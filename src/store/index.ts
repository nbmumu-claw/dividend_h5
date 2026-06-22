import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Stock, WatchlistStock } from '../types'
import { DEFAULT_SECTORS, STATIC_STOCKS } from '../data/stocks'
import { applyHolding, ensureTransactions, type Transaction } from '../utils/holdings'
import { makeFeeCalc, DEFAULT_FEE_CONFIG, type FeeConfig } from '../utils/fees'

const MAX_ACCOUNTS = 3
const DEFAULT_ACCOUNT_ID = 'default'
const DEFAULT_ACCOUNT_NAME = '我的账户'
const genAccountId = () => 'acc_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)

// 按当前费率重算一组持仓的摊薄成本（保证存储成本与 computeHolding 一致，避免卡片/详情不一致）
const recomputeList = (list: WatchlistStock[], cfg: FeeConfig): WatchlistStock[] =>
  list.map(w => applyHolding({ ...w }, Array.isArray(w.transactions) ? w.transactions : ensureTransactions(w), makeFeeCalc(w, cfg)))

// 发现页（静态 + 手动）对某代码的权威每股红利；找不到返回 undefined
function discoveryDividendOf(code: string, staticEdits: Record<string, Partial<Stock>>, manualStocks: Stock[]): number | undefined {
  const edit = staticEdits[code]
  if (edit && typeof edit.dividendPerShare === 'number') return edit.dividendPerShare
  const stat = STATIC_STOCKS.find(s => s.code === code)
  if (stat) return stat.dividendPerShare
  const man = manualStocks.find(s => s.code === code)
  return man ? man.dividendPerShare : undefined
}

interface AppState {
  // Watchlist
  watchlist: WatchlistStock[]
  addToWatchlist: (stock: Stock) => void
  removeFromWatchlist: (code: string) => void
  updateWatchlistStock: (code: string, updates: Partial<WatchlistStock>) => void
  batchUpdateWatchlist: (updates: Record<string, Partial<WatchlistStock>>) => void
  setWatchlist: (list: WatchlistStock[]) => void
  setTransactions: (code: string, txs: Transaction[]) => void
  // 将未手动改过的自选股每股红利同步为发现页（静态/手动）的权威值
  syncWatchlistDividends: () => void

  // 多账户（镜像法：活动账户持仓在 watchlist、费率在 feeConfig，其余存 accountSnapshots / accountFeeConfigs）
  accounts: { id: string; name: string }[]
  activeAccountId: string
  accountSnapshots: Record<string, WatchlistStock[]>
  accountFeeConfigs: Record<string, FeeConfig>
  switchAccount: (id: string) => void
  addAccount: (name: string) => string | null
  renameAccount: (id: string, name: string) => void
  removeAccount: (id: string) => void
  gatherAccounts: () => { id: string; name: string; watchlist: WatchlistStock[]; feeConfig: FeeConfig }[]

  // 交易手续费（按账户独立）
  feeConfig: FeeConfig
  setFeeConfig: (cfg: FeeConfig) => void

  // Discovery
  manualStocks: Stock[]
  staticEdits: Record<string, Partial<Stock>>
  hiddenStocks: string[]
  customSectors: string[]
  addManualStock: (stock: Stock) => void
  removeManualStock: (code: string) => void
  updateManualStock: (code: string, updates: Partial<Stock>) => void
  updateStaticEdit: (code: string, updates: Partial<Stock>) => void
  hideStock: (code: string) => void
  showStock: (code: string) => void
  setCustomSectors: (sectors: string[]) => void
  addSector: (name: string) => void
  renameSector: (oldName: string, newName: string) => void
  deleteSector: (name: string) => void

  // 三大类手动归类覆盖 { [code]: 'weak'|'strong'|'consume' }
  categoryOverrides: Record<string, string>
  setCategoryOverride: (code: string, cat: string | null) => void

  // Settings
  exchangeRate: number
  setExchangeRate: (rate: number) => void
  usdRate: number
  setUsdRate: (rate: number) => void
  agreementAccepted: boolean
  setAgreementAccepted: (v: boolean) => void

