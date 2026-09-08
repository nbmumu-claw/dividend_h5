const GATEWAY = 'https://vercel-dividend-d8faqegf03442b6c.service.tcloudbase.com/stockPrice'

// Keep the same fiscal-year aggregation and historical supplements as the original page.
function dividendHistory(code, rows) {
  const byYear = {}
  for (const row of rows) {
    if (!['实施分配', '股东大会决议通过', '董事会决议通过', '特别分配'].some(s => (row.ASSIGN_PROGRESS || '').includes(s))) continue
    const year = row.REPORT_DATE ? parseInt(row.REPORT_DATE.slice(0, 4)) : 0
    if (!year) continue
    const match = row.IMPL_PLAN_PROFILE?.match(/10\s*派\s*(\d+(?:\.\d+)?)/)
    let dps = match ? parseFloat(match[1]) / 10 : 0
    if (!dps && row.PRETAX_BONUS_RMB) dps = Number(row.PRETAX_BONUS_RMB) / 10
    if (dps <= 0) continue
    byYear[year] = (byYear[year] || 0) + parseFloat(dps.toFixed(4))
  }
  const records = Object.entries(byYear).map(([year, value]) => ({ year: Number(year), perShare: Number(value.toFixed(4)) }))
  if (code === '000538') {
    for (const supplement of [{ year: 2024, perShare: 1.213 }, { year: 2025, perShare: 1.019 }]) {
      const record = records.find(item => item.year === supplement.year)
      if (record) record.perShare = Number((record.perShare + supplement.perShare).toFixed(4))
      else records.push(supplement)
    }
  }
  return { records: records.sort((a, b) => b.year - a.year) }
}

async function fetchJson(params) {
  const response = await fetch(`${GATEWAY}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`基础数据请求失败（${response.status}）`)
  return response.json()
}

async function loadData(code) {
  const [response, payoutResponse, historyResponse] = await Promise.all([
    fetchJson({ action: 'forecastData', code }),
    fetchJson({ action: 'dividendPayout', codes: code, years: '2023,2024,2025', version: '3' }),
    fetchJson({ action: 'dividendHistory', reportName: 'RPT_SHAREBONUS_DET', columns: 'ALL',
      filter: `(SECURITY_CODE="${code}")`, pageNumber: '1', pageSize: '200', sortColumns: 'REPORT_DATE', sortTypes: '-1' })
      .catch(error => {
        // As on the original page, unavailable history disables the interim anchor only.
        console.warn('[dividendForecast] 历史分红暂不可用:', code, error.message)
        return null
      }),
  ])
  const records = payoutResponse.data?.find(item => item.code === code)?.data
  const payouts = Array.isArray(records) ? records.filter(item => item && typeof item.year === 'number'
    && typeof item.payoutRatio === 'number'
    && (item.calculationBasis == null || ['official', 'estimated'].includes(item.calculationBasis))
    && (item.pendingImplementation == null || typeof item.pendingImplementation === 'boolean'))
    .sort((a, b) => b.year - a.year) : []
  if (!Array.isArray(response.reports)) throw new Error('财报数据格式异常')
  return { response, payouts, history: historyResponse ? dividendHistory(code, historyResponse.result?.data || []) : null }
}

// Cache source data, not personal scenarios; concurrent requests for a code share one fetch.
function createDataLoader(loader = loadData, ttl = 5 * 60 * 1000) {
  const cache = new Map()
  return async code => {
    const existing = cache.get(code)
    if (existing && existing.expiresAt > Date.now()) return existing.promise
    const entry = { expiresAt: Date.now() + ttl, promise: null }
    entry.promise = loader(code).catch(error => {
      if (cache.get(code) === entry) cache.delete(code)
      throw error
    })
    cache.delete(code)
    cache.set(code, entry)
    if (cache.size > 300) cache.delete(cache.keys().next().value)
    return entry.promise
  }
}

module.exports = { dividendHistory, loadData, createDataLoader }
