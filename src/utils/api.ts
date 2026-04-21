import type { PriceMap } from '../types'
import { cacheGet, cacheSet } from './cache'
import { STATIC_STOCKS } from '../data/stocks'

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
  if (first === '5') return `sh${str}` // 5xxxxx ETF → 腾讯均用 sh 前缀
  if (first === '1') return `sz${str}` // 159xxx 深交所ETF
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
    const res = await fetch(`/api/stock-price?${new URLSearchParams({ codes: txCodes.join(',') })}`)
    const body = await res.text()
    const parsed = parseTxBody(body)

    const result: PriceMap = {}
    for (const [parsedCode, data] of Object.entries(parsed)) {
      const origCode = reverseMap[parsedCode]
        ?? reverseMap[parsedCode.replace(/^0+/, '')]  // hk02318 → 2318 fallback
        ?? parsedCode
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
  return 0.88
}

export interface SearchResult {
  name: string
  code: string
  isHK: boolean
}

// Local search against STATIC_STOCKS — always available, no network
export function searchStocksLocal(keyword: string): SearchResult[] {
  const kw = keyword.toLowerCase()
  return (STATIC_STOCKS || [])
    .filter(s => s.name.includes(keyword) || s.code.toLowerCase().startsWith(kw))
    .slice(0, 6)
    .map(s => ({
      name: s.name,
      code: s.isHK
        ? String(s.code).replace(/^0+/, '').padStart(4, '0')
        : String(s.code).padStart(6, '0'),
      isHK: !!s.isHK,
    }))
}

// Tencent smartbox
async function searchViaTencent(keyword: string): Promise<SearchResult[]> {
  const res = await fetch(
    `/api/stock-search-tx?v=2&type=S&count=8&q=${encodeURIComponent(keyword)}`
  )
  const text = await res.text()
  const match = text.match(/="([^"]+)"/)
  if (!match || !match[1]) return []
  return parseCloudResults(match[1], 'tencent')
}

// East money suggest
async function searchViaEastMoney(keyword: string): Promise<SearchResult[]> {
  const res = await fetch(
    `/api/stock-search-em?input=${encodeURIComponent(keyword)}&type=14&token=D43BF722C8E33BDC906FB84D85E32628&count=8`
  )
  const json = await res.json()
  const list: Array<{ Code: string; Name: string; Classify: string }> =
    json?.QuotationCodeTable?.Data || []
  return list
    .filter(item => item.Classify === 'AStock' || item.Classify === 'HK' || item.Classify === 'Fund')
    .slice(0, 8)
    .map(item => ({
      name: item.Name,
      code: item.Classify === 'HK'
        ? item.Code.replace(/^0+/, '').padStart(4, '0')
        : item.Code.padStart(6, '0'),
      isHK: item.Classify === 'HK',
    }))
}

// Sina (original)
async function searchViaSina(keyword: string): Promise<SearchResult[]> {
  const res = await fetch(`/api/stock-search?key=${encodeURIComponent(keyword)}`)
  const buf = await res.arrayBuffer()
  const text = new TextDecoder('gbk').decode(buf)
  const match = text.match(/suggestvalue="([^"]*)"/)
  if (!match || !match[1] || match[1] === 'N') return []
  return parseCloudResults(match[1], 'sina')
}

function parseCloudResults(raw: string, source: 'tencent' | 'sina'): SearchResult[] {
  const results: SearchResult[] = []
  const entries = source === 'tencent' ? raw.split('^') : raw.split(';')
  for (const entry of entries) {
    if (!entry) continue
    const fields = entry.split('_')
    if (source === 'tencent') {
      // tencent: name_code_marketcode or name^... format
      const name = fields[0]
      const rawCode = fields[1] || ''
      const marketCode = fields[2] || ''
      if (!name || !rawCode) continue
      const isHK = marketCode.startsWith('hk') || rawCode.length <= 4
      results.push({
        name,
        code: isHK ? rawCode.replace(/^0+/, '').padStart(4, '0') : rawCode.padStart(6, '0'),
        isHK,
      })
    } else {
      // sina: name,type,code,...
      const [name, type, code] = fields
      if (!name || !code) continue
      const isHK = type === '31'
      const isA = ['11', '12', '13', '14', '15'].includes(type)
      if (!isHK && !isA) continue
      results.push({ name, code: isHK ? code.replace(/^0+/, '').padStart(4, '0') : code.padStart(6, '0'), isHK })
    }
    if (results.length >= 8) break
  }
  return results
}

// 纯数字代码搜索时，只保留代码包含关键词的结果
function filterByCode(results: SearchResult[], keyword: string): SearchResult[] {
  if (!/^\d+$/.test(keyword)) return results
  return results.filter(r => r.code.startsWith(keyword) || r.name.includes(keyword))
}

// Three-level fallback: local → Tencent → EastMoney → Sina → direct price check
export async function searchStocks(keyword: string, forceCloud = false): Promise<SearchResult[]> {
  if (!forceCloud) {
    const local = searchStocksLocal(keyword)
    if (local.length > 0) return local
  }
  try {
    const tx = filterByCode(await searchViaTencent(keyword), keyword)
    if (tx.length > 0) return tx
  } catch { /* fall through */ }
  try {
    const em = filterByCode(await searchViaEastMoney(keyword), keyword)
    if (em.length > 0) return em
  } catch { /* fall through */ }
  try {
    const sina = filterByCode(await searchViaSina(keyword), keyword)
    if (sina.length > 0) return sina
  } catch { /* fall through */ }
  // 兜底：直接拉价格验证6位代码是否存在
  if (/^\d{5,6}$/.test(keyword)) {
    try {
      const code = keyword.padStart(6, '0')
      const priceMap = await fetchStockPrices([{ code }], true)
      if (priceMap[code]?.price) {
        return [{ name: code, code, isHK: false }]
      }
    } catch { /* ignore */ }
  }
  return []
}
