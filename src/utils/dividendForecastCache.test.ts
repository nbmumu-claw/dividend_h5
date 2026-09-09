import { expect, it } from 'vitest'
import { DIVIDEND_FORECAST_MODEL_VERSION } from './dividendForecast'
import { clearForecastOverrides, loadForecastCache, loadForecastOverrides, normalizeForecastOverrides, saveForecastCache, saveForecastOverrides } from './dividendForecastCache'

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

it('keeps only valid manual dividend values before account sync', () => {
  expect(normalizeForecastOverrides({ '600941': 5, '00700': 0, bad: 3, '601166': Number.NaN })).toEqual({ '600941': 5 })
})
