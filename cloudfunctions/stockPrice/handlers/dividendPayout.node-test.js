const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('module')

const documents = new Map()
let upstreamCalls = 0
const originalLoad = Module._load
Module._load = function load(request, parent, isMain) {
  if (parent?.filename.endsWith('/handlers/dividendPayout.js') && request === '../utils/db') {
    return {
      collection: () => ({
        doc: id => ({
          get: async () => ({ data: documents.has(id) ? [documents.get(id)] : [] }),
          set: async data => { documents.set(id, data) },
        }),
      }),
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

const originalFetch = global.fetch
global.fetch = async () => {
  upstreamCalls += 1
  return {
    ok: true,
    json: async () => ({ result: { data: [
      { REPORT_DATE: '2025-12-31 00:00:00', ASSIGN_PROGRESS: '实施分配', PRETAX_BONUS_RMB: 7.9, BASIC_EPS: 1.4101, TOTAL_SHARES: 24468217716, EX_DIVIDEND_DATE: '2026-07-17 00:00:00' },
      { REPORT_DATE: '2025-09-30 00:00:00', ASSIGN_PROGRESS: '实施分配', PRETAX_BONUS_RMB: 2.1, BASIC_EPS: 1.1522, TOTAL_SHARES: 24468217716, EX_DIVIDEND_DATE: '2026-02-12 00:00:00' },
      { REPORT_DATE: '2025-12-31 00:00:00', ASSIGN_PROGRESS: '预披露', PRETAX_BONUS_RMB: 9, BASIC_EPS: 1.4101, TOTAL_SHARES: 24468217716 },
    ] } }),
  }
}

const dividendPayoutHandler = require('./dividendPayout')
Module._load = originalLoad

test.after(() => { global.fetch = originalFetch })

test('aggregates implemented interim and annual dividends by fiscal year', async () => {
  const response = await dividendPayoutHandler({ codes: '600900', years: '2025' })
  const record = JSON.parse(response.body).data[0].data[0]
  assert.equal(response.statusCode, 200)
  assert.equal(record.dividendPerShare, 1)
  assert.equal(record.eps, 1.4101)
  assert.equal(record.payoutRatio, 70.92)
  assert.equal(record.events.length, 2)
})

test('returns the cached fiscal year without another upstream request', async () => {
  const before = upstreamCalls
  const response = await dividendPayoutHandler({ codes: '600900', years: '2025' })
  assert.equal(response.statusCode, 200)
  assert.equal(upstreamCalls, before)
})

test('caches an unavailable historical year to avoid repeated upstream reads', async () => {
  const before = upstreamCalls
  const first = await dividendPayoutHandler({ codes: '600900', years: '2024' })
  assert.equal(JSON.parse(first.body).data[0].data[0].payoutRatio, null)
  await dividendPayoutHandler({ codes: '600900', years: '2024' })
  assert.equal(upstreamCalls, before + 1)
})
