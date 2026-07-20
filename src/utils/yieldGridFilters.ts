import type { BollPeriod, PeriodBoll } from './periodBoll'

export type YieldStatusFilter = 'all' | 'buy-zone' | 'neutral' | 'sell-zone'
export type BollPositionFilter = 'all' | 'lower-zone' | 'lower-half' | 'upper-half' | 'upper-zone'
export type BollFilters = Record<BollPeriod, BollPositionFilter>

export interface BollTolerances {
  lower: number
  upper: number
}

export const EMPTY_BOLL_FILTERS: BollFilters = { day: 'all', week: 'all', month: 'all' }

export function getSingleActiveBollPeriod(filters: BollFilters): BollPeriod | null {
  const activePeriods = (['day', 'week', 'month'] as const).filter(period => filters[period] !== 'all')
  return activePeriods.length === 1 ? activePeriods[0] : null
}

export function matchesYieldStatus(
  currentYield: number,
  filter: YieldStatusFilter,
  buyThreshold: number,
  sellThreshold: number,
  tolerance: number,
  sellEnabled = true,
): boolean {
  if (filter === 'all') return true
  if (filter === 'buy-zone') return currentYield >= buyThreshold - tolerance
  if (filter === 'sell-zone') return sellEnabled && currentYield <= sellThreshold + tolerance
  return currentYield > sellThreshold + tolerance && currentYield < buyThreshold - tolerance
}

export function matchesBollPosition(
  price: number,
  boll: Pick<PeriodBoll, 'lower' | 'middle' | 'upper'> | undefined,
  filter: BollPositionFilter,
  tolerances: BollTolerances,
): boolean {
  if (filter === 'all') return true
  if (!boll || boll.lower <= 0 || boll.lower >= boll.middle || boll.middle >= boll.upper) return false
  const lowerZoneCeiling = boll.lower * (1 + tolerances.lower)
  const upperZoneFloor = boll.upper * (1 - tolerances.upper)
  if (filter === 'lower-zone') return price <= lowerZoneCeiling
  if (filter === 'lower-half') return price > lowerZoneCeiling && price < boll.middle
  if (filter === 'upper-half') return price >= boll.middle && price < upperZoneFloor
  return price >= upperZoneFloor
}
