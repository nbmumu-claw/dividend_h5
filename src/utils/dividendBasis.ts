export type DividendBasis = '2025' | '2026'

export function resolveGridDividend(
  basis: DividendBasis,
  dividend2025: number,
  dividend2026: number | null | undefined,
) {
  if (basis === '2026' && typeof dividend2026 === 'number' && Number.isFinite(dividend2026) && dividend2026 > 0) {
    return { dividend: dividend2026, fallbackTo2025: false }
  }
  return {
    dividend: dividend2025,
    fallbackTo2025: basis === '2026',
  }
}
