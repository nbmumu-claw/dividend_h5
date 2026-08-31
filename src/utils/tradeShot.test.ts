import { describe, expect, it } from 'vitest'
import { findMatchedStock } from './tradeShot'

describe('findMatchedStock', () => {
  const stocks = [
    { code: '00941', name: '中国移动H' },
    { code: '600941', name: '中国移动' },
  ]

  it('prefers an exact name over an earlier fuzzy match', () => {
    expect(findMatchedStock('中国移动', stocks)).toEqual(stocks[1])
  })

  it('keeps fuzzy matching as a fallback', () => {
    expect(findMatchedStock('中国移动H', [{ code: '600941', name: '中国移动' }])).toEqual({ code: '600941', name: '中国移动' })
  })
})
