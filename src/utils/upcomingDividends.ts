import { cacheGet, cacheSet } from './cache'

const CACHE_VERSION = 'v3'
const CACHE_TTL_WITH_RECORDS = 24 * 60 * 60 * 1000
const CACHE_TTL_EMPTY = 12 * 60 * 60 * 1000

export interface UpcomingDividendRecord {
  code: string
  exDate: string
  perShare: number
  progress: string
}

export async function fetchUpcomingDividends(codes: string[]): Promise<UpcomingDividendRecord[]> {
  const aShareCodes = [...new Set(codes.filter(code => /^\d{6}$/.test(code)))].sort()
  if (!aShareCodes.length) return []

  const cachedByCode = new Map<string, UpcomingDividendRecord[]>()
  const uncachedCodes = aShareCodes.filter(code => {
    const cached = cacheGet<UpcomingDividendRecord[]>(`upcomingDividends:${CACHE_VERSION}:${code}`)
    if (!cached) return true
    cachedByCode.set(code, cached)
    return false
  })

  if (!uncachedCodes.length) return [...cachedByCode.values()].flat().sort((a, b) => a.exDate.localeCompare(b.exDate))

  const params = new URLSearchParams({ codes: uncachedCodes.join(','), days: '30' })
  const response = await fetch(`/api/upcoming-dividends?${params}`)
  if (!response.ok) throw new Error(`upcoming dividend request failed: ${response.status}`)
  const payload = await response.json() as { items?: UpcomingDividendRecord[] }
  const items = Array.isArray(payload.items)
    ? payload.items.filter(item => typeof item?.code === 'string' && /^\d{6}$/.test(item.code) && typeof item.exDate === 'string' && typeof item.perShare === 'number')
    : []

  for (const code of uncachedCodes) {
    const records = items.filter(item => item.code === code)
    cacheSet(
      `upcomingDividends:${CACHE_VERSION}:${code}`,
      records,
      records.length > 0 ? CACHE_TTL_WITH_RECORDS : CACHE_TTL_EMPTY,
    )
    cachedByCode.set(code, records)
  }

  return [...cachedByCode.values()].flat().sort((a, b) => a.exDate.localeCompare(b.exDate))
}
