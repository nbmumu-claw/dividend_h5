import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { fetchCalendarEvents, type DividendEvent } from '../utils/dividendCalendar'
import {
  arrivalKey,
  buildArrivalTransaction,
  buildDividendArrivalItems,
  type DividendArrivalItem,
} from '../utils/dividendArrival'
import { computeHolding, ensureTransactions } from '../utils/holdings'
import Modal from './Modal'

const STORAGE_KEY = 'dividend-arrival-handled'

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function loadHandled(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return new Set(Array.isArray(value) ? value.filter(v => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

function saveHandled(keys: Set<string>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys])) } catch { /* 本地状态失败不影响分红记录 */ }
}

interface Props {
  enabled: boolean
}

export default function DividendArrivalModal({ enabled }: Props) {
  const watchlist = useStore(s => s.watchlist)
  const activeAccountId = useStore(s => s.activeAccountId)
  const setTransactions = useStore(s => s.setTransactions)
  const [events, setEvents] = useState<DividendEvent[]>([])
  const [handled, setHandled] = useState<Set<string>>(loadHandled)

  const holders = useMemo(
    () => watchlist.filter(stock => computeHolding(ensureTransactions(stock)).shares > 0),
    [watchlist],
  )
  const holderKey = holders.map(stock => stock.code).join(',')

  useEffect(() => {
    let alive = true
    if (!enabled || holders.length === 0) { setEvents([]); return }
    Promise.all(holders.map(stock => fetchCalendarEvents(stock.code, stock.name, stock.isHK).catch(() => [])))
      .then(results => { if (alive) setEvents(results.flat()) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, activeAccountId, holderKey])

  const items = useMemo(
    () => buildDividendArrivalItems(watchlist, events, todayStr(), handled, activeAccountId),
    [watchlist, events, handled, activeAccountId],
  )
  const total = items.reduce((sum, item) => sum + item.net, 0)

  const markHandled = (arrivalItems: DividendArrivalItem[]) => {
    setHandled(previous => {
      const next = new Set(previous)
      arrivalItems.forEach(item => next.add(arrivalKey(activeAccountId, item)))
      saveHandled(next)
      return next
    })
  }

  const close = () => markHandled(items)
  const confirm = () => {
    for (const item of items) {
      if (item.recorded) continue
      const stock = useStore.getState().watchlist.find(candidate => candidate.code === item.code)
      if (!stock) continue
      const txs = ensureTransactions(stock)
      setTransactions(stock.code, [...txs, buildArrivalTransaction(item, stock)])
    }
    markHandled(items)
  }

  return (
    <Modal
      open={enabled && items.length > 0}
      onClose={close}
      footer={(
        <button onClick={confirm} className="btn-primary w-full">
          开心收下
        </button>
      )}
    >
      <div className="relative overflow-hidden rounded-2xl bg-amber-50 px-5 pb-5 pt-6">
        <div className="absolute -right-5 -top-7 h-24 w-24 rounded-full border-[18px] border-amber-200/60" />
        <div className="relative">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-medium tracking-[0.18em] text-amber-700">DIVIDEND ARRIVAL</div>
              <h2 className="mt-1 text-xl font-bold text-gray-900">近期分红喜报</h2>
              <p className="mt-1 text-xs text-gray-500">已实施方案，登记日后5天内可确认</p>
            </div>
            <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-sm">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                <circle cx="12" cy="12" r="8" />
                <path d="M9 9.5h6M9 12.5h6M12 7v10" strokeLinecap="round" />
              </svg>
            </div>
          </div>

          <div className="mb-5 border-l-2 border-red-600 pl-4">
            <div className="text-xs text-gray-500">预计到账合计</div>
            <div className="mt-1 text-3xl font-bold tabular-nums text-red-600">¥{total.toFixed(2)}</div>
          </div>

          <div className="space-y-2">
            {items.map(item => (
              <div key={`${item.code}@${item.recordDate}`} className="flex items-center justify-between gap-3 border-t border-amber-200/70 pt-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <div className="truncate text-sm font-medium text-gray-800">{item.name}</div>
                    {item.recorded && <span className="shrink-0 text-[10px] font-medium text-emerald-600">已记录</span>}
                  </div>
                  <div className="mt-0.5 text-[11px] text-gray-500">预计到账日 {item.paymentDate}</div>
                  <div className="mt-0.5 text-[11px] text-gray-500">{item.qty}股 × ¥{item.perShare.toFixed(4)}</div>
                </div>
                <div className="shrink-0 text-sm font-semibold tabular-nums text-gray-900">¥{item.net.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-3 px-1 text-[11px] leading-relaxed text-gray-400">
        金额按股权登记日持仓和当前税务设置估算，请以券商实际到账为准。
      </p>
    </Modal>
  )
}
