export type NasdaqMarketQuote = {
  price: number
  change: number
  changePercent: number
  quoteTime: number
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

export async function fetchNasdaqMarketQuote(symbol: '^NDX' | 'NQ=F'): Promise<NasdaqMarketQuote> {
  const response = await fetch(`/api/yahoo-chart?${new URLSearchParams({ symbols: symbol })}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`指数行情请求失败：${response.status}`)
  const quote = parseNasdaqMarketQuote(await response.json() as unknown, symbol)
  if (!quote) throw new Error(`缺少 ${symbol} 有效行情`)
  return quote
}

export function formatNasdaqMarketTime(epochSeconds: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(epochSeconds * 1000)
}
