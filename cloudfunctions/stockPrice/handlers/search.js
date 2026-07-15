/**
 * 统一搜索代理：A/H/美股及场外基金。
 * source: tx | em | sina | us | fund
 */

const { ok, badRequest, upstreamError } = require('../utils/response')

const SOURCES = {
  tx: {
    buildUrl: params => `https://smartbox.gtimg.cn/s3/?${new URLSearchParams(params)}`,
    contentType: 'text/plain; charset=utf-8',
  },
  em: {
    buildUrl: params => `https://searchapi.eastmoney.com/api/suggest/get?${new URLSearchParams(params)}`,
    contentType: 'application/json; charset=utf-8',
  },
  sina: {
    buildUrl: params => `https://suggest3.sinajs.cn/suggest/type=11,12,13,14,15,31&key=${encodeURIComponent(params.key || '')}&_=${Date.now()}`,
    contentType: 'text/plain',
    binary: true,
  },
  us: {
    buildUrl: params => `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(params.q || '')}&quotesCount=8&newsCount=0`,
    contentType: 'application/json; charset=utf-8',
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
  },
  fund: {
    buildUrl: params => `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(params.key || '')}`,
    contentType: 'application/json; charset=utf-8',
    headers: { Referer: 'http://fund.eastmoney.com/', 'User-Agent': 'Mozilla/5.0' },
  },
}

module.exports = async function searchHandler(params) {
  const source = params.source
  const config = SOURCES[source]
  if (!config) return badRequest('source 参数无效')

  const upstreamParams = { ...params }
  delete upstreamParams.source

  try {
    const res = await fetch(config.buildUrl(upstreamParams), { headers: config.headers })
    if (!res.ok) return upstreamError(`${source} search error: ${res.status}`)

    const body = config.binary
      ? Buffer.from(await res.arrayBuffer())
      : await res.text()
    return ok(body, {
      'Content-Type': res.headers.get('content-type') || config.contentType,
      'Cache-Control': 'public, max-age=10',
    })
  } catch (e) {
    return upstreamError(`${source} search error: ${e.message}`)
  }
}
