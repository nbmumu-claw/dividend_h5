import type { WeeklyBoll } from '../utils/weeklyBoll'

export interface WeeklyBollPositionResult {
  position: number
  zone: string
  gapLabel: string
  gap: number
  tone: 'green' | 'red' | 'neutral'
}

export function getWeeklyBollPosition(
  boll: WeeklyBoll | null | undefined,
  currentPrice: number,
): WeeklyBollPositionResult | null {
  if (!boll || currentPrice <= 0 || boll.upper <= boll.lower) return null

  const rawPosition = ((currentPrice - boll.lower) / (boll.upper - boll.lower)) * 100
  const position = Math.min(100, Math.max(0, rawPosition))
  const near = (value: number) => Math.abs(currentPrice - value) < 0.005

  if (currentPrice < boll.lower && !near(boll.lower)) {
    return { position, zone: '低于下轨', gapLabel: '较下轨', gap: (currentPrice / boll.lower - 1) * 100, tone: 'green' }
  }
  if (near(boll.lower)) {
    return { position, zone: '位于下轨', gapLabel: '较下轨', gap: 0, tone: 'green' }
  }
  if (currentPrice < boll.middle && !near(boll.middle)) {
    return { position, zone: '中下轨之间', gapLabel: '距中轨', gap: (currentPrice / boll.middle - 1) * 100, tone: 'green' }
  }
  if (near(boll.middle)) {
    return { position, zone: '位于中轨', gapLabel: '较中轨', gap: 0, tone: 'neutral' }
  }
  if (currentPrice < boll.upper && !near(boll.upper)) {
    return { position, zone: '中上轨之间', gapLabel: '距中轨', gap: (currentPrice / boll.middle - 1) * 100, tone: 'red' }
  }
  if (near(boll.upper)) {
    return { position, zone: '位于上轨', gapLabel: '较上轨', gap: 0, tone: 'red' }
  }
  return { position, zone: '高于上轨', gapLabel: '较上轨', gap: (currentPrice / boll.upper - 1) * 100, tone: 'red' }
}

interface Props {
  boll?: WeeklyBoll | null
  currentPrice: number
  symbol: string
  loading?: boolean
  compact?: boolean
}

export default function WeeklyBollPosition({ boll, currentPrice, symbol, loading = false, compact = false }: Props) {
  const result = getWeeklyBollPosition(boll, currentPrice)
  const overflowDirection = result?.zone === '低于下轨' ? 'below' : result?.zone === '高于上轨' ? 'above' : null
  const rulerHeight = compact ? 'h-[58px]' : 'h-[78px] sm:h-[84px]'
  const trackTop = compact ? 'top-5' : 'top-8 sm:top-9'
  const tickTop = compact ? 'top-[17px] h-3' : 'top-[26px] h-4 sm:top-[30px]'
  const dotTop = compact ? 'top-[15px]' : 'top-[27px] sm:top-[31px]'
  const labelsTop = compact ? 'top-[32px]' : 'top-[47px] sm:top-[52px]'

  return (
    <div
      className={compact ? 'min-w-[218px]' : undefined}
      data-weekly-boll-ruler
      data-boll-zone={result?.zone || 'unavailable'}
      title={boll?.weekDate ? `前复权周K · ${boll.weekDate}` : loading ? '周BOLL加载中' : '暂无周BOLL数据'}
    >
      <div className={`relative mx-1 ${rulerHeight}`}>
        <div className={`absolute inset-x-0 flex h-1.5 overflow-hidden rounded-full bg-slate-100 ${trackTop}`}>
          <div className="w-1/2 bg-green-100" />
          <div className="w-1/2 bg-red-100" />
        </div>

        {[0, 50, 100].map(position => (
          <span
            key={position}
            className={`absolute w-px bg-slate-300 ${tickTop}`}
            style={{ left: `${position}%` }}
          />
        ))}

        {result && (
          <>
            <div
              className={`absolute top-0 flex -translate-x-1/2 items-center gap-0.5 whitespace-nowrap font-bold text-red-600 ${compact ? 'text-[9px]' : 'text-[10px] sm:text-[11px]'}`}
              style={{ left: `clamp(36px, ${result.position}%, calc(100% - 36px))` }}
              data-boll-overflow-direction={overflowDirection || undefined}
            >
              {overflowDirection === 'below' && (
                <svg className="h-3 w-3 shrink-0" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M6 3 2 7l4 4M2 7h10" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              现价 {symbol}{currentPrice.toFixed(2)}
              {overflowDirection === 'above' && (
                <svg className="h-3 w-3 shrink-0" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="m8 3 4 4-4 4M2 7h10" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <span
              className={`absolute h-3 w-3 -translate-x-1/2 rounded-full border-2 border-white bg-red-600 shadow-[0_0_0_2px_#dc2626] ${dotTop}`}
              style={{ left: `${result.position}%` }}
              data-boll-position={result.position.toFixed(2)}
            />
          </>
        )}

        <div className={`absolute inset-x-0 text-[9px] text-gray-400 ${labelsTop}`}>
          <div className="absolute left-0 text-left">
            <strong className={`block font-bold text-slate-600 ${compact ? 'text-[9px]' : 'text-[10px] sm:text-[11px]'}`}>
              {boll ? `${symbol}${boll.lower.toFixed(2)}` : '--'}
            </strong>
            下轨
          </div>
          <div className="absolute left-1/2 -translate-x-1/2 text-center">
            <strong className={`block font-bold text-slate-600 ${compact ? 'text-[9px]' : 'text-[10px] sm:text-[11px]'}`}>
              {boll ? `${symbol}${boll.middle.toFixed(2)}` : '--'}
            </strong>
            中轨
          </div>
          <div className="absolute right-0 text-right">
            <strong className={`block font-bold text-slate-600 ${compact ? 'text-[9px]' : 'text-[10px] sm:text-[11px]'}`}>
              {boll ? `${symbol}${boll.upper.toFixed(2)}` : '--'}
            </strong>
            上轨
          </div>
        </div>
      </div>

      <div className={`flex items-center justify-between gap-2 px-0.5 ${compact ? 'min-h-5 text-[9px]' : 'min-h-6 text-[11px]'}`}>
        <strong className="text-slate-700">{result?.zone || (loading ? '正在计算位置' : '暂无周 BOLL 数据')}</strong>
        {result && (
          <span className={`shrink-0 rounded-full font-semibold tabular-nums ${compact ? 'px-1.5 py-0.5' : 'px-2 py-1'} ${
            result.tone === 'green'
              ? 'bg-green-50 text-green-700'
              : result.tone === 'red'
                ? 'bg-red-50 text-red-600'
                : 'bg-slate-100 text-slate-600'
          }`}>
            {result.gapLabel} {result.gap >= 0 ? '+' : ''}{result.gap.toFixed(2)}%
          </span>
        )}
      </div>
    </div>
  )
}
