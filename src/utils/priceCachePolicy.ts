export type MarketPhase = 'trading' | 'lunch' | 'closed'

const CLOSE_MINUTES = 15 * 60
const CLOSE_SETTLED_MINUTES = CLOSE_MINUTES + 2

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

function isWeekday(now: Date): boolean {
  return now.getDay() >= 1 && now.getDay() <= 5
}

/** 15:00 后给行情源留出 2 分钟结算时间，避免把边界时刻的快照定格为收盘价。 */
export function isCloseFinalizing(now: Date = new Date()): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes()
  return isWeekday(now) && minutes >= CLOSE_MINUTES && minutes < CLOSE_SETTLED_MINUTES
}

/** 页面在 15:02 只检查一次，不增加轮询。 */
export function closeFinalizationDelayMs(now: Date = new Date()): number | null {
  if (!isWeekday(now)) return null
  const settledAt = new Date(now)
  settledAt.setHours(15, 2, 0, 0)
  return now < settledAt ? settledAt.getTime() - now.getTime() : null
}

export function isCloseSettled(now: Date = new Date()): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes()
  return isWeekday(now) && minutes >= CLOSE_SETTLED_MINUTES
}

/** 只有当天 15:02:00 之后更新的行情才视为已定格。 */
export function hasSettledCloseQuote(tradeDate: string, tradeTime: string, now: Date = new Date()): boolean {
  const p = (value: number) => String(value).padStart(2, '0')
  const today = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
  const raw = tradeTime.replace(/\D/g, '')
  return tradeDate === today && raw.startsWith(today) && Number(raw.slice(8, 14)) > 150200
}

/** 行情缓存仅在当前休市阶段已于今天校验过时复用，避免跨日永久停留在旧收盘价。 */
export function shouldUsePriceCache(
  cacheFetchedAt: number,
  cacheCoversAll: boolean,
  now: Date = new Date(),
  closeQuotesSettled = false,
): boolean {
  if (!cacheCoversAll) return false
  const phase = marketPhase(now)
  if (phase === 'trading') return false
  if (phase === 'lunch') return fetchedTodayAfter(cacheFetchedAt, now, 690)
  // 15:00–15:02 复用当天已有快照，避免重复请求；15:02 后检查行情自身的时间。
  if (isCloseFinalizing(now)) return fetchedTodayAfter(cacheFetchedAt, now, 0)
  if (isCloseSettled(now)) return closeQuotesSettled
  return fetchedTodayAfter(cacheFetchedAt, now, 0) && marketPhase(new Date(cacheFetchedAt)) !== 'trading'
}
