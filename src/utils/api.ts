import type { PriceMap } from '../types'
import { cacheGet, cacheSet } from './cache'

const PRICE_TTL = 5 * 60 * 1000
const RATE_TTL = 6 * 60 * 60 * 1000

function toTxCode(code: string, isHK?: boolean): string {
  if (isHK) {
    const digits = String(code).replace(/^0+/, '') || '0'
    return `hk${digits.padStart(5, '0')}`
  }
  const str = String(code).padStart(6, '0')
  const first = str[0]
  if (first === '6') return `sh${str}`
  if (first === '0' || first === '3') return `sz${str}`
  if (first === '8' || first === '4') return `bj${str}`
  return `sh${str}`
}

function parseTxBody(body: string): Record<string, { price: number; preClose: number; pctChg: number; tradeDate: string }> {
  const result: Record<string, { price: number; preClose: number; pctChg: number; tradeDate: string }> = {}
  const lines = body.split('\n')
  for (const line of lines) {
    const match = line.match(/v_[a-z]{2}(\d{5,6})="([^"]*)"/)
    if (!match) continue
    const code = match[1]
    const fields = match[2].split('~')
    if (fields.length < 33) continue
    const price = parseFloat(fields[3])
    const preClose = parseFloat(fields[4])
    if (!price || price <= 0) continue
    const pctChg = parseFloat(fields[32]) || 0
    const tradeDate = (fields[30] || '').replace(/\D/g, '').slice(0, 8)
    result[code] = { price, preClose, pctChg, tradeDate }
  }
  return result
}

export interface StockInput {
  code: string
  isHK?: boolean
}

export async function fetchStockPrices(stocks: StockInput[], forceRefresh = false): Promise<PriceMap> {
  if (!stocks.length) return {}

  const cacheKey = 'stockPrice:' + stocks.map(s => s.code).sort().join(',')
  if (!forceRefresh) {
    const cached = cacheGet<PriceMap>(cacheKey)
    if (cached) return cached
  }

  const reverseMap: Record<string, string> = {}
  const txCodes = stocks.map(s => {
    const tx = toTxCode(s.code, s.isHK)
    const numeric = tx.replace(/^[a-z]+/, '')
    reverseMap[numeric] = s.code
    return tx
  })

  try {
    const res = await fetch(`/api/stock-price?${txCodes.join(',')}`)
    const body = await res.text()
    const parsed = parseTxBody(body)

    const result: PriceMap = {}
    for (const [parsedCode, data] of Object.entries(parsed)) {
      const origCode = reverseMap[parsedCode] || parsedCode
      result[origCode] = { ...data, source: 'txzq' }
    }

    // fill nulls for missing
    for (const s of stocks) {
      if (!(s.code in result)) result[s.code] = null
    }

    cacheSet(cacheKey, result, PRICE_TTL)
    return result
  } catch {
    return Object.fromEntries(stocks.map(s => [s.code, null]))
  }
}

export async function fetchExchangeRate(forceRefresh = false): Promise<number> {
  const cacheKey = 'exchangeRate'
  if (!forceRefresh) {
    const cached = cacheGet<number>(cacheKey)
    if (cached) return cached
  }
  // Use a CORS-friendly approach — try multiple sources
  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/HKD')
    const json = await res.json()
    const rate = json?.rates?.CNY
    if (rate && rate > 0.5 && rate < 2.0) {
      cacheSet(cacheKey, rate, RATE_TTL)
      return rate
    }
  } catch {
    // fall through
  }
  return 0.92
}

export interface SearchResult {
  name: string
  code: string
  isHK: boolean
}

export async function searchStocks(keyword: string): Promise<SearchResult[]> {
  try {
    const res = await fetch(`/api/stock-search?v=2&type=S&count=8&q=${encodeURIComponent(keyword)}`)
    const text = await res.text()
    // Parse smartbox format: v_hint="0^code^name^..."
    const results: SearchResult[] = []
    const matches = text.matchAll(/(\d+)\^([^~^]+)\^([^~^]+)/g)
    for (const m of matches) {
      const type = m[1]
      const code = m[2]
      const name = m[3]
      if (!code || !name) continue
      const isHK = type === '3' || code.length <= 5
      results.push({ name, code: isHK ? code.replace(/^0+/, '').padStart(4, '0') : code.padStart(6, '0'), isHK })
      if (results.length >= 8) break
    }
    return results
  } catch {
    return []
  }
}
