import { describe, expect, it } from 'vitest'
import type { WatchlistStock } from '../types'
import { DEFAULT_FEE_CONFIG } from './fees'
import { currencyOf, normalizeCash, transactionCashFlow } from './cash'

const stock = (patch: Partial<WatchlistStock> = {}): WatchlistStock => ({
  code: '600000', name: '测试股', sector: '银行', price: 10,
  dividendPerShare: 0.5, yieldRate: 5, confirmed: true, ...patch,
})

describe('cash currency', () => {
  it('defaults Hong Kong stocks to CNY settlement for Stock Connect', () => {
    expect(currencyOf(stock({ code: '00700', isHK: true }))).toBe('CNY')
  })

  it('uses HKD only when a Hong Kong account is explicitly selected', () => {
    expect(currencyOf(stock({ code: '00700', isHK: true, cashCurrency: 'HKD' }))).toBe('HKD')
  })

  it('assigns US stocks to USD and domestic stocks to CNY', () => {
    expect(currencyOf(stock({ code: 'AAPL', isUS: true }))).toBe('USD')
    expect(currencyOf(stock())).toBe('CNY')
  })

  it('migrates legacy single-currency cash to CNY', () => {
    expect(normalizeCash(1234.5)).toEqual({ CNY: 1234.5, USD: 0, HKD: 0 })
  })
})

describe('transaction cash flow', () => {
  it('subtracts buys, adds sells, and adds after-tax dividends', () => {
    const result = transactionCashFlow(stock(), [
      { type: 'buy', qty: 100, price: 10, ts: 1 },
      { type: 'dividend', qty: 100, price: 0.5, ts: 2 },
      { type: 'sell', qty: 50, price: 12, ts: 3 },
    ], DEFAULT_FEE_CONFIG)

    expect(result).toBe( -350 )
  })

  it('uses the selected Hong Kong dividend tax rate', () => {
    const result = transactionCashFlow(stock({ code: '00700', isHK: true, taxType: 'h' }), [
      { type: 'buy', qty: 100, price: 10, ts: 1 },
      { type: 'dividend', qty: 100, price: 1, ts: 2 },
    ], DEFAULT_FEE_CONFIG)

    expect(result).toBe(-920)
  })
})
