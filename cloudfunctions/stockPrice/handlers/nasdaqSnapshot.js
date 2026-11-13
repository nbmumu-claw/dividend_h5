const db = require('../utils/db')
const { ok, upstreamError } = require('../utils/response')

const CODES = ['sh513110', 'sz159513', 'sz159632', 'sz159660', 'sh513390', 'sh513870',
  'sh513300', 'sz159659', 'sz159941', 'sz159696', 'sh513100', 'sz159501']
const SNAPSHOT_ID = 'NASDAQ_100_ETF_SNAPSHOT_V1'
const collection = () => db.collection('stockPrices').doc(SNAPSHOT_ID)

function isTradingSession(now = Date.now()) {
  const china = new Date(now + 8 * 60 * 60_000)
  const day = china.getUTCDay()
  const minutes = china.getUTCHours() * 60 + china.getUTCMinutes()
  return day >= 1 && day <= 5 && ((minutes >= 555 && minutes < 690) || (minutes >= 780 && minutes < 900))
}

function validQuoteCount(body) {
  const allowed = new Set(CODES)
  let count = 0
  for (const match of body.matchAll(/v_((?:sh|sz)\d{6})="([^"]*)"/g)) {
    if (!allowed.has(match[1])) continue
    const fields = match[2].split('~')
    if (fields.length <= 78 || !/^\d{14}$/.test(fields[30] || '')) continue
    if ([3, 72, 78].some(index => !Number.isFinite(Number(fields[index])) || Number(fields[index]) <= 0)) continue
    count += 1
  }
  return count
}

async function readSnapshot() {
  const result = await collection().get()
  const doc = Array.isArray(result?.data) ? result.data[0] : result?.data
  return typeof doc?.body === 'string' && validQuoteCount(doc.body) === CODES.length ? doc.body : null
}

async function fetchLive() {
  const response = await fetch(`https://qt.gtimg.cn/q=${encodeURIComponent(CODES.join(','))}`, {
    headers: { Referer: 'https://finance.qq.com' },
  })
  if (!response.ok) throw new Error(`Tencent upstream error: ${response.status}`)
  const body = new TextDecoder('gbk').decode(await response.arrayBuffer())
  if (validQuoteCount(body) !== CODES.length) throw new Error('Tencent returned incomplete Nasdaq ETF quotes')
  return body
}

async function writeSnapshot(body) {
  await collection().set({ code: SNAPSHOT_ID, body, updatedAt: db.serverDate() })
}

function response(body, cached) {
  return ok(body, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': cached ? 'public, max-age=300, stale-while-revalidate=60' : 'no-store',
  })
}

async function nasdaqSnapshotHandler(_params, now = Date.now()) {
  const trading = isTradingSession(now)
  let cached = null
  try {
    cached = await readSnapshot()
  } catch (error) {
    console.warn('[nasdaqSnapshot] DB 读取失败:', error.message)
    if (!trading) return upstreamError('盘后快照暂不可用')
  }

  if (!trading && cached) return response(cached, true)

  try {
    const body = await fetchLive()
    try { await writeSnapshot(body) } catch (error) {
      console.warn('[nasdaqSnapshot] DB 写入失败:', error.message)
      if (!trading) throw error
    }
    return response(body, false)
  } catch (error) {
    console.warn('[nasdaqSnapshot] 更新失败:', error.message)
    return cached ? response(cached, true) : upstreamError('纳指 ETF 行情暂不可用')
  }
}

module.exports = nasdaqSnapshotHandler
module.exports.isTradingSession = isTradingSession
module.exports.validQuoteCount = validQuoteCount
