import { describe, expect, it } from 'vitest'
import { compareNasdaqFunds, formatQuoteTime, parseNasdaqQuotes, type NasdaqSortKey } from './nasdaqPremium'

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

describe('Nasdaq ETF column sorting', () => {
  const funds = [
    { code: '513110', manage: 0.8, custody: 0.2 },
    { code: '513111', manage: 0.5, custody: 0.1 },
    { code: '513112', manage: 0.6, custody: 0.2 },
  ]
  const quotes = parseNasdaqQuotes(
    quote('513110') + quote('513111', { 3: '2.000', 32: '-0.72', 57: '20000', 72: '1000000000', 78: '1.7000' }),
  )

  it.each<[NasdaqSortKey, string]>([
    ['change', '513111'], ['premium', '513110'], ['iopv', '513111'],
    ['size', '513111'], ['turnover', '513110'], ['fee', '513111'],
  ])('sorts %s numerically in both directions', (key, firstAscending) => {
    const ascending = [...funds].sort((a, b) => compareNasdaqFunds(a, b, quotes, { key, direction: 'asc' }))
    const descending = [...funds].sort((a, b) => compareNasdaqFunds(a, b, quotes, { key, direction: 'desc' }))
    expect(ascending[0].code).toBe(firstAscending)
    expect(descending[0].code).toBe(firstAscending === '513110' ? '513111' : '513110')
    if (key !== 'fee') {
      expect(ascending[2].code).toBe('513112')
      expect(descending[2].code).toBe('513112')
    }
  })
})
