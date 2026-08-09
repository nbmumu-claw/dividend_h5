const CLOUDBASE_DATA_GATEWAY_URL = 'https://vercel-dividend-d8faqegf03442b6c.service.tcloudbase.com/stockPrice'

export interface DividendPayoutRecord {
  year: number
  payoutRatio: number
  calculationBasis?: 'official' | 'estimated'
}

interface DividendPayoutResponse {
  data?: Array<{ code?: string; data?: unknown }>
}

function isPayoutRecord(value: unknown): value is DividendPayoutRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.year === 'number'
    && typeof record.payoutRatio === 'number'
    && (record.calculationBasis == null || record.calculationBasis === 'official' || record.calculationBasis === 'estimated')
}

export async function fetchDividendPayouts(code: string): Promise<DividendPayoutRecord[]> {
  const params = new URLSearchParams({ action: 'dividendPayout', codes: code, years: '2023,2024,2025', version: '3' })
  const response = await fetch(`${CLOUDBASE_DATA_GATEWAY_URL}?${params}`)
  if (!response.ok) throw new Error(`dividend payout request failed: ${response.status}`)
  const payload = await response.json() as DividendPayoutResponse
  const records = payload.data?.find(item => item.code === code)?.data
  return Array.isArray(records)
    ? records.filter(isPayoutRecord).sort((a, b) => b.year - a.year)
    : []
}

export function summarizeDividendPayout(records: DividendPayoutRecord[]): { average: number; conclusion: string } | null {
  if (!records.length) return null
  const average = records.reduce((sum, record) => sum + record.payoutRatio, 0) / records.length
  if (records.length < 2) return { average, conclusion: '仅有一年可用数据' }

  const newest = records[0].payoutRatio
  const oldest = records[records.length - 1].payoutRatio
  const change = newest - oldest
  const spread = Math.max(...records.map(record => record.payoutRatio)) - Math.min(...records.map(record => record.payoutRatio))
  if (spread <= 5) {
    if (change <= -1) return { average, conclusion: '整体稳定，略有回落' }
    if (change >= 1) return { average, conclusion: '整体稳定，略有上行' }
    return { average, conclusion: '整体稳定' }
  }
  return { average, conclusion: change > 0 ? '整体呈上行趋势' : '整体呈回落趋势' }
}
