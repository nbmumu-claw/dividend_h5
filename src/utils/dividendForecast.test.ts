import { afterEach, expect, it, vi } from 'vitest'
import { fetchDividendForecast, fetchDividendForecasts } from './dividendForecast'

afterEach(() => vi.unstubAllGlobals())

it('sends the fiscal year and personal choices to the prediction service', async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ annualDps: 1.5 })))
  vi.stubGlobal('fetch', request)
  const result = await fetchDividendForecast('600941', { profitRatio: 0.5, payoutMethod: 'latest', forecastMethod: 'interim' })
  const url = new URL(request.mock.calls[0][0], 'https://www.manmanbianfu.top')
  expect(Object.fromEntries(url.searchParams)).toEqual({ code: '600941', year: '2026', profitRatio: '0.5', payoutMethod: 'latest', forecastMethod: 'interim' })
  expect(result.annualDps).toBe(1.5)
})

it('does not send personal choices for the default forecast', async () => {
  const request = vi.fn().mockResolvedValue(new Response('{}'))
  vi.stubGlobal('fetch', request)
  await fetchDividendForecast('600941')
  expect(Object.fromEntries(new URL(request.mock.calls[0][0], 'https://www.manmanbianfu.top').searchParams)).toEqual({ code: '600941', year: '2026' })
})

it('shows service errors and handles non-JSON gateway failures', async () => {
  const request = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: '尚未取得 2026 年中报归母净利润。' }), { status: 502 }))
    .mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }))
  vi.stubGlobal('fetch', request)
  await expect(fetchDividendForecast('600941')).rejects.toThrow('尚未取得 2026 年中报归母净利润。')
  await expect(fetchDividendForecast('600941')).rejects.toThrow('预测请求失败（502）')
})

it('deduplicates stock codes in one grid forecast request', async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: {}, errors: {} })))
  vi.stubGlobal('fetch', request)
  await fetchDividendForecasts(['600941', '601728', '600941'])
  expect(Object.fromEntries(new URL(request.mock.calls[0][0], 'https://www.manmanbianfu.top').searchParams)).toEqual({
    codes: '600941,601728',
    year: '2026',
  })
})
