/**
 * 股价处理器
 *
 * 读取策略（优先级从高到低）：
 *   1. 内存缓存（30s，模块作用域，warm container 复用）
 *   2. 云数据库 stockPrices（交易时段 2min / 休市 30min）
 *   3. 腾讯证券实时接口（A股/港股/美股）
 *   4. Yahoo Finance（美股降级）
 *
 * 请求参数: ?codes=sh600519,usVGT
 * 返回格式: 腾讯原始文本（v_xxCODE="..." 行）
 */

const db = require('../utils/db')
const { ok, upstreamError } = require('../utils/response')

const DB_COLLECTION = 'stockPrices'

// ── 内存缓存（模块作用域） ────────────────────────────────────────────
const MEM_TTL = 30 * 1000
const memCache = new Map()
const inflightYahoo = new Map()

// ── DB 新鲜度 ─────────────────────────────────────────────────────────
const FRESH_TRADING = 2 * 60 * 1000
const FRESH_CLOSED = 30 * 60 * 1000

function isTradingHour() {
  const now = new Date()
  const day = now.getUTCDay()
  const mins = ((now.getUTCHours() + 8) % 24) * 60 + now.getUTCMinutes()
  return day >= 1 && day <= 5 && mins >= 570 && mins < 900
}
function freshTTL() { return isTradingHour() ? FRESH_TRADING : FRESH_CLOSED }

// ── 腾讯接口 ───────────────────────────────────────────────────────────

function parseUsCodes(codesStr) {
  return codesStr.split(',').filter(c => /^us[A-Z0-9]+$/i.test(c.trim())).map(c => c.trim().toUpperCase())
}

function parseTxResponse(body) {
  const result = {}
  const lines = body.split('\n')
  for (const line of lines) {
    const m = line.match(/v_([a-z]{2}[\dA-Za-z]+)="([^"]*)"/)
    if (!m) continue
    const code = m[1].toUpperCase()
    const fields = m[2].split('~')
    const price = parseFloat(fields[3])
    if (price > 0 && fields.length >= 33) {
      result[code] = {
        price,
        preClose: parseFloat(fields[4]) || price,
        pctChg: parseFloat(fields[32]) || 0,
        tradeDate: (fields[30] || '').replace(/\D/g, '').slice(0, 8),
        marketCap: parseFloat(fields[45]) || undefined,
        source: 'txzq_realtime',
        _line: line,
      }
    }
  }
  return result
}

async function fetchTencent(codesStr) {
  const res = await fetch(`https://qt.gtimg.cn/q=${encodeURIComponent(codesStr)}`, {
    headers: { Referer: 'https://finance.qq.com' },
  })
  if (!res.ok) throw new Error(`Tencent upstream error: ${res.status}`)
  return res.text()
}

// ── Yahoo 降级 ─────────────────────────────────────────────────────────

async function fetchYahoo(usCode) {
  const ticker = usCode.replace(/^us/i, '')
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (!res.ok) return null
    const json = await res.json()
    const meta = json?.chart?.result?.[0]?.meta
    if (!meta?.regularMarketPrice || meta.regularMarketPrice <= 0) return null
    const price = meta.regularMarketPrice
    const preClose = meta.chartPreviousClose || meta.previousClose || price
    const pctChg = preClose > 0 ? ((price - preClose) / preClose) * 100 : 0
    const ts = meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString().replace(/[-:]/g, '').replace('T', ' ').slice(0, 17)
      : ''
    return { code: usCode, price, preClose, pctChg: parseFloat(pctChg.toFixed(2)), tradeDate: ts.replace(/\D/g, '').slice(0, 8), source: 'yahoo_fallback' }
  } catch { return null }
}

// ── 数据 → 腾讯文本格式 ──────────────────────────────────────────────

function toTxLine(code, data) {
  const f = Array(46).fill('')
  f[3] = data.price.toFixed(2)
  f[4] = (data.preClose || data.price).toFixed(2)
  f[30] = data.tradeDate ? `${data.tradeDate.slice(0, 4)}-${data.tradeDate.slice(4, 6)}-${data.tradeDate.slice(6, 8)} 15:00:00` : ''
  f[32] = (data.pctChg || 0).toFixed(2)
  if (data.marketCap) f[45] = data.marketCap.toFixed(2)
  return `v_${code}="${f.join('~')}"`
}

// ── DB 缓存（code 统一大写，避免大小写不命中）─────────────────────────

async function readFromDB(codes) {
  const freshMap = {}, staleCodes = []
  if (!codes.length) return { freshMap, staleCodes }
  const upperCodes = codes.map(c => c.toUpperCase())
  let docs
  try {
    const result = await db.collection(DB_COLLECTION).where({ code: db.command.in(upperCodes) }).limit(100).get()
    docs = result.data || []
  } catch (err) {
    console.warn('[stockPrice] DB 读取失败:', err.message)
    return { freshMap: {}, staleCodes: codes }
  }
  const dbMap = {}
  for (const doc of docs) dbMap[doc.code] = doc
  const now = Date.now(), ttl = freshTTL()
  for (const code of codes) {
    const doc = dbMap[code.toUpperCase()]
    if (!doc?.updatedAt) { staleCodes.push(code); continue }
    if (now - new Date(doc.updatedAt).getTime() > ttl) { staleCodes.push(code); continue }
    freshMap[code] = { price: doc.price, preClose: doc.preClose, pctChg: doc.pctChg, tradeDate: doc.tradeDate, marketCap: doc.marketCap, source: 'db_cache' }
  }
  return { freshMap, staleCodes }
}

