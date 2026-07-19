const SHANGHAI_OFFSET = 8 * 60 * 60 * 1000
const DAY_CACHE_TTL = 15 * 60 * 1000
const WEEK_CACHE_TTL = 60 * 60 * 1000

function shanghaiParts(now) {
  const local = new Date(now + SHANGHAI_OFFSET)
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
    date: local.getUTCDate(),
    day: local.getUTCDay(),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  }
}

function timestamp(parts, dayOffset, minutes) {
  return Date.UTC(
    parts.year,
    parts.month,
    parts.date + dayOffset,
    Math.floor(minutes / 60) - 8,
    minutes % 60,
  )
}

function previousWeekdayClose(parts) {
  let offset = -1
  while ([0, 6].includes(new Date(Date.UTC(parts.year, parts.month, parts.date + offset)).getUTCDay())) offset -= 1
  return timestamp(parts, offset, 15 * 60)
}

function latestDailyBoundary(now) {
  const parts = shanghaiParts(now)
  if (parts.day === 0 || parts.day === 6 || parts.minutes < 9 * 60 + 30) return previousWeekdayClose(parts)
  if (parts.minutes < 15 * 60) return previousWeekdayClose(parts)
  return timestamp(parts, 0, 15 * 60)
}

function isDayTrading(now) {
  const { day, minutes } = shanghaiParts(now)
  if (day === 0 || day === 6) return false
  return (minutes >= 9 * 60 + 30 && minutes < 11 * 60 + 30)
    || (minutes >= 13 * 60 && minutes < 15 * 60)
}

function isCacheFresh(period, updatedAt, now = Date.now()) {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return false
  if (period !== 'month' && isDayTrading(now)) {
    const ttl = period === 'week' ? WEEK_CACHE_TTL : DAY_CACHE_TTL
    return now - updatedAt < ttl
  }
  return updatedAt >= latestDailyBoundary(now)
}

function nextWeekdayOffset(parts, initialOffset) {
  let offset = initialOffset
  while ([0, 6].includes(new Date(Date.UTC(parts.year, parts.month, parts.date + offset)).getUTCDay())) offset += 1
  return offset
}

function nextDailyExpiry(now, tradingTtl = DAY_CACHE_TTL) {
  const parts = shanghaiParts(now)
  if (isDayTrading(now)) return now + tradingTtl
  if (parts.day > 0 && parts.day < 6 && parts.minutes < 9 * 60 + 30) return timestamp(parts, 0, 9 * 60 + 30)
  if (parts.day > 0 && parts.day < 6 && parts.minutes >= 11 * 60 + 30 && parts.minutes < 13 * 60) {
    return timestamp(parts, 0, 13 * 60)
  }
  return timestamp(parts, nextWeekdayOffset(parts, 1), 9 * 60 + 30)
}

function nextMonthlyExpiry(now) {
  const parts = shanghaiParts(now)
  if (parts.day > 0 && parts.day < 6 && parts.minutes < 15 * 60) return timestamp(parts, 0, 15 * 60)
  return timestamp(parts, nextWeekdayOffset(parts, 1), 15 * 60)
}

function cacheExpiresAt(period, now = Date.now()) {
  if (period === 'month') return nextMonthlyExpiry(now)
  return nextDailyExpiry(now, period === 'week' ? WEEK_CACHE_TTL : DAY_CACHE_TTL)
}

function calculateBoll(closes) {
  if (!Array.isArray(closes) || closes.length < 20) return null
  const values = closes.slice(-20)
  if (values.some(value => !Number.isFinite(value) || value <= 0)) return null
  const middle = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - middle) ** 2, 0) / (values.length - 1)
  const width = 2 * Math.sqrt(variance)
  return { middle, upper: middle + width, lower: middle - width }
}

function parseTencentRows(rows, period, now = Date.now()) {
  if (!Array.isArray(rows) || rows.length < 20) return null
  const validRows = rows.filter(row => Array.isArray(row) && Number.isFinite(Number(row[2])) && Number(row[2]) > 0)
  if (validRows.length < 20) return null
  const boll = calculateBoll(validRows.map(row => Number(row[2])))
  if (!boll) return null
  const lastRow = validRows.at(-1)
  const periodDate = String(lastRow[0] || '')
  const currentMonth = new Date(now + SHANGHAI_OFFSET).toISOString().slice(0, 7)
  return {
    ...boll,
    latestClose: Number(lastRow[2]),
    periodDate,
    isPartial: period === 'month' && periodDate.slice(0, 7) === currentMonth,
  }
}

module.exports = {
  cacheExpiresAt,
  calculateBoll,
  isCacheFresh,
  parseTencentRows,
}