  // Import/export
  importBackup: (data: AppState['watchlist'] extends unknown ? Record<string, unknown> : never) => void
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Watchlist
      watchlist: [],
      addToWatchlist: (stock) =>
        set(s => {
          if (s.watchlist.find(w => w.code === stock.code)) return s
          return { watchlist: [...s.watchlist, { ...stock }] }
        }),
      removeFromWatchlist: (code) =>
        set(s => ({ watchlist: s.watchlist.filter(w => w.code !== code) })),
      updateWatchlistStock: (code, updates) =>
        set(s => ({
          watchlist: s.watchlist.map(w => w.code === code ? { ...w, ...updates } : w),
        })),
      batchUpdateWatchlist: (updates) =>
        set(s => ({
          watchlist: s.watchlist.map(w => w.code in updates ? { ...w, ...updates[w.code] } : w),
        })),
      setWatchlist: (list) => set({ watchlist: list }),
      syncWatchlistDividends: () =>
        set(s => {
          const fix = (list: WatchlistStock[]) => {
            let changed = false
            const next = list.map(w => {
              if (w.dividendManual) return w
              const dv = discoveryDividendOf(w.code, s.staticEdits, s.manualStocks)
              if (dv == null || dv === w.dividendPerShare) return w
              changed = true
              const price = Number(w.price) || 0
              return { ...w, dividendPerShare: dv, yieldRate: price > 0 && dv > 0 ? (dv / price) * 100 : 0 }
            })
            return changed ? next : list
          }
          const watchlist = fix(s.watchlist)
          let snapChanged = false
          const accountSnapshots: Record<string, WatchlistStock[]> = {}
          for (const [id, list] of Object.entries(s.accountSnapshots)) {
            const nl = fix(list); accountSnapshots[id] = nl
            if (nl !== list) snapChanged = true
          }
          if (watchlist === s.watchlist && !snapChanged) return s
          return { watchlist, accountSnapshots: snapChanged ? accountSnapshots : s.accountSnapshots }
        }),
      setTransactions: (code, txs) =>
        set(s => ({
          watchlist: s.watchlist.map(w =>
            w.code === code ? applyHolding({ ...w }, txs, makeFeeCalc(w, s.feeConfig)) : w
          ),
        })),

      // 多账户
      accounts: [{ id: DEFAULT_ACCOUNT_ID, name: DEFAULT_ACCOUNT_NAME }],
      activeAccountId: DEFAULT_ACCOUNT_ID,
      accountSnapshots: {},
      accountFeeConfigs: {},
      switchAccount: (id) =>
        set(s => {
          if (id === s.activeAccountId || !s.accounts.find(a => a.id === id)) return s
          const snapshots = { ...s.accountSnapshots, [s.activeAccountId]: s.watchlist }
          const feeConfigs = { ...s.accountFeeConfigs, [s.activeAccountId]: s.feeConfig }
          const targetCfg = feeConfigs[id] ?? DEFAULT_FEE_CONFIG
          // 载入目标账户时按「该账户的费率」重算摊薄成本
          const target = recomputeList(snapshots[id] ?? [], targetCfg)
          delete snapshots[id]; delete feeConfigs[id]
          return { accountSnapshots: snapshots, accountFeeConfigs: feeConfigs, watchlist: target, feeConfig: targetCfg, activeAccountId: id }
        }),
      addAccount: (name) => {
        const s = get()
        if (s.accounts.length >= MAX_ACCOUNTS) return null
        const id = genAccountId()
        set({
          accounts: [...s.accounts, { id, name: String(name || '新账户').trim() || '新账户' }],
          accountSnapshots: { ...s.accountSnapshots, [s.activeAccountId]: s.watchlist },
          accountFeeConfigs: { ...s.accountFeeConfigs, [s.activeAccountId]: s.feeConfig },
          watchlist: [],
          activeAccountId: id,
          feeConfig: { ...s.feeConfig }, // 新账户默认继承当前费率，可再单独修改
        })
        return id
      },
      renameAccount: (id, name) =>
        set(s => ({
          accounts: s.accounts.map(a => a.id === id ? { ...a, name: String(name || '').trim() || a.name } : a),
        })),
      removeAccount: (id) =>
        set(s => {
          if (s.accounts.length <= 1) return s
          const snapshots = { ...s.accountSnapshots }
          const feeConfigs = { ...s.accountFeeConfigs }
          let { watchlist, activeAccountId, feeConfig } = s
          if (id === s.activeAccountId) {
            // 删的是当前账户：切到别的，载入其持仓与费率并按该费率重算
            const other = s.accounts.find(a => a.id !== id)!
            feeConfig = feeConfigs[other.id] ?? DEFAULT_FEE_CONFIG
            watchlist = recomputeList(snapshots[other.id] ?? [], feeConfig)
            activeAccountId = other.id
            delete snapshots[other.id]; delete feeConfigs[other.id]
          }
          delete snapshots[id]; delete feeConfigs[id]
          return {
            accounts: s.accounts.filter(a => a.id !== id),
            accountSnapshots: snapshots,
            accountFeeConfigs: feeConfigs,
            watchlist,
            activeAccountId,
            feeConfig,
          }
        }),
      gatherAccounts: () => {
        const s = get()
        return s.accounts.map(a => ({
          id: a.id,
          name: a.name,
          watchlist: a.id === s.activeAccountId ? s.watchlist : (s.accountSnapshots[a.id] ?? []),
          feeConfig: a.id === s.activeAccountId ? s.feeConfig : (s.accountFeeConfigs[a.id] ?? DEFAULT_FEE_CONFIG),
        }))
      },

