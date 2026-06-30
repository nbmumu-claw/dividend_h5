import type { PriceMap } from '../types'
import { cacheGet, cacheSet } from './cache'
import { STATIC_STOCKS } from '../data/stocks'

const PRICE_TTL = 15 * 60 * 1000
const RATE_TTL = 6 * 60 * 60 * 1000

// 内存级股价缓存（per-code），页面间共享，无需反复读 localStorage
type MemEntry = { data: Exclude<PriceMap[string], null>; expiresAt: number }
const priceMemCache = new Map<string, MemEntry>()
function memGet(code: string): MemEntry | undefined {
  const e = priceMemCache.get(code)
  if (!e) return undefined
  if (Date.now() > e.expiresAt) { priceMemCache.delete(code); return undefined }
  return e
}
function memSet(code: string, data: Exclude<PriceMap[string], null>) {
  priceMemCache.set(code, { data, expiresAt: Date.now() + PRICE_TTL })
}

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
  if (first === '9') return `sh${str}` // 900xxx 沪市B股
  if (first === '2') return `sz${str}` // 200xxx 深市B股
  return `sh${str}`
}

type ParsedPrice = { price: number; preClose: number; pctChg: number; tradeDate: string; tradeTime: string; marketCap?: number; name?: string }

function parseTxBody(body: string): Record<string, ParsedPrice> {
  const result: Record<string, ParsedPrice> = {}
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
    const name = fields[1] || undefined  // 股票名称
    const pctChg = parseFloat(fields[32]) || 0
    const raw = (fields[30] || '').replace(/\D/g, '')  // yyyymmddHHMMSS
    const tradeDate = raw.slice(0, 8)
    const tradeTime = raw.length >= 12 ? raw.slice(0, 14) : ''  // 行情时间（含时分秒）
    const marketCap = fields.length > 45 ? parseFloat(fields[45]) || undefined : undefined
    result[code] = { price, preClose, pctChg, tradeDate, tradeTime, marketCap, name }
  }
  return result
}

export interface StockInput {
  code: string
  isHK?: boolean
  isUS?: boolean
  isFund?: boolean
}

async function fetchTxPrices(stocks: StockInput[], forceRefresh: boolean): Promise<PriceMap> {
  // 1) 先查内存缓存 (per-code), 收集已缓存的
  const result: PriceMap = {}
  const toFetch: StockInput[] = []
  for (const s of stocks) {
    if (forceRefresh) { toFetch.push(s); continue }
    const m = memGet(s.code)
    if (m) { result[s.code] = m.data; continue }
    toFetch.push(s)
  }
  if (!toFetch.length) return result

  // 2) 未命中的查 localStorage 批量缓存
  const cacheKey = 'txPrice:' + toFetch.map(s => s.code).sort().join(',')
  if (!forceRefresh) {
    const cached = cacheGet<PriceMap>(cacheKey)
    if (cached) {
      for (const s of toFetch) {
        const d = cached[s.code]
        if (d && d.price) { result[s.code] = d; memSet(s.code, d) }
      }
      return result
    }
  }

  // 3) API 拉取
  const reverseMap: Record<string, string> = {}
  const txCodes = toFetch.map(s => {
    const tx = toTxCode(s.code, s.isHK)
    const numeric = tx.replace(/^[a-z]+/, '')
    reverseMap[numeric] = s.code
    return tx
  })

  try {
    const res = await fetch(`/api/stock-price?${new URLSearchParams({ codes: txCodes.join(',') })}`)
    const body = await res.text()
    const parsed = parseTxBody(body)

    const fresh: PriceMap = {}
    for (const [parsedCode, data] of Object.entries(parsed)) {
      const origCode = reverseMap[parsedCode]
        ?? reverseMap[parsedCode.replace(/^0+/, '')]
        ?? parsedCode
      fresh[origCode] = { ...data, source: 'txzq' }
      memSet(origCode, fresh[origCode]!)
    }

    for (const s of toFetch) {
      if (!(s.code in fresh)) fresh[s.code] = null
    }

    cacheSet(cacheKey, fresh, PRICE_TTL)
    return { ...result, ...fresh }
  } catch {
    for (const s of toFetch) result[s.code] = null
    return result
  }
}

