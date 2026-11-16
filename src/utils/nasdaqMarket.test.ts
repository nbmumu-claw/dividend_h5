import { describe, expect, it } from 'vitest'
import { formatNasdaqMarketTime, parseNasdaqMarketQuote, parseNasdaqIndexYtd } from './nasdaqMarket'

const chart = { chart: { result: [{ meta: {
  symbol: '^NDX', regularMarketPrice: 28289.19, chartPreviousClose: 28374.25, regularMarketTime: 1794521759,
} }] } }

describe('Nasdaq market quote parsing', () => {
  it('reads the production batch envelope and computes change from previous close', () => {
    const quote = parseNasdaqMarketQuote({ '^NDX': chart }, '^NDX')
    expect(quote?.price).toBe(28289.19)
    expect(quote?.change).toBeCloseTo(-85.06)
    expect(quote?.changePercent).toBeCloseTo((28289.19 / 28374.25 - 1) * 100)
    expect(quote?.quoteTime).toBe(1794521759)
  })

  it('reads the local proxy chart shape', () => {
    expect(parseNasdaqMarketQuote(chart, '^NDX')?.price).toBe(28289.19)
  })

  it('rejects missing, invalid or wrong-symbol prices', () => {
    expect(parseNasdaqMarketQuote({}, '^NDX')).toBeNull()
    expect(parseNasdaqMarketQuote(chart, 'NQ=F')).toBeNull()
    expect(parseNasdaqMarketQuote({ chart: { result: [{ meta: { ...chart.chart.result[0].meta, regularMarketPrice: 0 } }] } }, '^NDX')).toBeNull()
  })

  it('formats the source quote time in Beijing time', () => {
    expect(formatNasdaqMarketTime(1794521759)).toBe('11/13 06:15')
  })
})

describe('Nasdaq index YTD', () => {
  const quote = { price: 120, change: 1, changePercent: 1, quoteTime: Date.parse('2026-11-13T21:00:00Z') / 1000 }
  const history = { chart: { result: [{ meta: { symbol: '^NDX' }, timestamp: ['2025-12-30', '2025-12-31', '2026-01-02'].map(date => Date.parse(date + 'T21:00:00Z') / 1000), indicators: { quote: [{ close: [90, 100, 110] }] } }] } }
  it('compares latest quote to last previous-year close in both response shapes', () => {
    for (const data of [history, { '^NDX': history }]) {
      expect(parseNasdaqIndexYtd(data, quote)?.percent).toBeCloseTo(20)
      expect(parseNasdaqIndexYtd(data, quote)?.baseDate).toBe('2025-12-31')
    }
  })
  it('does not substitute first current-year close when the baseline is missing', () => {
    expect(parseNasdaqIndexYtd({}, quote)).toBeNull()
    expect(parseNasdaqIndexYtd(history, { ...quote, quoteTime: Date.parse('2025-11-13T21:00:00Z') / 1000 })).toBeNull()
  })
})
