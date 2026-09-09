const { test } = require('node:test')
const assert = require('node:assert/strict')
const { forecast } = require('./model')
const { dividendHistory, createDataLoader } = require('./data')
const { createServer, forecastBatch, parseOptions } = require('./index')

function fixture() {
  return {
    response: {
      name: '测试股票',
      reports: [2023, 2024, 2025].flatMap(year => [
        { REPORTDATE: `${year}-06-30`, PARENT_NETPROFIT: 50 },
        { REPORTDATE: `${year}-12-31`, PARENT_NETPROFIT: 100 },
      ]).concat({ REPORTDATE: '2026-06-30', PARENT_NETPROFIT: 60 }),
      latestShare: { TOTAL_SHARES: 100 },
      interimDividend: null, priorInterimDividend: null, dividendCommitment: null,
    },
    payouts: [2025, 2024, 2023].map(year => ({ year, payoutRatio: 50 })),
    history: { records: [{ year: 2025, perShare: 0.5 }] },
  }
}

test('profit model annualizes H1 and preserves manual payout selections', () => {
  const data = fixture()
  assert.equal(forecast('600941', data).annualDps, 0.6)
  assert.equal(forecast('600941', data, { profitRatio: 0.4 }).annualDps, 0.75)
  data.payouts[0].payoutRatio = 30
  assert.equal(forecast('600941', data).systemPayoutMethod, 'latest')
  const manual = forecast('600941', data, { payoutMethod: 'median' })
  assert.equal(manual.annualDps, 0.6)
  assert.equal(manual.payoutMethod, 'median')
})

test('interim anchor and eligible commitment preserve method priority and explicit override', () => {
  const data = fixture()
  data.response.interimDividend = { PRETAX_BONUS_RMB: 1 }
  data.response.priorInterimDividend = { PRETAX_BONUS_RMB: 2 }
  assert.equal(forecast('600941', data).annualDps, 0.25)
  assert.equal(forecast('600941', data).terminalDps, 0.15)
  data.response.dividendCommitment = { modelEligible: true, minDps: 0.8 }
  assert.equal(forecast('600941', data).forecastMethod, 'policy')
  assert.equal(forecast('600941', data).annualDps, 0.8)
  assert.equal(forecast('600941', data, { forecastMethod: 'profit' }).annualDps, 0.6)
  data.response.dividendCommitment.modelEligible = false
  assert.equal(forecast('600941', data, { forecastMethod: 'policy' }).forecastMethod, 'interim')
})

test('missing H1 fails instead of reporting zero dividend', () => {
  const data = fixture()
  data.response.reports.pop()
  assert.throws(() => forecast('600941', data), /2026 年中报/)
})

test('unavailable history disables the interim anchor but retains the profit forecast', () => {
  const data = fixture()
  data.history = null
  const result = forecast('600941', data)
  assert.equal(result.annualDps, 0.6)
  assert.equal(result.interimAnchor, null)
  assert.deepEqual(result.history, [])
})

test('historical aggregation retains fiscal years, rounding, progress filtering and supplements', () => {
  const history = dividendHistory('000538', [
    { REPORT_DATE: '2025-12-31', ASSIGN_PROGRESS: '实施分配', IMPL_PLAN_PROFILE: '10派20.00元' },
    { REPORT_DATE: '2025-06-30', ASSIGN_PROGRESS: '董事会决议通过', PRETAX_BONUS_RMB: 1 },
    { REPORT_DATE: '2025-06-30', ASSIGN_PROGRESS: '取消分配', PRETAX_BONUS_RMB: 100 },
  ])
  assert.deepEqual(history.records, [{ year: 2025, perShare: 3.119 }, { year: 2024, perShare: 1.213 }])
})

test('source cache coalesces concurrent fetches, does not cache failures or personal results', async () => {
  let calls = 0
  const load = createDataLoader(async () => { calls++; return fixture() })
  const [a, b] = await Promise.all([load('600941'), load('600941')])
  assert.equal(calls, 1)
  assert.equal(a, b)
  forecast('600941', a, { profitRatio: 0.4 })
  assert.equal(forecast('600941', b).annualDps, 0.6)
  let attempts = 0
  const retry = createDataLoader(async () => { if (++attempts === 1) throw new Error('upstream'); return fixture() })
  await assert.rejects(retry('600941'))
  await retry('600941')
  assert.equal(attempts, 2)
})

test('batch input deduplicates codes, enforces limits and preserves single-code compatibility', async () => {
  const single = parseOptions(new URLSearchParams('code=600941'))
  assert.deepEqual(single.codes, ['600941'])
  assert.equal(single.batch, false)
  const batch = parseOptions(new URLSearchParams('codes=600941,601728,600941'))
  assert.deepEqual(batch.codes, ['600941', '601728'])
  assert.equal(batch.batch, true)
  assert.throws(() => parseOptions(new URLSearchParams('codes=600941,00700')), /6 位 A 股/)
  assert.throws(() => parseOptions(new URLSearchParams(`codes=${Array.from({ length: 101 }, (_, i) => String(600000 + i)).join(',')}`)), /最多预测 100/)
})

test('batch prediction returns partial results without failing the whole grid', async () => {
  const active = { count: 0, max: 0 }
  const loader = async code => {
    active.count++
    active.max = Math.max(active.max, active.count)
    await new Promise(resolve => setTimeout(resolve, 5))
    active.count--
    if (code === '000001') throw new Error('数据缺失')
    return fixture()
  }
  const output = await forecastBatch(['600941', '000001', '601728'], loader, {}, 2)
  assert.equal(output.results['600941'].annualDps, 0.6)
  assert.equal(output.results['601728'].annualDps, 0.6)
  assert.equal(output.errors['000001'], '数据缺失')
  assert.ok(active.max <= 2)
})

test('HTTP contract validates inputs and returns CORS, prediction and upstream errors', async t => {
  process.env.FORECAST_PROXY_SECRET = 'test-secret'
  const server = createServer(async code => { if (code === '000001') throw new Error('数据缺失'); return fixture() })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = `http://127.0.0.1:${server.address().port}`
  for (const query of ['code=00700', 'code=600941&year=2027', 'code=600941&profitRatio=NaN', 'code=600941&profitRatio=0', 'code=600941&payoutMethod=bad']) {
    assert.equal((await fetch(`${base}/?${query}`, { headers: { 'X-Forecast-Proxy-Secret': 'test-secret' } })).status, 400)
  }
  assert.equal((await fetch(`${base}/?code=600941`)).status, 403)
  const headers = { 'X-Forecast-Proxy-Secret': 'test-secret' }
  const response = await fetch(`${base}/?code=600941&profitRatio=0.4`, { headers })
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.equal((await response.json()).annualDps, 0.75)
  const batchResponse = await fetch(`${base}/?codes=600941,000001,601728`, { headers })
  const batch = await batchResponse.json()
  assert.equal(batch.results['600941'].annualDps, 0.6)
  assert.equal(batch.results['601728'].annualDps, 0.6)
  assert.equal(batch.errors['000001'], '数据缺失')
  assert.equal((await fetch(`${base}/?code=000001`, { headers })).status, 502)
  assert.equal((await fetch(base, { method: 'OPTIONS' })).status, 200)
  assert.equal((await fetch(base, { method: 'POST' })).status, 405)
  assert.equal((await fetch(`${base}/missing`)).status, 404)
  delete process.env.FORECAST_PROXY_SECRET
})
