import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { searchStocks } from './api.ts'

const require = createRequire(import.meta.url)
const cloudStockPrice = require('../../cloudfunctions/stockPrice/handlers/stockPrice.js')
const originalFetch = globalThis.fetch

function gbkHongLi() {
  return Uint8Array.from([0xba, 0xec, 0xc0, 0xfb])
}

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('Tencent response encoding', () => {
  it('keeps UTF-8 names returned by the Tencent search proxy intact', async () => {
    const proxyBody = 'v_hint="红利低波50ETF南方_515450_sh515450";'
    globalThis.fetch = vi.fn(async input => {
      const url = String(input)
      if (url.includes('source=em') || url.startsWith('/api/stock-search-em')) {
        throw new Error('EastMoney unavailable')
      }
      if (url.includes('source=tx')) {
        return new Response(proxyBody, {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    await expect(searchStocks('515450', true)).resolves.toEqual([
      { name: '红利低波50ETF南方', code: '515450', isHK: false },
    ])
  })

  it('decodes Tencent GBK bytes in the CloudBase stock-price handler', async () => {
    const response = new Response(gbkHongLi())
    await expect(cloudStockPrice.decodeTencentResponse(response)).resolves.toBe('红利')
  })

})
