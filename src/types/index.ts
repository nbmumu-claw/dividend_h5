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
  isUS?: boolean
  isETF?: boolean
  isFund?: boolean   // 场外开放式基金：现价取净值(NAV)，行情走天天基金接口
  // 港股结算现金：港股通为人民币，港户为港币；未设置时默认港股通人民币。
  cashCurrency?: 'CNY' | 'HKD'
  isManual?: boolean
  priceCny?: number
  priceLabel?: string
  pctChg?: number | null
}

export interface WatchlistStock extends Stock {
  shares?: number
  costPrice?: string
  taxType?: 'h' | 'n' | 'a'
  marketCap?: number
  transactions?: import('../utils/holdings').Transaction[]
  // 每股红利是否被手动改过：true 则不再跟随发现页同步
  dividendManual?: boolean
}

export interface PriceData {
  price: number
  preClose?: number
  pctChg?: number
  tradeDate?: string
  tradeTime?: string  // 行情时间 yyyymmddHHMMSS（股价对应的时刻，非抓取时刻）
  source?: string
  marketCap?: number
  name?: string  // 股票名称（仅兜底搜索时用到）
}

export interface PriceMap {
  [code: string]: PriceData | null
}

export interface BackupData {
  version: string
  exportedAt: string
  data: {
    watchlist: WatchlistStock[]
    accounts?: { id: string; name: string; watchlist: WatchlistStock[]; feeConfig?: import('../utils/fees').FeeConfig }[]
    discoveryManualStocks: Stock[]
    discoveryStaticEdits: Record<string, Partial<Stock>>
    discoveryHiddenStocks: string[]
    discoveryCustomSectors: string[]
  }
}
