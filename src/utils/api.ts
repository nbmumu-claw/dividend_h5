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

function parseTxBody(body: string): Record<string, { price: number; preClose: number; pctChg: number; tradeDate: string; marketCap?: number }> {
  const result: Record<string, { price: number; preClose: number; pctChg: number; tradeDate: string; marketCap?: number }> = {}
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
    const marketCap = fields.length > 45 ? parseFloat(fields[45]) || undefined : undefined
    result[code] = { price, preClose, pctChg, tradeDate, marketCap }
  }
  return result
}

export interface StockInput {
  code: string
  isHK?: boolean
  isUS?: boolean
}

async function fetchTxPrices(stocks: StockInput[], forceRefresh: boolean): Promise<PriceMap> {
  const cacheKey = 'txPrice:' + stocks.map(s => s.code).sort().join(',')
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

    for (const s of stocks) {
      if (!(s.code in result)) result[s.code] = null
    }

    cacheSet(cacheKey, result, PRICE_TTL)
    return result
  } catch {
    return Object.fromEntries(stocks.map(s => [s.code, null]))
  }
}

async function fetchYfPrices(stocks: StockInput[], forceRefresh: boolean): Promise<PriceMap> {
  const cacheKey = 'yfPrice:' + stocks.map(s => s.code).sort().join(',')
  if (!forceRefresh) {
    const cached = cacheGet<PriceMap>(cacheKey)
    if (cached) return cached
  }

  const result: PriceMap = {}
  await Promise.all(stocks.map(async s => {
    try {
      const res = await fetch(`/api/stock-price-us?${new URLSearchParams({ symbol: s.code })}`)
      const json = await res.json()
      const meta = json?.chart?.result?.[0]?.meta
      if (!meta?.regularMarketPrice) { result[s.code] = null; return }
      const price = meta.regularMarketPrice as number
      const preClose = (meta.chartPreviousClose ?? meta.previousClose ?? price) as number
      result[s.code] = {
        price,
        preClose,
        pctChg: preClose > 0 ? ((price - preClose) / preClose) * 100 : 0,
        tradeDate: meta.regularMarketTime
          ? new Date((meta.regularMarketTime as number) * 1000).toISOString().slice(0, 10).replace(/-/g, '')
          : '',
        source: 'yahoo',
      }
    } catch {
      result[s.code] = null
    }
  }))

  cacheSet(cacheKey, result, PRICE_TTL)
  return result
}

export async function fetchStockPrices(stocks: StockInput[], forceRefresh = false): Promise<PriceMap> {
  if (!stocks.length) return {}

  const usStocks = stocks.filter(s => s.isUS)
  const otherStocks = stocks.filter(s => !s.isUS)

  const [txResult, yfResult] = await Promise.all([
    otherStocks.length ? fetchTxPrices(otherStocks, forceRefresh) : Promise.resolve({}),
    usStocks.length ? fetchYfPrices(usStocks, forceRefresh) : Promise.resolve({}),
  ])

  return { ...txResult, ...yfResult }
}

export async function fetchExchangeRate(forceRefresh = false): Promise<number> {
  const cacheKey = 'exchangeRate'
  if (!forceRefresh) {
    const cached = cacheGet<number>(cacheKey)
    if (cached) return cached
  }
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

export async function fetchUsdRate(forceRefresh = false): Promise<number> {
  const cacheKey = 'usdRate'
  if (!forceRefresh) {
    const cached = cacheGet<number>(cacheKey)
    if (cached) return cached
  }
  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD')
    const json = await res.json()
    const rate = json?.rates?.CNY
    if (rate && rate > 5.0 && rate < 10.0) {
      cacheSet(cacheKey, rate, RATE_TTL)
      return rate
    }
  } catch {
    // fall through
  }
  return 7.25
}

