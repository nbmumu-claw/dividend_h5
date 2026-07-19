import type { BollPeriod, PeriodBoll } from '../utils/periodBoll'
import { getWeeklyBollPosition } from './WeeklyBollPosition'
import { BOLL_PERIOD_LABELS } from './BollPeriodSwitch'

interface Props {
  values: Partial<Record<BollPeriod, PeriodBoll | null>>
  currentPrice: number
  loading?: Partial<Record<BollPeriod, boolean>>
  unsupported?: boolean
  compact?: boolean
}

const PERIODS: BollPeriod[] = ['day', 'week', 'month']

function shortZone(zone: string): string {
  if (zone === '中下轨之间') return '中下'
  if (zone === '中上轨之间') return '中上'
  if (zone === '低于下轨') return '下轨外'
  if (zone === '高于上轨') return '上轨外'
  if (zone === '位于下轨') return '下轨'
  if (zone === '位于中轨') return '中轨'
  if (zone === '位于上轨') return '上轨'
  return zone
}

export default function BollPeriodOverview({ values, currentPrice, loading = {}, unsupported = false, compact = false }: Props) {
  return (
    <div className={`grid grid-cols-3 gap-1 ${compact ? 'mb-0.5 text-[9px]' : 'mb-1.5 text-[10px]'}`} data-testid="boll-period-overview">
      {PERIODS.map(period => {
        const result = getWeeklyBollPosition(values[period], currentPrice)
        const text = unsupported ? '暂不支持' : loading[period] ? '加载中' : result ? shortZone(result.zone) : '未加载'
        const tone = result?.tone === 'green'
          ? 'text-green-700'
          : result?.tone === 'red' ? 'text-red-600' : 'text-slate-400'
        return (
          <span key={period} className={`min-w-0 truncate whitespace-nowrap text-center font-semibold ${tone}`}>
            <i className="mr-0.5 not-italic text-slate-400">{BOLL_PERIOD_LABELS[period]}</i>{text}
          </span>
        )
      })}
    </div>
  )
}
