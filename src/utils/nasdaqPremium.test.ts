import { describe, expect, it } from 'vitest'
import { nasdaqYtdGap, compareNasdaqFunds, formatQuoteTime, parseNasdaqQuotes, type NasdaqSortKey } from './nasdaqPremium'

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

describe('performance sorting', () => {
  const funds = ['a', 'b', 'c', 'd'].map(code => ({ code, manage: 0, custody: 0 }))
  it.each(['week', 'month', 'quarter', 'year', 'ytd'] as const)('sorts %s and keeps missing data last in both directions', key => {
    const performance = {
      a: { date: '2026-11-13', returns: { week: -2, month: -2, quarter: -2, year: -2, ytd: -2 } },
      b: { date: '2026-11-13', returns: { week: 0, month: 0, quarter: 0, year: 0, ytd: 0 } },
      c: { date: '2026-11-13', returns: { week: null, month: null, quarter: null, year: null, ytd: null } },
    }
    for (const direction of ['asc', 'desc'] as const) {
      const sorted = [...funds].sort((a, b) => compareNasdaqFunds(a, b, {}, { key, direction }, performance))
      expect(sorted.map(fund => fund.code)).toEqual(direction === 'asc' ? ['a', 'b', 'c', 'd'] : ['b', 'a', 'c', 'd'])
    }
  })
})

describe('YTD gap to Nasdaq', () => {
  const index = { price: 100, change: 0, changePercent: 0, quoteTime: Date.parse('2026-11-13T21:00:00Z') / 1000, ytd: { percent: 10.67, baseDate: '2025-12-31', baseClose: 90 } }
  const make = (ytd: number | null, date = '2026-11-16') => ({ date, returns: { week: null, month: null, quarter: null, year: null, ytd } })
  it('subtracts percentage returns as percentage points without rounding inputs', () => {
    expect(nasdaqYtdGap(make(16.89), index)).toBeCloseTo(6.22)
    expect(nasdaqYtdGap(make(8), index)).toBeCloseTo(-2.67)
    expect(nasdaqYtdGap(make(10.67), index)).toBe(0)
    expect(nasdaqYtdGap(make(0), { ...index, ytd: { ...index.ytd, percent: 0 } })).toBe(0)
  })
  it('returns missing for unavailable inputs or mismatched years', () => {
    expect(nasdaqYtdGap(make(null), index)).toBeNull()
    expect(nasdaqYtdGap(make(10), null)).toBeNull()
    expect(nasdaqYtdGap(make(10, '2025-12-31'), index)).toBeNull()
    expect(nasdaqYtdGap(make(NaN), index)).toBeNull()
  })
  it('sorts gaps in both directions and keeps unavailable values last', () => {
    const funds = ['a', 'b', 'c'].map(code => ({ code, manage: 0, custody: 0 }))
    const performance = { a: make(16.89), b: make(8), c: make(null) }
    for (const direction of ['asc', 'desc'] as const) {
      expect([...funds].sort((a, b) => compareNasdaqFunds(a, b, {}, { key: 'ytdGap', direction }, performance, index)).map(fund => fund.code)).toEqual(direction === 'asc' ? ['b', 'a', 'c'] : ['a', 'b', 'c'])
    }
  })
})
