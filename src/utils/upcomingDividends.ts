import { cacheGet, cacheSet } from './cache'

const CACHE_TTL = 30 * 24 * 60 * 60 * 1000

export interface UpcomingDividendRecord {
  code: string
  exDate: string
  perShare: number
  progress: string
}

export async function fetchUpcomingDividends(codes: string[]): Promise<UpcomingDividendRecord[]> {
  const aShareCodes = [...new Set(codes.filter(code => /^\d{6}$/.test(code)))].sort()
  if (!aShareCodes.length) return []

  const legacyCached = cacheGet<UpcomingDividendRecord[]>(`upcomingDividends:v1:${aShareCodes.join(',')}`)
  if (legacyCached) return legacyCached

  const cachedByCode = new Map<string, UpcomingDividendRecord[]>()
  const uncachedCodes = aShareCodes.filter(code => {
    const cached = cacheGet<UpcomingDividendRecord[]>(`upcomingDividends:v2:${code}`)
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
    cacheSet(`upcomingDividends:v2:${code}`, records, CACHE_TTL)
    cachedByCode.set(code, records)
  }

  return [...cachedByCode.values()].flat().sort((a, b) => a.exDate.localeCompare(b.exDate))
}
