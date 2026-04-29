import { cacheGet, cacheSet } from './cache'

export interface DividendEvent {
  code: string
  name: string
  isHK?: boolean
  recordDate: string   // YYYY-MM-DD
  exDate?: string      // YYYY-MM-DD
  perShare: number     // 税前
  status: 'confirmed' | 'estimated'
}

// 接口未能返回的已知分红事件，手动补录
const MANUAL_DIVIDEND_EVENTS: DividendEvent[] = [
  // 云南白药 中期分红，东财接口未收录
  { code: '000538', name: '云南白药', recordDate: '2024-11-25', perShare: 1.213, status: 'confirmed' },
  { code: '000538', name: '云南白药', recordDate: '2025-09-24', perShare: 1.019, status: 'confirmed' },
]

function ttlUntil4AM(): number {
  const next4AM = new Date()
  next4AM.setHours(4, 0, 0, 0)
  if (next4AM <= new Date()) next4AM.setDate(next4AM.getDate() + 1)
  return next4AM.getTime() - Date.now()
}

function toNextWeekday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  if (day === 6) d.setDate(d.getDate() + 2)
  else if (day === 0) d.setDate(d.getDate() + 1)
  return d
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// 从分红方案说明里解析每股派息
function parseDpsFromPlan(plan: string): number {
  const m = plan.match(/10\s*派\s*(\d+(?:\.\d+)?)/)
  return m ? parseFloat(m[1]) / 10 : 0
}

async function fetchAShareCalendarEvents(code: string): Promise<DividendEvent[]> {
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
    EQUITY_RECORD_DATE?: string
    EX_DIVIDEND_DATE?: string
  }> = json?.result?.data || []

  // 提取所有已实施分配的历史记录（用于估算），含特别分配（中期股息）和股东大会决议通过
  const confirmed = rows.filter(r => {
    const p = r.ASSIGN_PROGRESS || ''
    return p.includes('实施分配') || p.includes('特别分配') || p.includes('股东大会决议通过')
  })

  const events: DividendEvent[] = []

  for (const r of rows) {
    const progress = r.ASSIGN_PROGRESS || ''
    const isConfirmed = progress.includes('实施分配') || progress.includes('特别分配') || progress.includes('股东大会决议通过')
    const isPending = progress.includes('董事会决议通过')
    if (!isConfirmed && !isPending) continue

    let dps = 0
    if (r.IMPL_PLAN_PROFILE) dps = parseDpsFromPlan(r.IMPL_PLAN_PROFILE)
    if (!dps && r.PRETAX_BONUS_RMB) dps = Number(r.PRETAX_BONUS_RMB) / 10
    if (dps <= 0) continue

    if (isConfirmed && r.EQUITY_RECORD_DATE) {
      events.push({
        code,
        name: '',
        recordDate: r.EQUITY_RECORD_DATE.slice(0, 10),
        exDate: r.EX_DIVIDEND_DATE ? r.EX_DIVIDEND_DATE.slice(0, 10) : undefined,
        perShare: dps,
        status: 'confirmed',
      })
    } else if (isPending) {
      // 估算：取同一报告期（年报Q4/中报Q2）最近3年实际登记日，平均月日
      const reportYear = r.REPORT_DATE ? parseInt(r.REPORT_DATE.slice(0, 4)) : new Date().getFullYear()
      const reportMonth = r.REPORT_DATE ? parseInt(r.REPORT_DATE.slice(5, 7)) : 12
      const isAnnual = reportMonth >= 10 // Q4=年报, Q2=中报

      let sameTermDates = confirmed
        .filter(c => {
          if (!c.EQUITY_RECORD_DATE || !c.REPORT_DATE) return false
          const cm = parseInt(c.REPORT_DATE.slice(5, 7))
          return isAnnual ? cm >= 10 : (cm >= 4 && cm <= 7)
        })
        .slice(0, 3)
        .map(c => c.EQUITY_RECORD_DATE!.slice(5, 10)) // MM-DD

      // 无同期历史时，退一步用全部历史记录日期做参考
      if (sameTermDates.length === 0) {
        sameTermDates = confirmed
          .filter(c => c.EQUITY_RECORD_DATE)
          .slice(0, 3)
          .map(c => c.EQUITY_RECORD_DATE!.slice(5, 10))
      }

      if (sameTermDates.length === 0) continue

      // 平均月日
      const totalDays = sameTermDates.reduce((sum, md) => {
        const [m, d] = md.split('-').map(Number)
        return sum + (m - 1) * 31 + d
      }, 0)
      const avgTotal = Math.round(totalDays / sameTermDates.length)
      const avgMonth = Math.floor(avgTotal / 31) + 1
      const avgDay = avgTotal % 31 || 1

      // Annual dividends paid the following fiscal year (FY2025 annual → paid 2026)
      const estimated = new Date(reportYear + 1, avgMonth - 1, avgDay)
      if (estimated < new Date()) estimated.setFullYear(estimated.getFullYear() + 1)
      const adjusted = toNextWeekday(estimated)

      events.push({
        code,
        name: '',
        recordDate: toDateStr(adjusted),
        perShare: dps,
        status: 'estimated',
      })
    }
  }

  return events
}

