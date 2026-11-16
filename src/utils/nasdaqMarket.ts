export type NasdaqMarketQuote = {
  price: number
  change: number
  changePercent: number
  quoteTime: number
  ytd?: { percent: number; baseDate: string; baseClose: number } | null
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function parseNasdaqMarketQuote(body: unknown, symbol: string): NasdaqMarketQuote | null {
  const response = object(body)
  const chart = object(object(response?.[symbol])?.chart ?? response?.chart)
  const result = chart?.result
  const meta = Array.isArray(result) ? object(object(result[0])?.meta) : null
  if (!meta || meta.symbol !== symbol) return null

  const { regularMarketPrice: price, chartPreviousClose: previousClose, regularMarketTime: quoteTime } = meta
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0
    || typeof previousClose !== 'number' || !Number.isFinite(previousClose) || previousClose <= 0
    || typeof quoteTime !== 'number' || !Number.isFinite(quoteTime) || quoteTime <= 0) return null

  return { price, change: price - previousClose, changePercent: (price / previousClose - 1) * 100, quoteTime }
}

export function parseNasdaqIndexYtd(body: unknown, quote: NasdaqMarketQuote): NasdaqMarketQuote['ytd'] {
  const response = object(body)
  const chart = object(object(response?.['^NDX'])?.chart ?? response?.chart)
  const results = chart?.result
  const series = Array.isArray(results) ? object(results[0]) : null
  if (object(series?.meta)?.symbol !== '^NDX') return null
  const timestamps = series?.timestamp
  const indicators = object(series?.indicators)?.quote
  const closes = Array.isArray(indicators) ? object(indicators[0])?.close : null
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return null
  const marketDate = (seconds: number) => new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(seconds * 1000)
  const year = Number(marketDate(quote.quoteTime).slice(0, 4))
  let baseDate = ''
  let baseClose = 0
  timestamps.forEach((timestamp, index) => {
    const close = closes[index]
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)
      || typeof close !== 'number' || !Number.isFinite(close) || close <= 0) return
    const date = marketDate(timestamp)
    if (date.startsWith(String(year - 1)) && date > baseDate) { baseDate = date; baseClose = close }
  })
  return baseClose ? { percent: (quote.price / baseClose - 1) * 100, baseDate, baseClose } : null
}

export async function fetchNasdaqMarketQuote(symbol: '^NDX' | 'NQ=F'): Promise<NasdaqMarketQuote> {
  const response = await fetch(`/api/yahoo-chart?${new URLSearchParams({ symbols: symbol })}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`指数行情请求失败：${response.status}`)
  const quote = parseNasdaqMarketQuote(await response.json() as unknown, symbol)
  if (!quote) throw new Error(`缺少 ${symbol} 有效行情`)
  if (symbol === '^NDX') {
    try {
      const history = await fetch('/api/yahoo-chart?symbols=%5ENDX&range=2y', { signal: AbortSignal.timeout(10000) })
      quote.ytd = history.ok ? parseNasdaqIndexYtd(await history.json(), quote) : null
    } catch { quote.ytd = null } // 历史行情失败不影响现价和日涨跌展示。
  }
  return quote
}

export function formatNasdaqMarketTime(epochSeconds: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(epochSeconds * 1000)
}
