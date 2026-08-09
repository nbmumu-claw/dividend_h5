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
const PAYOUT_CACHE_VERSION = 5
const EASTMONEY_NOTICE_LIST_URL = 'https://np-anotice-stock.eastmoney.com/api/security/ann'
const EASTMONEY_NOTICE_CONTENT_URL = 'https://np-cnotice-stock.eastmoney.com/api/content/ann'

// 东财接口未收录的已实施特别分红，按财报年补入。
const MANUAL_DIVIDEND_EVENTS = {
  '000538': {
    2024: [{ dividendPerShare: 1.213, reportDate: '2024-09-30', exDividendDate: '2024-11-26' }],
    2025: [{ dividendPerShare: 1.019, reportDate: '2025-09-30', exDividendDate: '2025-09-25' }],
  },
}
const MANUAL_CACHE_VERSION = 1

// 双重上市公司的 H 股派息在东财 A 股公告流中不完整，暂保留已核验值作为降级。
// 普通 A 股优先使用下方实施公告的实际全年派现总额，不再依赖此表。
const OFFICIAL_CASH_DIVIDENDS = {
  '000333': { 2024: 26711662411, 2025: 32160000000 },
  '000423': { 2025: 1738737424.8 },
  '000538': { 2024: 4278661722, 2025: 4642651293.01 },
}

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
      const isCurrent = data?.payoutCacheVersion === PAYOUT_CACHE_VERSION
      return data?.code === code && data?.year === year && isCurrent ? { _id: `${code}_${year}`, ...data } : null
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

async function fetchAnnualNetProfitRows(code) {
  const query = new URLSearchParams({
    reportName: 'RPT_LICO_FN_CPD',
    columns: 'SECURITY_CODE,REPORTDATE,PARENT_NETPROFIT',
    filter: `(SECURITY_CODE="${code}")`,
    pageNumber: '1',
    pageSize: '100',
    sortColumns: 'REPORTDATE',
    sortTypes: '-1',
  })
  const response = await fetch(`${EASTMONEY_URL}?${query}`)
  if (!response.ok) throw new Error(`eastmoney financial error: ${response.status}`)
  const json = await response.json()
  return json?.result?.data || []
}

