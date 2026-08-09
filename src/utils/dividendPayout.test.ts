import { describe, expect, it } from 'vitest'
import { summarizeDividendPayout } from './dividendPayout'

describe('summarizeDividendPayout', () => {
  it('summarizes the three-year Yangtze Power payout trend', () => {
    expect(summarizeDividendPayout([
      { year: 2025, payoutRatio: 70.92 },
      { year: 2024, payoutRatio: 71 },
      { year: 2023, payoutRatio: 73.66 },
    ])).toEqual({ average: 71.86, conclusion: '整体稳定，略有回落' })
  })

  it('reports unavailable when no fiscal-year payout is returned', () => {
    expect(summarizeDividendPayout([])).toBeNull()
  })
})
