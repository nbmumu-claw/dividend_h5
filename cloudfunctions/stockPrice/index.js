/**
 * 红利助手 · 统一数据网关 (H5)
 *
 * 调用方式：
 *   GET /stockPrice?codes=sh600519,usVGT            → action=stockPrice（默认）
 *   GET /stockPrice?action=dividendHistory&code=...  → 未来扩展
 *
 * 新增 Handler：
 *   1. 在 handlers/ 下新建 handler 文件
 *   2. 在下方 HANDLERS 注册表中加一行
 */

const http = require('http')
const response = require('./utils/response')

// ── Handler 注册表 ──────────────────────────────────────────────────────
const HANDLERS = {
  stockPrice: './handlers/stockPrice',
  ownerType:  './handlers/ownerType',
  dividendHistory: './handlers/dividendHistory',
  search: './handlers/search',
  weeklyBoll: './handlers/weeklyBoll',
  periodBoll: './handlers/periodBoll',
}

// 懒加载，避免冷启动全量 require
const handlerCache = {}
function getHandler(action) {
  if (!handlerCache[action]) handlerCache[action] = require(HANDLERS[action])
  return handlerCache[action]
}

// ── HTTP 服务 ───────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    const action = url.searchParams.get('action') || 'stockPrice'

    if (!HANDLERS[action]) {
      const r = response.badRequest(`未知的 action: ${action}`)
      res.writeHead(r.statusCode, r.headers); res.end(r.body); return
    }

    // 将 ?action=xxx 之外的查询参数全部作为 handler 参数传入
    const params = {}
    for (const [k, v] of url.searchParams) {
      if (k !== 'action') params[k] = v
    }

    const handler = getHandler(action)
    const r = await handler(params)

    res.writeHead(r.statusCode, r.headers)
    res.end(r.body)
  } catch (e) {
    console.error(`[dataGateway] ${e.message}`)
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`error: ${e.message}`)
  }
})

server.listen(9000)

exports.main = server
