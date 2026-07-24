import { useMemo, useState } from 'react'
import { useStore } from '../store'
import type { WatchlistStock } from '../types'
import { estimateDividendTax } from './dividendTax'
import { ensureTransactions, type Transaction } from './holdings'
import { isAShare } from './market'

const DISMISS_KEY = 'dividend-tax-dismissed'

export interface PendingDividendTax {
  code: string
  saleDate: string
  saleTs: number
  qty: number
  tax: number
}

function dateOf(ts: number): string {
  const date = new Date(ts)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function keyOf(code: string, saleDate: string): string {
  return `${code}@${saleDate}`
}

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch { return new Set() }
}

function saveDismissed(dismissed: Set<string>) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...dismissed])) } catch { /* 忽略本地状态写入失败 */ }
}

export function findPendingDividendTax(stock: WatchlistStock, dismissed: Set<string> = new Set()): PendingDividendTax | null {
  if (!isAShare(stock)) return null
  const transactions = ensureTransactions(stock)
  const salesByDate = new Map<string, { qty: number; ts: number }>()
  for (const transaction of transactions) {
    if (transaction.type !== 'sell' || !(Number(transaction.qty) > 0)) continue
    const saleDate = dateOf(transaction.ts)
    const previous = salesByDate.get(saleDate)
    salesByDate.set(saleDate, {
      qty: (previous?.qty || 0) + Number(transaction.qty),
      ts: Math.max(previous?.ts || 0, transaction.ts),
    })
  }

  const dates = [...salesByDate.entries()].sort((a, b) => b[1].ts - a[1].ts)
  for (const [saleDate, sale] of dates) {
    if (dismissed.has(keyOf(stock.code, saleDate))) continue
    const alreadyRecorded = transactions.some(transaction => transaction.type === 'dividendTax' && dateOf(transaction.ts) === saleDate)
    if (alreadyRecorded) continue
    const estimate = estimateDividendTax(transactions, sale.ts, sale.qty)
    if (estimate.tax <= 0) continue
    return { code: stock.code, saleDate, saleTs: sale.ts, qty: sale.qty, tax: estimate.tax }
  }
  return null
}

export function usePendingDividendTax(stock: WatchlistStock) {
  const setTransactions = useStore(state => state.setTransactions)
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed)
  const item = useMemo(() => findPendingDividendTax(stock, dismissed), [dismissed, stock])

  const confirm = (pending: PendingDividendTax) => {
    const transactions = ensureTransactions(stock)
    const transaction: Transaction = { type: 'dividendTax', qty: pending.qty, price: pending.tax, ts: pending.saleTs }
    setTransactions(stock.code, [...transactions, transaction])
  }

  const dismiss = (pending: PendingDividendTax) => {
    setDismissed(previous => {
      const next = new Set(previous)
      next.add(keyOf(pending.code, pending.saleDate))
      saveDismissed(next)
      return next
    })
  }

  return { item, confirm, dismiss }
}
