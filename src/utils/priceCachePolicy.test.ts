import { describe, expect, it } from 'vitest'
import {
  closeFinalizationDelayMs,
  hasSettledCloseQuote,
  marketPhase,
  shouldUsePriceCache,
} from './priceCachePolicy'

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

  it('requires lunch and close snapshots to be captured after their settled boundaries', () => {
    const beforeLunch = local('2026-07-17T11:20:00').getTime()
    const afterLunch = local('2026-07-17T11:35:00').getTime()
    const beforeClose = local('2026-07-17T14:55:00').getTime()
    const closingSnapshot = local('2026-07-17T15:01:00').getTime()
    const settledClose = local('2026-07-17T15:03:00').getTime()
    expect(shouldUsePriceCache(beforeLunch, true, local('2026-07-17T12:00:00'))).toBe(false)
    expect(shouldUsePriceCache(afterLunch, true, local('2026-07-17T12:00:00'))).toBe(true)
    expect(shouldUsePriceCache(beforeClose, true, local('2026-07-17T15:01:00'))).toBe(true)
    expect(shouldUsePriceCache(closingSnapshot, true, local('2026-07-17T16:00:00'), false)).toBe(false)
    expect(shouldUsePriceCache(settledClose, true, local('2026-07-17T16:00:00'), true)).toBe(true)
  })

  it('schedules one final check and identifies quotes still stuck on the close boundary', () => {
    expect(closeFinalizationDelayMs(local('2026-07-17T15:01:59'))).toBe(1000)
    expect(closeFinalizationDelayMs(local('2026-07-17T15:02:00'))).toBeNull()
    expect(closeFinalizationDelayMs(local('2026-07-19T10:00:00'))).toBeNull()
    expect(hasSettledCloseQuote('20260717', '20260717150200', local('2026-07-17T15:02:00'))).toBe(false)
    expect(hasSettledCloseQuote('20260717', '20260717150201', local('2026-07-17T15:02:00'))).toBe(true)
    expect(hasSettledCloseQuote('20260716', '20260716161500', local('2026-07-17T15:02:00'))).toBe(false)
  })
})
