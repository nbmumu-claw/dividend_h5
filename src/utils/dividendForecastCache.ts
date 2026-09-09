import { DIVIDEND_FORECAST_MODEL_VERSION } from './dividendForecast'

const FORECAST_CACHE_KEY = 'yield-grid-2026-dividend-forecast'
const FORECAST_OVERRIDES_KEY = 'yield-grid-2026-dividend-overrides'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>
export type ForecastCacheValues = Record<string, number | null>
type ForecastCache = { modelVersion: string; values: ForecastCacheValues }

const storageOf = (): StorageLike | undefined => typeof localStorage === 'undefined' ? undefined : localStorage

export function normalizeForecastOverrides(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => (
    /^\d{4,6}$/.test(entry[0]) && typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0
  )))
}

function forecastValues(value: unknown): ForecastCacheValues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => (
    /^\d{4,6}$/.test(entry[0]) && typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0
  )))
}

export function loadForecastCache(storage = storageOf()): ForecastCacheValues {
  if (!storage) return {}
  try {
    const parsed = JSON.parse(storage.getItem(FORECAST_CACHE_KEY) || 'null') as ForecastCache | null
    return parsed?.modelVersion === DIVIDEND_FORECAST_MODEL_VERSION ? forecastValues(parsed.values) : {}
  } catch { return {} }
}

export function saveForecastCache(values: ForecastCacheValues, storage = storageOf()) {
  if (!storage) return
  try {
    storage.setItem(FORECAST_CACHE_KEY, JSON.stringify({ modelVersion: DIVIDEND_FORECAST_MODEL_VERSION, values: forecastValues(values) }))
  } catch { /* localStorage unavailable or full */ }
}

export function loadForecastOverrides(storage = storageOf()): Record<string, number> {
  if (!storage) return {}
  try { return normalizeForecastOverrides(JSON.parse(storage.getItem(FORECAST_OVERRIDES_KEY) || '{}')) }
  catch { return {} }
}

export function saveForecastOverrides(values: Record<string, number>, storage = storageOf()) {
  if (!storage) return
  try { storage.setItem(FORECAST_OVERRIDES_KEY, JSON.stringify(normalizeForecastOverrides(values))) }
  catch { /* localStorage unavailable or full */ }
}

export function clearForecastOverrides(storage = storageOf()) {
  if (!storage) return
  try {
    if (storage.removeItem) storage.removeItem(FORECAST_OVERRIDES_KEY)
    else storage.setItem(FORECAST_OVERRIDES_KEY, '{}')
  } catch { /* localStorage unavailable */ }
}
