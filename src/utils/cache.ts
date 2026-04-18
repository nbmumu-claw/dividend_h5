interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const PREFIX = 'dh_cache_'

export function cacheGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const entry: CacheEntry<T> = JSON.parse(raw)
    if (Date.now() > entry.expiresAt) {
      localStorage.removeItem(PREFIX + key)
      return null
    }
    return entry.data
  } catch {
    return null
  }
}

export function cacheSet<T>(key: string, data: T, ttlMs: number): void {
  try {
    const entry: CacheEntry<T> = { data, expiresAt: Date.now() + ttlMs }
    localStorage.setItem(PREFIX + key, JSON.stringify(entry))
  } catch {
    // storage full — ignore
  }
}

export function cacheClear(): void {
  Object.keys(localStorage)
    .filter(k => k.startsWith(PREFIX))
    .forEach(k => localStorage.removeItem(k))
}

export function cacheClearPrices(): void {
  Object.keys(localStorage)
    .filter(k => k.startsWith(PREFIX + 'stockPrice:'))
    .forEach(k => localStorage.removeItem(k))
}
