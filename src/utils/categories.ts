// 标的三大类（弱周期 / 强周期 / 消费）归类
// 解析优先级：用户手动覆盖 > 个股默认表 > 板块兜底 > 未分类
// 统计口径：仅 A 股 / 港股；美股（isUS）与 ETF（含「红利ETF / 美股指数」）不纳入。
// 移植自小程序 utils/categories.js（手动覆盖改由 store 持久化传入）

export type Category = 'weak' | 'strong' | 'consume'
export const CATEGORIES: Category[] = ['weak', 'strong', 'consume']
export const CATEGORY_LABEL: Record<Category, string> = { weak: '弱周期', strong: '强周期', consume: '消费' }
export const CATEGORY_COLORS: Record<Category, string> = { weak: '#3B82F6', strong: '#E03025', consume: '#F59E0B' }
export const UNCLASSIFIED = '' as const
export const UNCLASSIFIED_LABEL = '未分类'
export const UNCLASSIFIED_COLOR = '#9CA3AF'

// 个股默认表（key = code）。电力锚点必须精确（电力板块兜底为「未分类」）
const STOCK_DEFAULTS: Record<string, Category> = {
  // 消费
  '000333': 'consume', // 美的集团
  '000651': 'consume', // 格力电器
  '000538': 'consume', // 云南白药
  '600066': 'consume', // 宇通客车
  // 弱周期（公用事业 + 通信 + 大行）
  '600941': 'weak',    // 中国移动
  '0728': 'weak',      // 中国电信 H
  '600036': 'weak',    // 招商银行
  // 弱周期 · 电力（水电 / 核电）
  '600900': 'weak',    // 长江电力
  '600886': 'weak',    // 国投电力
  '600674': 'weak',    // 川投能源
  '003816': 'weak',    // 中国广核
  '601985': 'weak',    // 中国核电
  // 强周期（能源 / 资源）
  '601088': 'strong',  // 中国神华
  '601225': 'strong',  // 陕西煤业
  '600938': 'strong',  // 中国海油
  '601899': 'strong',  // 紫金矿业
  // 强周期 · 电力（火电）
  '600795': 'strong',  // 国电电力
  '600863': 'strong',  // 华能蒙电
  '600011': 'strong',  // 华能国际
  // 强周期 · 运输（航运）
  '601919': 'strong',  // 中远海控 A
  '1919': 'strong',    // 中远海控 港
}

// 板块兜底表（个股默认表未命中时按 sector 归）
const SECTOR_FALLBACK: Record<string, Category> = {
  银行: 'weak',
  通讯: 'weak',
  能源: 'strong',
  有色金属: 'strong',
  保险: 'strong',
  白酒: 'consume',
  白色家电: 'consume',
  中药: 'consume',
  // 电力 / 运输 / 其他：细分差异大，不兜底 → 未分类
}

interface StockLike { code: string; sector?: string; isUS?: boolean; isHK?: boolean }

/** 该标的是否纳入三大类统计（排除美股与 ETF / 美股指数） */
export function isIncluded(stock: StockLike | undefined | null): boolean {
  if (!stock) return false
  if (stock.isUS) return false
  const sector = (stock.sector || '').trim()
  if (sector === 'ETF' || sector === '红利ETF' || sector === '美股指数' || sector === '美股') return false
  return true
}

/** 解析某标的的大类，'' = 未分类 */
export function resolveCategory(stock: StockLike, manual: Record<string, string>): Category | '' {
  if (!isIncluded(stock)) return UNCLASSIFIED
  const code = String(stock.code)
  const m = manual[code]
  if (m && (CATEGORIES as string[]).includes(m)) return m as Category
  if (STOCK_DEFAULTS[code]) return STOCK_DEFAULTS[code]
  const sector = (stock.sector || '').trim()
  if (SECTOR_FALLBACK[sector]) return SECTOR_FALLBACK[sector]
  return UNCLASSIFIED
}

export function labelOf(cat: Category | ''): string {
  return cat ? CATEGORY_LABEL[cat] : UNCLASSIFIED_LABEL
}

export function colorOf(cat: Category | ''): string {
  return cat ? CATEGORY_COLORS[cat] : UNCLASSIFIED_COLOR
}
