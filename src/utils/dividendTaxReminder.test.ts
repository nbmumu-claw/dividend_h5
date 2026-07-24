import { describe, expect, it } from 'vitest'
import type { WatchlistStock } from '../types'
import { findPendingDividendTax } from './dividendTaxReminder'

const at = (value: string) => new Date(`${value}T12:00:00`).getTime()
const stock = (transactions: NonNullable<WatchlistStock['transactions']>): WatchlistStock => ({
  code: '600000', name: '测试股', sector: '银行', price: 10, dividendPerShare: 1, yieldRate: 10, confirmed: true, transactions,
})

describe('findPendingDividendTax', () => {
  it('uses the latest taxable sell date and groups its sell quantity', () => {
    const item = findPendingDividendTax(stock([
      { type: 'buy', qty: 1000, price: 10, ts: at('2026-07-01') },
      { type: 'dividend', qty: 1000, price: 1, gross: 1, ts: at('2026-07-05') },
      { type: 'sell', qty: 300, price: 10, ts: at('2026-07-10') },
      { type: 'sell', qty: 200, price: 10, ts: at('2026-07-10') + 1000 },
    ]))

    expect(item).toMatchObject({ saleDate: '2026-07-10', qty: 500, tax: 100 })
  })

  it('does not repeat dismissed or recorded tax reminders', () => {
    const transactions = [
      { type: 'buy' as const, qty: 100, price: 10, ts: at('2026-07-01') },
      { type: 'dividend' as const, qty: 100, price: 1, gross: 1, ts: at('2026-07-05') },
      { type: 'sell' as const, qty: 100, price: 10, ts: at('2026-07-10') },
    ]
    expect(findPendingDividendTax(stock(transactions), new Set(['600000@2026-07-10']))).toBeNull()
    expect(findPendingDividendTax(stock([...transactions, { type: 'dividendTax', qty: 100, price: 20, ts: at('2026-07-10') }]))).toBeNull()
  })
})
