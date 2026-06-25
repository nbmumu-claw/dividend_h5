// B 股支持：纯代码段识别，无需额外标记字段

/** 沪市 B 股（900xxx，美元计价） */
export function isShB(code: string): boolean { return /^900/.test(String(code).padStart(6, '0')) }

/** 深市 B 股（200xxx，港币计价） */
export function isSzB(code: string): boolean { return /^200/.test(String(code).padStart(6, '0')) }

/** 是否为 B 股 */
export function isBShare(code: string): boolean { return isShB(code) || isSzB(code) }

type StockLike = { code: string; isHK?: boolean; isUS?: boolean }

/** 展示所用的货币符号 */
export function currencySymbol(stock: StockLike): string {
  if (stock.isUS) return '$'
  if (stock.isHK) return 'HK$'
  if (isSzB(stock.code)) return 'HK$'
  if (isShB(stock.code)) return '$'
  return '¥'
}

/** 原始价格换算为人民币（用于汇总、对比） */
export function toCnyPrice(price: number, stock: StockLike, hkdRate: number, usdRate: number): number {
  if (stock.isHK) return price * hkdRate
  if (stock.isUS) return price * usdRate
  if (isSzB(stock.code)) return price * hkdRate
  if (isShB(stock.code)) return price * usdRate
  return price
}

/** B 股红利税 10%，与港户户头一致 */
export const B_TAX_RATE = 0.10