function toYahooTicker(code: string): string {
  return parseInt(code, 10).toString().padStart(4, '0') + '.HK'
}

async function fetchHKCalendarEvents(code: string): Promise<DividendEvent[]> {
  const ticker = toYahooTicker(code)
  const res = await fetch(`/api/hk-dividend?ticker=${ticker}`)
  const json = await res.json()

  const divs: Record<string, { date: number; amount: number }> =
    json?.chart?.result?.[0]?.events?.dividends || {}

  const today = new Date()
  const todayTs = today.getTime()
  const events: DividendEvent[] = []

  // 历史（含今年已公布）按年+月日分组，用于估算
  const historicalByYearMD: Array<{ year: number; md: string; amount: number }> = []

  for (const v of Object.values(divs)) {
    const d = new Date(v.date * 1000)
    const dateStr = toDateStr(d)
    if (v.date * 1000 <= todayTs) {
      events.push({
        code,
        name: '',
        recordDate: dateStr,
        perShare: parseFloat(v.amount.toFixed(4)),
        status: 'confirmed',
      })
      historicalByYearMD.push({
        year: d.getFullYear(),
        md: dateStr.slice(5, 10),
        amount: v.amount,
      })
    }
  }

  // 估算未来1年：取最近2年同期月份，取平均
  if (historicalByYearMD.length >= 2) {
    // 找出最近2年的记录
    const years = [...new Set(historicalByYearMD.map(r => r.year))].sort((a, b) => b - a).slice(0, 2)
    const recentTwo = historicalByYearMD.filter(r => years.includes(r.year))

    // 按月份分组，取均值，预测当年或明年
    const byMonth: Record<number, Array<{ md: string; amount: number }>> = {}
    for (const r of recentTwo) {
      const m = parseInt(r.md.slice(0, 2))
      if (!byMonth[m]) byMonth[m] = []
      byMonth[m].push({ md: r.md, amount: r.amount })
    }

    const currentYear = today.getFullYear()
    for (const [mStr, items] of Object.entries(byMonth)) {
      const month = parseInt(mStr)
      // 平均日期
      const avgDay = Math.round(items.reduce((s, i) => s + parseInt(i.md.slice(3, 5)), 0) / items.length)
      const avgAmount = parseFloat((items.reduce((s, i) => s + i.amount, 0) / items.length).toFixed(4))

      // 看今年这个月是否已有 confirmed，无则估算
      const alreadyHas = events.some(e => {
        const em = new Date(e.recordDate)
        return em.getFullYear() === currentYear && em.getMonth() + 1 === month
      })
      if (alreadyHas) continue

      const targetYear = new Date(currentYear, month - 1, avgDay) > today ? currentYear : currentYear + 1
      const estimated = toNextWeekday(new Date(targetYear, month - 1, avgDay))

      events.push({
        code,
        name: '',
        recordDate: toDateStr(estimated),
        perShare: avgAmount,
        status: 'estimated',
      })
    }
  }

  return events
}

export async function fetchCalendarEvents(
  code: string,
  name: string,
  isHK = false,
): Promise<DividendEvent[]> {
  const key = `calEvent2:${code}`
  const cached = cacheGet<DividendEvent[]>(key)
  if (cached) return cached.map(e => ({ ...e, name }))

  try {
    const events = isHK
      ? await fetchHKCalendarEvents(code)
      : await fetchAShareCalendarEvents(code)

    // 补入手动记录的事件（仅当该日期尚未存在时）
    const manual = MANUAL_DIVIDEND_EVENTS.filter(m => m.code === code)
    for (const m of manual) {
      const exists = events.some(e => e.recordDate === m.recordDate)
      if (!exists) events.push({ ...m, isHK })
    }

    const withName = events.map(e => ({ ...e, name, isHK }))
    if (withName.length > 0) cacheSet(key, withName, ttlUntil4AM())
    return withName
  } catch {
    return []
  }
}
