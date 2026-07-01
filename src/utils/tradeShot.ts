// 成交截图录入共用逻辑（持仓详情页按本股过滤、自选页全局匹配都用它）
import { fileToBase64Downscaled } from './image'

// 截图录入暂仅对渔人开放（uid 灰度）
export const FISHERMAN_UID = '2069679426588643328'

export type ParsedTrade = { name: string; type: 'buy' | 'sell'; qty: number; price: number; date: string; time?: string | null }

// 名称模糊匹配（截图只有股票名、无代码）
export function nameMatch(a: string, b: string): boolean {
  return !!a && !!b && (a.includes(b) || b.includes(a))
}

// 由日期(+可选时间)构造交易时间戳；无时间默认按 15:00（收盘）
export function buildTs(date: string, time?: string | null): number {
  const [y, mo, d] = date.split('-').map(Number)
  let H = 15, M = 0, S = 0
  if (time) { const [h, mi, s] = String(time).split(':').map(Number); if (!isNaN(h)) { H = h; M = mi || 0; S = s || 0 } }
  return new Date(y, (mo || 1) - 1, d || 1, H, M, S).getTime()
}

// 上传成交截图 → 后端百度OCR+DeepSeek → 返回识别到的真实买卖（未按股票过滤）。失败抛错。
export async function parseTradeScreenshot(file: File, uid: string | null): Promise<ParsedTrade[]> {
  const image = await fileToBase64Downscaled(file)
  const resp = await fetch('/api/parse-trade', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, uid }),
  })
  if (!resp.ok) throw new Error('parse failed')
  const { trades } = await resp.json() as { trades: ParsedTrade[] }
  return trades || []
}