async function fetchYfPrices(stocks: StockInput[], forceRefresh: boolean): Promise<PriceMap> {
  // 先查内存缓存
  const result: PriceMap = {}
  const toFetch: StockInput[] = []
  for (const s of stocks) {
    if (forceRefresh) { toFetch.push(s); continue }
    const m = memGet(s.code)
    if (m) { result[s.code] = m.data; continue }
    toFetch.push(s)
  }
  if (!toFetch.length) return result

  // 未命中的查 localStorage 批量缓存
  const cacheKey = 'yfPrice:' + toFetch.map(s => s.code).sort().join(',')
  if (!forceRefresh) {
    const cached = cacheGet<PriceMap>(cacheKey)
    if (cached) {
      for (const s of toFetch) {
        const d = cached[s.code]
        if (d && d.price) { result[s.code] = d; memSet(s.code, d) }
      }
      return result
    }
  }

  // 批量请求：一次 Vercel Function 调用拉取全部美股
  try {
    const symbols = toFetch.map(s => s.code).join(',')
    const res = await fetch(`/api/stock-price-us?${new URLSearchParams({ symbols })}`)
    const json = await res.json()
    const fresh: PriceMap = {}
    for (const s of toFetch) {
      const raw = json[s.code]
      const meta = raw?.chart?.result?.[0]?.meta
      if (!meta?.regularMarketPrice) { fresh[s.code] = null; continue }
      const price = meta.regularMarketPrice as number
      const preClose = (meta.chartPreviousClose ?? meta.previousClose ?? price) as number
      fresh[s.code] = {
        price,
        preClose,
        pctChg: preClose > 0 ? ((price - preClose) / preClose) * 100 : 0,
        tradeDate: meta.regularMarketTime
          ? new Date((meta.regularMarketTime as number) * 1000).toISOString().slice(0, 10).replace(/-/g, '')
          : '',
        source: 'yahoo',
      }
      memSet(s.code, fresh[s.code]!)
    }
    cacheSet(cacheKey, fresh, PRICE_TTL)
    return { ...result, ...fresh }
  } catch {
    for (const s of toFetch) result[s.code] = null
    return result
  }
}

// 场外基金净值：天天基金历史净值接口取最新一条（净值=现价、JZZZL=当日涨跌、FSRQ=净值日期）
async function fetchFundPrices(stocks: StockInput[], forceRefresh: boolean): Promise<PriceMap> {
  const result: PriceMap = {}
  const toFetch: StockInput[] = []
  for (const s of stocks) {
    if (!forceRefresh) { const m = memGet(s.code); if (m) { result[s.code] = m.data; continue } }
    toFetch.push(s)
  }
  if (!toFetch.length) return result

  const fresh: PriceMap = {}
  await Promise.all(toFetch.map(async s => {
    try {
      const res = await fetch(`/api/fund-quote?${new URLSearchParams({ code: s.code })}`)
      const json = await res.json()
      const row = json?.Data?.LSJZList?.[0]
      const price = row ? parseFloat(row.DWJZ) : 0
      if (!price || price <= 0) { fresh[s.code] = null; return }
      const pct = parseFloat(row.JZZZL) || 0
      const data = {
        price,
        preClose: pct ? price / (1 + pct / 100) : price,
        pctChg: pct,
        tradeDate: String(row.FSRQ || '').replace(/-/g, ''),
        source: 'fund',
      }
      fresh[s.code] = data
      memSet(s.code, data)
    } catch { fresh[s.code] = null }
  }))
  return { ...result, ...fresh }
}

export async function fetchStockPrices(stocks: StockInput[], forceRefresh = false): Promise<PriceMap> {
  if (!stocks.length) return {}

  const usStocks = stocks.filter(s => s.isUS)
  const fundStocks = stocks.filter(s => !s.isUS && s.isFund)
  const otherStocks = stocks.filter(s => !s.isUS && !s.isFund)

  const [txResult, yfResult, fundResult] = await Promise.all([
    otherStocks.length ? fetchTxPrices(otherStocks, forceRefresh) : Promise.resolve({}),
    usStocks.length ? fetchYfPrices(usStocks, forceRefresh) : Promise.resolve({}),
    fundStocks.length ? fetchFundPrices(fundStocks, forceRefresh) : Promise.resolve({}),
  ])

  return { ...txResult, ...yfResult, ...fundResult }
}

