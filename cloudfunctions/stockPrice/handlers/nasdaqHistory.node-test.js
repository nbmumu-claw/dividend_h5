const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const handler = require('./nasdaqHistory')
const original = global.fetch
afterEach(() => { global.fetch = original })
test('rejects codes outside the allowlist without upstream access', async () => {
  global.fetch = () => { throw new Error('Must not fetch') }
  const response = await handler({ code: '../invalid' })
  assert.equal(response.statusCode, 400)
  assert.equal(response.headers['Access-Control-Allow-Origin'], undefined)
})
test('returns adjusted history and reuses successful cached results', async () => {
  let calls = 0
  const rows = [['2026-11-13', '2', '2.23']]
  global.fetch = async url => {
    calls++
    assert.equal(new URL(url).searchParams.get('param'), 'sh513100,day,,,320,qfq')
    return { ok: true, json: async () => ({ data: { sh513100: { qfqday: rows } } }) }
  }
  const response = await handler({ code: '513100' })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(JSON.parse(response.body).rows, rows)
  await handler({ code: '513100' })
  assert.equal(calls, 1)
})
test('leaves CORS to the gateway and does not cache failures', async () => {
  global.fetch = async () => ({ ok: false, status: 503, text: async () => 'unavailable' })
  assert.equal((await handler({ code: '159501' })).statusCode, 502)
  global.fetch = async () => ({ ok: true, json: async () => ({ data: { sz159501: { day: [['2026-11-13', '1', '1.5']] } } }) })
  const response = await handler({ code: '159501' })
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['Access-Control-Allow-Origin'], undefined)
})
test('retries a transient WAF 501 once with a fresh request', async () => {
  const urls = []
  global.fetch = async url => {
    urls.push(url)
    return urls.length === 1
      ? { ok: false, status: 501, text: async () => 'WAF' }
      : { ok: true, status: 200, json: async () => ({ data: { sz159660: { day: [['2026-11-13', '1', '1.5']] } } }) }
  }
  assert.equal((await handler({ code: '159660' })).statusCode, 200)
  assert.equal(urls.length, 2)
  assert.notEqual(urls[0], urls[1])
})
