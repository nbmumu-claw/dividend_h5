import { cbDb } from './cloudbase'

// 页面全局点赞：全用户累加，同一设备一次（localStorage 记一票）
const COLLECTION = 'appStats'
const DOC_ID = 'grid-likes'
const LIKED_KEY = 'yg-liked'
const INTERIM_LIKED_KEY = 'interim-report-liked'

type LikeField = 'count' | 'interimReportCount'
type LikesDocument = Partial<Record<LikeField, number>>

function readLikesDocument(data: LikesDocument | LikesDocument[] | undefined): LikesDocument | undefined {
  return Array.isArray(data) ? data[0] : data
}

async function getLikeCount(field: LikeField): Promise<number> {
  try {
    const res = await cbDb.collection(COLLECTION).doc(DOC_ID).get()
    const doc = readLikesDocument(res.data as LikesDocument | LikesDocument[] | undefined)
    return doc?.[field] ?? 0
  } catch { return 0 }
}

async function addLikeCount(field: LikeField, likedKey: string): Promise<number> {
  const res = await cbDb.collection(COLLECTION).doc(DOC_ID).update({ [field]: cbDb.command.inc(1) })
  if (!res.updated) throw new Error('点赞失败')
  try { localStorage.setItem(likedKey, '1') } catch { /* ignore */ }
  return getLikeCount(field)
}

export function hasLiked(): boolean {
  try { return localStorage.getItem(LIKED_KEY) === '1' } catch { return false }
}

export async function getLikes(): Promise<number> {
  return getLikeCount('count')
}

export async function addLike(): Promise<number> {
  return addLikeCount('count', LIKED_KEY)
}

export function hasInterimReportLiked(): boolean {
  try { return localStorage.getItem(INTERIM_LIKED_KEY) === '1' } catch { return false }
}

export async function getInterimReportLikes(): Promise<number> {
  return getLikeCount('interimReportCount')
}

export async function addInterimReportLike(): Promise<number> {
  return addLikeCount('interimReportCount', INTERIM_LIKED_KEY)
}
