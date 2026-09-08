const CLOUDBASE_FORECAST_URL = 'https://vercel-dividend-d8faqegf03442b6c-1421474398.ap-shanghai.app.tcloudbase.com/dividendForecast'
const ALLOWED_ORIGINS = new Set([
  'https://www.manmanbianfu.top',
  'https://manmanbianfu.top',
])

function validatedForecastQuery(query) {
  const code = String(query.code || '')
  if (!/^\d{6}$/.test(code)) throw new Error('code 必须为 6 位 A 股代码')
  const params = new URLSearchParams({ code, year: '2026' })
  if (query.year && String(query.year) !== '2026') throw new Error('目前仅支持 2026 财年预测')
  if (query.profitRatio !== undefined) {
    const ratio = Number(query.profitRatio)
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) throw new Error('H1 / 全年利润比例必须大于 0 且不超过 1')
    params.set('profitRatio', String(ratio))
  }
  if (query.payoutMethod !== undefined) {
    const method = String(query.payoutMethod)
    if (!['auto', 'average', 'median', 'latest'].includes(method)) throw new Error('派息率算法无效')
    params.set('payoutMethod', method)
  }
  if (query.forecastMethod !== undefined) {
    const method = String(query.forecastMethod)
    if (!['auto', 'profit', 'interim', 'policy'].includes(method)) throw new Error('预测方法无效')
    params.set('forecastMethod', method)
  }
  return params
}

async function handleForecast(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: 'Method Not Allowed' })
    return
  }

  const origin = req.headers?.origin
  const host = String(req.headers?.host || '')
  const isLocal = /^localhost(?::\d+)?$/.test(host) || /^127\.0\.0\.1(?::\d+)?$/.test(host)
  if (origin && !ALLOWED_ORIGINS.has(origin) && !isLocal) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const accessKey = process.env.CLOUDBASE_FORECAST_ACCESS_KEY
  const proxySecret = process.env.FORECAST_PROXY_SECRET
  if (!accessKey || !proxySecret) {
    res.status(503).json({ error: '预测服务尚未配置' })
    return
  }

  let params
  try {
    params = validatedForecastQuery(req.query || {})
  } catch (error) {
    res.status(400).json({ error: error.message })
    return
  }

  try {
    const response = await fetch(`${CLOUDBASE_FORECAST_URL}?${params}`, {
      headers: {
        Authorization: `Bearer ${accessKey}`,
        'X-Forecast-Proxy-Secret': proxySecret,
      },
      signal: AbortSignal.timeout(45000),
    })
    const body = await response.text()
    res.status(response.status)
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'private, no-store')
    res.send(body)
  } catch (error) {
    res.status(502).json({ error: error.name === 'TimeoutError' ? '预测服务响应超时' : '预测服务暂不可用' })
  }
}

export default async function handler(req, res) {
  if (req.query?.__proxy === 'forecast') return handleForecast(req, res)
  const qs = new URLSearchParams(req.query).toString()
  const response = await fetch(`https://datacenter-web.eastmoney.com/api/data/v1/get?${qs}`)
  const text = await response.text()
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30')
  res.send(text)
}

export { validatedForecastQuery }
