// 与纳指 ETF 清单保持一致；只代理固定证券的前复权日 K 线。
const codes = new Set(['513110', '159513', '159632', '159660', '513390', '513870', '513300', '159659', '159941', '159696', '513100', '159501'])
const cache = new Map()
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
}

module.exports = async function nasdaqHistory({ code }) {
  if (!codes.has(code)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid ETF code' }) }
  const cached = cache.get(code)
  if (cached && Date.now() < cached.expiresAt) return cached.response
  const symbol = `${code.startsWith('5') ? 'sh' : 'sz'}${code}`
  try {
    const params = new URLSearchParams({ param: `${symbol},day,,,320,qfq`, _: String(Math.floor(Date.now() / 300_000)) })
    const request = () => fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?${params}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://gu.qq.com/' },
      signal: AbortSignal.timeout(6000),
    })
    let upstream = await request()
    // 腾讯偶发返回 WAF 501 页面；仅重试一次，失败仍返回明确错误。
    if (upstream.status === 501) {
      await upstream.text()
      params.set('_', String(Date.now()))
      upstream = await request()
    }
    if (!upstream.ok) throw new Error(`HTTP ${upstream.status}: ${(await upstream.text()).slice(0, 300)}`)
    const data = await upstream.json()
    const rows = data.data?.[symbol]?.qfqday ?? data.data?.[symbol]?.day
    if (!Array.isArray(rows) || !rows.length) throw new Error('Empty history')
    const response = {
      statusCode: 200,
      headers: { ...headers, 'Cache-Control': 'public, max-age=60' },
      body: JSON.stringify({ rows }),
    }
    cache.set(code, { response, expiresAt: Date.now() + 300_000 })
    return response
  } catch (error) {
    console.error(`[nasdaqHistory] ${code}: ${error.message}`)
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'ETF history unavailable' }) }
  }
}
