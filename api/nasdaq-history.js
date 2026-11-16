// 固定 ETF 清单，避免成为任意证券的开放代理。
const codes = new Set(['513110', '159513', '159632', '159660', '513390', '513870', '513300', '159659', '159941', '159696', '513100', '159501'])

export default async function handler(req, res) {
  const code = new URL(req.url, 'http://localhost').searchParams.get('code')
  res.setHeader('Content-Type', 'application/json')
  if (!codes.has(code)) {
    res.statusCode = 400
    return res.end(JSON.stringify({ error: 'Invalid ETF code' }))
  }
  const symbol = `${code.startsWith('5') ? 'sh' : 'sz'}${code}`
  try {
    const response = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,320,qfq`, { signal: AbortSignal.timeout(12000) })
    if (!response.ok) throw new Error('History unavailable')
    const body = await response.json()
    const rows = body.data?.[symbol]?.qfqday ?? body.data?.[symbol]?.day
    if (!Array.isArray(rows) || !rows.length) throw new Error('Empty history')
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60')
    res.end(JSON.stringify({ rows }))
  } catch {
    res.statusCode = 502
    res.end(JSON.stringify({ error: 'ETF history unavailable' }))
  }
}