function parseAmount(value) {
  const amount = Number(String(value || '').replace(/[,，\s]/g, ''))
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

function extractAnnualCashDividendTotal(content, year) {
  const normalized = String(content || '').replace(/\s+/g, '')
  const patterns = [
    new RegExp(`${year}年度(?:全年)?(?:合计|累计)派发现金红利(?:为|总额为)?([0-9,.，]+)元`),
    new RegExp(`${year}年度现金(?:股利|红利)(?:总额)?(?:为|合计为|合计派发)?([0-9,.，]+)元`),
    /全年(?:合计|累计)派发现金红利(?:为|总额为)?([0-9,.，]+)元/,
  ]
  for (const pattern of patterns) {
    const match = normalized.match(pattern)
    const amount = parseAmount(match?.[1])
    if (amount) return amount
  }
  return null
}

async function fetchAnnualImplementationTotals(code, years) {
  const query = new URLSearchParams({
    ann_type: 'A', client_source: 'web', f_node: '0', s_node: '0', sr: '-1',
    page_size: '100', page_index: '1', stock_list: code,
  })
  const response = await fetch(`${EASTMONEY_NOTICE_LIST_URL}?${query}`)
  if (!response.ok) throw new Error(`eastmoney notice list error: ${response.status}`)
  const json = await response.json()
  const notices = json?.data?.list || []
  const totals = new Map()

  await Promise.all(years.map(async year => {
    const candidates = notices.filter(notice => {
      const title = String(notice.title || '')
      return new RegExp(`${year}年?年度`).test(title) && !title.includes('A股')
        && /(利润分配|权益分派|分红派息).*(实施|派发).*(公告)?/.test(title)
    })
    for (const notice of candidates) {
      const contentQuery = new URLSearchParams({ art_code: notice.art_code, client_source: 'web', page_index: '1' })
      const contentResponse = await fetch(`${EASTMONEY_NOTICE_CONTENT_URL}?${contentQuery}`)
      if (!contentResponse.ok) continue
      const contentJson = await contentResponse.json()
      const dividendTotal = extractAnnualCashDividendTotal(contentJson?.data?.notice_content, year)
      if (dividendTotal) {
        totals.set(year, { dividendTotal, announcementCode: notice.art_code, announcementTitle: notice.title })
        return
      }
    }
  }))
  return totals
}

function buildPayoutRecords(code, years, rows, financialRows, implementationTotals) {
  const netProfitByYear = new Map(financialRows
    .filter(row => String(row.REPORTDATE || '').slice(5, 10) === '12-31')
    .map(row => [Number(String(row.REPORTDATE).slice(0, 4)), Number(row.PARENT_NETPROFIT)]))
  const byYear = new Map(years.map(year => [year, { dividendPerShare: 0, eps: null, dividendTotalEstimate: 0, events: [] }]))

  for (const row of rows) {
    if (row.ASSIGN_PROGRESS !== '实施分配') continue
    const reportYear = Number(String(row.REPORT_DATE || '').slice(0, 4))
    const group = byYear.get(reportYear)
    const perShare = Number(row.PRETAX_BONUS_RMB) / 10
    if (!group || !Number.isFinite(perShare) || perShare <= 0) continue

    group.dividendPerShare += perShare
    const shares = Number(row.TOTAL_SHARES)
    if (Number.isFinite(shares) && shares > 0) group.dividendTotalEstimate += perShare * shares
    group.events.push({
      reportDate: String(row.REPORT_DATE).slice(0, 10),
      exDividendDate: String(row.EX_DIVIDEND_DATE || '').slice(0, 10) || null,
      dividendPerShare: perShare,
    })
    if (String(row.REPORT_DATE || '').slice(5, 10) === '12-31') {
      const eps = Number(row.BASIC_EPS)
      if (Number.isFinite(eps) && eps > 0) group.eps = eps
    }
  }

  const manualByYear = MANUAL_DIVIDEND_EVENTS[code] || {}
  for (const [yearText, events] of Object.entries(manualByYear)) {
    const group = byYear.get(Number(yearText))
    if (!group) continue
    for (const event of events) {
      group.dividendPerShare += event.dividendPerShare
      group.events.push(event)
    }
  }

  return years.map(year => {
    const group = byYear.get(year)
    const netProfit = netProfitByYear.get(year)
    const implementationTotal = implementationTotals.get(year)
    const fallbackOfficialTotal = OFFICIAL_CASH_DIVIDENDS[code]?.[year]
    const dividendTotal = implementationTotal?.dividendTotal ?? fallbackOfficialTotal ?? (group?.dividendTotalEstimate ? Math.round(group.dividendTotalEstimate) : null)
    const calculationBasis = implementationTotal || fallbackOfficialTotal ? 'official' : 'estimated'
    const source = implementationTotal ? 'eastmoney-implementation-announcement' : calculationBasis === 'official' ? 'verified-fallback' : 'eastmoney-estimate'
    if (!netProfit || netProfit <= 0 || !dividendTotal || group?.events.length === 0) {
      return {
        _id: `${code}_${year}`,
        code,
        year,
        dividendPerShare: null,
        eps: group?.eps || null,
        payoutRatio: null,
        dividendTotal,
        netProfit: netProfit || null,
        calculationBasis,
        events: group?.events || [],
        source,
        announcementCode: implementationTotal?.announcementCode || null,
        announcementTitle: implementationTotal?.announcementTitle || null,
        manualCacheVersion: MANUAL_DIVIDEND_EVENTS[code]?.[year] ? MANUAL_CACHE_VERSION : null,
        payoutCacheVersion: PAYOUT_CACHE_VERSION,
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
      payoutRatio: Number(((dividendTotal / netProfit) * 100).toFixed(2)),
      dividendTotal,
      netProfit,
      calculationBasis,
      events: group.events,
      source,
      announcementCode: implementationTotal?.announcementCode || null,
      announcementTitle: implementationTotal?.announcementTitle || null,
      manualCacheVersion: MANUAL_DIVIDEND_EVENTS[code]?.[year] ? MANUAL_CACHE_VERSION : null,
      payoutCacheVersion: PAYOUT_CACHE_VERSION,
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

  const [rows, financialRows, implementationTotals] = await Promise.all([
    fetchDividendRows(code), fetchAnnualNetProfitRows(code), fetchAnnualImplementationTotals(code, missingYears),
  ])
  const fresh = buildPayoutRecords(code, missingYears, rows, financialRows, implementationTotals)
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
      'Cache-Control': 'no-store',
    })
  } catch (error) {
    return upstreamError(`eastmoney error: ${error.message}`)
  }
}
