const EASTMONEY_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get'
const MAX_CODES = 60

function shanghaiToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const value = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function parsePerShare(record) {
  const plan = String(record.IMPL_PLAN_PROFILE || '')
  const matched = plan.match(/10\s*派\s*(\d+(?:\.\d+)?)/)
  if (matched) return Number(matched[1]) / 10

  const preTax = Number(record.PRETAX_BONUS_RMB)
  return Number.isFinite(preTax) && preTax > 0 ? preTax / 10 : 0
}

function exDate(record) {
  if (record.EX_DIVIDEND_DATE) return String(record.EX_DIVIDEND_DATE).slice(0, 10)
  if (!record.EQUITY_RECORD_DATE) return null
  const date = new Date(`${String(record.EQUITY_RECORD_DATE).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return null
  date.setDate(date.getDate() + 1)
  return date.toISOString().slice(0, 10)
}

async function fetchForCode(code) {
  const params = new URLSearchParams({
    reportName: 'RPT_SHAREBONUS_DET',
    columns: 'ALL',
    filter: `(SECURITY_CODE="${code}")`,
    pageNumber: '1',
    pageSize: '20',
    sortColumns: 'REPORT_DATE',
    sortTypes: '-1',
  })
  const response = await fetch(`${EASTMONEY_URL}?${params}`)
  if (!response.ok) throw new Error(`Eastmoney request failed: ${response.status}`)
  const payload = await response.json()
  return payload?.result?.data || []
}

export default async function handler(req, res) {
  const query = req.query || Object.fromEntries(new URL(req.url || '', 'http://localhost').searchParams)
  const codes = String(query.codes || '')
    .split(',')
    .map(code => code.trim())
    .filter(code => /^\d{6}$/.test(code))
    .slice(0, MAX_CODES)
  if (!codes.length) return sendJson(res, 400, { error: 'codes must contain A-share codes' })

  const days = Math.min(Math.max(Number(query.days) || 30, 1), 90)
  const start = shanghaiToday()
  const end = addDays(start, days)

  try {
    const results = await Promise.allSettled(codes.map(async code => ({ code, records: await fetchForCode(code) })))
    const items = results.flatMap(result => {
      if (result.status !== 'fulfilled') return []
      return result.value.records.flatMap(record => {
        const date = exDate(record)
        const perShare = parsePerShare(record)
        const progress = String(record.ASSIGN_PROGRESS || '')
        if (!date || date < start || date > end || perShare <= 0 || !progress) return []
        return [{ code: result.value.code, exDate: date, perShare: Number(perShare.toFixed(4)), progress }]
      })
    }).sort((a, b) => a.exDate.localeCompare(b.exDate))

    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400')
    return sendJson(res, 200, { items })
  } catch (error) {
    console.error('upcoming dividend request failed', error)
    return sendJson(res, 502, { error: 'upstream dividend data unavailable' })
  }
}

function sendJson(res, status, data) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}
