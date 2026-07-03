/**
 * 企业性质查询（仅 A 股）
 * 代理东财 ShareholderResearch/PageAjax，180 天 DB 缓存
 *
 * 请求参数: ?code=600519
 * 返回格式: 东财原始 JSON
 */

const db = require('../utils/db')
const { ok, upstreamError } = require('../utils/response')

const DB_COLLECTION = 'ownerTypes'
const CACHE_TTL = 180 * 24 * 60 * 60 * 1000 // 180 天
const memCache = new Map()                    // 模块作用域，warm container 复用

function toEmCode(code) {
  const s = String(code).padStart(6, '0')
  return s[0] === '6' ? `SH${s}` : `SZ${s}`
}

module.exports = async function ownerTypeHandler(params) {
  const code = params.code
  if (!code) throw new Error('code 参数不能为空')

  const emCode = toEmCode(code)

  // 1. 内存缓存
  const memHit = memCache.get(emCode)
  if (memHit) return ok(memHit, { 'Content-Type': 'application/json' })

  // 2. DB 缓存
  try {
    const doc = await db.collection(DB_COLLECTION).doc(emCode).get()
    const d = Array.isArray(doc?.data) ? doc.data[0] : doc?.data
    if (d?.data && d.updatedAt) {
      const age = Date.now() - new Date(d.updatedAt).getTime()
      if (age < CACHE_TTL) {
        memCache.set(emCode, d.data)
        return ok(d.data, { 'Content-Type': 'application/json' })
      }
    }
  } catch { /* 无缓存，继续请求 */ }

  // 3. 东财实时接口
  try {
    const res = await fetch(
      `https://emweb.securities.eastmoney.com/PC_HSF10/ShareholderResearch/PageAjax?code=${emCode}`,
      { headers: { Referer: 'https://emweb.securities.eastmoney.com/' } }
    )
    if (!res.ok) return upstreamError(`eastmoney error: ${res.status}`)
    const json = await res.json()
    const body = JSON.stringify(json)

    memCache.set(emCode, body)

    // 异步回写 DB
    db.collection(DB_COLLECTION).doc(emCode).set({
      data: body,
      updatedAt: db.serverDate(),
    }).catch(e => console.warn(`[ownerType] DB 回写 ${emCode} 失败:`, e.message))

    return ok(body, { 'Content-Type': 'application/json' })
  } catch (e) {
    return upstreamError(`eastmoney error: ${e.message}`)
  }
}
