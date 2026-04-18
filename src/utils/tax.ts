import type { WatchlistStock } from '../types'

export const TAX_RATES = {
  aStock: 0,
  hkAccount: 0.10,
  hkConnectH: 0.20,
  hkConnectNonH: 0.28,
}

export function getTaxRate(stock: WatchlistStock): number {
  if (!stock.isHK) return TAX_RATES.aStock
  if (stock.taxType === 'a') return TAX_RATES.hkAccount
  if (stock.taxType === 'n') return TAX_RATES.hkConnectNonH
  return TAX_RATES.hkConnectH
}

export function getTaxLabel(stock: WatchlistStock): string {
  if (!stock.isHK) return '免税'
  if (stock.taxType === 'a') return '港户 10%'
  if (stock.taxType === 'n') return '非H股 28%'
  return 'H股 20%'
}

export function afterTax(amount: number, stock: WatchlistStock): number {
  return amount * (1 - getTaxRate(stock))
}

export function toCNY(hkdAmount: number, rate: number): number {
  return hkdAmount * rate
}
