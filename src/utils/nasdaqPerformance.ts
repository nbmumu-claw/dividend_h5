export const performancePeriods = [
  { key: 'week', label: '近1周' },
  { key: 'month', label: '近1月' },
  { key: 'quarter', label: '近3月' },
  { key: 'year', label: '近1年' },
  { key: 'ytd', label: '今年以来' },
] as const
export type PerformanceKey = typeof performancePeriods[number]['key']
export type NasdaqPerformance = { date: string; returns: Record<PerformanceKey, number | null> }

function historyCutoff(): string {
  const china = new Date(Date.now() + 8 * 60 * 60_000)
  // 收盘后可纳入当日 K 线；盘中仅使用前一交易日。
  if (china.getUTCHours() >= 15) china.setUTCDate(china.getUTCDate() + 1)
  return china.toISOString().slice(0, 10)
}

export function calculatePerformance(rows: unknown, today = historyCutoff()): NasdaqPerformance | null {
  if (!Array.isArray(rows)) return null
  // 排除当天尚未收盘的 K 线，统一使用已完成交易日。
  const prices = rows.filter((row): row is string[] => Array.isArray(row)
    && typeof row[0] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row[0])
    && row[0] < today && Number.isFinite(Number(row[2])) && Number(row[2]) > 0)
    .sort((a, b) => a[0].localeCompare(b[0]))
  const last = prices[prices.length - 1]
  if (!last) return null
  const returns = {} as NasdaqPerformance['returns']
  for (const { key } of performancePeriods) {
    const target = new Date(`${last[0]}T00:00:00Z`)
    if (key === 'week') target.setUTCDate(target.getUTCDate() - 7)
    else if (key === 'ytd') target.setUTCFullYear(target.getUTCFullYear() - 1, 11, 31)
    else {
      const day = target.getUTCDate()
      target.setUTCDate(1)
      target.setUTCMonth(target.getUTCMonth() - (key === 'month' ? 1 : key === 'quarter' ? 3 : 12))
      const end = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
      target.setUTCDate(Math.min(day, end))
    }
    const date = target.toISOString().slice(0, 10)
    const base = prices.filter(row => row[0] <= date).pop()
    returns[key] = base ? (Number(last[2]) / Number(base[2]) - 1) * 100 : null
  }
  return { date: last[0], returns }
}

export async function fetchNasdaqPerformance(code: string): Promise<NasdaqPerformance> {
  const response = await fetch(`https://vercel-dividend-d8faqegf03442b6c.service.tcloudbase.com/stockPrice?action=nasdaqHistory&code=${code}`, { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error('历史行情获取失败')
  const data = calculatePerformance((await response.json()).rows)
  if (!data) throw new Error('历史行情不足')
  return data
}
