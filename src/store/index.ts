import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Stock, WatchlistStock } from '../types'
import { DEFAULT_SECTORS, STATIC_STOCKS } from '../data/stocks'
import { applyHolding, ensureTransactions, type Transaction } from '../utils/holdings'
import { makeFeeCalc, DEFAULT_FEE_CONFIG, type FeeConfig } from '../utils/fees'
import { migrateRedFundSector, NEW_RED_SECTOR, NEW_US_SECTOR } from '../utils/sectorMigrate'
import { migrateStatsScope, type StatsScope } from '../utils/statsScopeMigrate'
import { EMPTY_CASH, normalizeCash, currencyOf, transactionCashFlow, type CashBalances, type CashCurrency } from '../utils/cash'

// 网格页偏好（纳入账号体系，跟随云同步）
export interface GridPrefs {
  custom: { sector: string; name: string; code: string; dive: number; isHK?: boolean }[]
  favs: string[]
  hidden: string[]
  sectorOrder: string[]
  stockOrder: string[]
  cfg: { buyStep: number; buyCount: number; sellStep: number; sellCount: number; lowerTolerance: number; middleTolerance: number; upperTolerance: number; yieldTolerance: number }
  sort: { key: string; dir: 'asc' | 'desc' }
  active: string
  collapsed: Record<string, string[]> // 各 tab（筛选）下已折叠的板块名，互不影响
  yieldStarts: { code: string; buy: number; sell: number }[]
}
const DEFAULT_GRID_PREFS: GridPrefs = {
  custom: [],
  favs: [],
  hidden: [],
  sectorOrder: ['电力', '水电', '银行', '保险', '能源', '通讯', '白色家电', '中药', '运输', '白酒', '消费', '其他'],
  stockOrder: [],
  cfg: { buyStep: 0.005, buyCount: 4, sellStep: 0.005, sellCount: 4, lowerTolerance: 0.0025, middleTolerance: 0.01, upperTolerance: 0.0025, yieldTolerance: 0.0025 },
  sort: { key: 'cy', dir: 'desc' },
  active: '全部',
  collapsed: {},
  yieldStarts: [
    { code: '600900', buy: 0.04, sell: 0.03 },
    { code: '600886', buy: 0.04, sell: 0.03 },
  ],
}

const MAX_ACCOUNTS = 3
const DEFAULT_ACCOUNT_ID = 'default'
const DEFAULT_ACCOUNT_NAME = '我的账户'
const genAccountId = () => 'acc_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)

// 按当前费率重算一组持仓的摊薄成本（保证存储成本与 computeHolding 一致，避免卡片/详情不一致）
const recomputeList = (list: WatchlistStock[], cfg: FeeConfig): WatchlistStock[] =>
  list.map(w => applyHolding({ ...w }, Array.isArray(w.transactions) ? w.transactions : ensureTransactions(w), makeFeeCalc(w, cfg)))

