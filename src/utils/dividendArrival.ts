import type { WatchlistStock } from '../types'
import type { DividendEvent } from './dividendCalendar'
import { afterTax } from './tax'
import { ensureTransactions, sharesAsOf, type Transaction } from './holdings'

const DAY = 86400000

export interface DividendArrivalItem {
  code: string
  name: string
  recordDate: string
  paymentDate: string
  perShare: number
  qty: number
  net: number
}

export const arrivalKey = (accountId: string, item: Pick<DividendArrivalItem, 'code' | 'recordDate'>) =>
  `${accountId}:${item.code}@${item.recordDate}`

const endOfDayTs = (date: string) => new Date(`${date}T23:59:59.999`).getTime()

export function isDividendRecorded(transactions: Transaction[] | undefined, recordDate: string): boolean {
  const recordTs = endOfDayTs(recordDate)
  return (transactions || []).some(t => t.type === 'dividend' && Math.abs((t.ts || 0) - recordTs) <= 7 * DAY)
}

export function buildDividendArrivalItems(
  stocks: WatchlistStock[],
  events: DividendEvent[],
  today: string,
  handledKeys: Set<string>,
  accountId: string,
): DividendArrivalItem[] {
  const byCode = new Map(stocks.map(stock => [stock.code, stock]))
  const items: DividendArrivalItem[] = []

  for (const event of events) {
    if (event.status !== 'confirmed' || event.isHK || event.isUS || event.paymentDate !== today) continue
    const stock = byCode.get(event.code)
    if (!stock) continue
    const txs = ensureTransactions(stock)
    const itemKey = arrivalKey(accountId, event)
    if (handledKeys.has(itemKey) || isDividendRecorded(txs, event.recordDate)) continue
    const qty = sharesAsOf(txs, endOfDayTs(event.recordDate))
    if (qty <= 0) continue
    items.push({
      code: event.code,
      name: event.name || stock.name,
      recordDate: event.recordDate,
      paymentDate: event.paymentDate,
      perShare: event.perShare,
      qty,
      net: afterTax(event.perShare, stock) * qty,
    })
  }

  return items.sort((a, b) => b.net - a.net)
}

export function buildArrivalTransaction(item: DividendArrivalItem, stock: WatchlistStock): Transaction {
  return {
    type: 'dividend',
    qty: item.qty,
    price: afterTax(item.perShare, stock),
    ts: endOfDayTs(item.recordDate),
    gross: item.perShare,
  }
}
