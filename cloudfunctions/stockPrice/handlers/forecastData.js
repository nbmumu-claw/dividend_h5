const { ok, badRequest, upstreamError } = require('../utils/response')
const EASTMONEY_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get'

module.exports = async function forecastData(params) {
  const code = String(params.code || '')
  if (!/^\d{6}$/.test(code)) return badRequest('code 必须为 6 位 A 股代码')
  try {
    const common = { filter: `(SECURITY_CODE="${code}")`, pageNumber: '1', pageSize: '100', sortTypes: '-1' }
    const reportsQuery = new URLSearchParams({ ...common, reportName: 'RPT_LICO_FN_CPD', columns: 'SECURITY_CODE,SECURITY_NAME_ABBR,REPORT_DATE,NOTICE_DATE,PARENT_NETPROFIT,BASIC_EPS', sortColumns: 'REPORT_DATE' })
    const dividendQuery = new URLSearchParams({ ...common, reportName: 'RPT_SHAREBONUS_DET', columns: 'SECURITY_CODE,REPORT_DATE,NOTICE_DATE,PRETAX_BONUS_RMB,TOTAL_SHARES,ASSIGN_PROGRESS', sortColumns: 'REPORT_DATE' })
    const [reportRes, dividendRes] = await Promise.all([fetch(`${EASTMONEY_URL}?${reportsQuery}`), fetch(`${EASTMONEY_URL}?${dividendQuery}`)])
    if (!reportRes.ok || !dividendRes.ok) throw new Error('上游接口不可用')
    const reports = (await reportRes.json())?.result?.data || []
    const dividends = (await dividendRes.json())?.result?.data || []
    const latestShare = dividends.find(row => Number(row.TOTAL_SHARES) > 0) || null
    const interim = dividends.find(row => String(row.REPORT_DATE || '').startsWith('2026-06-30')) || null
    return ok(JSON.stringify({ code, name: reports[0]?.SECURITY_NAME_ABBR || code, reports, latestShare, interimDividend: interim }), { 'Content-Type': 'application/json; charset=utf-8' })
  } catch (error) { return upstreamError(error.message) }
}
