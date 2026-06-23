/**
 * 选择"添加股票时预填"的每股年分红 — 移植自小程序 utils/dividendFill.js
 *
 * 输入：dividendHistory 的 records（按 year 降序），market 'A'/'HK'/'US'/'ETF'
 * 输出：每股年分红（0 表示无可用值）
 *
 * 规则：
 *   - A 股 / ETF / 港股：records 已按财年合并（中期+末期），records[0] 即最新完整财年
 *   - 美股：按自然年聚合，当年可能不完整：
 *       · 仅 1 年 → 用它
 *       · 最新一年明显低于次新年（< 70%）→ 用次新年（避免预填到半年数据）
 *       · 其他 → records[0]
 */
import type { Market } from './sectorPredictor'

export function pickDividendForFill(records: { year: number; perShare: number }[], mkt: Market): number {
  if (!records || records.length === 0) return 0

  if (mkt === 'A' || mkt === 'ETF' || mkt === 'HK') {
    return records[0].perShare || 0
  }

  if (records.length === 1) return records[0].perShare || 0

  const [latest, prev] = records
  const currentYear = new Date().getFullYear()
  if (latest.year === currentYear && latest.perShare < prev.perShare * 0.7) {
    return prev.perShare || 0
  }
  return latest.perShare || 0
}