// CloudBase NoSQL（类 MongoDB）会把对象键里的 "." 当作嵌套路径，导致 simStrategy.shares
// 的费率键 "6.0" 被存成 {"6":{"0":...}}，同步回来读不到就像丢了。统一改用无点键 "6_0"，
// 并把历史的「本地点号键 6.0」「云端嵌套键 6→{0:..}」「已是新键 6_0」三种都规整还原。
function normalizeShares(shares: unknown): Record<string, number> {
  if (!shares || typeof shares !== 'object') return {}
  const out: Record<string, number> = {}
  const put = (rate: number, val: unknown) => {
    // 与 Matrix 的 simKey 一致：去尾零的无点键（"6.0"→6_0，"5.25"→5_25）
    if (isFinite(rate)) out[rate.toFixed(2).replace(/0$/, '').replace('.', '_')] = Number(val) || 0
  }
  for (const [k, v] of Object.entries(shares as Record<string, unknown>)) {
    if (v !== null && typeof v === 'object') {
      // 云端被点号拆成的嵌套：k + '.' + sub = 原费率
      for (const [sub, val] of Object.entries(v as Record<string, unknown>)) put(parseFloat(`${k}.${sub}`), val)
    } else if (k === 'cur') {
      out.cur = Number(v) || 0
    } else if (k.includes('.')) {
      put(parseFloat(k), v) // 本地旧点号键 "6.0"
    } else {
      out[k] = Number(v) || 0 // 已是新无点键 "6_0" / "cur"
    }
  }
  return out
}
function normalizeSimStrategy(sim: unknown): Record<string, { end: number; shares: Record<string, number>; step?: number }> {
  if (!sim || typeof sim !== 'object') return {}
  const out: Record<string, { end: number; shares: Record<string, number>; step?: number }> = {}
  for (const [code, v] of Object.entries(sim as Record<string, { end?: number; shares?: unknown; step?: number }>)) {
    out[code] = { end: Number(v?.end) || 0, shares: normalizeShares(v?.shares), ...(v?.step ? { step: Number(v.step) } : {}) }
  }
  return out
}

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
  cashBalance: CashBalances
  accountCashBalances: Record<string, CashBalances>
  cashOpeningBalance: CashBalances
  accountCashOpeningBalances: Record<string, CashBalances>
  cashTrackingEnabled: boolean
  accountCashTracking: Record<string, boolean>
  switchAccount: (id: string) => void
  addAccount: (name: string) => string | null
  renameAccount: (id: string, name: string) => void
  removeAccount: (id: string) => void
  gatherAccounts: () => { id: string; name: string; watchlist: WatchlistStock[]; feeConfig: FeeConfig; cashBalance: CashBalances; cashOpeningBalance: CashBalances; cashTrackingEnabled: boolean }[]
  setCashBalance: (currency: CashCurrency, amount: number) => void
  setAccountCashBalance: (id: string, currency: CashCurrency, amount: number) => void
  changeCashBalance: (id: string, currency: CashCurrency, amount: number) => void
  setOpeningCashBalance: (id: string, currency: CashCurrency, amount: number) => void
  addOpeningCashBalance: (id: string, currency: CashCurrency, amount: number) => void

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
  // 收益页统计范围（默认全部）
  statsScope: StatsScope
  setStatsScope: (v: StatsScope) => void

  // 网格页偏好（纳入云同步）
  gridPrefs: GridPrefs
  setGridPrefs: (patch: Partial<GridPrefs>) => void

  // 模拟加仓策略（决策矩阵页·纯推演偏好，按股票存，绝不影响真实持仓数据）
  // 结构：{ [code]: { end: 终点股息率, shares: { [档位股息率.toFixed(1)]: 该档股数 } } }
  simStrategy: Record<string, { end: number; shares: Record<string, number>; step?: number }>
  setSimStrategy: (code: string, patch: Partial<{ end: number; shares: Record<string, number>; step?: number }>) => void

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
        set(s => {
          const stock = s.watchlist.find(w => w.code === code)
          if (!stock) return s
          const previous = Array.isArray(stock.transactions) ? stock.transactions : ensureTransactions(stock)
          const delta = transactionCashFlow(stock, txs, s.feeConfig) - transactionCashFlow(stock, previous, s.feeConfig)
          const currency = currencyOf(stock)
          return {
            watchlist: s.watchlist.map(w => w.code === code ? applyHolding({ ...w }, txs, makeFeeCalc(w, s.feeConfig)) : w),
            ...(s.cashTrackingEnabled ? { cashBalance: { ...s.cashBalance, [currency]: s.cashBalance[currency] + delta } } : {}),
          }
        }),

      // 多账户
      accounts: [{ id: DEFAULT_ACCOUNT_ID, name: DEFAULT_ACCOUNT_NAME }],
      activeAccountId: DEFAULT_ACCOUNT_ID,
      accountSnapshots: {},
      accountFeeConfigs: {},
      cashBalance: { ...EMPTY_CASH },
      accountCashBalances: {},
      cashOpeningBalance: { ...EMPTY_CASH },
      accountCashOpeningBalances: {},
      cashTrackingEnabled: false,
      accountCashTracking: {},
      switchAccount: (id) =>
        set(s => {
          if (id === s.activeAccountId || !s.accounts.find(a => a.id === id)) return s
          const snapshots = { ...s.accountSnapshots, [s.activeAccountId]: s.watchlist }
          const feeConfigs = { ...s.accountFeeConfigs, [s.activeAccountId]: s.feeConfig }
          const cashBalances = { ...s.accountCashBalances, [s.activeAccountId]: s.cashBalance }
          const openingBalances = { ...s.accountCashOpeningBalances, [s.activeAccountId]: s.cashOpeningBalance }
          const cashTracking = { ...s.accountCashTracking, [s.activeAccountId]: s.cashTrackingEnabled }
          const targetCfg = feeConfigs[id] ?? DEFAULT_FEE_CONFIG
          const targetCash = cashBalances[id] ?? { ...EMPTY_CASH }
          const targetOpening = openingBalances[id] ?? { ...EMPTY_CASH }
          // 载入目标账户时按「该账户的费率」重算摊薄成本
          const target = recomputeList(snapshots[id] ?? [], targetCfg)
          const targetTracking = cashTracking[id] ?? false
          delete snapshots[id]; delete feeConfigs[id]; delete cashBalances[id]; delete openingBalances[id]; delete cashTracking[id]
          return { accountSnapshots: snapshots, accountFeeConfigs: feeConfigs, accountCashBalances: cashBalances, accountCashOpeningBalances: openingBalances, accountCashTracking: cashTracking, watchlist: target, feeConfig: targetCfg, cashBalance: targetCash, cashOpeningBalance: targetOpening, cashTrackingEnabled: targetTracking, activeAccountId: id }
        }),
      addAccount: (name) => {
        const s = get()
        if (s.accounts.length >= MAX_ACCOUNTS) return null
        const id = genAccountId()
        set({
          accounts: [...s.accounts, { id, name: String(name || '新账户').trim() || '新账户' }],
          accountSnapshots: { ...s.accountSnapshots, [s.activeAccountId]: s.watchlist },
          accountFeeConfigs: { ...s.accountFeeConfigs, [s.activeAccountId]: s.feeConfig },
          accountCashBalances: { ...s.accountCashBalances, [s.activeAccountId]: s.cashBalance },
          accountCashOpeningBalances: { ...s.accountCashOpeningBalances, [s.activeAccountId]: s.cashOpeningBalance },
          accountCashTracking: { ...s.accountCashTracking, [s.activeAccountId]: s.cashTrackingEnabled },
          watchlist: [],
          cashBalance: { ...EMPTY_CASH },
          cashOpeningBalance: { ...EMPTY_CASH },
          cashTrackingEnabled: false,
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
          const cashBalances = { ...s.accountCashBalances }
          let { watchlist, activeAccountId, feeConfig, cashBalance } = s
          if (id === s.activeAccountId) {
            // 删的是当前账户：切到别的，载入其持仓与费率并按该费率重算
            const other = s.accounts.find(a => a.id !== id)!
            feeConfig = feeConfigs[other.id] ?? DEFAULT_FEE_CONFIG
            cashBalance = cashBalances[other.id] ?? { ...EMPTY_CASH }
            watchlist = recomputeList(snapshots[other.id] ?? [], feeConfig)
            activeAccountId = other.id
            delete snapshots[other.id]; delete feeConfigs[other.id]; delete cashBalances[other.id]
          }
          delete snapshots[id]; delete feeConfigs[id]; delete cashBalances[id]
          return {
            accounts: s.accounts.filter(a => a.id !== id),
            accountSnapshots: snapshots,
            accountFeeConfigs: feeConfigs,
            accountCashBalances: cashBalances,
            watchlist,
            activeAccountId,
            feeConfig,
            cashBalance,
          }
        }),
      gatherAccounts: () => {
        const s = get()
        return s.accounts.map(a => ({
          id: a.id,
          name: a.name,
          watchlist: a.id === s.activeAccountId ? s.watchlist : (s.accountSnapshots[a.id] ?? []),
          feeConfig: a.id === s.activeAccountId ? s.feeConfig : (s.accountFeeConfigs[a.id] ?? DEFAULT_FEE_CONFIG),
          cashBalance: a.id === s.activeAccountId ? s.cashBalance : (s.accountCashBalances[a.id] ?? { ...EMPTY_CASH }),
          cashOpeningBalance: a.id === s.activeAccountId ? s.cashOpeningBalance : (s.accountCashOpeningBalances[a.id] ?? { ...EMPTY_CASH }),
          cashTrackingEnabled: a.id === s.activeAccountId ? s.cashTrackingEnabled : (s.accountCashTracking[a.id] ?? false),
        }))
      },
      setCashBalance: (currency, amount) => set(s => ({ cashBalance: { ...s.cashBalance, [currency]: Math.max(0, Number(amount) || 0) } })),
      setAccountCashBalance: (id, currency, amount) =>
        set(s => {
          if (!s.accounts.some(a => a.id === id)) return s
          const value = Math.max(0, Number(amount) || 0)
          return id === s.activeAccountId
            ? { cashBalance: { ...s.cashBalance, [currency]: value } }
            : { accountCashBalances: { ...s.accountCashBalances, [id]: { ...normalizeCash(s.accountCashBalances[id]), [currency]: value } } }
        }),
      changeCashBalance: (id, currency, amount) => set(s => {
        if (!s.accounts.some(a => a.id === id)) return s
        const apply = (balance: CashBalances) => ({ ...balance, [currency]: balance[currency] + amount })
        return id === s.activeAccountId
          ? { cashBalance: apply(s.cashBalance), cashTrackingEnabled: true }
          : { accountCashBalances: { ...s.accountCashBalances, [id]: apply(normalizeCash(s.accountCashBalances[id])) }, accountCashTracking: { ...s.accountCashTracking, [id]: true } }
      }),
      setOpeningCashBalance: (id, currency, amount) => set(s => {
        if (!s.accounts.some(a => a.id === id)) return s
        const next = Math.max(0, Number(amount) || 0)
        const update = (cash: CashBalances, opening: CashBalances) => {
          const previous = opening[currency]
          return {
            cash: { ...cash, [currency]: cash[currency] + next - previous },
          opening: { ...opening, [currency]: next },
          }
        }
        if (id === s.activeAccountId) {
          const nextState = update(s.cashBalance, s.cashOpeningBalance)
          return { cashBalance: nextState.cash, cashOpeningBalance: nextState.opening, cashTrackingEnabled: true }
        }
        const nextState = update(normalizeCash(s.accountCashBalances[id]), normalizeCash(s.accountCashOpeningBalances[id]))
        return { accountCashBalances: { ...s.accountCashBalances, [id]: nextState.cash }, accountCashOpeningBalances: { ...s.accountCashOpeningBalances, [id]: nextState.opening }, accountCashTracking: { ...s.accountCashTracking, [id]: true } }
      }),
      addOpeningCashBalance: (id, currency, amount) => set(s => {
        if (!s.accounts.some(a => a.id === id)) return s
        const value = Math.max(0, Number(amount) || 0)
        const apply = (cash: CashBalances, opening: CashBalances) => ({
          cash: { ...cash, [currency]: cash[currency] + value },
          opening: { ...opening, [currency]: value },
        })
        if (id === s.activeAccountId) {
          const next = apply(s.cashBalance, s.cashOpeningBalance)
          return { cashBalance: next.cash, cashOpeningBalance: next.opening, cashTrackingEnabled: true }
        }
        const next = apply(normalizeCash(s.accountCashBalances[id]), normalizeCash(s.accountCashOpeningBalances[id]))
        return { accountCashBalances: { ...s.accountCashBalances, [id]: next.cash }, accountCashOpeningBalances: { ...s.accountCashOpeningBalances, [id]: next.opening }, accountCashTracking: { ...s.accountCashTracking, [id]: true } }
      }),

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
      statsScope: 'all',
      setStatsScope: (v) => set({ statsScope: v }),

      // 网格页偏好
      gridPrefs: { ...DEFAULT_GRID_PREFS },
      setGridPrefs: (patch) => set(s => ({ gridPrefs: { ...s.gridPrefs, ...patch } })),

      // 模拟加仓策略（纯页面推演偏好，绝不生成交易、不改 shares/costPrice）
      simStrategy: {},
      setSimStrategy: (code, patch) =>
        set(s => ({
          simStrategy: {
            ...s.simStrategy,
            [code]: { ...(s.simStrategy[code] ?? { end: 0, shares: {} }), ...patch },
          },
        })),

      importBackup: (data) => {
        const d = data as {
          watchlist?: WatchlistStock[]
          accounts?: { id: string; name: string; watchlist?: WatchlistStock[]; feeConfig?: FeeConfig; cashBalance?: CashBalances | number; cashOpeningBalance?: CashBalances | number; cashTrackingEnabled?: boolean }[]
          discoveryManualStocks?: Stock[]
          discoveryStaticEdits?: Record<string, Partial<Stock>>
          discoveryHiddenStocks?: string[]
          discoveryCustomSectors?: string[]
          gridPrefs?: GridPrefs
          // 旧版格式兼容
          manualStocks?: Stock[]
          staticEdits?: Record<string, Partial<Stock>>
          hiddenStocks?: string[]
          customSectors?: string[]
          simStrategy?: Record<string, { end: number; shares: Record<string, number>; step?: number }>
        }

        // 板块「红利ETF」→「红利基金」：云端/旧备份数据进来时一并改名（与 migrate 同步，防止云端旧名覆盖回去）
        migrateRedFundSector(d as Record<string, unknown>)

        // 账户：新格式 data.accounts；否则旧格式单账户落到默认账户
        let accounts: { id: string; name: string }[]
        let activeAccountId: string
        let accountSnapshots: Record<string, WatchlistStock[]>
        let accountFeeConfigs: Record<string, FeeConfig>
        let accountCashBalances: Record<string, CashBalances>
        let accountCashOpeningBalances: Record<string, CashBalances>
        let accountCashTracking: Record<string, boolean>
        let watchlist: WatchlistStock[]
        let activeFeeConfig: FeeConfig | undefined
        let cashBalance: CashBalances = { ...EMPTY_CASH }
        let cashOpeningBalance: CashBalances = { ...EMPTY_CASH }
        let cashTrackingEnabled = false
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
          cashBalance = normalizeCash(d.accounts[0].cashBalance)
          cashOpeningBalance = normalizeCash(d.accounts[0].cashOpeningBalance)
          cashTrackingEnabled = Boolean(d.accounts[0].cashTrackingEnabled) || Object.values(cashBalance).some(v => v !== 0)
          accountSnapshots = {}
          accountFeeConfigs = {}
          accountCashBalances = {}
          accountCashOpeningBalances = {}
          accountCashTracking = {}
          d.accounts.slice(1).forEach((a, i) => {
            accountSnapshots[accounts[i + 1].id] = a.watchlist || []
            // 缺失则沿用当前费率，保持与旧版（单一全局费率）一致
            accountFeeConfigs[accounts[i + 1].id] = a.feeConfig ?? curFee
            accountCashBalances[accounts[i + 1].id] = normalizeCash(a.cashBalance)
            accountCashOpeningBalances[accounts[i + 1].id] = normalizeCash(a.cashOpeningBalance)
            accountCashTracking[accounts[i + 1].id] = Boolean(a.cashTrackingEnabled) || Object.values(accountCashBalances[accounts[i + 1].id]).some(v => v !== 0)
          })
        } else {
          accounts = [{ id: DEFAULT_ACCOUNT_ID, name: DEFAULT_ACCOUNT_NAME }]
          activeAccountId = DEFAULT_ACCOUNT_ID
          accountSnapshots = {}
          accountFeeConfigs = {}
          accountCashBalances = {}
          accountCashOpeningBalances = {}
          accountCashTracking = {}
          watchlist = d.watchlist || []
        }

        // 网格页偏好：云端同步或旧备份恢复
        const gridPrefs = d.gridPrefs as GridPrefs | undefined
        const mergedGridPrefs = gridPrefs ? { ...DEFAULT_GRID_PREFS, ...gridPrefs } : get().gridPrefs

        set({
          watchlist,
          accounts,
          activeAccountId,
          accountSnapshots,
          accountFeeConfigs,
          cashBalance,
          accountCashBalances,
          cashOpeningBalance,
          accountCashOpeningBalances,
          cashTrackingEnabled,
          accountCashTracking,
          manualStocks: d.discoveryManualStocks || d.manualStocks || [],
          staticEdits: d.discoveryStaticEdits || d.staticEdits || {},
          hiddenStocks: d.discoveryHiddenStocks || d.hiddenStocks || [],
          customSectors: d.discoveryCustomSectors || d.customSectors || [...DEFAULT_SECTORS],
          // 备份含账户费率则恢复活动账户费率（旧备份无则保持当前）
          ...(activeFeeConfig ? { feeConfig: activeFeeConfig } : {}),
          // 云端有网格偏好则恢复（合并默认值补缺字段），否则保持本地
          gridPrefs: mergedGridPrefs,
          // 模拟加仓策略：云端有则恢复，否则保持本地；规整还原被点号拆坏的费率键
          simStrategy: normalizeSimStrategy(d.simStrategy ?? get().simStrategy),
        })
      },
    }),
    {
      name: 'xuxu-efu-store',
      version: 12,
      migrate: (persisted) => {
        const s = persisted as { customSectors?: string[]; accounts?: unknown }
        // v10：历史板块别名统一到 H5 标准名称（含“美股”→“美股指数”）。
        migrateRedFundSector(s as Record<string, unknown>)
        if (s?.customSectors && !s.customSectors.includes(NEW_RED_SECTOR)) {
          const sectors = [...s.customSectors]
          const othersIdx = sectors.indexOf('其他')
          if (othersIdx >= 0) sectors.splice(othersIdx, 0, NEW_RED_SECTOR)
          else sectors.push(NEW_RED_SECTOR)
          s.customSectors = sectors
        }
        if (s?.customSectors && !s.customSectors.includes(NEW_US_SECTOR)) {
          const sectors = [...s.customSectors]
          const othersIdx = sectors.indexOf('其他')
          if (othersIdx >= 0) sectors.splice(othersIdx, 0, NEW_US_SECTOR)
          else sectors.push(NEW_US_SECTOR)
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
        // v11：现金按账户独立保存，历史数据默认现金为 0。
        if (!m.accountCashBalances || typeof m.accountCashBalances !== 'object') m.accountCashBalances = {}
        m.cashBalance = normalizeCash(m.cashBalance)
        if (!m.accountCashOpeningBalances || typeof m.accountCashOpeningBalances !== 'object') m.accountCashOpeningBalances = {}
        m.cashOpeningBalance = normalizeCash(m.cashOpeningBalance)
        if (!m.accountCashTracking || typeof m.accountCashTracking !== 'object') m.accountCashTracking = {}
        if (typeof m.cashTrackingEnabled !== 'boolean') m.cashTrackingEnabled = Object.values(normalizeCash(m.cashBalance)).some(v => v !== 0)
        // v7：simStrategy.shares 费率键去点号，并还原历史被点号拆坏的数据
        if (m.simStrategy) m.simStrategy = normalizeSimStrategy(m.simStrategy)
        // v9：布尔「美股纳入统计」→ 三态 statsScope（幂等，逻辑见 statsScopeMigrate + 其单测）
        migrateStatsScope(m)
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
