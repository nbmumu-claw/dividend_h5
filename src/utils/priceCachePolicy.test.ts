import { describe, expect, it } from 'vitest'
import { marketPhase, shouldUsePriceCache } from './priceCachePolicy'

const local = (value: string) => new Date(value)

describe('price cache policy', () => {
  it('recognizes trading, lunch and closed phases', () => {
    expect(marketPhase(local('2026-07-17T10:00:00'))).toBe('trading')
    expect(marketPhase(local('2026-07-17T12:00:00'))).toBe('lunch')
    expect(marketPhase(local('2026-07-19T10:00:00'))).toBe('closed')
  })

  it('rejects a previous-day cache on weekends', () => {
    const fridayAfterClose = local('2026-07-17T16:15:00').getTime()
    expect(shouldUsePriceCache(fridayAfterClose, true, local('2026-07-19T10:00:00'))).toBe(false)
  })

  it('reuses a cache already checked today while the market is closed', () => {
    const sundayMorning = local('2026-07-19T09:00:00').getTime()
    expect(shouldUsePriceCache(sundayMorning, true, local('2026-07-19T10:00:00'))).toBe(true)
  })

  it('requires lunch and close snapshots to be captured after their boundaries', () => {
    const beforeLunch = local('2026-07-17T11:20:00').getTime()
    const afterLunch = local('2026-07-17T11:35:00').getTime()
    const beforeClose = local('2026-07-17T14:55:00').getTime()
    const afterClose = local('2026-07-17T15:05:00').getTime()
    expect(shouldUsePriceCache(beforeLunch, true, local('2026-07-17T12:00:00'))).toBe(false)
    expect(shouldUsePriceCache(afterLunch, true, local('2026-07-17T12:00:00'))).toBe(true)
    expect(shouldUsePriceCache(beforeClose, true, local('2026-07-17T16:00:00'))).toBe(false)
    expect(shouldUsePriceCache(afterClose, true, local('2026-07-17T16:00:00'))).toBe(true)
  })
})
