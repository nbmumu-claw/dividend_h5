const response = require('../utils/response')
const db = require('../utils/db')
const { cacheExpiresAt, isCacheFresh } = require('./periodBollCore')

const SYMBOL_RE = /^(?:(?:sh|sz|bj)\d{6}|hk\d{5})$/
const DB_COLLECTION = 'weeklyChangeCache'
const BATCH_SIZE = 20

function parseWeeklyChange(rows) {
  const validRows = Array.isArray(rows)
    ? rows.filter(row => Array.isArray(row) && Number.isFinite(Number(row[2])) && Number(row[2]) > 0)
    : []
  if (validRows.length < 2) return null
  const previousClose = Number(validRows.at(-2)[2])
  const latestClose = Number(validRows.at(-1)[2])
  return {
    pctChg: (latestClose - previousClose) / previousClose * 100,
    periodDate: String(validRows.at(-1)[0] || ''),
    isPartial: true,
  }
}

async function fetchOne(symbol) {
  const params = new URLSearchParams({ param: `${symbol},week,,,2,qfq` })
  const upstream = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?${params}`, {
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://gu.qq.com/' },
    signal: AbortSignal.timeout(8000),
  })
  if (!upstream.ok) return null
  const payload = await upstream.json()
  return parseWeeklyChange(payload?.data?.[symbol]?.qfqweek)
}

async function readFromDB(symbols, now) {
  try {
    const result = await db.collection(DB_COLLECTION).where({ symbol: db.command.in(symbols) }).limit(100).get()
    const fresh = {}
    const stale = {}
    for (const doc of result.data || []) {
      if (!doc.symbol || !doc.data) continue
      stale[doc.symbol] = doc.data
      if (isCacheFresh('week', new Date(doc.updatedAt).getTime(), now)) fresh[doc.symbol] = doc.data
    }
    return { fresh, stale }
  } catch (error) {
    console.warn('[weeklyChange] DB 读取失败:', error.message)
    return { fresh: {}, stale: {} }
  }
}

async function writeToDB(values) {
  await Promise.allSettled(Object.entries(values).map(([symbol, data]) =>
    db.collection(DB_COLLECTION).doc(symbol).set({ symbol, data, updatedAt: db.serverDate() }),
  ))
}

module.exports = async function weeklyChangeHandler(params) {
  const symbols = [...new Set(String(params.symbols || '').split(',').filter(symbol => SYMBOL_RE.test(symbol)))].slice(0, 80)
  if (!symbols.length) return response.badRequest('缺少有效的股票 symbols')

  const now = Date.now()
  const { fresh, stale } = await readFromDB(symbols, now)
  const data = { ...fresh }
  const fetched = {}
  const misses = symbols.filter(symbol => !data[symbol])
  for (let index = 0; index < misses.length; index += BATCH_SIZE) {
    const batch = misses.slice(index, index + BATCH_SIZE)
    const values = await Promise.all(batch.map(symbol => fetchOne(symbol).catch(() => null)))
    batch.forEach((symbol, offset) => {
      if (values[offset]) { data[symbol] = values[offset]; fetched[symbol] = values[offset] }
      else if (stale[symbol]) data[symbol] = stale[symbol]
    })
  }
  if (Object.keys(fetched).length) await writeToDB(fetched)

  return response.ok(JSON.stringify({
    data,
    expiresAt: cacheExpiresAt('week', now),
  }), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
}
