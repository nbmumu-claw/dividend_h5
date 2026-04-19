import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Stock, WatchlistStock } from '../types'
import { DEFAULT_SECTORS, STATIC_STOCKS } from '../data/stocks'

interface AppState {
  // Watchlist
  watchlist: WatchlistStock[]
  addToWatchlist: (stock: Stock) => void
  removeFromWatchlist: (code: string) => void
  updateWatchlistStock: (code: string, updates: Partial<WatchlistStock>) => void
  batchUpdateWatchlist: (updates: Record<string, Partial<WatchlistStock>>) => void
  setWatchlist: (list: WatchlistStock[]) => void

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

  // Settings
  exchangeRate: number
  setExchangeRate: (rate: number) => void
  agreementAccepted: boolean
  setAgreementAccepted: (v: boolean) => void

  // Import/export
  importBackup: (data: AppState['watchlist'] extends unknown ? Record<string, unknown> : never) => void
}

function mergeWatchlistWithPrices(watchlist: WatchlistStock[]): WatchlistStock[] {
  return watchlist
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
        set(s => ({
          customSectors: s.customSectors.map(sec => sec === oldName ? newName : sec),
          manualStocks: s.manualStocks.map(st => st.sector === oldName ? { ...st, sector: newName } : st),
          watchlist: s.watchlist.map(st => st.sector === oldName ? { ...st, sector: newName } : st),
        })),
      deleteSector: (name) =>
        set(s => ({
          customSectors: s.customSectors.filter(sec => sec !== name),
        })),

      // Settings
      exchangeRate: 0.88,
      setExchangeRate: (rate) => set({ exchangeRate: rate }),
      agreementAccepted: false,
      setAgreementAccepted: (v) => set({ agreementAccepted: v }),

      importBackup: (data) => {
        const d = data as {
          watchlist?: WatchlistStock[]
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
        set({
          watchlist: d.watchlist || [],
          manualStocks: d.discoveryManualStocks || d.manualStocks || [],
          staticEdits: d.discoveryStaticEdits || d.staticEdits || {},
          hiddenStocks: d.discoveryHiddenStocks || d.hiddenStocks || [],
          customSectors: d.discoveryCustomSectors || d.customSectors || [...DEFAULT_SECTORS],
        })
      },
    }),
    {
      name: 'xuxu-efu-store',
    }
  )
)

// Derived helper: get all discovery stocks for a sector
export function getDiscoveryStocks(sector: string): Stock[] {
  const { staticEdits, hiddenStocks, manualStocks } = useStore.getState()

  const staticForSector = STATIC_STOCKS
    .filter(s => s.sector === sector && !hiddenStocks.includes(s.code))
    .map(s => ({ ...s, ...(staticEdits[s.code] || {}) }))

  const manualForSector = manualStocks.filter(s => s.sector === sector)

  return [...staticForSector, ...manualForSector]
}
