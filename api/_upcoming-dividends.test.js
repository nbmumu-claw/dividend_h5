import { afterEach, describe, expect, it, vi } from 'vitest'
import handler from './upcoming-dividends.js'

function mockResponse() {
  const headers = {}
  return {
    headers,
    statusCode: 0,
    body: '',
    setHeader(name, value) { headers[name] = value },
    end(value) { this.body = value },
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('upcoming dividend API', () => {
  it('uses stock-calendar data when the share-bonus dataset omits a special dividend', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-17T06:00:00Z'))
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async input => {
      const url = String(input)
      const data = url.includes('RPT_STOCKCALENDAR')
        ? [{
            SECURITY_CODE: '000538',
            EVENT_TYPE_CODE: '004',
            LEVEL1_CONTENT: '2026年09月17日公布2026年年报分红，股权登记日：2026年09月23日；除权除息日：2026年09月24日；分配方案：10派10.38元(含税,扣税后9.342元)[正式]',
          }]
        : []
      return { ok: true, json: async () => ({ result: { data } }) }
    }))

    const res = mockResponse()
    await handler({ query: { codes: '000538', days: '30' } }, res)

    expect(JSON.parse(res.body).items).toEqual([{
      code: '000538',
      exDate: '2026-09-24',
      perShare: 1.038,
      progress: '正式',
    }])
  })
})
