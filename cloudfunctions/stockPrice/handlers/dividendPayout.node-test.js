const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('module')

const documents = new Map()
let upstreamCalls = 0
let upstreamRows = [
  { REPORT_DATE: '2025-12-31 00:00:00', ASSIGN_PROGRESS: '实施分配', PRETAX_BONUS_RMB: 7.9, BASIC_EPS: 1.4101, TOTAL_SHARES: 24468217716, EX_DIVIDEND_DATE: '2026-07-17 00:00:00' },
  { REPORT_DATE: '2025-09-30 00:00:00', ASSIGN_PROGRESS: '实施分配', PRETAX_BONUS_RMB: 2.1, BASIC_EPS: 1.1522, TOTAL_SHARES: 24468217716, EX_DIVIDEND_DATE: '2026-02-12 00:00:00' },
  { REPORT_DATE: '2025-12-31 00:00:00', ASSIGN_PROGRESS: '预披露', PRETAX_BONUS_RMB: 9, BASIC_EPS: 1.4101, TOTAL_SHARES: 24468217716 },
]
let financialRows = [
  { REPORTDATE: '2025-12-31 00:00:00', PARENT_NETPROFIT: 34500000000 },
]
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
global.fetch = async url => {
  upstreamCalls += 1
  return {
    ok: true,
    json: async () => ({ result: { data: String(url).includes('RPT_LICO_FN_CPD') ? financialRows : upstreamRows } }),
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
  assert.equal(record.netProfit, 34500000000)
  assert.equal(record.payoutRatio, 70.92)
  assert.equal(record.calculationBasis, 'estimated')
  assert.equal(record.events.length, 2)
  assert.equal(response.headers['Cache-Control'], 'no-store')
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
  assert.equal(upstreamCalls, before + 2)
})

test('uses Midea 2025 implemented cash dividend total instead of the annual-report plan', async () => {
  upstreamRows = [
    { REPORT_DATE: '2025-12-31 00:00:00', ASSIGN_PROGRESS: '实施分配', PRETAX_BONUS_RMB: 38, BASIC_EPS: 5.67, TOTAL_SHARES: 6820019535, EX_DIVIDEND_DATE: '2026-06-17 00:00:00' },
    { REPORT_DATE: '2025-06-30 00:00:00', ASSIGN_PROGRESS: '实施分配', PRETAX_BONUS_RMB: 5, BASIC_EPS: 2.21, TOTAL_SHARES: 7560000000, EX_DIVIDEND_DATE: '2025-09-25 00:00:00' },
  ]
  financialRows = [
    { REPORTDATE: '2025-12-31 00:00:00', PARENT_NETPROFIT: 43945411000 },
  ]

  const response = await dividendPayoutHandler({ codes: '000333', years: '2025' })
  const record = JSON.parse(response.body).data[0].data[0]
  assert.equal(record.dividendTotal, 32160000000)
  assert.equal(record.netProfit, 43945411000)
  assert.equal(record.payoutRatio, 73.18)
  assert.equal(record.calculationBasis, 'official')
  assert.equal(record.payoutCacheVersion, 4)
})

test('refreshes only stale Yunnan Baiyao records and adds its special dividends', async () => {
  documents.set('000538_2024', { code: '000538', year: 2024, payoutRatio: 44.55 })
  documents.set('000538_2025', { code: '000538', year: 2025, payoutRatio: 54.78 })
  upstreamRows = [
    { REPORT_DATE: '2025-12-31 00:00:00', ASSIGN_PROGRESS: '实施分配', PRETAX_BONUS_RMB: 15.83, BASIC_EPS: 2.89, TOTAL_SHARES: 510000000, EX_DIVIDEND_DATE: '2026-06-01 00:00:00' },
    { REPORT_DATE: '2024-12-31 00:00:00', ASSIGN_PROGRESS: '实施分配', PRETAX_BONUS_RMB: 11.85, BASIC_EPS: 2.66, TOTAL_SHARES: 510000000, EX_DIVIDEND_DATE: '2025-06-01 00:00:00' },
  ]
  financialRows = [
    { REPORTDATE: '2025-12-31 00:00:00', PARENT_NETPROFIT: 5153348088.59 },
    { REPORTDATE: '2024-12-31 00:00:00', PARENT_NETPROFIT: 4749319260.74 },
  ]

  const response = await dividendPayoutHandler({ codes: '000538', years: '2024,2025' })
  const records = JSON.parse(response.body).data[0].data
  assert.deepEqual(records.map(record => [record.year, record.dividendPerShare, record.payoutRatio, record.calculationBasis]), [
    [2025, 2.602, 90.09, 'official'],
    [2024, 2.398, 90.09, 'official'],
  ])
  assert.ok(records.every(record => record.payoutCacheVersion === 4))
})
