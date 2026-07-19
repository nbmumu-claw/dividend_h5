import type { BollPeriod } from '../utils/periodBoll'

export const BOLL_PERIOD_LABELS: Record<BollPeriod, string> = {
  day: '日',
  week: '周',
  month: '月',
}

interface Props {
  value: BollPeriod
  onChange: (period: BollPeriod) => void
  compact?: boolean
}

const PERIODS: BollPeriod[] = ['day', 'week', 'month']

export default function BollPeriodSwitch({ value, onChange, compact = false }: Props) {
  return (
    <div
      className={`inline-flex items-center rounded-full border border-slate-200 bg-slate-100 p-0.5 ${compact ? 'gap-0' : 'gap-0.5'}`}
      role="group"
      aria-label="BOLL 周期"
      data-testid="boll-period-switch"
    >
      {PERIODS.map(period => (
        <button
          key={period}
          type="button"
          onClick={() => onChange(period)}
          aria-pressed={value === period}
          className={`rounded-full font-semibold leading-none transition-colors ${compact ? 'h-7 min-w-7 px-1.5 text-[10px]' : 'h-9 min-w-9 px-2 text-[11px]'} ${
            value === period
              ? 'bg-white text-red-600 shadow-sm'
              : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          {BOLL_PERIOD_LABELS[period]}
        </button>
      ))}
    </div>
  )
}
