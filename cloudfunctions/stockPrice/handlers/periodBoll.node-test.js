const test = require('node:test')
const assert = require('node:assert/strict')
const { cacheExpiresAt, calculateBoll, isCacheFresh, parseTencentRows } = require('./periodBollCore')

const shanghaiTime = value => new Date(`${value}+08:00`).getTime()

test('calculateBoll uses the latest 20 closes and sample standard deviation', () => {
  const result = calculateBoll(Array.from({ length: 21 }, (_, index) => index + 1))
  assert.ok(result)
  assert.equal(result.middle, 11.5)
  assert.ok(Math.abs(result.upper - 23.332159566199232) < 1e-10)
})

test('parseTencentRows includes the unfinished current month', () => {
  const rows = Array.from({ length: 20 }, (_, index) => [`2026-${String(index + 1).padStart(2, '0')}-01`, '', index + 1])
  rows[19][0] = '2026-07-19'
  const result = parseTencentRows(rows, 'month', shanghaiTime('2026-07-19T12:00:00'))
  assert.equal(result.isPartial, true)
  assert.equal(result.periodDate, '2026-07-19')
  assert.equal(result.latestClose, 20)
})

test('day cache expires every 15 minutes while trading', () => {
  const now = shanghaiTime('2026-07-17T10:30:00')
  assert.equal(isCacheFresh('day', now - 14 * 60_000, now), true)
  assert.equal(isCacheFresh('day', now - 16 * 60_000, now), false)
  assert.equal(cacheExpiresAt('day', now), now + 15 * 60_000)
})

test('week uses a 60-minute intraday cache boundary', () => {
  const now = shanghaiTime('2026-07-17T10:30:00')
  assert.equal(isCacheFresh('week', now - 59 * 60_000, now), true)
  assert.equal(isCacheFresh('week', now - 61 * 60_000, now), false)
  assert.equal(cacheExpiresAt('week', now), now + 60 * 60_000)
})

test('month cache refreshes once after the daily close', () => {
  const beforeClose = shanghaiTime('2026-07-17T14:00:00')
  const afterClose = shanghaiTime('2026-07-17T15:05:00')
  assert.equal(isCacheFresh('month', shanghaiTime('2026-07-16T15:05:00'), beforeClose), true)
  assert.equal(isCacheFresh('month', beforeClose, afterClose), false)
  assert.equal(cacheExpiresAt('month', beforeClose), shanghaiTime('2026-07-17T15:00:00'))
})