      // 交易手续费（按账户独立，仅作用于当前账户）
      feeConfig: DEFAULT_FEE_CONFIG,
      setFeeConfig: (cfg) =>
        set(s => ({
          feeConfig: cfg,
          // 改费率后只重算当前账户的摊薄成本（其余账户各有自己的费率）
          watchlist: recomputeList(s.watchlist, cfg),
        })),

      // Discovery
      manualStocks: [],
      staticEdits: {},
      hiddenStocks: [],
      customSectors: [...DEFAULT_SECTORS],
      addManualStock: (stock) =>
        set(s => {
          if (s.manualStocks.find(m => m.code === stock.code)) return s
          return { manualStocks: [...s.manualStocks, stock] }
        }),
      removeManualStock: (code) =>
        set(s => ({ manualStocks: s.manualStocks.filter(m => m.code !== code) })),
      updateManualStock: (code, updates) =>
        set(s => ({
          manualStocks: s.manualStocks.map(m => m.code === code ? { ...m, ...updates } : m),
          watchlist: s.watchlist.map(w => w.code === code ? { ...w, ...updates } : w),
        })),
      updateStaticEdit: (code, updates) =>
        set(s => ({
          staticEdits: { ...s.staticEdits, [code]: { ...s.staticEdits[code], ...updates } },
          watchlist: s.watchlist.map(w => w.code === code ? { ...w, ...updates } : w),
        })),
      hideStock: (code) =>
        set(s => ({ hiddenStocks: s.hiddenStocks.includes(code) ? s.hiddenStocks : [...s.hiddenStocks, code] })),
      showStock: (code) =>
        set(s => ({ hiddenStocks: s.hiddenStocks.filter(c => c !== code) })),
      setCustomSectors: (sectors) => set({ customSectors: sectors }),
      addSector: (name) =>
        set(s => {
          if (s.customSectors.includes(name)) return s
          const othersIdx = s.customSectors.indexOf('其他')
          const sectors = [...s.customSectors]
          if (othersIdx >= 0) sectors.splice(othersIdx, 0, name)
          else sectors.push(name)
          return { customSectors: sectors }
        }),
      renameSector: (oldName, newName) =>
        set(s => {
          const extraEdits: Record<string, Partial<Stock>> = {}
          STATIC_STOCKS.forEach(st => {
            const effectiveSector = s.staticEdits[st.code]?.sector ?? st.sector
            if (effectiveSector === oldName) {
              extraEdits[st.code] = { ...(s.staticEdits[st.code] || {}), sector: newName }
            }
          })
          return {
            customSectors: s.customSectors.map(sec => sec === oldName ? newName : sec),
            manualStocks: s.manualStocks.map(st => st.sector === oldName ? { ...st, sector: newName } : st),
            watchlist: s.watchlist.map(st => st.sector === oldName ? { ...st, sector: newName } : st),
            staticEdits: { ...s.staticEdits, ...extraEdits },
          }
        }),
      deleteSector: (name) =>
        set(s => ({
          customSectors: s.customSectors.filter(sec => sec !== name),
        })),

      // 三大类手动归类覆盖
      categoryOverrides: {},
      setCategoryOverride: (code, cat) =>
        set(s => {
          const next = { ...s.categoryOverrides }
          if (cat) next[code] = cat
          else delete next[code]
          return { categoryOverrides: next }
        }),

      // Settings
      exchangeRate: 0.88,
      setExchangeRate: (rate) => set({ exchangeRate: rate }),
      usdRate: 7.25,
      setUsdRate: (rate) => set({ usdRate: rate }),
      agreementAccepted: false,
      setAgreementAccepted: (v) => set({ agreementAccepted: v }),

