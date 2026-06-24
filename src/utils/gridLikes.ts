import { cbDb } from './cloudbase'

// 网格页全局点赞：全用户累加，同一设备一次（localStorage 记一票）
const COLLECTION = 'appStats'
const DOC_ID = 'grid-likes'
const LIKED_KEY = 'yg-liked'

export function hasLiked(): boolean {
  try { return localStorage.getItem(LIKED_KEY) === '1' } catch { return false }
}
function markLiked() { try { localStorage.setItem(LIKED_KEY, '1') } catch { /* ignore */ } }

export async function getLikes(): Promise<number> {
  try {
    const res = await cbDb.collection(COLLECTION).doc(DOC_ID).get()
    const d = res.data as { count?: number } | { count?: number }[] | undefined
    const doc = Array.isArray(d) ? d[0] : d
    return doc?.count ?? 0
  } catch { return 0 }
}

export async function addLike(): Promise<number> {
  const res = await cbDb.collection(COLLECTION).doc(DOC_ID).update({ count: cbDb.command.inc(1) })
  if (!res.updated) throw new Error('点赞失败')
  markLiked()
  return getLikes()
}
