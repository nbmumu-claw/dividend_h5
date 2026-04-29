import { cacheGet, cacheSet } from './cache'

const TTL_HISTORY = 30 * 24 * 60 * 60 * 1000 // 30 days for past years
const TTL_CURRENT  =      24 * 60 * 60 * 1000 // 1 day  for current year

// 接口未能收录的历史分红，按支付年份手动补录
const MANUAL_DIVIDEND_HISTORY: Record<string, Array<{ year: number; perShare: number }>> = {
  // 云南白药 中期分红，东财接口未返回
  // 2023年中期（登记日2024-11-25，每10派12.13）
  // 2024年中期（登记日2025-09-24，每10派10.19）
  '000538': [
    { year: 2024, perShare: 1.213 },
    { year: 2025, perShare: 1.019 },
  ],
}

export interface DividendYearRecord {
  year: number
  perShare: number // 每股派息（税前，元）
}

export interface DividendHistory {
  records: DividendYearRecord[] // 按年份倒序，最多10条
  consecutiveYears: number      // 从最近年份往前连续派息年数
}

// 从分红方案说明里解析每股派息，如 "10派40.00元" → 4.00
function parseDpsFromPlan(plan: string): number {
  const m = plan.match(/10\s*派\s*(\d+(?:\.\d+)?)/)
  return m ? parseFloat(m[1]) / 10 : 0
}

// 港股内部代码（如 "00700"）→ Yahoo ticker（如 "0700.HK"）
function toYahooTicker(code: string): string {
  return parseInt(code, 10).toString().padStart(4, '0') + '.HK'
}

async function fetchHKDividendHistory(code: string): Promise<DividendHistory | null> {
  const ticker = toYahooTicker(code)
  const res = await fetch(`/api/hk-dividend?ticker=${ticker}`)
  const json = await res.json()

  const divs: Record<string, { date: number; amount: number }> =
    json?.chart?.result?.[0]?.events?.dividends || {}

  const byYear: Record<number, number> = {}
  for (const v of Object.values(divs)) {
    const year = new Date(v.date * 1000).getFullYear()
    byYear[year] = parseFloat(((byYear[year] || 0) + v.amount).toFixed(4))
  }

  return buildHistory(byYear)
}

async function fetchAShareDividendHistory(code: string): Promise<DividendHistory | null> {
  const filter = `(SECURITY_CODE="${code.padStart(6, '0')}")`
  const params = new URLSearchParams({
    reportName: 'RPT_SHAREBONUS_DET',
    columns: 'ALL',
    filter,
    pageNumber: '1',
    pageSize: '50',
    sortColumns: 'REPORT_DATE',
    sortTypes: '-1',
  })
  const res = await fetch(`/api/dividend-history?${params}`)
  const json = await res.json()

  const rows: Array<{
    REPORT_DATE?: string
    ASSIGN_PROGRESS?: string
    IMPL_PLAN_PROFILE?: string
    PRETAX_BONUS_RMB?: number
  }> = json?.result?.data || []

  const byYear: Record<number, number> = {}
  for (const r of rows) {
    const progress = r.ASSIGN_PROGRESS || ''
    if (!['实施分配', '董事会决议通过', '特别分配'].some(s => progress.includes(s))) continue
    const year = r.REPORT_DATE ? parseInt(r.REPORT_DATE.slice(0, 4)) : 0
    if (!year) continue

    let dps = 0
    if (r.IMPL_PLAN_PROFILE) dps = parseDpsFromPlan(r.IMPL_PLAN_PROFILE)
    if (!dps && r.PRETAX_BONUS_RMB) dps = Number(r.PRETAX_BONUS_RMB) / 10
    if (dps <= 0) continue

    byYear[year] = (byYear[year] || 0) + parseFloat(dps.toFixed(4))
  }

  return buildHistory(byYear)
}

function buildHistory(byYear: Record<number, number>): DividendHistory {
  const records = Object.entries(byYear)
    .map(([y, v]) => ({ year: parseInt(y), perShare: parseFloat(v.toFixed(4)) }))
    .sort((a, b) => b.year - a.year)
    .slice(0, 10)

  let consecutiveYears = 0
  for (let i = 0; i < records.length; i++) {
    if (i === 0 || records[i].year === records[i - 1].year - 1) {
      consecutiveYears++
    } else {
      break
    }
  }

  return { records, consecutiveYears }
}

export async function fetchDividendHistory(code: string, isHK = false): Promise<DividendHistory | null> {
  const key = `dividendHistory:${code}`
  const cached = cacheGet<DividendHistory>(key)
  if (cached) return cached

  try {
    const history = isHK
      ? await fetchHKDividendHistory(code)
      : await fetchAShareDividendHistory(code)

    // 补入手动记录（叠加到对应年份，不重新触发请求）
    const manuals = MANUAL_DIVIDEND_HISTORY[code]
    if (history && manuals) {
      for (const m of manuals) {
        const rec = history.records.find(r => r.year === m.year)
        if (rec) {
          rec.perShare = parseFloat((rec.perShare + m.perShare).toFixed(4))
        } else {
          history.records.push({ year: m.year, perShare: m.perShare })
          history.records.sort((a, b) => b.year - a.year)
        }
      }
    }

    if (history && history.records.length > 0) {
      const prevYear = new Date().getFullYear() - 1
      const ttl = history.records.some(r => r.year >= prevYear) ? TTL_CURRENT : TTL_HISTORY
      cacheSet(key, history, ttl)
    }
    return history
  } catch {
    return null
  }
}
