import { describe, expect, it } from 'vitest'
import { computeHolding, findFirstOversell, type Transaction } from './holdings'

const day = (value: string) => new Date(`${value}T12:00:00`).getTime()
const tx = (type: Transaction['type'], qty: number, date: string): Transaction => ({
  type,
  qty,
  price: 10,
  ts: day(date),
})

describe('findFirstOversell', () => {
  it('accepts valid partial sells and ignores dividend records', () => {
    const transactions = [
      tx('buy', 100, '2026-01-01'),
      tx('dividend', 100, '2026-02-01'),
      tx('sell', 60, '2026-03-01'),
      tx('sell', 40, '2026-04-01'),
    ]

    expect(findFirstOversell(transactions)).toBeNull()
  })

  it('checks availability on the sell date instead of using final holdings', () => {
    const transactions = [
      tx('sell', 50, '2026-01-01'),
      tx('buy', 100, '2026-02-01'),
    ]

    expect(findFirstOversell(transactions)).toMatchObject({ index: 0, available: 0 })
  })

  it('finds the first invalid sell even when records are not stored chronologically', () => {
    const transactions = [
      tx('sell', 50, '2026-03-01'),
      tx('buy', 40, '2026-01-01'),
      tx('sell', 30, '2026-02-01'),
    ]

    expect(findFirstOversell(transactions)).toMatchObject({ index: 0, available: 10 })
  })

  it('detects a later invalid sell after a historical buy is moved', () => {
    const transactions = [
      tx('buy', 100, '2026-04-01'),
      tx('sell', 80, '2026-03-01'),
    ]

    const issue = findFirstOversell(transactions)
    expect(issue).toMatchObject({ index: 1, available: 0 })
    expect(issue?.transaction.ts).toBe(day('2026-03-01'))
  })

  it('detects a later invalid sell after a historical buy is deleted', () => {
    const transactions = [
      tx('buy', 40, '2026-01-01'),
      tx('sell', 70, '2026-02-01'),
    ]

    expect(findFirstOversell(transactions)).toMatchObject({ index: 1, available: 40 })
  })
})

describe('computeHolding', () => {
  it('keeps the net result after a position is fully cleared', () => {
    const transactions: Transaction[] = [
      { type: 'buy', qty: 500, price: 25, ts: day('2026-01-01') },
      { type: 'dividend', qty: 500, price: 0.18, ts: day('2026-02-01') },
      { type: 'sell', qty: 500, price: 26, ts: day('2026-03-01') },
    ]

    expect(computeHolding(transactions)).toEqual({
      shares: 0,
      costPrice: '',
      netAmount: -590,
      cleared: true,
    })
  })
})
