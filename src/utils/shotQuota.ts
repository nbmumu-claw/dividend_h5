// 截图录入每日限次：存 CloudBase（前端 SDK 读写，同点赞思路）。
// 表 parseTradeUsage 权限 PRIVATE（仅创建者可读写），doc = `${uid}_${date}`。
// 跨设备统一、清缓存不清零；仍属软限制（前端写，理论上能改自己那条），硬上限是 OCR 资源包。
import { cbDb } from './cloudbase'

const COLLECTION = 'parseTradeUsage'
export const SHOT_DAILY_LIMIT = 2

const today = () => new Date().toISOString().slice(0, 10)
const docId = (uid: string) => `${uid}_${today()}`

// 读今日已用次数；读失败按 0（宁松不误伤，真正兜底是 OCR 包）
export async function getShotUsage(uid: string): Promise<number> {
  try {
    const res = await cbDb.collection(COLLECTION).doc(docId(uid)).get()
    const d = Array.isArray(res.data) ? res.data[0] : res.data
    return (d as { count?: number } | undefined)?.count ?? 0
  } catch { return 0 }
}

// 计一次：原子自增；当天首次无 doc 则创建 count=1
export async function bumpShotUsage(uid: string): Promise<void> {
  const id = docId(uid)
  try {
    const r = await cbDb.collection(COLLECTION).doc(id).update({ count: cbDb.command.inc(1) })
    if (!(r as { updated?: number }).updated) {
      await cbDb.collection(COLLECTION).doc(id).set({ count: 1, uid, date: today() })
    }
  } catch { /* 记次失败不阻断使用 */ }
}
