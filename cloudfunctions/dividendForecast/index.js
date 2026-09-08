const http = require('node:http')
const { forecast } = require('./model')
const { createDataLoader } = require('./data')

function parseOptions(params) {
  const code = params.get('code') || ''
  if (!/^\d{6}$/.test(code)) throw new Error('code 必须为 6 位 A 股代码')
  if (params.has('year') && params.get('year') !== '2026') throw new Error('目前仅支持 2026 财年预测')
  const payoutMethod = params.get('payoutMethod') || 'auto'
  const forecastMethod = params.get('forecastMethod') || 'auto'
  if (!['auto', 'average', 'median', 'latest'].includes(payoutMethod)) throw new Error('派息率算法无效')
  if (!['auto', 'profit', 'interim', 'policy'].includes(forecastMethod)) throw new Error('预测方法无效')
  const profitRatio = params.has('profitRatio') ? Number(params.get('profitRatio')) : undefined
  if (profitRatio !== undefined && (!Number.isFinite(profitRatio) || profitRatio <= 0 || profitRatio > 1)) {
    throw new Error('H1 / 全年利润比例必须大于 0 且不超过 1')
  }
  return { code, options: { profitRatio, payoutMethod, forecastMethod } }
}

function createServer(loader = createDataLoader()) {
  return http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Cache-Control': 'no-store',
      })
      res.end(JSON.stringify(body))
    }
    const url = new URL(req.url, 'http://localhost')
    if (!['/', '/dividendForecast', '/health'].includes(url.pathname)) return send(404, { error: 'Not Found' })
    if (req.method === 'OPTIONS') return send(200, { ok: true })
    if (req.method !== 'GET') return send(405, { error: 'Method Not Allowed' })
    if (url.pathname === '/health') return send(200, { ok: true, modelVersion: '2026-v1' })
    const expectedSecret = process.env.FORECAST_PROXY_SECRET
    if (!expectedSecret || req.headers['x-forecast-proxy-secret'] !== expectedSecret) {
      return send(403, { error: 'Forbidden' })
    }
    let input
    try { input = parseOptions(url.searchParams) }
    catch (error) { return send(400, { error: error.message }) }
    try {
      const data = await loader(input.code)
      const result = forecast(input.code, data, input.options)
      if (![result.annualDps, result.annualProfit, result.appliedPayout].every(Number.isFinite)) {
        return send(422, { error: '基础数据无法形成有效预测' })
      }
      send(200, result)
    } catch (error) {
      console.error('[dividendForecast]', input.code, error.message)
      send(502, { error: error.message || '预测失败，请稍后重试' })
    }
  })
}

if (require.main === module) createServer().listen(9000)
module.exports = { createServer, parseOptions }
