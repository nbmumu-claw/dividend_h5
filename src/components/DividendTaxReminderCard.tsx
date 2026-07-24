import type { PendingDividendTax } from '../utils/dividendTaxReminder'

interface Props {
  item: PendingDividendTax | null
  onConfirm: (item: PendingDividendTax) => void
  onDismiss: (item: PendingDividendTax) => void
  onReview: (item: PendingDividendTax) => void
}

export default function DividendTaxReminderCard({ item, onConfirm, onDismiss, onReview }: Props) {
  if (!item) return null
  return (
    <div
      className="card mb-3 border border-amber-200 bg-amber-50/70 p-4 cursor-pointer"
      role="button"
      tabIndex={0}
      onClick={() => onReview(item)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onReview(item)
        }
      }}
    >
      <div className="flex items-center gap-1.5 mb-3">
        <svg className="w-4 h-4 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M12 9v4m0 4h.01M10.3 3.7 2.9 16.5A2 2 0 0 0 4.6 19.5h14.8a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-sm font-semibold text-amber-800">待确认分红税</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-amber-900">卖出日 {item.saleDate} · {item.qty} 股</div>
          <div className="mt-1 text-sm font-semibold text-amber-900">预计补缴 ¥{item.tax.toFixed(2)}</div>
          <div className="mt-1 text-[11px] text-amber-700">点击卡片可调整；请以券商实际扣缴为准</div>
        </div>
        <button onClick={event => { event.stopPropagation(); onConfirm(item) }} className="flex-shrink-0 px-3 py-1.5 bg-red-600 text-white text-xs font-semibold rounded-lg">确认记录</button>
        <button onClick={event => { event.stopPropagation(); onDismiss(item) }} className="flex-shrink-0 px-2 py-1.5 text-xs text-amber-700">忽略</button>
      </div>
    </div>
  )
}
