import type { Transaction } from './holdings'

interface Lot {
  qty: number
  acquiredAt: number
  dividends: number[]
}

export interface DividendTaxEstimate {
  tax: number
  withinMonth: number
  withinYear: number
  dividendCount: number
  availableQty: number
}

function addMonths(ts: number, count: number): number {
  const date = new Date(ts)
  return new Date(date.getFullYear(), date.getMonth() + count, date.getDate()).getTime()
}

function dayStart(ts: number): number {
  const date = new Date(ts)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function consumeLots(lots: Lot[], qty: number): Lot[] {
  let remaining = qty
  const next: Lot[] = []
  for (const lot of lots) {
    if (remaining <= 0) {
      next.push(lot)
      continue
    }
    if (lot.qty <= remaining) {
      remaining -= lot.qty
      continue
    }
    next.push({ ...lot, qty: lot.qty - remaining })
    remaining = 0
  }
  return next
}

/**
 * 估算一笔拟卖出对应的 A 股分红税。
 * 依据已录入流水按先进先出匹配买入批次；同日买入先抵扣卖出数量，
 * 分红只统计卖出日前已记录的毛额。
 */
export function estimateDividendTax(transactions: Transaction[] | undefined, saleTs: number, saleQty: number): DividendTaxEstimate {
  let lots: Lot[] = []
  let dividendCount = 0
  const saleDay = dayStart(saleTs)
  const sameDayBuyQty = (transactions || []).reduce((sum, transaction) => (
    transaction.type === 'buy' && dayStart(transaction.ts || 0) === saleDay
      ? sum + Math.max(0, Number(transaction.qty) || 0)
      : sum
  ), 0)
  const ordered = (transactions || [])
    .map((transaction, index) => ({ transaction, index }))
    .filter(({ transaction }) => dayStart(transaction.ts || 0) < saleDay)
    .sort((a, b) => ((a.transaction.ts || 0) - (b.transaction.ts || 0)) || (a.index - b.index))

  for (const { transaction } of ordered) {
    const qty = Number(transaction.qty) || 0
    if (transaction.type === 'buy' && qty > 0) {
      lots.push({ qty, acquiredAt: transaction.ts, dividends: [] })
    } else if (transaction.type === 'sell' && qty > 0) {
      lots = consumeLots(lots, qty)
    } else if (transaction.type === 'dividend') {
      const grossPerShare = Number(transaction.gross ?? transaction.price) || 0
      if (grossPerShare <= 0 || lots.length === 0) continue
      lots = lots.map(lot => ({ ...lot, dividends: [...lot.dividends, grossPerShare] }))
      dividendCount += 1
    }
  }

  const availableQty = lots.reduce((sum, lot) => sum + lot.qty, 0) + sameDayBuyQty
  let remaining = Math.max(0, saleQty - sameDayBuyQty)
  let withinMonth = 0
  let withinYear = 0
  for (const lot of lots) {
    if (remaining <= 0) break
    const matchedQty = Math.min(remaining, lot.qty)
    const gross = lot.dividends.reduce((sum, perShare) => sum + matchedQty * perShare, 0)
    if (dayStart(saleTs) <= addMonths(lot.acquiredAt, 1)) withinMonth += gross
    else if (dayStart(saleTs) <= addMonths(lot.acquiredAt, 12)) withinYear += gross
    remaining -= matchedQty
  }

  return {
    tax: withinMonth * 0.2 + withinYear * 0.1,
    withinMonth,
    withinYear,
    dividendCount,
    availableQty,
  }
}
