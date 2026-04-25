import { cacheGet, cacheSet } from './cache'

const TTL = 30 * 24 * 60 * 60 * 1000 // 30 days

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

export async function fetchDividendHistory(code: string): Promise<DividendHistory | null> {
  const key = `dividendHistory:${code}`
  const cached = cacheGet<DividendHistory>(key)
  if (cached) return cached

  try {
    // 东财分红历史接口，A股代码6位纯数字
    const filter = `(SECURITY_CODE="${code.padStart(6, '0')}")`
    const params = new URLSearchParams({
      reportName: 'RPT_SHAREBONUS_DET',
      columns: 'REPORT_DATE,ASSIGN_PROGRESS,IMPL_PLAN_PROFILE,PAY_CASH_AFTERTAX',
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
      PAY_CASH_AFTERTAX?: number
    }> = json?.result?.data || []

    // 按报告期（自然年）聚合，同年可能有中期+末期两次派息
    const byYear: Record<number, number> = {}
    for (const r of rows) {
      const progress = r.ASSIGN_PROGRESS || ''
      // 只统计已实施
      if (!['实施', '完成', '已实施'].some(s => progress.includes(s))) continue
      const year = r.REPORT_DATE ? parseInt(r.REPORT_DATE.slice(0, 4)) : 0
      if (!year) continue

      let dps = 0
      // 优先从文案解析
      if (r.IMPL_PLAN_PROFILE) dps = parseDpsFromPlan(r.IMPL_PLAN_PROFILE)
      // 回退到数值字段（单位：每10股派X元）
      if (!dps && r.PAY_CASH_AFTERTAX) dps = Number(r.PAY_CASH_AFTERTAX) / 10
      if (dps <= 0) continue

      byYear[year] = (byYear[year] || 0) + parseFloat(dps.toFixed(4))
    }

    const records = Object.entries(byYear)
      .map(([y, v]) => ({ year: parseInt(y), perShare: parseFloat(v.toFixed(4)) }))
      .sort((a, b) => b.year - a.year)
      .slice(0, 10)

    // 连续年数：从最近有记录的年份往前，不断检查是否有上一年
    let consecutiveYears = 0
    for (let i = 0; i < records.length; i++) {
      if (i === 0 || records[i].year === records[i - 1].year - 1) {
        consecutiveYears++
      } else {
        break
      }
    }

    const history: DividendHistory = { records, consecutiveYears }
    if (records.length > 0) cacheSet(key, history, TTL)
    return history
  } catch {
    return null
  }
}
