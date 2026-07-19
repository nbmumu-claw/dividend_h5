const response = require('../utils/response')
const db = require('../utils/db')
const periodBollHandler = require('./periodBoll')
const { isCacheFresh } = require('./periodBollCore')

const SYMBOL_RE = /^(?:sh|sz|bj)\d{6}$/
const LEGACY_COLLECTION = 'weeklyBollCache'

async function readLegacyCache(symbols) {
  try {
    const result = await db.collection(LEGACY_COLLECTION).where({ symbol: db.command.in(symbols) }).limit(100).get()
    const now = Date.now()
    return Object.fromEntries((result.data || []).flatMap(doc => {
      const updatedAt = doc.updatedAt ? new Date(doc.updatedAt).getTime() : 0
      if (!doc.symbol || !doc.data || !isCacheFresh('week', updatedAt, now)) return []
      return [[doc.symbol, doc.data]]
    }))
  } catch (error) {
    console.warn('[weeklyBoll] 旧缓存读取失败:', error.message)
    return {}
  }
}

// 兼容旧版前端：有效旧缓存直接返回，缺失或过期数据统一走 periodBoll。
module.exports = async function weeklyBollHandler(params) {
  const symbols = [...new Set(String(params.symbols || '').split(',').filter(symbol => SYMBOL_RE.test(symbol)))].slice(0, 80)
  if (!symbols.length) {
    return response.ok(JSON.stringify({ data: {} }), {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })
  }

  const data = await readLegacyCache(symbols)
  const misses = symbols.filter(symbol => !data[symbol])
  if (misses.length) {
    const result = await periodBollHandler({ symbols: misses.join(','), period: 'week' })
    if (result.statusCode !== 200) return result

    const payload = JSON.parse(result.body)
    for (const [symbol, boll] of Object.entries(payload.data || {})) {
      data[symbol] = {
        middle: boll.middle,
        upper: boll.upper,
        lower: boll.lower,
        weekDate: boll.periodDate,
      }
    }
  }
  return response.ok(JSON.stringify({ data }), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
}
