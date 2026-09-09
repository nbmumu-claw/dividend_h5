import { afterEach, describe, expect, it, vi } from 'vitest'
import handler, { validatedForecastQuery } from '../api/dividend-history.js'

function responseRecorder() {
  const output = { statusCode: 200, headers: {}, body: '' }
  const res = {
    status(code) { output.statusCode = code; return res },
    setHeader(name, value) { output.headers[name] = value },
    json(value) { output.body = JSON.stringify(value) },
    send(value) { output.body = value },
  }
  return { output, res }
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.CLOUDBASE_FORECAST_ACCESS_KEY
  delete process.env.FORECAST_PROXY_SECRET
})

describe('dividend forecast site proxy', () => {
  it('only forwards validated forecast parameters', () => {
    expect(Object.fromEntries(validatedForecastQuery({ code: '600941', year: '2026', profitRatio: '0.5', payoutMethod: 'latest', forecastMethod: 'interim', ignored: 'x' }))).toEqual({
      code: '600941', year: '2026', profitRatio: '0.5', payoutMethod: 'latest', forecastMethod: 'interim',
    })
    expect(() => validatedForecastQuery({ code: '00700' })).toThrow(/6 位 A 股/)
    expect(() => validatedForecastQuery({ code: '600941', profitRatio: '0' })).toThrow(/利润比例/)
    expect(() => validatedForecastQuery({ code: '600941', payoutMethod: 'bad' })).toThrow(/派息率算法/)
    expect(Object.fromEntries(validatedForecastQuery({ codes: '600941,601728,600941' }))).toEqual({ codes: '600941,601728', year: '2026' })
    expect(() => validatedForecastQuery({ code: '600941', codes: '601728' })).toThrow(/不能同时使用/)
  })

  it('rejects other browser origins and requests without server credentials', async () => {
    let result = responseRecorder()
    await handler({ method: 'GET', query: { __proxy: 'forecast', code: '600941' }, headers: { origin: 'https://evil.example', host: 'www.manmanbianfu.top' } }, result.res)
    expect(result.output.statusCode).toBe(403)
    result = responseRecorder()
    await handler({ method: 'GET', query: { __proxy: 'forecast', code: '600941' }, headers: { host: 'www.manmanbianfu.top' } }, result.res)
    expect(result.output.statusCode).toBe(503)
  })

  it('keeps the credential server-side and relays the upstream response', async () => {
    process.env.CLOUDBASE_FORECAST_ACCESS_KEY = 'server-only-key'
    process.env.FORECAST_PROXY_SECRET = 'function-only-secret'
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ annualDps: 4.5 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', request)
    const result = responseRecorder()
    await handler({ method: 'GET', query: { __proxy: 'forecast', code: '600941' }, headers: { origin: 'https://www.manmanbianfu.top', host: 'www.manmanbianfu.top' } }, result.res)
    expect(result.output.statusCode).toBe(200)
    expect(JSON.parse(result.output.body)).toEqual({ annualDps: 4.5 })
    expect(request.mock.calls[0][1].headers.Authorization).toBe('Bearer server-only-key')
    expect(request.mock.calls[0][1].headers['X-Forecast-Proxy-Secret']).toBe('function-only-secret')
    expect(request.mock.calls[0][0]).not.toContain('server-only-key')
  })
})