export interface SearchResult {
  name: string
  code: string
  isHK: boolean
  isUS?: boolean
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

// US exchanges on Yahoo Finance
const US_EXCHANGES = new Set(['NMS', 'NYQ', 'NGM', 'PCX', 'ASE', 'NasdaqGS', 'NASDAQ', 'NYSE', 'CBT', 'NYB'])

// Yahoo Finance search for US stocks
async function searchViaYahooUS(keyword: string): Promise<SearchResult[]> {
  const res = await fetch(`/api/stock-search-us?q=${encodeURIComponent(keyword)}`)
  const json = await res.json()
  const quotes: Array<{
    symbol?: string
    shortname?: string
    longname?: string
    quoteType?: string
    exchange?: string
  }> = json?.quotes || []

  return quotes
    .filter(q =>
      q.symbol &&
      (q.quoteType === 'EQUITY' || q.quoteType === 'ETF') &&
      !q.symbol.includes('=') &&
      !q.symbol.includes('.') &&  // exclude AAPL.SW, AAPL.DE etc.
      US_EXCHANGES.has(q.exchange || '')
    )
    .slice(0, 8)
    .map(q => ({
      name: q.shortname || q.longname || q.symbol!,
      code: q.symbol!,
      isHK: false,
      isUS: true,
    }))
}

const OWNER_MEM_CACHE: Record<string, string> = {}
const OWNER_LS_KEY = 'owner-type-cache'
const OWNER_TTL = 180 * 24 * 60 * 60 * 1000 // 半年

function ownerLsGet(code: string): string | null {
  try {
    const raw = localStorage.getItem(OWNER_LS_KEY)
    if (!raw) return null
    const store: Record<string, { v: string; t: number }> = JSON.parse(raw)
    const entry = store[code]
    if (!entry || Date.now() - entry.t > OWNER_TTL) return null
    return entry.v
  } catch { return null }
}

function ownerLsSet(code: string, value: string) {
  try {
    const raw = localStorage.getItem(OWNER_LS_KEY)
    const store: Record<string, { v: string; t: number }> = raw ? JSON.parse(raw) : {}
    store[code] = { v: value, t: Date.now() }
    localStorage.setItem(OWNER_LS_KEY, JSON.stringify(store))
  } catch { /* ignore quota errors */ }
}

const CENTRAL_SOE_KEYWORDS = ['国务院', '中央汇金', '中国投资有限', '招商局', '中国烟草', '中国石油', '中国石化', '中国移动', '中国联通', '中国电信', '国家电网', '中国华能', '中国大唐', '中国华电', '中国国电', '国家开发投资', '中粮', '中国铁建', '中国中铁', '中国交通', '中国建筑', '中国航空', '中国远洋', '中国海运', '中国五矿', '中国铝业', '中国宝武', '中国兵器', '中国航天', '中国电子', '中国核工业']
const LOCAL_SOE_KEYWORDS = ['国有资产监督', '人民政府', '国资委', '省政府', '市政府']

function classifyName(name: string): '央企' | '地方国企' | '民营' | null {
  if (CENTRAL_SOE_KEYWORDS.some(kw => name.includes(kw))) return '央企'
  if (LOCAL_SOE_KEYWORDS.some(kw => name.includes(kw))) return '地方国企'
  return null
}

export async function fetchOwnerType(code: string): Promise<string> {
  if (OWNER_MEM_CACHE[code]) return OWNER_MEM_CACHE[code]
  const cached = ownerLsGet(code)
  if (cached) { OWNER_MEM_CACHE[code] = cached; return cached }

  try {
    const res = await fetch(`/api/company-nature?code=${code}`)
    const data = await res.json()
    const holderName: string | null = data?.sjkzr?.[0]?.HOLDER_NAME ?? null

    let ownerType = '未知'

    if (holderName) {
      ownerType = classifyName(holderName) ?? '民营'
    } else {
      const sdgd: Array<{ HOLDER_NAME?: string }> = data?.sdgd || []
      for (const s of sdgd) {
        const n = s.HOLDER_NAME || ''
        if (!n || n.includes('中央结算') || n.includes('代理人')) continue
        const result = classifyName(n)
        if (result) { ownerType = result; break }
      }
    }

    OWNER_MEM_CACHE[code] = ownerType
    ownerLsSet(code, ownerType)
    return ownerType
  } catch {
    return '未知'
  }
}

// 纯数字代码搜索时，只保留代码包含关键词的结果
function filterByCode(results: SearchResult[], keyword: string): SearchResult[] {
  if (!/^\d+$/.test(keyword)) return results
  return results.filter(r => r.code.startsWith(keyword) || r.name.includes(keyword))
}

// Three-level fallback: local → Tencent → EastMoney → Sina → Yahoo Finance (US) → direct price check
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
  // Try Yahoo Finance for US stocks
  try {
    const yf = await searchViaYahooUS(keyword)
    if (yf.length > 0) return yf
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
