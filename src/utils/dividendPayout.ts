import { cacheGet, cacheSetPermanent } from './cache'

const CLOUDBASE_DATA_GATEWAY_URL = 'https://vercel-dividend-d8faqegf03442b6c.service.tcloudbase.com/stockPrice'
const payoutCacheKey = (code: string) => `dividendPayout:v2:${code}`

export interface DividendPayoutRecord {
  year: number
  payoutRatio: number
  calculationBasis?: 'official' | 'estimated'
  pendingImplementation?: boolean
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
    && (record.pendingImplementation == null || typeof record.pendingImplementation === 'boolean')
}

function getCachedPayouts(code: string): DividendPayoutRecord[] | null {
  const cached = cacheGet<DividendPayoutRecord[]>(payoutCacheKey(code))
  return Array.isArray(cached)
    ? cached.filter(isPayoutRecord).sort((a, b) => b.year - a.year)
    : null
}

function cachePayouts(code: string, records: DividendPayoutRecord[]) {
  if (records.length) cacheSetPermanent(payoutCacheKey(code), records)
}

export async function fetchDividendPayouts(code: string): Promise<DividendPayoutRecord[]> {
  const cached = getCachedPayouts(code)
  if (cached) return cached

  const params = new URLSearchParams({ action: 'dividendPayout', codes: code, years: '2023,2024,2025', version: '3' })
  const response = await fetch(`${CLOUDBASE_DATA_GATEWAY_URL}?${params}`)
  if (!response.ok) throw new Error(`dividend payout request failed: ${response.status}`)
  const payload = await response.json() as DividendPayoutResponse
  const records = payload.data?.find(item => item.code === code)?.data
  const payoutRecords = Array.isArray(records)
    ? records.filter(isPayoutRecord).sort((a, b) => b.year - a.year)
    : []
  cachePayouts(code, payoutRecords)
  return payoutRecords
}

// 云函数一次最多处理 20 个标的；网格页可复用每只股票近三年的支付率。
export async function fetchDividendPayoutsForCodes(codes: string[]): Promise<Record<string, DividendPayoutRecord[]>> {
  const uniqueCodes = [...new Set(codes.filter(code => /^\d{6}$/.test(code)))]
  const result: Record<string, DividendPayoutRecord[]> = {}
  const uncachedCodes = uniqueCodes.filter(code => {
    const cached = getCachedPayouts(code)
    if (!cached) return true
    result[code] = cached
    return false
  })
  const batches = Array.from({ length: Math.ceil(uncachedCodes.length / 20) }, (_, index) => uncachedCodes.slice(index * 20, index * 20 + 20))

  await Promise.all(batches.map(async codesInBatch => {
    const params = new URLSearchParams({ action: 'dividendPayout', codes: codesInBatch.join(','), years: '2023,2024,2025', version: '3' })
    const response = await fetch(`${CLOUDBASE_DATA_GATEWAY_URL}?${params}`)
    if (!response.ok) throw new Error(`dividend payout request failed: ${response.status}`)
    const payload = await response.json() as DividendPayoutResponse
    for (const code of codesInBatch) {
      const records = payload.data?.find(item => item.code === code)?.data
      const payoutRecords = Array.isArray(records)
        ? records.filter(isPayoutRecord).sort((a, b) => b.year - a.year)
        : []
      cachePayouts(code, payoutRecords)
      result[code] = payoutRecords
    }
  }))

  return result
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