      importBackup: (data) => {
        const d = data as {
          watchlist?: WatchlistStock[]
          accounts?: { id: string; name: string; watchlist?: WatchlistStock[]; feeConfig?: FeeConfig }[]
          discoveryManualStocks?: Stock[]
          discoveryStaticEdits?: Record<string, Partial<Stock>>
          discoveryHiddenStocks?: string[]
          discoveryCustomSectors?: string[]
          // 旧版格式兼容
          manualStocks?: Stock[]
          staticEdits?: Record<string, Partial<Stock>>
          hiddenStocks?: string[]
          customSectors?: string[]
        }

        // 账户：新格式 data.accounts；否则旧格式单账户落到默认账户
        let accounts: { id: string; name: string }[]
        let activeAccountId: string
        let accountSnapshots: Record<string, WatchlistStock[]>
        let accountFeeConfigs: Record<string, FeeConfig>
        let watchlist: WatchlistStock[]
        let activeFeeConfig: FeeConfig | undefined
        const curFee = get().feeConfig
        if (Array.isArray(d.accounts) && d.accounts.length > 0) {
          accounts = d.accounts.map((a, i) => ({
            id: a.id || (i === 0 ? DEFAULT_ACCOUNT_ID : genAccountId()),
            name: a.name || DEFAULT_ACCOUNT_NAME,
          }))
          activeAccountId = accounts[0].id
          watchlist = d.accounts[0].watchlist || []
          // 旧备份无按账户费率：活动账户用当前费率兜底，避免切换后成本归零
          activeFeeConfig = d.accounts[0].feeConfig ?? curFee
          accountSnapshots = {}
          accountFeeConfigs = {}
          d.accounts.slice(1).forEach((a, i) => {
            accountSnapshots[accounts[i + 1].id] = a.watchlist || []
            // 缺失则沿用当前费率，保持与旧版（单一全局费率）一致
            accountFeeConfigs[accounts[i + 1].id] = a.feeConfig ?? curFee
          })
        } else {
          accounts = [{ id: DEFAULT_ACCOUNT_ID, name: DEFAULT_ACCOUNT_NAME }]
          activeAccountId = DEFAULT_ACCOUNT_ID
          accountSnapshots = {}
          accountFeeConfigs = {}
          watchlist = d.watchlist || []
        }

        set({
          watchlist,
          accounts,
          activeAccountId,
          accountSnapshots,
          accountFeeConfigs,
          manualStocks: d.discoveryManualStocks || d.manualStocks || [],
          staticEdits: d.discoveryStaticEdits || d.staticEdits || {},
          hiddenStocks: d.discoveryHiddenStocks || d.hiddenStocks || [],
          customSectors: d.discoveryCustomSectors || d.customSectors || [...DEFAULT_SECTORS],
          // 备份含账户费率则恢复活动账户费率（旧备份无则保持当前）
          ...(activeFeeConfig ? { feeConfig: activeFeeConfig } : {}),
        })
      },
    }),
    {
      name: 'xuxu-efu-store',
      version: 6,
      migrate: (persisted) => {
        const s = persisted as { customSectors?: string[]; accounts?: unknown }
        if (s?.customSectors && !s.customSectors.includes('红利ETF')) {
          const sectors = [...s.customSectors]
          const othersIdx = sectors.indexOf('其他')
          if (othersIdx >= 0) sectors.splice(othersIdx, 0, '红利ETF')
          else sectors.push('红利ETF')
          s.customSectors = sectors
        }
        if (s?.customSectors && !s.customSectors.includes('美股')) {
          const sectors = [...s.customSectors]
          const othersIdx = sectors.indexOf('其他')
          if (othersIdx >= 0) sectors.splice(othersIdx, 0, '美股')
          else sectors.push('美股')
          s.customSectors = sectors
        }
        // v4：白酒与能源对换位置
        if (s?.customSectors) {
          const a = s.customSectors.indexOf('白酒')
          const b = s.customSectors.indexOf('能源')
          if (a >= 0 && b >= 0) {
            const sectors = [...s.customSectors]
            ;[sectors[a], sectors[b]] = [sectors[b], sectors[a]]
            s.customSectors = sectors
          }
        }
        // v5：多账户。只在缺失时补账户字段，绝不触碰 watchlist（老持仓→默认账户）
        if (!Array.isArray(s.accounts)) {
          const m = s as Record<string, unknown>
          m.accounts = [{ id: DEFAULT_ACCOUNT_ID, name: DEFAULT_ACCOUNT_NAME }]
          m.activeAccountId = DEFAULT_ACCOUNT_ID
          m.accountSnapshots = {}
        }
        // v6：手续费按账户。补 accountFeeConfigs：非活动账户沿用旧的全局 feeConfig，行为不变
        const m = s as Record<string, unknown>
        if (!m.accountFeeConfigs || typeof m.accountFeeConfigs !== 'object') {
          const accts = (m.accounts as { id: string }[]) || []
          const active = m.activeAccountId
          const fc = m.feeConfig
          const map: Record<string, unknown> = {}
          if (fc) for (const a of accts) { if (a.id !== active) map[a.id] = fc }
          m.accountFeeConfigs = map
        }
        return s
      },
    }
  )
)

// Derived helper: get all discovery stocks for a sector
export function getDiscoveryStocks(sector: string): Stock[] {
  const { staticEdits, hiddenStocks, manualStocks } = useStore.getState()

  const staticForSector = STATIC_STOCKS
    .filter(s => !hiddenStocks.includes(s.code))
    .map(s => ({ ...s, ...(staticEdits[s.code] || {}) }))
    .filter(s => s.sector === sector)

  const manualForSector = manualStocks.filter(s => s.sector === sector)

  return [...staticForSector, ...manualForSector]
}
