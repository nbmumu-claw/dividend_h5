const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('module')

let periodCalls = 0
const originalLoad = Module._load
Module._load = function load(request, parent, isMain) {
  if (parent?.filename.endsWith('/handlers/weeklyBoll.js') && request === '../utils/db') {
    return {
      command: { in: values => values },
      collection: () => ({
        where: () => ({
          limit: () => ({
            get: async () => ({
              data: [{
                symbol: 'sh600036',
                data: { middle: 37.47, upper: 39.68, lower: 35.27, weekDate: '2026-07-17' },
                updatedAt: new Date(),
              }],
            }),
          }),
        }),
      }),
    }
  }
  if (parent?.filename.endsWith('/handlers/weeklyBoll.js') && request === './periodBoll') {
    return async () => {
      periodCalls += 1
      throw new Error('有效旧缓存不应请求统一接口')
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

const weeklyBollHandler = require('./weeklyBoll')
Module._load = originalLoad

test('returns a fresh legacy cache without calling the unified upstream path', async () => {
  const result = await weeklyBollHandler({ symbols: 'sh600036' })
  assert.equal(result.statusCode, 200)
  assert.equal(periodCalls, 0)
  assert.deepEqual(JSON.parse(result.body), {
    data: {
      sh600036: { middle: 37.47, upper: 39.68, lower: 35.27, weekDate: '2026-07-17' },
    },
  })
})

test('ignores an HK-only legacy request instead of failing the whole grid', async () => {
  const result = await weeklyBollHandler({ symbols: 'hk00883,hk00941,hk02318' })
  assert.equal(result.statusCode, 200)
  assert.equal(periodCalls, 0)
  assert.deepEqual(JSON.parse(result.body), { data: {} })
})
