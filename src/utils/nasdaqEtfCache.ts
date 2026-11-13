import { parseNasdaqQuotes } from './nasdaqPremium'

const KEY = 'nasdaq-etf-snapshot-v1'
const QUOTE_COUNT = 12
const BEIJING_OFFSET = 8 * 60 * 60_000

export function isChinaTradingSession(now = Date.now()): boolean {
  const china = new Date(now + BEIJING_OFFSET)
  const day = china.getUTCDay()
  const minutes = china.getUTCHours() * 60 + china.getUTCMinutes()
  return day >= 1 && day <= 5 && ((minutes >= 555 && minutes < 690) || (minutes >= 780 && minutes < 900))
}

function nextTradingOpen(now: number): number {
  const china = new Date(now + BEIJING_OFFSET)
  const open = Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate(), 9, 15) - BEIJING_OFFSET
  for (let days = open > now ? 0 : 1; days <= 7; days++) {
    const candidate = open + days * 24 * 60 * 60_000
    const day = new Date(candidate + BEIJING_OFFSET).getUTCDay()
    if (day >= 1 && day <= 5) return candidate
  }
  return open + 7 * 24 * 60 * 60_000
}

export function readNasdaqEtfCache(now = Date.now()): string | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const { body, expiresAt } = JSON.parse(raw)
    if (typeof body !== 'string' || !Number.isFinite(expiresAt) || now >= expiresAt
      || Object.keys(parseNasdaqQuotes(body)).length !== QUOTE_COUNT) return null
    return body
  } catch { return null }
}

export function writeNasdaqEtfCache(body: string, now = Date.now()): void {
  if (Object.keys(parseNasdaqQuotes(body)).length !== QUOTE_COUNT) return
  try { localStorage.setItem(KEY, JSON.stringify({ body, expiresAt: nextTradingOpen(now) })) } catch { /* storage unavailable */ }
}
