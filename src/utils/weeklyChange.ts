const CLOUDBASE_DATA_GATEWAY_URL = 'https://vercel-dividend-d8faqegf03442b6c.service.tcloudbase.com/stockPrice'

export interface WeeklyChangeInput {
  code: string
  isHK?: boolean
}

export interface WeeklyChange {
  pctChg: number
  periodDate: string
  isPartial: boolean
}

export const toWeeklyChangeSymbol = ({ code, isHK }: WeeklyChangeInput): string => {
  const digits = String(code).replace(/\D/g, '')
  if (isHK) return `hk${digits.padStart(5, '0')}`
  const padded = digits.padStart(6, '0')
  const prefix = padded.startsWith('6') || padded.startsWith('9') || padded.startsWith('5')
    ? 'sh'
    : padded.startsWith('8') || padded.startsWith('4') ? 'bj' : 'sz'
  return `${prefix}${padded}`
}

const isWeeklyChange = (value: unknown): value is WeeklyChange => {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  return typeof data.pctChg === 'number'
    && typeof data.periodDate === 'string'
    && typeof data.isPartial === 'boolean'
}

export async function fetchWeeklyChanges(inputs: WeeklyChangeInput[]): Promise<Record<string, WeeklyChange>> {
  const symbolToCode = new Map(inputs.map(input => [toWeeklyChangeSymbol(input), input.code]))
  if (!symbolToCode.size) return {}
  try {
    const params = new URLSearchParams({ action: 'weeklyChange', symbols: [...symbolToCode.keys()].join(',') })
    const response = await fetch(`${CLOUDBASE_DATA_GATEWAY_URL}?${params}`)
    if (!response.ok) return {}
    const payload = await response.json() as { data?: Record<string, unknown> }
    return Object.fromEntries(Object.entries(payload.data || {}).flatMap(([symbol, value]) => {
      const code = symbolToCode.get(symbol)
      return code && isWeeklyChange(value) ? [[code, value]] : []
    }))
  } catch {
    return {}
  }
}
