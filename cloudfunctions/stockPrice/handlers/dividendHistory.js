/**
 * 东财数据中心代理：分红历史、分红日历、上市日期共用。
 * 请求参数原样转发，避免浏览器跨域访问东财接口。
 */

const { ok, badRequest, upstreamError } = require('../utils/response')

module.exports = async function dividendHistoryHandler(params) {
  if (!params.reportName) return badRequest('reportName 参数不能为空')

  try {
    const query = new URLSearchParams(params).toString()
    const res = await fetch(`https://datacenter-web.eastmoney.com/api/data/v1/get?${query}`)
    if (!res.ok) return upstreamError(`eastmoney error: ${res.status}`)

    return ok(await res.text(), {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    })
  } catch (e) {
    return upstreamError(`eastmoney error: ${e.message}`)
  }
}