/** 后台预热缓存：拉取价格存入内存缓存，不返回数据。用于全局定时轮询，让页面间切换秒开。 */
export async function warmPrices(stocks: StockInput[]): Promise<void> {
  await fetchStockPrices(stocks).catch(() => {})
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
  isFund?: boolean
}

// 基金分红（场内 ETF / 场外开放式基金通用）：解析 f10 分红送配页的「权益登记日 + 每份派现金」
export async function fetchFundDividend(code: string): Promise<{ recordDate: string; perShare: number }[]> {
  try {
    const res = await fetch(`/api/fund-dividend?${new URLSearchParams({ code })}`)
    const html = await res.text()
    const out: { recordDate: string; perShare: number }[] = []
    // 行结构：<td>年份</td><td>权益登记日</td><td>除息日</td><td>每份派现金X元</td><td>发放日</td>
    const re = /<td>(\d{4}-\d{2}-\d{2})<\/td><td>\d{4}-\d{2}-\d{2}<\/td><td>每份派现金([\d.]+)元<\/td>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(html))) {
      const perShare = parseFloat(m[2])
      if (perShare > 0) out.push({ recordDate: m[1], perShare })
    }
    return out
  } catch {
    return []
  }
}

// 由分红记录推算「年度每份红利」：取近 12 个月派现求和；一年内无派现则退回最近一次
export function annualFundDividend(events: { recordDate: string; perShare: number }[]): number {
  if (!events.length) return 0
  const now = Date.now()
  const yearAgo = now - 365 * 24 * 60 * 60 * 1000
  const within = events.filter(e => {
    const t = new Date(e.recordDate + 'T00:00:00').getTime()
    return t <= now && t >= yearAgo
  })
  if (within.length) return within.reduce((s, e) => s + e.perShare, 0)
  const past = events
    .filter(e => new Date(e.recordDate + 'T00:00:00').getTime() <= now)
    .sort((a, b) => b.recordDate.localeCompare(a.recordDate))
  return past.length ? past[0].perShare : 0
}

// 场外基金搜索：天天基金 fundsuggest
// fundsuggest 返回混合类别：CATEGORY 100=沪市 200=港股 700=基金，只保留 700（真正的基金），
// 否则会把同名股票（如「贵州茅台」）误标成场外基金。
export async function searchFunds(keyword: string): Promise<SearchResult[]> {
  try {
    const res = await fetch(`/api/fund-search?${new URLSearchParams({ key: keyword })}`)
    const json = await res.json()
    const list: Array<{ CODE?: string; NAME?: string; CATEGORY?: number | string }> = json?.Datas || []
    return list
      .filter(d => d.CODE && d.NAME && Number(d.CATEGORY) === 700)
      .slice(0, 6)
      .map(d => ({ name: String(d.NAME), code: String(d.CODE).padStart(6, '0'), isHK: false, isFund: true }))
  } catch {
    return []
  }
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
    .filter(item => item.Classify === 'AStock' || item.Classify === 'BStock' || item.Classify === 'HK' || item.Classify === 'Fund')
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
      const isB = ['21', '22'].includes(type)  // 21=沪B, 22=深B
      if (!isHK && !isA && !isB) continue
      results.push({ name, code: isHK ? code.replace(/^0+/, '').padStart(4, '0') : code.padStart(6, '0'), isHK })
    }
    if (results.length >= 8) break
  }
  return results
}

// US exchanges on Yahoo Finance
const US_EXCHANGES = new Set(['NMS', 'NYQ', 'NGM', 'PCX', 'ASE', 'BTS', 'NCM', 'NasdaqGS', 'NASDAQ', 'NYSE', 'CBT', 'NYB'])

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
const OWNER_LS_KEY = 'owner-type-cache-v2'
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
  // 以"中国"开头的集团/公司，通常为国务院直属央企（如中国海洋石油集团、中国华润有限公司）
  if (/^中国.{0,15}(集团|总公司|有限公司|有限责任公司)/.test(name)) return '央企'
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
        const stockName = (priceMap[code] as { name?: string })?.name || code
        return [{ name: stockName, code, isHK: false }]
      }
    } catch { /* ignore */ }
  }
  return []
}
