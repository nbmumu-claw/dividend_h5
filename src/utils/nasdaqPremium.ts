import type { NasdaqMarketQuote } from './nasdaqMarket'
import type { NasdaqPerformance, PerformanceKey } from './nasdaqPerformance'

export type NasdaqQuote = {
  code: string
  price: number
  change: number
  iopv: number
  premium: number
  size: number
  turnover: number
  tradeTime: string
}

export type NasdaqSortKey = 'change' | 'premium' | 'iopv' | 'size' | 'turnover' | 'fee' | 'ytdGap' | PerformanceKey
export type NasdaqSort = { key: NasdaqSortKey; direction: 'asc' | 'desc' }

// 百分点差；币种、交易时点不同，不作为跟踪误差。
export function nasdaqYtdGap(performance: NasdaqPerformance | undefined, index: NasdaqMarketQuote | null | undefined): number | null {
  const fundYtd = performance?.returns.ytd
  const indexYtd = index?.ytd?.percent
  if (!index || fundYtd == null || indexYtd == null || !Number.isFinite(fundYtd) || !Number.isFinite(indexYtd)) return null
  const indexYear = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric' }).format(index.quoteTime * 1000)
  if (performance?.date.slice(0, 4) !== indexYear) return null
  return fundYtd - indexYtd
}

export function compareNasdaqFunds(
  a: { code: string; manage: number; custody: number },
  b: { code: string; manage: number; custody: number },
  quotes: Record<string, NasdaqQuote>,
  sort: NasdaqSort,
  performance: Record<string, NasdaqPerformance> = {},
  index?: NasdaqMarketQuote | null,
): number {
  const value = (fund: { code: string; manage: number; custody: number }) => {
    if (sort.key === 'ytdGap') return nasdaqYtdGap(performance[fund.code], index)
    if (sort.key === 'fee') return fund.manage + fund.custody
    if (sort.key === 'week' || sort.key === 'month' || sort.key === 'quarter' || sort.key === 'year' || sort.key === 'ytd') {
      return performance[fund.code]?.returns[sort.key]
    }
    return quotes[fund.code]?.[sort.key]
  }
  const aValue = value(a)
  const bValue = value(b)
  if (aValue == null) return bValue == null ? 0 : 1
  if (bValue == null) return -1
  return (aValue - bValue) * (sort.direction === 'asc' ? 1 : -1)
}

// 腾讯 ETF 行情：3 现价、30 时间、32 涨跌%、57 成交额(万元)、72 份额(份)、78 IOPV。
export function parseNasdaqQuotes(body: string): Record<string, NasdaqQuote> {
  const quotes: Record<string, NasdaqQuote> = {}
  for (const match of body.matchAll(/v_(?:sh|sz)(\d{6})="([^"]*)"/g)) {
    const fields = match[2].split('~')
    if (fields.length <= 78) continue
    const [price, change, amountWan, shares, iopv] = [3, 32, 57, 72, 78].map(index => Number(fields[index]))
    const tradeTime = fields[30] || ''
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(change) || !Number.isFinite(amountWan)
      || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(iopv) || iopv <= 0
      || !/^\d{14}$/.test(tradeTime)) continue
    quotes[match[1]] = {
      code: match[1], price, change, iopv,
      premium: (price / iopv - 1) * 100,
      size: shares * iopv / 1e8,
      turnover: amountWan / 1e4,
      tradeTime,
    }
  }
  return quotes
}

export function formatQuoteTime(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)} ${value.slice(8, 10)}:${value.slice(10, 12)}`
}
