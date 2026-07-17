import { describe, expect, it } from 'vitest'
import { calculateWeeklyBoll, isWeeklyBollCacheFresh } from './weeklyBoll'

describe('calculateWeeklyBoll', () => {
  it('uses the latest 20 closes and sample standard deviation', () => {
    const result = calculateWeeklyBoll(Array.from({ length: 21 }, (_, i) => i + 1), '2026-07-17')

    expect(result).not.toBeNull()
    expect(result?.middle).toBeCloseTo(11.5, 8)
    expect(result?.upper).toBeCloseTo(23.33215957, 8)
    expect(result?.lower).toBeCloseTo(-0.33215957, 8)
    expect(result?.weekDate).toBe('2026-07-17')
  })

  it('requires 20 valid positive closes', () => {
    expect(calculateWeeklyBoll([1, 2, 3])).toBeNull()
    expect(calculateWeeklyBoll([...Array(19).fill(1), 0])).toBeNull()
  })
})

describe('isWeeklyBollCacheFresh', () => {
  const shanghaiTime = (value: string) => new Date(`${value}+08:00`).getTime()

  it('uses TTL while the market is trading', () => {
    const now = shanghaiTime('2026-07-17T10:30:00')
    expect(isWeeklyBollCacheFresh(now - 9 * 60_000, false, 10 * 60_000, now)).toBe(true)
    expect(isWeeklyBollCacheFresh(now - 11 * 60_000, false, 10 * 60_000, now)).toBe(false)
  })

  it('keeps a post-close cache during non-trading hours', () => {
    const fridayAfterClose = shanghaiTime('2026-07-17T15:05:00')
    const saturday = shanghaiTime('2026-07-18T12:00:00')
    expect(isWeeklyBollCacheFresh(fridayAfterClose, false, 10 * 60_000, saturday)).toBe(true)
  })

  it('refreshes a cache written before the latest session boundary', () => {
    const beforeClose = shanghaiTime('2026-07-17T14:50:00')
    const afterClose = shanghaiTime('2026-07-17T16:00:00')
    expect(isWeeklyBollCacheFresh(beforeClose, false, 10 * 60_000, afterClose)).toBe(false)
  })
})
