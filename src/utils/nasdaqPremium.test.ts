import { describe, expect, it } from 'vitest'
import { formatQuoteTime, parseNasdaqQuotes } from './nasdaqPremium'

function quote(code: string, overrides: Record<number, string> = {}) {
  const fields = Array(82).fill('')
  fields[3] = '2.465'
  fields[30] = '20261113114500'
  fields[32] = '0.49'
  fields[57] = '19600'
  fields[72] = '2225000000'
  fields[78] = '2.1727'
  for (const [index, value] of Object.entries(overrides)) fields[Number(index)] = value
  return `v_sh${code}="${fields.join('~')}";`
}

describe('Nasdaq ETF quote parsing', () => {
  it('calculates premium, estimated size and turnover from live quote fields', () => {
    const result = parseNasdaqQuotes(quote('513110'))['513110']
    expect(result.price).toBe(2.465)
    expect(result.change).toBe(0.49)
    expect(result.iopv).toBe(2.1727)
    expect(result.premium).toBeCloseTo((2.465 / 2.1727 - 1) * 100)
    expect(result.size).toBeCloseTo(2225000000 * 2.1727 / 1e8)
    expect(result.turnover).toBe(1.96)
    expect(formatQuoteTime(result.tradeTime)).toBe('2026-11-13 11:45')
  })

  it('ignores quotes with missing IOPV instead of showing a false premium', () => {
    expect(parseNasdaqQuotes(quote('513110', { 78: '' }))).toEqual({})
  })
})
