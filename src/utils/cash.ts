import type { WatchlistStock } from '../types'
import { afterTax } from './tax'
import { dividendShares, type Transaction } from './holdings'
import { makeFeeCalc, type FeeConfig } from './fees'
import { isShB, isSzB } from './market'

export type CashCurrency = 'CNY' | 'USD' | 'HKD'
export type CashBalances = Record<CashCurrency, number>

export const EMPTY_CASH: CashBalances = { CNY: 0, USD: 0, HKD: 0 }
export const CASH_CURRENCIES: CashCurrency[] = ['CNY', 'USD', 'HKD']

export function normalizeCash(value: unknown): CashBalances {
  if (typeof value === 'number') return { CNY: Math.max(0, value), USD: 0, HKD: 0 }
  const data = value && typeof value === 'object' ? value as Partial<CashBalances> : {}
  return {
    CNY: Math.max(0, Number(data.CNY) || 0),
    USD: Math.max(0, Number(data.USD) || 0),
    HKD: Math.max(0, Number(data.HKD) || 0),
  }
}

export function currencyOf(stock: WatchlistStock): CashCurrency {
  if (stock.isUS || isShB(stock.code)) return 'USD'
  if (stock.isHK) return stock.cashCurrency ?? 'CNY'
  if (isSzB(stock.code)) return 'HKD'
  return 'CNY'
}

/** 一只股票全部交易带来的现金变化（正数为流入）。 */
export function transactionCashFlow(stock: WatchlistStock, txs: Transaction[], feeConfig: FeeConfig): number {
  const feeCalc = makeFeeCalc(stock, feeConfig)
  return txs.reduce((sum, tx) => {
    const qty = Number(tx.qty) || 0
    const price = Number(tx.price) || 0
    if (qty <= 0) return sum
    if (tx.type === 'dividend') return sum + afterTax(dividendShares(txs, tx) * price, stock)
    const amount = qty * price
    const fee = feeCalc?.(tx.type, amount) || 0
    return sum + (tx.type === 'buy' ? -amount - fee : amount - fee)
  }, 0)
}
