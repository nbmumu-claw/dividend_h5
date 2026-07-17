const response = require('../utils/response')
const db = require('../utils/db')

const SYMBOL_RE = /^(?:sh|sz|bj)\d{6}$|^hk\d{5}$/
const BATCH_SIZE = 20
const DB_COLLECTION = 'weeklyBollCache'
const DB_CACHE_TTL = 15 * 60 * 1000
const SHANGHAI_OFFSET = 8 * 60 * 60 * 1000

function marketState(symbol, now) {
  const local = new Date(now + SHANGHAI_OFFSET)
  const year = local.getUTCFullYear()
  const month = local.getUTCMonth()
  const date = local.getUTCDate()
  const day = local.getUTCDay()
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes()
  const morningCloseMinutes = symbol.startsWith('hk') ? 12 * 60 : 11 * 60 + 30
  const closeMinutes = symbol.startsWith('hk') ? 16 * 60 : 15 * 60
  const toTimestamp = (dayOffset, boundaryMinutes) => (
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

function isCacheFresh(symbol, updatedAt, now) {
  if (now - updatedAt < DB_CACHE_TTL) return true
  const state = marketState(symbol, now)
  return !state.trading && updatedAt >= state.latestBoundary
}

function calculate(closes, weekDate) {
  if (closes.length < 20) return null
  const values = closes.slice(-20)
  const middle = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - middle) ** 2, 0) / (values.length - 1)
  const width = 2 * Math.sqrt(variance)
  return { middle, upper: middle + width, lower: middle - width, weekDate }
}

async function fetchOne(symbol) {
  const params = new URLSearchParams({ param: `${symbol},week,,,25,qfq` })
  const upstream = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?${params}`, {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://gu.qq.com/' },
    signal: AbortSignal.timeout(8000),
  })
  if (!upstream.ok) return null
  const payload = await upstream.json()
  const rows = payload?.data?.[symbol]?.qfqweek
  if (!Array.isArray(rows) || rows.length < 20) return null
  const closes = rows.map(row => Number(row?.[2])).filter(value => Number.isFinite(value) && value > 0)
  return calculate(closes, String(rows.at(-1)?.[0] || ''))
}

async function readFromDB(symbols) {
  try {
    const result = await db.collection(DB_COLLECTION).where({ symbol: db.command.in(symbols) }).limit(100).get()
    const now = Date.now()
    return Object.fromEntries((result.data || []).flatMap(doc => {
      const updatedAt = doc.updatedAt ? new Date(doc.updatedAt).getTime() : 0
      if (!doc.symbol || !doc.data || !isCacheFresh(doc.symbol, updatedAt, now)) return []
      return [[doc.symbol, doc.data]]
    }))
  } catch (error) {
    console.warn('[weeklyBoll] DB 读取失败:', error.message)
    return {}
  }
}

async function writeToDB(values) {
  await Promise.allSettled(Object.entries(values).map(([symbol, data]) => (
    db.collection(DB_COLLECTION).doc(symbol).set({ symbol, data, updatedAt: db.serverDate() })
  )))
}

module.exports = async function weeklyBollHandler(params) {
  const symbols = [...new Set(String(params.symbols || '').split(',').filter(symbol => SYMBOL_RE.test(symbol)))].slice(0, 80)
  if (!symbols.length) return response.badRequest('缺少有效的 symbols')

  const data = await readFromDB(symbols)
  const misses = symbols.filter(symbol => !data[symbol])
  const upstreamValues = {}
  for (let index = 0; index < misses.length; index += BATCH_SIZE) {
    const batch = misses.slice(index, index + BATCH_SIZE)
    const values = await Promise.all(batch.map(symbol => fetchOne(symbol).catch(() => null)))
    batch.forEach((symbol, offset) => {
      if (values[offset]) {
        data[symbol] = values[offset]
        upstreamValues[symbol] = values[offset]
      }
    })
  }
  if (Object.keys(upstreamValues).length) await writeToDB(upstreamValues)

  return response.ok(JSON.stringify({ data }), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
}
