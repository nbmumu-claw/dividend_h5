import { describe, expect, it } from 'vitest'
import { getSingleActiveBollPeriod, matchesBollPosition, matchesYieldStatus } from './yieldGridFilters'

describe('getSingleActiveBollPeriod', () => {
  it('returns the period only when exactly one BOLL period filter is active', () => {
    expect(getSingleActiveBollPeriod({ day: ['lower-zone', 'lower-half'], week: [], month: [] })).toBe('day')
    expect(getSingleActiveBollPeriod({ day: [], week: [], month: ['upper-zone'] })).toBe('month')
    expect(getSingleActiveBollPeriod({ day: ['lower-zone'], week: ['lower-half'], month: [] })).toBeNull()
    expect(getSingleActiveBollPeriod({ day: [], week: [], month: [] })).toBeNull()
  })
})

describe('matchesYieldStatus', () => {
  const buy = 0.05
  const sell = 0.04
  const tolerance = 0.0025

  it('combines near and reached values into continuous buy and sell zones', () => {
    expect(matchesYieldStatus(0.049, 'buy-zone', buy, sell, tolerance)).toBe(true)
    expect(matchesYieldStatus(0.08, 'buy-zone', buy, sell, tolerance)).toBe(true)
    expect(matchesYieldStatus(0.045, 'neutral', buy, sell, tolerance)).toBe(true)
    expect(matchesYieldStatus(0.041, 'sell-zone', buy, sell, tolerance)).toBe(true)
    expect(matchesYieldStatus(0.01, 'sell-zone', buy, sell, tolerance)).toBe(true)
    expect(matchesYieldStatus(0.047, 'buy-zone', buy, sell, tolerance)).toBe(false)
    expect(matchesYieldStatus(0.043, 'sell-zone', buy, sell, tolerance)).toBe(false)
  })

  it('does not expose the sell zone for sell-muted stocks', () => {
    expect(matchesYieldStatus(0.04, 'sell-zone', buy, sell, tolerance, false)).toBe(false)
  })
})

describe('matchesBollPosition', () => {
  const boll = { lower: 90, middle: 100, upper: 110 }
  const tolerances = { lower: 0.0025, middle: 0.01, upper: 0.0025 }

  it('partitions the full BOLL range into lower, middle-lower, middle-upper, and upper zones', () => {
    expect(matchesBollPosition(50, boll, ['lower-zone'], tolerances)).toBe(true)
    expect(matchesBollPosition(90.2, boll, ['lower-zone'], tolerances)).toBe(true)
    expect(matchesBollPosition(90.3, boll, ['lower-zone'], tolerances)).toBe(false)
    expect(matchesBollPosition(90.3, boll, ['lower-half'], tolerances)).toBe(true)
    expect(matchesBollPosition(99.9, boll, ['lower-half'], tolerances)).toBe(true)
    expect(matchesBollPosition(50, boll, ['lower-half'], tolerances)).toBe(false)
    expect(matchesBollPosition(100, boll, ['lower-half'], tolerances)).toBe(false)
    expect(matchesBollPosition(99, boll, ['middle-zone'], tolerances)).toBe(true)
    expect(matchesBollPosition(101, boll, ['middle-zone'], tolerances)).toBe(true)
    expect(matchesBollPosition(98.9, boll, ['middle-zone'], tolerances)).toBe(false)
    expect(matchesBollPosition(101.1, boll, ['middle-zone'], tolerances)).toBe(false)
    expect(matchesBollPosition(100, boll, ['upper-half'], tolerances)).toBe(true)
    expect(matchesBollPosition(109.7, boll, ['upper-half'], tolerances)).toBe(true)
    expect(matchesBollPosition(150, boll, ['upper-half'], tolerances)).toBe(false)
    expect(matchesBollPosition(109.8, boll, ['upper-zone'], tolerances)).toBe(true)
    expect(matchesBollPosition(150, boll, ['upper-zone'], tolerances)).toBe(true)
  })

  it('matches any selected position within the same period', () => {
    expect(matchesBollPosition(90.3, boll, ['lower-zone', 'lower-half'], tolerances)).toBe(true)
    expect(matchesBollPosition(105, boll, ['lower-zone', 'lower-half'], tolerances)).toBe(false)
  })

  it('requires BOLL data whenever a position filter is active', () => {
    expect(matchesBollPosition(100, undefined, ['lower-half'], tolerances)).toBe(false)
    expect(matchesBollPosition(100, undefined, [], tolerances)).toBe(true)
  })
})
