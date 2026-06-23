import { useEffect, useMemo, useState } from 'react'
import { fetchCalendarEvents } from './dividendCalendar'
import type { DividendEvent } from './dividendCalendar'
import { computeHolding, ensureTransactions, sharesAsOf, type Transaction } from './holdings'
import { afterTax } from './tax'
import { useStore } from '../store'
import type { WatchlistStock } from '../types'

const DISMISS_KEY = 'dividend-dismissed'
const DAY = 86400000
const WINDOW_AHEAD = 7   // 登记日前 7 天起提示
const WINDOW_BACK = 0    // 下限：今天起（登记日已过的历史分红不再提示）

export interface PendingDividend {
  code: string
  name: string
  isHK?: boolean
  recordDate: string  // YYYY-MM-DD
  perShare: number    // 税前每股
  qty: number         // 预填股数（截至登记日的持仓）
  net: number         // 税后到手总额（原币种）
}

function recordTs(recordDate: string): number {
  return new Date(recordDate + 'T12:00:00').getTime()
}

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch { return new Set() }
}
function saveDismissed(s: Set<string>) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...s])) } catch { /* ignore */ }
}
const keyOf = (code: string, recordDate: string) => `${code}@${recordDate}`

// 该股是否已录入登记日相近（±7 天）的分红
function alreadyRecorded(txs: Transaction[] | undefined, recordDate: string): boolean {
  const rt = recordTs(recordDate)
  return (txs || []).some(t => t.type === 'dividend' && Math.abs((t.ts || 0) - rt) <= 7 * DAY)
}

// 生成一笔分红交易（与 HoldingDetail.confirmTx 分红分支等价）
function buildDividendTx(txs: Transaction[], recordDate: string, perShare: number, stock: WatchlistStock): Transaction | null {
  const ts = recordTs(recordDate)
  const qty = sharesAsOf(txs, ts)
  if (qty <= 0) return null
  return { type: 'dividend', qty, price: afterTax(perShare, stock), ts, gross: perShare }
}

export function usePendingDividends(stocks: WatchlistStock[]) {
  const setTransactions = useStore(s => s.setTransactions)
  const [events, setEvents] = useState<DividendEvent[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed)

  // 仅有持仓的标的
  const holders = useMemo(
    () => stocks.filter(s => computeHolding(ensureTransactions(s)).shares > 0),
    [stocks],
  )
  const holderKey = holders.map(s => s.code).join(',')

  useEffect(() => {
    let alive = true
    if (holders.length === 0) { setEvents([]); return }
    Promise.all(holders.map(s => fetchCalendarEvents(s.code, s.name, s.isHK).catch(() => [])))
      .then(res => { if (alive) setEvents(res.flat()) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holderKey])

  const items = useMemo<PendingDividend[]>(() => {
    if (events.length === 0) return []
    const today0 = new Date(); today0.setHours(0, 0, 0, 0)
    const hi = today0.getTime() + WINDOW_AHEAD * DAY
    const lo = today0.getTime() - WINDOW_BACK * DAY
    const byCode = new Map(holders.map(s => [s.code, s]))
    const out: PendingDividend[] = []
    for (const e of events) {
      if (e.status !== 'confirmed') continue
      const stock = byCode.get(e.code)
      if (!stock) continue
      const rt = recordTs(e.recordDate)
      if (rt > hi || rt < lo) continue
      if (dismissed.has(keyOf(e.code, e.recordDate))) continue
      const txs = ensureTransactions(stock)
      if (alreadyRecorded(txs, e.recordDate)) continue
      const qty = sharesAsOf(txs, rt)
      if (qty <= 0) continue
      out.push({
        code: e.code,
        name: e.name || stock.name,
        isHK: stock.isHK,
        recordDate: e.recordDate,
        perShare: e.perShare,
        qty,
        net: afterTax(e.perShare, stock) * qty,
      })
    }
    return out.sort((a, b) => a.recordDate.localeCompare(b.recordDate))
  }, [events, holders, dismissed])

  const confirm = (item: PendingDividend) => {
    const stock = stocks.find(s => s.code === item.code)
    if (!stock) return
    const txs = ensureTransactions(stock)
    const tx = buildDividendTx(txs, item.recordDate, item.perShare, stock)
    if (!tx) return
    setTransactions(item.code, [...txs, tx])
  }

  const dismiss = (item: PendingDividend) => {
    setDismissed(prev => {
      const next = new Set(prev)
      next.add(keyOf(item.code, item.recordDate))
      saveDismissed(next)
      return next
    })
  }

  return { items, confirm, dismiss }
}
