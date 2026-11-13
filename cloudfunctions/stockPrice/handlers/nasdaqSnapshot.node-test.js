const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('module')

let snapshot = null
let upstreamCalls = 0
const codes = ['sh513110', 'sz159513', 'sz159632', 'sz159660', 'sh513390', 'sh513870',
  'sh513300', 'sz159659', 'sz159941', 'sz159696', 'sh513100', 'sz159501']
const quoteBody = codes.map(code => {
  const fields = Array(79).fill('')
  fields[3] = '2.453'
  fields[30] = '20261113145959'
  fields[32] = '0.50'
  fields[57] = '10000'
  fields[72] = '100000000'
  fields[78] = '2.1234'
  return `v_${code}="${fields.join('~')}";`
}).join('\n')

const originalLoad = Module._load
Module._load = function load(request, parent, isMain) {
  if (parent?.filename.endsWith('/handlers/nasdaqSnapshot.js') && request === '../utils/db') {
    return {
      collection: () => ({ doc: () => ({
        get: async () => ({ data: snapshot ? [snapshot] : [] }),
        set: async data => { snapshot = data },
      }) }),
      serverDate: () => new Date(),
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}
const handler = require('./nasdaqSnapshot')
Module._load = originalLoad

const originalFetch = global.fetch
global.fetch = async () => {
  upstreamCalls += 1
  return { ok: true, arrayBuffer: async () => new TextEncoder().encode(quoteBody).buffer }
}
test.after(() => { global.fetch = originalFetch })

const at = value => Date.parse(`${value}+08:00`)

test('recognizes A-share trading windows in Beijing time', () => {
  assert.equal(handler.isTradingSession(at('2026-11-13T09:15:00')), true)
  assert.equal(handler.isTradingSession(at('2026-11-13T11:30:00')), false)
  assert.equal(handler.isTradingSession(at('2026-11-13T13:00:00')), true)
  assert.equal(handler.isTradingSession(at('2026-11-13T15:00:00')), false)
  assert.equal(handler.isTradingSession(at('2026-11-14T10:00:00')), false)
})

test('trading request writes the complete quote snapshot', async () => {
  const result = await handler({}, at('2026-11-13T14:59:00'))
  assert.equal(result.statusCode, 200)
  assert.equal(result.body, quoteBody)
  assert.equal(snapshot.body, quoteBody)
  assert.equal(upstreamCalls, 1)
})

test('after close reads database snapshot without Tencent calls', async () => {
  const before = upstreamCalls
  const result = await handler({}, at('2026-11-13T16:00:00'))
  assert.equal(result.statusCode, 200)
  assert.equal(result.body, quoteBody)
  assert.equal(upstreamCalls, before)
})

test('one-time after-close bootstrap writes a missing database snapshot', async () => {
  snapshot = null
  const before = upstreamCalls
  const result = await handler({}, at('2026-11-13T16:00:00'))
  assert.equal(result.statusCode, 200)
  assert.equal(snapshot.body, quoteBody)
  assert.equal(upstreamCalls, before + 1)
  await handler({}, at('2026-11-13T16:05:00'))
  assert.equal(upstreamCalls, before + 1)
})

test('incomplete upstream response does not replace last good snapshot', async () => {
  const before = upstreamCalls
  global.fetch = async () => {
    upstreamCalls += 1
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode(quoteBody.split('\n')[0]).buffer }
  }
  const result = await handler({}, at('2026-11-16T09:30:00'))
  assert.equal(result.statusCode, 200)
  assert.equal(result.body, quoteBody)
  assert.equal(snapshot.body, quoteBody)
  assert.equal(upstreamCalls, before + 1)
})
