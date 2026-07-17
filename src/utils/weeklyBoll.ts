export interface WeeklyBoll {
  middle: number
  upper: number
  lower: number
  weekDate: string
}

export interface WeeklyBollInput {
  code: string
  isHK?: boolean
}

const CLOUDBASE_DATA_GATEWAY_URL = 'https://vercel-dividend-d8faqegf03442b6c.service.tcloudbase.com/stockPrice'
const LOCAL_CACHE_KEY = 'weekly-boll-cache-v1'
const LOCAL_CACHE_TTL = 10 * 60 * 1000

interface LocalCacheEntry {
  data: WeeklyBoll
  cachedAt: number
}

const SHANGHAI_OFFSET = 8 * 60 * 60 * 1000

function marketState(isHK: boolean, now: number): { trading: boolean; latestBoundary: number } {
  const local = new Date(now + SHANGHAI_OFFSET)
  const year = local.getUTCFullYear()
  const month = local.getUTCMonth()
  const date = local.getUTCDate()
  const day = local.getUTCDay()
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes()
  const morningCloseMinutes = isHK ? 12 * 60 : 11 * 60 + 30
  const closeMinutes = isHK ? 16 * 60 : 15 * 60
  const toTimestamp = (dayOffset: number, boundaryMinutes: number) => (
    Date.UTC(year, month, date + dayOffset, Math.floor(boundaryMinutes / 60) - 8, boundaryMinutes % 60)
  )
  const previousWeekdayClose = () => {
    let offset = -1
    while ([0, 6].includes(new Date(Date.UTC(year, month, date + offset)).getUTCDay())) offset -= 1
    return toTimestamp(offset, closeMinutes)
  }

  if (day === 0 || day === 6) return { trading: false, latestBoundary: previousWeekdayClose() }
  if (minutes < 9 * 60 + 30) return { trading: false, latestBoundary: previousWeekdayClose() }
  if (minutes < morningCloseMinutes) return { trading: true, latestBoundary: 0 }
  if (minutes < 13 * 60) return { trading: false, latestBoundary: toTimestamp(0, morningCloseMinutes) }
  if (minutes < closeMinutes) return { trading: true, latestBoundary: 0 }
  return { trading: false, latestBoundary: toTimestamp(0, closeMinutes) }
}

export function isWeeklyBollCacheFresh(cachedAt: number, isHK: boolean, ttl: number, now = Date.now()): boolean {
  if (now - cachedAt < ttl) return true
  const state = marketState(isHK, now)
  return !state.trading && cachedAt >= state.latestBoundary
}

const toWeeklySymbol = ({ code, isHK }: WeeklyBollInput): string => {
  const digits = String(code).replace(/\D/g, '')
  if (isHK) return `hk${digits.padStart(5, '0')}`
  const padded = digits.padStart(6, '0')
  return `${padded.startsWith('6') || padded.startsWith('9') || padded.startsWith('5') ? 'sh' : padded.startsWith('8') || padded.startsWith('4') ? 'bj' : 'sz'}${padded}`
}

/** BOLL(20, 2)：简单移动平均 + 样本标准差（N-1），与同花顺周 BOLL 口径一致。 */
export function calculateWeeklyBoll(closes: number[], weekDate = ''): WeeklyBoll | null {
  if (closes.length < 20) return null
  const values = closes.slice(-20)
  if (values.some(v => !Number.isFinite(v) || v <= 0)) return null
  const middle = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - middle) ** 2, 0) / (values.length - 1)
  const width = 2 * Math.sqrt(variance)
  return { middle, upper: middle + width, lower: middle - width, weekDate }
}

function readLocalCache(inputs: WeeklyBollInput[]): Record<string, WeeklyBoll> {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY)
    const cache = raw ? JSON.parse(raw) as Record<string, LocalCacheEntry> : {}
    const now = Date.now()
    return Object.fromEntries(inputs.flatMap(({ code, isHK = false }) => {
      const entry = cache[code]
      return entry?.data && isWeeklyBollCacheFresh(entry.cachedAt, isHK, LOCAL_CACHE_TTL, now) ? [[code, entry.data]] : []
    }))
  } catch {
    return {}
  }
}

function writeLocalCache(values: Record<string, WeeklyBoll>): void {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY)
    const cache = raw ? JSON.parse(raw) as Record<string, LocalCacheEntry> : {}
    const cachedAt = Date.now()
    for (const [code, data] of Object.entries(values)) cache[code] = { data, cachedAt }
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // localStorage 不可用时直接退化为云端查询。
  }
}

export async function fetchWeeklyBoll(inputs: WeeklyBollInput[]): Promise<Record<string, WeeklyBoll>> {
  const symbolToCode = new Map(inputs.map(input => [toWeeklySymbol(input), input.code]))
  if (!symbolToCode.size) return {}
  const localHits = readLocalCache(inputs)
  const missingSymbols = [...symbolToCode].filter(([, code]) => !localHits[code]).map(([symbol]) => symbol)
  if (!missingSymbols.length) return localHits

  const params = new URLSearchParams({ action: 'weeklyBoll', symbols: missingSymbols.join(',') })
  const response = await fetch(`${CLOUDBASE_DATA_GATEWAY_URL}?${params}`)
  if (!response.ok) throw new Error(`Weekly BOLL request failed: ${response.status}`)
  const payload = await response.json() as { data?: Record<string, WeeklyBoll> }
  const remoteValues: Record<string, WeeklyBoll> = {}
  for (const [symbol, boll] of Object.entries(payload.data || {})) {
    const code = symbolToCode.get(symbol)
    if (code && boll) remoteValues[code] = boll
  }
  writeLocalCache(remoteValues)
  return { ...localHits, ...remoteValues }
}
