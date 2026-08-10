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
let announcementRows = [
  { art_code: 'AN_TEST_600900_2025', title: '长江电力:长江电力2025年年度权益分派实施公告' },
]
let announcementPages = null
let announcementContents = {
  AN_TEST_600900_2025: '2025 年全年现金红利为每股 1.00 元（含税），2025 年度合计派发现金红利24,468,217,716元（含税）。',
}
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
  if (String(url).includes('np-anotice-stock')) {
    const pageIndex = Number(new URL(String(url)).searchParams.get('page_index'))
    const rows = announcementPages?.[pageIndex - 1] || announcementRows
    return { ok: true, json: async () => ({ data: { list: rows } }) }
  }
  if (String(url).includes('np-cnotice-stock')) {
    const artCode = new URL(String(url)).searchParams.get('art_code')
    return { ok: true, json: async () => ({ data: { notice_content: announcementContents[artCode] || '' } }) }
  }
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
  assert.equal(record.calculationBasis, 'official')
  assert.equal(record.source, 'eastmoney-annual-dividend-announcement')
  assert.equal(record.events.length, 2)
  assert.equal(response.headers['Cache-Control'], 'no-store')
})

test('returns the cached fiscal year without another upstream request', async () => {
  const before = upstreamCalls
  const response = await dividendPayoutHandler({ codes: '600900', years: '2025' })
  assert.equal(response.statusCode, 200)
  assert.equal(upstreamCalls, before)
})

test('keeps unaffected version 7 cache records without refetching', async () => {
  documents.set('601288_2024', { code: '601288', year: 2024, payoutRatio: 66.66, payoutCacheVersion: 7 })
  const before = upstreamCalls
  const response = await dividendPayoutHandler({ codes: '601288', years: '2024' })
  const record = JSON.parse(response.body).data[0].data[0]
  assert.equal(record.payoutRatio, 66.66)
  assert.equal(upstreamCalls, before)
})

test('caches an unavailable historical year to avoid repeated upstream reads', async () => {
  const before = upstreamCalls
  const first = await dividendPayoutHandler({ codes: '600900', years: '2024' })
  assert.equal(JSON.parse(first.body).data[0].data[0].payoutRatio, null)
  await dividendPayoutHandler({ codes: '600900', years: '2024' })
  assert.equal(upstreamCalls, before + 3)
})

test('uses Midea 2025 implemented cash dividend total instead of the annual-report plan', async () => {
  announcementRows = [
    { art_code: 'AN_TEST_000333_A', title: '美的集团:2025年度A股利润分配实施公告' },
  ]
  announcementContents = {}
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
  assert.equal(record.payoutCacheVersion, 8)
})

test('includes shareholder-approved annual dividends with an EPS-based pending payout ratio', async () => {
  announcementRows = [
    { art_code: 'AN_TEST_000651_2025', title: '格力电器:2025年年度利润分配预案的公告' },
  ]
  announcementContents = {
    AN_TEST_000651_2025: '公司2025年度预计将累计向股东派发现金红利16,755,416,223.00元（含税），其中2025年中期利润分配方案已实施完毕。',
  }
  upstreamRows = [
    { REPORT_DATE: '2025-12-31 00:00:00', ASSIGN_PROGRESS: '股东大会决议通过', PRETAX_BONUS_RMB: 20, BASIC_EPS: 5.193, TOTAL_SHARES: 5601405741 },
    { REPORT_DATE: '2025-09-30 00:00:00', ASSIGN_PROGRESS: '实施分配', PRETAX_BONUS_RMB: 10, BASIC_EPS: 3.7, TOTAL_SHARES: 5601405741, EX_DIVIDEND_DATE: '2026-01-23 00:00:00' },
  ]
  financialRows = [{ REPORTDATE: '2025-12-31 00:00:00', PARENT_NETPROFIT: 29003103411.66 }]

  const response = await dividendPayoutHandler({ codes: '000651', years: '2025' })
  const record = JSON.parse(response.body).data[0].data[0]
  assert.equal(record.dividendPerShare, 3)
  assert.equal(record.dividendTotal, 16755416223)
  assert.equal(record.payoutRatio, 57.77)
  assert.equal(record.pendingImplementation, true)
  assert.equal(record.events[0].status, 'approved-pending')
  assert.equal(record.source, 'eastmoney-annual-dividend-announcement')
})

test('adds implemented special dividends to the matching fiscal year', async () => {
  announcementRows = []
  announcementPages = [
    Array.from({ length: 100 }, (_, index) => ({ art_code: `AN_FILLER_${index}`, title: '贵州茅台:其他公告' })),
    [
      { art_code: 'AN_TEST_600519_ANNUAL', title: '贵州茅台:2023年年度权益分派实施公告' },
      { art_code: 'AN_TEST_600519_SPECIAL', title: '贵州茅台:2023年度回报股东特别分红实施公告' },
    ],
  ]
  announcementContents = {
    AN_TEST_600519_ANNUAL: '公司2023年度利润分配共计派发现金红利38,786,363,273元（含税）。',
    AN_TEST_600519_SPECIAL: '公司2023年度回报股东特别分红共计派发现金红利24,000,915,166.80元（含税）。',
  }
  upstreamRows = [
    { REPORT_DATE: '2023-12-31 00:00:00', ASSIGN_PROGRESS: '实施分配', PRETAX_BONUS_RMB: 308.76, BASIC_EPS: 59.49, TOTAL_SHARES: 1256197800, EX_DIVIDEND_DATE: '2024-06-19 00:00:00' },
  ]
  financialRows = [{ REPORTDATE: '2023-12-31 00:00:00', PARENT_NETPROFIT: 74734071550.75 }]

  const response = await dividendPayoutHandler({ codes: '600519', years: '2023' })
  const record = JSON.parse(response.body).data[0].data[0]
  assert.equal(record.dividendTotal, 62787278439.8)
  assert.equal(record.payoutRatio, 84.01)
  assert.equal(record.calculationBasis, 'official')
  assert.match(record.announcementTitle, /特别分红/)
})

test('refreshes only stale Yunnan Baiyao records and adds its special dividends', async () => {
  announcementRows = []
  announcementPages = null
  announcementContents = {}
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
  assert.ok(records.every(record => record.payoutCacheVersion === 8))
})
