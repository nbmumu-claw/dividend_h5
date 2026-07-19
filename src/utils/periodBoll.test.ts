import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPeriodBoll, toPeriodBollSymbol } from './periodBoll'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('period BOLL data utility', () => {
  it('maps A-share codes and excludes HK inputs', async () => {
    expect(toPeriodBollSymbol({ code: '600011' })).toBe('sh600011')
    expect(toPeriodBollSymbol({ code: '000858' })).toBe('sz000858')

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: {} })))
    await fetchPeriodBoll('day', [{ code: '600011' }, { code: '2318', isHK: true }])
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('symbols=sh600011')
    expect(url).not.toContain('2318')
  })

  it('requests the unified week period', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: {} })))
    await fetchPeriodBoll('week', [{ code: '600011' }])
    expect(String(fetchMock.mock.calls[0][0])).toContain('period=week')
  })

  it('uses a valid period cache without calling the backend', async () => {
    const cached = {
      middle: 7,
      upper: 8,
      lower: 6,
      latestClose: 7.2,
      periodDate: '2026-07-18',
      isPartial: true,
      expiresAt: Date.now() + 60_000,
    }
    const storage = new Map([['period-boll-cache-v1', JSON.stringify({ day_600011: { data: cached } })]])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(fetchPeriodBoll('day', [{ code: '600011' }])).resolves.toEqual({ '600011': cached })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not reuse another period cache entry', async () => {
    const cached = {
      middle: 7,
      upper: 8,
      lower: 6,
      latestClose: 7.2,
      periodDate: '2026-07-18',
      isPartial: true,
      expiresAt: Date.now() + 60_000,
    }
    const storage = new Map([['period-boll-cache-v1', JSON.stringify({ day_600011: { data: cached } })]])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: {} })))

    await fetchPeriodBoll('month', [{ code: '600011' }])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0][0])).toContain('period=month')
  })
})
