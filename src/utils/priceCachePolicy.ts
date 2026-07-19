export type MarketPhase = 'trading' | 'lunch' | 'closed'

// 周一~五 9:30–15:00 视为交易时段（无节假日日历，近似）。
export function marketPhase(d: Date = new Date()): MarketPhase {
  const day = d.getDay()
  const minutes = d.getHours() * 60 + d.getMinutes()
  if (day < 1 || day > 5) return 'closed'
  if ((minutes >= 570 && minutes < 690) || (minutes >= 780 && minutes < 900)) return 'trading'
  if (minutes >= 690 && minutes < 780) return 'lunch'
  return 'closed'
}

function fetchedTodayAfter(fetchedAt: number, now: Date, minutes: number): boolean {
  const fetched = new Date(fetchedAt)
  return fetched.getFullYear() === now.getFullYear()
    && fetched.getMonth() === now.getMonth()
    && fetched.getDate() === now.getDate()
    && fetched.getHours() * 60 + fetched.getMinutes() >= minutes
}

/** 行情缓存仅在当前休市阶段已于今天校验过时复用，避免跨日永久停留在旧收盘价。 */
export function shouldUsePriceCache(cacheFetchedAt: number, cacheCoversAll: boolean, now: Date = new Date()): boolean {
  if (!cacheCoversAll) return false
  const phase = marketPhase(now)
  const minutes = now.getHours() * 60 + now.getMinutes()
  if (phase === 'trading') return false
  if (phase === 'lunch') return fetchedTodayAfter(cacheFetchedAt, now, 690)
  const afterCloseToday = now.getDay() >= 1 && now.getDay() <= 5 && minutes >= 900
  if (afterCloseToday) return fetchedTodayAfter(cacheFetchedAt, now, 900)
  return fetchedTodayAfter(cacheFetchedAt, now, 0) && marketPhase(new Date(cacheFetchedAt)) !== 'trading'
}
