import { fetchPeriodBoll } from './periodBoll'

export interface WeeklyBoll {
  middle: number
  upper: number
  lower: number
  weekDate: string
}

export interface WeeklyBollInput {
  code: string
  isHK?: boolean
}

const SHANGHAI_OFFSET = 8 * 60 * 60 * 1000

function marketState(isHK: boolean, now: number): { trading: boolean; latestBoundary: number } {
  const local = new Date(now + SHANGHAI_OFFSET)
  const year = local.getUTCFullYear()
  const month = local.getUTCMonth()
  const date = local.getUTCDate()
  const day = local.getUTCDay()
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes()
  const morningCloseMinutes = isHK ? 12 * 60 : 11 * 60 + 30
  const closeMinutes = isHK ? 16 * 60 : 15 * 60
  const toTimestamp = (dayOffset: number, boundaryMinutes: number) => (
    Date.UTC(year, month, date + dayOffset, Math.floor(boundaryMinutes / 60) - 8, boundaryMinutes % 60)
  )
  const previousWeekdayClose = () => {
    let offset = -1
    while ([0, 6].includes(new Date(Date.UTC(year, month, date + offset)).getUTCDay())) offset -= 1
    return toTimestamp(offset, closeMinutes)
  }

  if (day === 0 || day === 6) return { trading: false, latestBoundary: previousWeekdayClose() }
  if (minutes < 9 * 60 + 30) return { trading: false, latestBoundary: previousWeekdayClose() }
  if (minutes < morningCloseMinutes) return { trading: true, latestBoundary: 0 }
  if (minutes < 13 * 60) return { trading: false, latestBoundary: toTimestamp(0, morningCloseMinutes) }
  if (minutes < closeMinutes) return { trading: true, latestBoundary: 0 }
  return { trading: false, latestBoundary: toTimestamp(0, closeMinutes) }
}

export function isWeeklyBollCacheFresh(cachedAt: number, isHK: boolean, ttl: number, now = Date.now()): boolean {
  if (now - cachedAt < ttl) return true
  const state = marketState(isHK, now)
  return !state.trading && cachedAt >= state.latestBoundary
}

/** BOLL(20, 2)：简单移动平均 + 样本标准差（N-1），与同花顺周 BOLL 口径一致。 */
export function calculateWeeklyBoll(closes: number[], weekDate = ''): WeeklyBoll | null {
  if (closes.length < 20) return null
  const values = closes.slice(-20)
  if (values.some(v => !Number.isFinite(v) || v <= 0)) return null
  const middle = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - middle) ** 2, 0) / (values.length - 1)
  const width = 2 * Math.sqrt(variance)
  return { middle, upper: middle + width, lower: middle - width, weekDate }
}

export async function fetchWeeklyBoll(inputs: WeeklyBollInput[]): Promise<Record<string, WeeklyBoll>> {
  const values = await fetchPeriodBoll('week', inputs)
  return Object.fromEntries(Object.entries(values).map(([code, boll]) => [code, {
    middle: boll.middle,
    upper: boll.upper,
    lower: boll.lower,
    weekDate: boll.periodDate,
  }]))
}
