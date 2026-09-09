import { expect, it } from 'vitest'
import { resolveGridDividend } from './dividendBasis'

it('uses the selected dividend basis and falls back after a missing 2026 result', () => {
  expect(resolveGridDividend('2025', 4.7, 4.5)).toEqual({ dividend: 4.7, fallbackTo2025: false })
  expect(resolveGridDividend('2026', 4.7, 4.5)).toEqual({ dividend: 4.5, fallbackTo2025: false })
  expect(resolveGridDividend('2026', 4.7, null)).toEqual({ dividend: 4.7, fallbackTo2025: true })
  expect(resolveGridDividend('2026', 4.7, undefined)).toEqual({ dividend: 4.7, fallbackTo2025: true })
})
