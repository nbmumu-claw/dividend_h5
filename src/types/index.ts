export interface Stock {
  code: string
  name: string
  sector: string
  price: number
  dividendPerShare: number
  yieldRate: number
  confirmed: boolean
  targetYield?: number
  targetPrice?: number
  price2026?: number
  change2026?: number
  isHK?: boolean
  isManual?: boolean
  priceCny?: number
  priceLabel?: string
  pctChg?: number | null
}

export interface WatchlistStock extends Stock {
  shares?: number
  costPrice?: string
  taxType?: 'h' | 'n' | 'a'
}

export interface PriceData {
  price: number
  preClose?: number
  pctChg?: number
  tradeDate?: string
  source?: string
}

export interface PriceMap {
  [code: string]: PriceData | null
}

export interface BackupData {
  version: string
  exportedAt: string
  data: {
    watchlist: WatchlistStock[]
    discoveryManualStocks: Stock[]
    discoveryStaticEdits: Record<string, Partial<Stock>>
    discoveryHiddenStocks: string[]
    discoveryCustomSectors: string[]
  }
}
