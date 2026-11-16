import { describe, expect, it } from 'vitest'
import { calculatePerformance } from './nasdaqPerformance'

const row = (date: string, price: number) => [date, '0', String(price)]
describe('calculatePerformance', () => {
  it('uses calendar periods and the previous trading day, excluding today', () => {
    const result = calculatePerformance([
      row('2025-11-13', 100), row('2026-08-13', 110), row('2026-10-13', 120),
      row('2026-11-06', 140), row('2026-11-13', 150), row('2026-11-16', 999),
    ], '2026-11-16')!
    expect(result.date).toBe('2026-11-13')
    expect(result.returns.week).toBeCloseTo((150 / 140 - 1) * 100)
    expect(result.returns.month).toBeCloseTo(25)
    expect(result.returns.quarter).toBeCloseTo((150 / 110 - 1) * 100)
    expect(result.returns.year).toBeCloseTo(50)
  })
  it('clamps month ends and handles missing history', () => {
    const result = calculatePerformance([row('2026-02-27', 100), row('2026-03-31', 90)], '2026-04-01')!
    expect(result.returns.month).toBeCloseTo(-10)
    expect(result.returns.year).toBeNull()
  })
  it('rejects malformed and nonpositive prices', () => {
    expect(calculatePerformance([row('2026-11-13', 0), ['bad', 1, 5]], '2026-11-16')).toBeNull()
    expect(calculatePerformance(null)).toBeNull()
  })
})
