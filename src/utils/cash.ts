import type { WatchlistStock } from '../types'
import { afterTax } from './tax'
import { dividendShares, type Transaction } from './holdings'
import { makeFeeCalc, type FeeConfig } from './fees'
import { isShB, isSzB } from './market'

export type CashCurrency = 'CNY' | 'USD' | 'HKD'
export type CashBalances = Record<CashCurrency, number>
export type CashFundingCurrencies = Record<CashCurrency, boolean>
export interface CashCalibration {
  id: string
  currency: CashCurrency
  previousBalance: number
  actualBalance: number
  difference: number
  ts: number
}

export const EMPTY_CASH: CashBalances = { CNY: 0, USD: 0, HKD: 0 }
export const EMPTY_CASH_FUNDING: CashFundingCurrencies = { CNY: false, USD: false, HKD: false }
export const CASH_CURRENCIES: CashCurrency[] = ['CNY', 'USD', 'HKD']

/** 按收益统计范围把现金统一折算成人民币。 */
export function cashCnyInScope(balance: CashBalances, scope: 'all' | 'us' | 'nonus', hkdRate: number, usdRate: number): number {
  if (scope === 'us') return balance.USD * usdRate
  if (scope === 'nonus') return balance.CNY + balance.HKD * hkdRate
  return balance.CNY + balance.USD * usdRate + balance.HKD * hkdRate
}

export function normalizeCash(value: unknown): CashBalances {
  if (typeof value === 'number') return { CNY: Number.isFinite(value) ? value : 0, USD: 0, HKD: 0 }
  const data = value && typeof value === 'object' ? value as Partial<CashBalances> : {}
  return {
    CNY: Number.isFinite(Number(data.CNY)) ? Number(data.CNY) : 0,
    USD: Number.isFinite(Number(data.USD)) ? Number(data.USD) : 0,
    HKD: Number.isFinite(Number(data.HKD)) ? Number(data.HKD) : 0,
  }
}

export function normalizeCashFunding(value: unknown): CashFundingCurrencies {
  const data = value && typeof value === 'object' ? value as Partial<CashFundingCurrencies> : {}
  return {
    CNY: Boolean(data.CNY),
    USD: Boolean(data.USD),
    HKD: Boolean(data.HKD),
  }
}

export function normalizeCashCalibrations(value: unknown): CashCalibration[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const data = item as Partial<CashCalibration>
    if (!CASH_CURRENCIES.includes(data.currency as CashCurrency)) return []
    const previousBalance = Number(data.previousBalance)
    const actualBalance = Number(data.actualBalance)
    if (!Number.isFinite(previousBalance) || !Number.isFinite(actualBalance)) return []
    return [{
      id: typeof data.id === 'string' ? data.id : `legacy_cal_${index}`,
      currency: data.currency as CashCurrency,
      previousBalance,
      actualBalance,
      difference: actualBalance - previousBalance,
      ts: Number.isFinite(Number(data.ts)) ? Number(data.ts) : 0,
    }]
  })
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
    if (tx.type === 'dividendTax') return sum - price
    const amount = qty * price
    const fee = feeCalc?.(tx.type, amount) || 0
    return sum + (tx.type === 'buy' ? -amount - fee : amount - fee)
  }, 0)
}
