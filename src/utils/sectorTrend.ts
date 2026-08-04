export type SectorTrendLevel =
  | 'strong-up'
  | 'up'
  | 'slight-up'
  | 'neutral'
  | 'slight-down'
  | 'down'
  | 'strong-down'

export interface SectorTrend {
  level: SectorTrendLevel
  median: number | null
  sampleSize: number
}

export function getSectorTrend(changes: number[], minSamples = 3): SectorTrend {
  const valid = changes.filter(Number.isFinite).sort((a, b) => a - b)
  if (valid.length < minSamples) return { level: 'neutral', median: null, sampleSize: valid.length }

  const middle = Math.floor(valid.length / 2)
  const median = valid.length % 2 === 0
    ? (valid[middle - 1] + valid[middle]) / 2
    : valid[middle]

  const level: SectorTrendLevel = median >= 2.5 ? 'strong-up'
    : median >= 1.5 ? 'up'
      : median >= 0.5 ? 'slight-up'
        : median <= -2.5 ? 'strong-down'
          : median <= -1.5 ? 'down'
            : median <= -0.5 ? 'slight-down'
              : 'neutral'

  return { level, median, sampleSize: valid.length }
}
