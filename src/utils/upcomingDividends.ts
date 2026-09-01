import { cacheGet, cacheSet } from './cache'

const CACHE_TTL = 6 * 60 * 60 * 1000

export interface UpcomingDividendRecord {
  code: string
  exDate: string
  perShare: number
  progress: string
}

export async function fetchUpcomingDividends(codes: string[]): Promise<UpcomingDividendRecord[]> {
  const aShareCodes = [...new Set(codes.filter(code => /^\d{6}$/.test(code)))].sort()
  if (!aShareCodes.length) return []
  const cacheKey = `upcomingDividends:v1:${aShareCodes.join(',')}`
  const cached = cacheGet<UpcomingDividendRecord[]>(cacheKey)
  if (cached) return cached

  const params = new URLSearchParams({ codes: aShareCodes.join(','), days: '30' })
  const response = await fetch(`/api/upcoming-dividends?${params}`)
  if (!response.ok) throw new Error(`upcoming dividend request failed: ${response.status}`)
  const payload = await response.json() as { items?: UpcomingDividendRecord[] }
  const items = Array.isArray(payload.items)
    ? payload.items.filter(item => typeof item?.code === 'string' && /^\d{6}$/.test(item.code) && typeof item.exDate === 'string' && typeof item.perShare === 'number')
    : []
  cacheSet(cacheKey, items, CACHE_TTL)
  return items
}
