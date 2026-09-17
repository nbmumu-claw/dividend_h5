import { afterEach, expect, it, vi } from 'vitest'
import { fetchUpcomingDividends } from './upcomingDividends'

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
    data,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('invalidates the old 30-day cache and caches announced dividends for one day', async () => {
  const now = 1_000_000
  const storage = memoryStorage({
    'dh_cache_upcomingDividends:v2:600000': JSON.stringify({ data: [], expiresAt: now + 30 * 24 * 60 * 60 * 1000 }),
  })
  const record = { code: '600000', exDate: '2026-09-20', perShare: 0.5, progress: '实施方案' }
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [record] }) })
  vi.spyOn(Date, 'now').mockReturnValue(now)
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('fetch', fetchMock)

  await expect(fetchUpcomingDividends(['600000'])).resolves.toEqual([record])
  expect(fetchMock).toHaveBeenCalledOnce()
  expect(JSON.parse(storage.data.get('dh_cache_upcomingDividends:v3:600000') || '{}').expiresAt)
    .toBe(now + 24 * 60 * 60 * 1000)
})

it('rechecks stocks without an announcement after twelve hours', async () => {
  const now = 2_000_000
  const storage = memoryStorage()
  vi.spyOn(Date, 'now').mockReturnValue(now)
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) }))

  await expect(fetchUpcomingDividends(['600000'])).resolves.toEqual([])
  expect(JSON.parse(storage.data.get('dh_cache_upcomingDividends:v3:600000') || '{}').expiresAt)
    .toBe(now + 12 * 60 * 60 * 1000)
})