function writeToDB(priceMap) {
  Object.entries(priceMap)
    .filter(([, v]) => v && v.price > 0)
    .forEach(([code, data]) => {
      const c = code.toUpperCase()
      db.collection(DB_COLLECTION).doc(c).set({
        code: c, price: data.price, preClose: data.preClose, pctChg: data.pctChg,
        tradeDate: data.tradeDate, marketCap: data.marketCap, source: data.source,
        updatedAt: db.serverDate(),
      }).catch(e => console.warn(`[stockPrice] DB 回写 ${c} 失败:`, e.message))
    })
}

// ── 主入口 ─────────────────────────────────────────────────────────────

module.exports = async function stockPriceHandler(params) {
  const codesStr = params.codes || ''
  if (!codesStr) throw new Error('codes 参数不能为空')

  const forceRefresh = params.forceRefresh === 'true' || params.forceRefresh === true
  const allCodes = codesStr.split(',').map(c => c.trim()).filter(Boolean)
  const usCodes = parseUsCodes(codesStr)
  const now = Date.now()

  // 1. 内存缓存（forceRefresh 时跳过）
  const memHits = {}, memMisses = []
  if (!forceRefresh) {
    for (const code of allCodes) {
      const entry = memCache.get(code)
      if (entry && (now - entry.ts) < MEM_TTL) memHits[code] = entry.data
      else memMisses.push(code)
    }
  } else {
    memMisses.push(...allCodes)
  }

  // 2. DB 缓存（forceRefresh 时跳过）
  let dbHits = {}, staleCodes = memMisses
  if (!forceRefresh && memMisses.length > 0) {
    const r = await readFromDB(memMisses)
    dbHits = r.freshMap, staleCodes = r.staleCodes
    for (const [code, data] of Object.entries(dbHits)) memCache.set(code, { data, ts: now })
  }

  // 3. 实时拉取（腾讯）
  let liveMap = {}, txBody = '', txOk = false
  if (staleCodes.length > 0) {
    try {
      txBody = await fetchTencent(staleCodes.join(',')); txOk = true
      const parsed = parseTxResponse(txBody)
      for (const [code, data] of Object.entries(parsed)) {
        liveMap[code] = { price: data.price, preClose: data.preClose, pctChg: data.pctChg, tradeDate: data.tradeDate, marketCap: data.marketCap, source: data.source }
        memCache.set(code, { data: liveMap[code], ts: now })
      }
      staleCodes.forEach(c => { if (!parsed[c]) liveMap[c] = null })
    } catch (err) {
      console.warn('[stockPrice] 腾讯请求失败:', err.message)
      staleCodes.forEach(c => { if (!liveMap[c]) liveMap[c] = null })
    }
  }

  // 4. Yahoo 降级
  const yahooLines = []
  if (usCodes.length > 0) {
    const txParsed = txOk ? parseTxResponse(txBody) : {}
    const needYahoo = usCodes.filter(c => !txParsed[c] || txParsed[c].price <= 0)
    if (needYahoo.length > 0) {
      const results = await Promise.all(needYahoo.map(async c => {
        if (inflightYahoo.has('yh_' + c)) return inflightYahoo.get('yh_' + c)
        const p = fetchYahoo(c); inflightYahoo.set('yh_' + c, p)
        const data = await p; inflightYahoo.delete('yh_' + c); return data
      }))
      results.forEach(data => {
        if (!data) return
        liveMap[data.code] = { price: data.price, preClose: data.preClose, pctChg: data.pctChg, tradeDate: data.tradeDate, source: 'yahoo_fallback' }
        memCache.set(data.code, { data: liveMap[data.code], ts: now })
        if (txParsed[data.code] && txParsed[data.code]._line) {
          txBody = txBody.replace(txParsed[data.code]._line, toTxLine(data.code, data))
        } else {
          yahooLines.push(toTxLine(data.code, data))
        }
      })
    }
  }

  // 5. 异步回写 DB
  writeToDB(liveMap)

  // 6. 拼装响应
  const cacheLines = []
  for (const [code, data] of Object.entries(memHits)) cacheLines.push(toTxLine(code, data))
  for (const [code, data] of Object.entries(dbHits)) {
    if (!memHits[code]) cacheLines.push(toTxLine(code, data))
  }
  const parts = [...cacheLines, txBody.trimEnd(), ...yahooLines].filter(Boolean)
  if (!parts.length) return upstreamError('all sources failed')

  return ok(parts.join('\n'), { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=10' })
}
