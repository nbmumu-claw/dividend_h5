// 持仓交易 · 摊薄成本计算（移植自小程序 utils/holdings.js）
//
// transaction: { type: 'buy'|'sell'|'dividend', qty, price, ts, gross? }
//   - dividend（分红）：不改变持仓数量，金额(qty×price)冲减成本基数（除权降成本）
//
// 摊薄成本法：
//   净持仓     = Σ买入数量 − Σ卖出数量            （分红不影响）
//   摊薄成本价 = (Σ买入额 − Σ卖出额 − Σ分红额) ÷ 净持仓  （卖出/分红冲减，可为负=已回本）
//   净持仓≤0（清仓）→ 视为无持仓，成本价置空

import type { WatchlistStock } from '../types'
import type { FeeCalc } from './fees'

export type TxType = 'buy' | 'sell' | 'dividend'
export interface Transaction {
  type: TxType
  qty: number
  price: number
  ts: number
  gross?: number // 分红毛额（税前），便于编辑回填
}

export interface HoldingResult {
  shares: number
  costPrice: number | ''
  netAmount: number
  cleared: boolean
}

/** 截至某时间点（含）持有的净股数：只看该日期及之前的买入/卖出（分红不影响持仓） */
export function sharesAsOf(transactions: Transaction[] | undefined, ts: number): number {
  let shares = 0
  ;(transactions || []).forEach(t => {
    if (t.type === 'dividend') return
    if ((t.ts || 0) > ts) return
    const qty = Number(t.qty) || 0
    if (qty <= 0) return
    shares += t.type === 'sell' ? -qty : qty
  })
  return Math.max(0, shares)
}

/** 某笔分红实际作用的股数 = 分红日期当时的持仓（与记录顺序无关，只按日期） */
export function dividendShares(transactions: Transaction[] | undefined, div: Transaction): number {
  return sharesAsOf(transactions, div.ts || 0)
}

/** 由交易流水算出净持仓与摊薄成本（分红按「当时持仓」冲减，与录入顺序无关）
 *  传入 feeCalc 时，买入/卖出手续费计入成本（netAmount += fee）；不传则与原行为完全一致 */
export function computeHolding(transactions: Transaction[] | undefined, feeCalc?: FeeCalc | null): HoldingResult {
  const txs = transactions || []
  let shares = 0 // 净持仓数量（与顺序无关）
  let buySellAmount = 0 // Σ买入额 − Σ卖出额（+手续费）
  txs.forEach(t => {
    if (t.type === 'dividend') return
    const qty = Number(t.qty) || 0
    const price = Number(t.price) || 0
    if (qty <= 0) return
    shares += t.type === 'sell' ? -qty : qty
    const amount = qty * price
    const fee = feeCalc ? feeCalc(t.type, amount) : 0
    buySellAmount += (t.type === 'sell' ? -amount : amount) + fee
  })
  // 分红额：每笔按其日期当时持仓 × 每股分红
  let divAmount = 0
  txs.forEach(t => {
    if (t.type !== 'dividend') return
    divAmount += dividendShares(txs, t) * (Number(t.price) || 0)
  })
  const netAmount = buySellAmount - divAmount

  if (shares <= 0) {
    return { shares: Math.max(0, shares), costPrice: '', netAmount, cleared: true }
  }
  return { shares, costPrice: netAmount / shares, netAmount, cleared: false }
}

/** 迁移兜底：老数据没有 transactions 时，用既有 shares/costPrice 生成一笔初始买入（不落库） */
export function ensureTransactions(stock: WatchlistStock): Transaction[] {
  if (Array.isArray(stock.transactions)) return stock.transactions
  const shares = parseInt(String(stock.shares ?? ''), 10) || 0
  if (shares > 0) {
    const price = parseFloat(String(stock.costPrice ?? ''))
    return [{ type: 'buy', qty: shares, price: isFinite(price) ? price : 0, ts: Date.now() }]
  }
  return []
}

/** 把交易流水算出的持仓写回 stock，保持 shares/costPrice 与交易一致（下游沿用 shares/costPrice，无需改动） */
export function applyHolding(stock: WatchlistStock, transactions: Transaction[], feeCalc?: FeeCalc | null): WatchlistStock {
  const { shares, costPrice } = computeHolding(transactions, feeCalc)
  stock.transactions = transactions
  stock.shares = shares
  // 成本价：有持仓存数值字符串（可负），清仓存空串（下游按「未填成本」处理）
  stock.costPrice = costPrice === '' ? '' : String(Number(costPrice.toFixed(4)))
  return stock
}

export const TX_LABEL: Record<TxType, string> = { buy: '买入', sell: '卖出', dividend: '分红' }
