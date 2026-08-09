/**
 * 按财报年返回现金股利支付率。
 *
 * 仅汇总东财已标记为“实施分配”的记录；同一财报年的中期和年度分红会相加。
 * 缓存键为 `${code}_${year}`，历史财报年写入后不再重复请求上游。
 */

const db = require('../utils/db')
const { ok, badRequest, upstreamError } = require('../utils/response')

const COLLECTION = 'dividendPayouts'
const EASTMONEY_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get'

function parseCodes(value) {
  return [...new Set(String(value || '').split(',').map(code => code.trim()).filter(code => /^\d{6}$/.test(code)))]
}

function parseYears(value) {
  const currentYear = new Date().getFullYear()
  const defaults = [currentYear - 3, currentYear - 2, currentYear - 1]
  const years = String(value || '')
    .split(',')
    .map(year => Number(year.trim()))
    .filter(year => Number.isInteger(year) && year >= 1990 && year < currentYear)
  return [...new Set(years.length ? years : defaults)].sort((a, b) => b - a)
}

async function readCache(code, years) {
  const records = await Promise.all(years.map(async year => {
    try {
      const result = await db.collection(COLLECTION).doc(`${code}_${year}`).get()
      const data = Array.isArray(result.data) ? result.data[0] : result.data
      return data?.code === code && data?.year === year ? { _id: `${code}_${year}`, ...data } : null
    } catch {
      return null
    }
  }))
  return records.filter(Boolean)
}

async function fetchDividendRows(code) {
  const query = new URLSearchParams({
    reportName: 'RPT_SHAREBONUS_DET',
    columns: 'SECURITY_CODE,REPORT_DATE,ASSIGN_PROGRESS,PRETAX_BONUS_RMB,BASIC_EPS,TOTAL_SHARES,EX_DIVIDEND_DATE',
    filter: `(SECURITY_CODE="${code}")`,
    pageNumber: '1',
    pageSize: '100',
    sortColumns: 'REPORT_DATE',
    sortTypes: '-1',
  })
  const response = await fetch(`${EASTMONEY_URL}?${query}`)
  if (!response.ok) throw new Error(`eastmoney error: ${response.status}`)
  const json = await response.json()
  return json?.result?.data || []
}

function buildPayoutRecords(code, years, rows) {
  const byYear = new Map(years.map(year => [year, { dividendPerShare: 0, eps: null, shares: null, events: [] }]))

  for (const row of rows) {
    if (row.ASSIGN_PROGRESS !== '实施分配') continue
    const reportYear = Number(String(row.REPORT_DATE || '').slice(0, 4))
    const group = byYear.get(reportYear)
    const perShare = Number(row.PRETAX_BONUS_RMB) / 10
    if (!group || !Number.isFinite(perShare) || perShare <= 0) continue

    group.dividendPerShare += perShare
    group.events.push({
      reportDate: String(row.REPORT_DATE).slice(0, 10),
      exDividendDate: String(row.EX_DIVIDEND_DATE || '').slice(0, 10) || null,
      dividendPerShare: perShare,
    })
    if (String(row.REPORT_DATE || '').slice(5, 10) === '12-31') {
      const eps = Number(row.BASIC_EPS)
      if (Number.isFinite(eps) && eps > 0) group.eps = eps
      const shares = Number(row.TOTAL_SHARES)
      if (Number.isFinite(shares) && shares > 0) group.shares = shares
    }
  }

  return years.map(year => {
    const group = byYear.get(year)
    if (!group?.eps || group.events.length === 0) {
      return {
        _id: `${code}_${year}`,
        code,
        year,
        dividendPerShare: null,
        eps: group?.eps || null,
        payoutRatio: null,
        dividendTotal: null,
        events: group?.events || [],
        source: 'eastmoney',
        cachedAt: new Date().toISOString(),
      }
    }
    const dividendPerShare = Number(group.dividendPerShare.toFixed(6))
    return {
      _id: `${code}_${year}`,
      code,
      year,
      dividendPerShare,
      eps: group.eps,
      payoutRatio: Number(((dividendPerShare / group.eps) * 100).toFixed(2)),
      dividendTotal: group.shares ? Math.round(dividendPerShare * group.shares) : null,
      events: group.events,
      source: 'eastmoney',
      cachedAt: new Date().toISOString(),
    }
  })
}

async function writeCache(records) {
  await Promise.all(records.map(({ _id, ...record }) => db.collection(COLLECTION).doc(_id).set(record)
    .catch(error => console.warn(`[dividendPayout] 缓存写入 ${_id} 失败:`, error.message))))
}

async function loadCodePayouts(code, years) {
  const cached = await readCache(code, years)
  const cachedYears = new Set(cached.map(record => record.year))
  const missingYears = years.filter(year => !cachedYears.has(year))
  if (missingYears.length === 0) return cached.sort((a, b) => b.year - a.year)

  const rows = await fetchDividendRows(code)
  const fresh = buildPayoutRecords(code, missingYears, rows)
  await writeCache(fresh)
  return [...cached, ...fresh].sort((a, b) => b.year - a.year)
}

module.exports = async function dividendPayoutHandler(params) {
  const codes = parseCodes(params.codes)
  if (codes.length === 0) return badRequest('codes 参数不能为空，且必须是 6 位 A 股代码')
  if (codes.length > 20) return badRequest('单次最多查询 20 只股票')
  const years = parseYears(params.years)

  try {
    const results = await Promise.all(codes.map(async code => ({ code, data: await loadCodePayouts(code, years) })))
    return ok(JSON.stringify({ data: results }), {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    })
  } catch (error) {
    return upstreamError(`eastmoney error: ${error.message}`)
  }
}
