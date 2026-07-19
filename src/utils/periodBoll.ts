export type BollPeriod = 'day' | 'week' | 'month'

export interface PeriodBoll {
  middle: number
  upper: number
  lower: number
  latestClose: number
  periodDate: string
  isPartial: boolean
  expiresAt: number
  stale?: boolean
}

export interface PeriodBollInput {
  code: string
  isHK?: boolean
}

const CLOUDBASE_DATA_GATEWAY_URL = 'https://vercel-dividend-d8faqegf03442b6c.service.tcloudbase.com/stockPrice'
const LOCAL_CACHE_KEY = 'period-boll-cache-v1'

interface LocalCacheEntry {
  data: PeriodBoll
}

const isPeriodBoll = (value: unknown): value is PeriodBoll => {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  return ['middle', 'upper', 'lower', 'latestClose', 'expiresAt'].every(key => typeof data[key] === 'number')
    && typeof data.periodDate === 'string'
    && typeof data.isPartial === 'boolean'
}

export const toPeriodBollSymbol = ({ code }: PeriodBollInput): string => {
  const digits = String(code).replace(/\D/g, '').padStart(6, '0')
  const prefix = digits.startsWith('6') || digits.startsWith('9') || digits.startsWith('5')
    ? 'sh'
    : digits.startsWith('8') || digits.startsWith('4') ? 'bj' : 'sz'
  return `${prefix}${digits}`
}

function readCache(period: BollPeriod, inputs: PeriodBollInput[]): Record<string, PeriodBoll> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY)
    const cache = raw ? JSON.parse(raw) as Record<string, LocalCacheEntry> : {}
    const now = Date.now()
    return Object.fromEntries(inputs.flatMap(({ code }) => {
      const entry = cache[`${period}_${code}`]
      return entry && isPeriodBoll(entry.data) && entry.data.expiresAt > now ? [[code, entry.data]] : []
    }))
  } catch {
    return {}
  }
}

function writeCache(period: BollPeriod, values: Record<string, PeriodBoll>): void {
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY)
    const cache = raw ? JSON.parse(raw) as Record<string, LocalCacheEntry> : {}
    for (const [code, data] of Object.entries(values)) cache[`${period}_${code}`] = { data }
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // localStorage 不可用时退化为云端查询。
  }
}

export async function fetchPeriodBoll(
  period: BollPeriod,
  inputs: PeriodBollInput[],
): Promise<Record<string, PeriodBoll>> {
  const aShareInputs = inputs.filter(input => !input.isHK)
  const symbolToCode = new Map(aShareInputs.map(input => [toPeriodBollSymbol(input), input.code]))
  if (!symbolToCode.size) return {}
  const localHits = readCache(period, aShareInputs)
  const missingSymbols = [...symbolToCode].filter(([, code]) => !localHits[code]).map(([symbol]) => symbol)
  if (!missingSymbols.length) return localHits

  const params = new URLSearchParams({ action: 'periodBoll', period, symbols: missingSymbols.join(',') })
  const request = await fetch(`${CLOUDBASE_DATA_GATEWAY_URL}?${params}`)
  if (!request.ok) throw new Error(`${period} BOLL request failed: ${request.status}`)
  const payload = await request.json() as { data?: Record<string, unknown> }
  const remoteValues: Record<string, PeriodBoll> = {}
  for (const [symbol, value] of Object.entries(payload.data || {})) {
    const code = symbolToCode.get(symbol)
    if (code && isPeriodBoll(value)) remoteValues[code] = value
  }
  writeCache(period, remoteValues)
  return { ...localHits, ...remoteValues }
}
