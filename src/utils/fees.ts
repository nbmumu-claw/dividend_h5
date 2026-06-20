// 交易手续费（仅 A/B 股）：买入=佣金+过户费；卖出=佣金+过户费+印花税
// 计入摊薄成本：买入/卖出 netAmount 都 += fee（见 holdings.ts）
import type { WatchlistStock } from '../types'

export interface FeeConfig {
  enabled: boolean
  commissionRate: number // 券商佣金费率（如万2.5 = 0.00025），可自定义
  min5Free: boolean      // 是否免最低5元
  allIn: boolean         // 全佣：佣金已含交易所规费，不再单独加规费
  allInTransfer: boolean // 全佣是否也含过户费（含则不再单独加过户费）
}

export const DEFAULT_FEE_CONFIG: FeeConfig = { enabled: false, commissionRate: 0.00025, min5Free: false, allIn: false, allInTransfer: false }

// 国家统一标准（固定）
const STAMP_RATE = 0.0005       // 印花税：卖出 0.05%（ETF 免）
const TRANSFER_RATE = 0.00001   // 过户费：双向 0.001%
const REGULATORY_RATE = 0.0000541 // 交易所规费：双向 0.00541%（经手费0.341‱ + 证管费0.2‱）

export type FeeCalc = (type: 'buy' | 'sell', amount: number) => number

/** 构造单笔费用计算器；未启用或港股/美股返回 null（不计费） */
export function makeFeeCalc(stock: WatchlistStock, config: FeeConfig): FeeCalc | null {
  if (!config.enabled) return null
  if (stock.isHK || stock.isUS) return null
  return (type, amount) => {
    if (amount <= 0) return 0 // 负成本/异常不计费
    let commission = amount * config.commissionRate
    if (!config.min5Free) commission = Math.max(commission, 5)
    let fee = commission
    // 全佣：佣金已含交易所规费，不再单独加
    if (!config.allIn) fee += amount * REGULATORY_RATE
    // 全佣且勾选含过户费时，过户费已含；否则单独加
    if (!(config.allIn && config.allInTransfer)) fee += amount * TRANSFER_RATE
    if (type === 'sell' && !stock.isETF) fee += amount * STAMP_RATE
    return fee
  }
}
