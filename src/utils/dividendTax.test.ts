import { describe, expect, it } from 'vitest'
import { estimateDividendTax } from './dividendTax'
import type { Transaction } from './holdings'

const at = (value: string) => new Date(`${value}T12:00:00`).getTime()
const tx = (type: Transaction['type'], qty: number, date: string, price = 10): Transaction => ({ type, qty, price, ts: at(date) })

describe('estimateDividendTax', () => {
  it('uses FIFO lots and the 20% / 10% holding-period rates', () => {
    const transactions = [
      tx('buy', 100, '2026-01-01'),
      tx('dividend', 100, '2026-01-15', 1),
      tx('buy', 100, '2026-02-10'),
      tx('dividend', 200, '2026-02-15', 0.5),
    ]

    const estimate = estimateDividendTax(transactions, at('2026-02-20'), 150)

    expect(estimate.withinMonth).toBe(25)
    expect(estimate.withinYear).toBe(150)
    expect(estimate.tax).toBe(20)
  })

  it('exempts lots held for more than one year and respects prior sells', () => {
    const transactions = [
      tx('buy', 100, '2025-01-01'),
      tx('dividend', 100, '2025-06-01', 1),
      tx('buy', 100, '2026-01-01'),
      tx('dividend', 200, '2026-01-15', 1),
      tx('sell', 100, '2026-01-20'),
    ]

    const estimate = estimateDividendTax(transactions, at('2026-02-01'), 100)

    expect(estimate.availableQty).toBe(100)
    expect(estimate.withinMonth).toBe(100)
    expect(estimate.withinYear).toBe(0)
    expect(estimate.tax).toBe(20)
  })

  it('offsets same-day buys before estimating the taxable sell quantity', () => {
    const transactions = [
      tx('buy', 100, '2026-01-01'),
      tx('dividend', 100, '2026-01-05', 1),
      tx('buy', 50, '2026-01-10'),
    ]

    expect(estimateDividendTax(transactions, at('2026-01-10'), 50)).toMatchObject({
      availableQty: 150,
      withinMonth: 0,
      tax: 0,
    })
    expect(estimateDividendTax(transactions, at('2026-01-10'), 80)).toMatchObject({
      withinMonth: 30,
      tax: 6,
    })
  })
})
