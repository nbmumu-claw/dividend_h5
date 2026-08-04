import { describe, expect, it } from 'vitest'
import { getSectorTrend } from './sectorTrend'

describe('getSectorTrend', () => {
  it('uses the median so a single extreme stock does not dominate the sector', () => {
    expect(getSectorTrend([-8, 0.6, 0.8, 1]).median).toBe(0.7)
    expect(getSectorTrend([-8, 0.6, 0.8, 1]).level).toBe('slight-up')
  })

  it.each([
    [2.5, 'strong-up'],
    [1.5, 'up'],
    [0.5, 'slight-up'],
    [0.49, 'neutral'],
    [-0.5, 'slight-down'],
    [-1.5, 'down'],
    [-2.5, 'strong-down'],
  ] as const)('classifies a median of %s as %s', (median, level) => {
    expect(getSectorTrend([median, median, median]).level).toBe(level)
  })

  it('stays neutral when fewer than three quotes are valid', () => {
    expect(getSectorTrend([2.8, 3.1])).toEqual({ level: 'neutral', median: null, sampleSize: 2 })
  })
})
