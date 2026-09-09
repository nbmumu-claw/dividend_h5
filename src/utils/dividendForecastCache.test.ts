import { expect, it } from 'vitest'
import { DIVIDEND_FORECAST_MODEL_VERSION, type ForecastResult } from './dividendForecast'
import { clearForecastOverrides, loadForecastCache, loadForecastDetail, loadForecastOverrides, normalizeForecastOverrides, saveForecastCache, saveForecastDetail, saveForecastOverrides } from './dividendForecastCache'

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
    data,
  }
}

it('keeps successful predictions, retries failed entries, and rejects older versions', () => {
  const storage = memoryStorage()
  saveForecastCache({ '600941': 4.5747, '600863': null }, storage)
  expect(loadForecastCache(storage)).toEqual({ '600941': 4.5747 })
  expect(JSON.parse(storage.data.get('yield-grid-2026-dividend-forecast') || '{}').values).toEqual({ '600941': 4.5747 })
  const stored = JSON.parse(storage.data.get('yield-grid-2026-dividend-forecast') || '{}')
  expect(stored.modelVersion).toBe(DIVIDEND_FORECAST_MODEL_VERSION)
  stored.modelVersion = 'older-model'
  storage.data.set('yield-grid-2026-dividend-forecast', JSON.stringify(stored))
  expect(loadForecastCache(storage)).toEqual({})
})

it('persists manual overrides independently from the prediction cache', () => {
  const storage = memoryStorage()
  saveForecastOverrides({ '600941': 5, '00700': 4.2 }, storage)
  expect(loadForecastOverrides(storage)).toEqual({ '600941': 5, '00700': 4.2 })
  clearForecastOverrides(storage)
  expect(loadForecastOverrides(storage)).toEqual({})
})

it('caches forecast details until the model version changes', () => {
  const storage = memoryStorage()
  const detail: ForecastResult = {
    code: '000807', name: '云铝股份', year: 2026,
    modelVersion: DIVIDEND_FORECAST_MODEL_VERSION, calculatedAt: '2026-09-09T00:00:00.000Z',
    profitRatio: 0.4571, medianProfitRatio: 0.4571, annualDps: 1.4933, terminalDps: null,
    annualProfit: 16809000000, h1Profit: 7684000000, payout: 0.3081, effectivePayout: 0.3081,
    appliedPayout: 0.3081, payoutAverage: 0.3081, payoutMedian: 0.3223, payoutLatest: 0.4004,
    payoutMethod: 'average', systemPayoutMethod: 'average', shares: 3468000000, shareSourceDate: null,
    interim: null, priorInterim: null, priorAnnualDps: 0.699, profitDps: 1.4933,
    forecastMethod: 'profit', interimAnchor: null, usesInterimAnchor: false, commitment: null,
    policyDpsFloor: null, policyApplied: false, seasonality: [], payouts: [], history: [], interimExceedsModel: false,
  }
  saveForecastDetail(detail, storage)
  expect(loadForecastDetail('000807', storage)).toEqual(detail)

  const stored = JSON.parse(storage.data.get('yield-grid-2026-dividend-forecast-details') || '{}')
  stored.modelVersion = 'older-model'
  storage.data.set('yield-grid-2026-dividend-forecast-details', JSON.stringify(stored))
  expect(loadForecastDetail('000807', storage)).toBeNull()
})

it('keeps only valid manual dividend values before account sync', () => {
  expect(normalizeForecastOverrides({ '600941': 5, '00700': 0, bad: 3, '601166': Number.NaN })).toEqual({ '600941': 5 })
})
