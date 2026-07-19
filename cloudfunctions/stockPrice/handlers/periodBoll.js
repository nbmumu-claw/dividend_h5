const response = require('../utils/response')
const db = require('../utils/db')
const { cacheExpiresAt, isCacheFresh, parseTencentRows } = require('./periodBollCore')

const SYMBOL_RE = /^(?:sh|sz|bj)\d{6}$/
const PERIODS = new Set(['day', 'week', 'month'])
const BATCH_SIZE = 20
const DB_COLLECTION = 'bollPeriodCache'

async function fetchOne(symbol, period) {
  const params = new URLSearchParams({ param: `${symbol},${period},,,25,qfq` })
  const upstream = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?${params}`, {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://gu.qq.com/' },
    signal: AbortSignal.timeout(8000),
  })
  if (!upstream.ok) return null
  const payload = await upstream.json()
  return parseTencentRows(payload?.data?.[symbol]?.[`qfq${period}`], period)
}

async function readFromDB(symbols, period, now) {
  try {
    const keys = symbols.map(symbol => `${period}_${symbol}`)
    const result = await db.collection(DB_COLLECTION).where({ cacheKey: db.command.in(keys) }).limit(100).get()
    const fresh = {}
    const stale = {}
    for (const doc of result.data || []) {
      if (!doc.symbol || !doc.data) continue
      const updatedAt = doc.updatedAt ? new Date(doc.updatedAt).getTime() : 0
      stale[doc.symbol] = doc.data
      if (isCacheFresh(period, updatedAt, now)) fresh[doc.symbol] = doc.data
    }
    return { fresh, stale }
  } catch (error) {
    console.warn('[periodBoll] DB 读取失败:', error.message)
    return { fresh: {}, stale: {} }
  }
}

async function writeToDB(values, period) {
  await Promise.allSettled(Object.entries(values).map(([symbol, data]) => {
    const cacheKey = `${period}_${symbol}`
    return db.collection(DB_COLLECTION).doc(cacheKey).set({ cacheKey, symbol, period, data, updatedAt: db.serverDate() })
  }))
}

module.exports = async function periodBollHandler(params) {
  const period = String(params.period || '')
  if (!PERIODS.has(period)) return response.badRequest('period 仅支持 day、week 或 month')
  const symbols = [...new Set(String(params.symbols || '').split(',').filter(symbol => SYMBOL_RE.test(symbol)))].slice(0, 80)
  if (!symbols.length) return response.badRequest('缺少有效的 A 股 symbols')

  const now = Date.now()
  const { fresh, stale } = await readFromDB(symbols, period, now)
  const data = { ...fresh }
  const staleSymbols = new Set()
  const misses = symbols.filter(symbol => !data[symbol])
  const upstreamValues = {}

  for (let index = 0; index < misses.length; index += BATCH_SIZE) {
    const batch = misses.slice(index, index + BATCH_SIZE)
    const values = await Promise.all(batch.map(symbol => fetchOne(symbol, period).catch(() => null)))
    batch.forEach((symbol, offset) => {
      if (values[offset]) {
        data[symbol] = values[offset]
        upstreamValues[symbol] = values[offset]
      } else if (stale[symbol]) {
        data[symbol] = stale[symbol]
        staleSymbols.add(symbol)
      }
    })
  }
  if (Object.keys(upstreamValues).length) await writeToDB(upstreamValues, period)

  const result = Object.fromEntries(Object.entries(data).map(([symbol, value]) => [symbol, {
    ...value,
    expiresAt: staleSymbols.has(symbol) ? now + 5 * 60 * 1000 : cacheExpiresAt(period, now),
    ...(staleSymbols.has(symbol) ? { stale: true } : {}),
  }]))
  return response.ok(JSON.stringify({ data: result }), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
}
