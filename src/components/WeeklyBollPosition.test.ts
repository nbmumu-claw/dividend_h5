import { describe, expect, it } from 'vitest'
import { getWeeklyBollPosition } from './WeeklyBollPosition'
import type { WeeklyBoll } from '../utils/weeklyBoll'

const boll: WeeklyBoll = { lower: 10, middle: 15, upper: 20, weekDate: '2026-07-17' }

describe('getWeeklyBollPosition', () => {
  it.each([
    [8, '低于下轨', 0],
    [10, '位于下轨', 0],
    [12.5, '中下轨之间', 25],
    [15, '位于中轨', 50],
    [17.5, '中上轨之间', 75],
    [20, '位于上轨', 100],
    [22, '高于上轨', 100],
  ])('maps price %s to %s', (price, zone, position) => {
    expect(getWeeklyBollPosition(boll, price)).toMatchObject({ zone, position })
  })

  it('returns null for unavailable or invalid data', () => {
    expect(getWeeklyBollPosition(undefined, 12)).toBeNull()
    expect(getWeeklyBollPosition({ ...boll, upper: 10 }, 12)).toBeNull()
    expect(getWeeklyBollPosition(boll, 0)).toBeNull()
  })

  it('shows the nearest rail inside each half of the band', () => {
    const nearLower = getWeeklyBollPosition(boll, 11)
    const nearUpper = getWeeklyBollPosition(boll, 19)
    expect(nearLower).toMatchObject({ gapLabel: '距下轨' })
    expect(nearLower?.gap).toBeCloseTo(10)
    expect(getWeeklyBollPosition(boll, 14)).toMatchObject({ gapLabel: '距中轨' })
    expect(getWeeklyBollPosition(boll, 16)).toMatchObject({ gapLabel: '距中轨' })
    expect(nearUpper).toMatchObject({ gapLabel: '距上轨' })
    expect(nearUpper?.gap).toBeCloseTo(-5)
  })
})
