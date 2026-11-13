import { describe, expect, it } from 'vitest'
import { formatNasdaqMarketTime, parseNasdaqMarketQuote } from './nasdaqMarket'

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
