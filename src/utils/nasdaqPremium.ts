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
