import { DIVIDEND_FORECAST_MODEL_VERSION, type ForecastResult } from './dividendForecast'

const FORECAST_CACHE_KEY = 'yield-grid-2026-dividend-forecast'
const FORECAST_DETAIL_CACHE_KEY = 'yield-grid-2026-dividend-forecast-details'
const FORECAST_OVERRIDES_KEY = 'yield-grid-2026-dividend-overrides'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>
export type ForecastCacheValues = Record<string, number | null>
type ForecastCache = { modelVersion: string; values: ForecastCacheValues }
type ForecastDetailCache = { modelVersion: string; values: Record<string, ForecastResult> }

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

function loadForecastDetailValues(storage: StorageLike | undefined): Record<string, ForecastResult> {
  if (!storage) return {}
  try {
    const parsed = JSON.parse(storage.getItem(FORECAST_DETAIL_CACHE_KEY) || 'null') as ForecastDetailCache | null
    return parsed?.modelVersion === DIVIDEND_FORECAST_MODEL_VERSION && parsed.values && typeof parsed.values === 'object'
      ? parsed.values
      : {}
  } catch { return {} }
}

export function loadForecastDetail(code: string, storage = storageOf()): ForecastResult | null {
  const detail = loadForecastDetailValues(storage)[code]
  return detail?.code === code && detail.modelVersion === DIVIDEND_FORECAST_MODEL_VERSION ? detail : null
}

export function saveForecastDetail(detail: ForecastResult, storage = storageOf()) {
  if (!storage || detail.modelVersion !== DIVIDEND_FORECAST_MODEL_VERSION) return
  try {
    const values = { ...loadForecastDetailValues(storage), [detail.code]: detail }
    storage.setItem(FORECAST_DETAIL_CACHE_KEY, JSON.stringify({ modelVersion: DIVIDEND_FORECAST_MODEL_VERSION, values }))
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
