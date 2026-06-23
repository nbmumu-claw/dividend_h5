import type { PendingDividend } from '../utils/dividendReminder'

interface Props {
  items: PendingDividend[]
  onConfirm: (item: PendingDividend) => void
  onDismiss: (item: PendingDividend) => void
  variant?: 'list' | 'single'
}

const fmtPerShare = (v: number) => String(Number(v.toFixed(4)))

export default function DividendReminderCard({ items, onConfirm, onDismiss, variant = 'list' }: Props) {
  if (items.length === 0) return null
  return (
    <div className={`card p-4 border border-red-100 bg-red-50/40 ${variant === 'list' ? 'mx-4 mb-3' : 'mb-3'}`}>
      <div className="flex items-center gap-1.5 mb-3">
        <svg className="w-4 h-4 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-sm font-semibold text-red-600">待确认分红</span>
        <span className="text-xs text-gray-400">{items.length} 笔</span>
      </div>
      <div className="space-y-2.5">
        {items.map(it => {
          const sym = it.isHK ? 'HK$' : '¥'
          return (
            <div key={`${it.code}@${it.recordDate}`} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                {variant === 'list' && <div className="text-sm font-medium text-gray-800 truncate">{it.name}</div>}
                <div className="text-xs text-gray-500">
                  登记日 {it.recordDate.slice(5)} · 每股 {sym}{fmtPerShare(it.perShare)} · {it.qty} 股
                </div>
                <div className="text-xs text-gray-400">≈ 到手 {sym}{it.net.toFixed(2)}（税后）</div>
              </div>
              <button
                onClick={() => onConfirm(it)}
                className="flex-shrink-0 px-3 py-1.5 bg-red-600 text-white text-xs font-semibold rounded-lg"
              >确认录入</button>
              <button
                onClick={() => onDismiss(it)}
                className="flex-shrink-0 px-2 py-1.5 text-xs text-gray-400"
              >忽略</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
