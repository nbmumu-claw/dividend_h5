// 云端同步去重：从同一用户的多条文档中选出最新一条（updatedAt 最大），其余判为冗余。
// 安全关键：最新那条永远是 latest、永远不进 stale —— 自愈删除绝不会删掉真实最新数据。
export function pickLatest<T extends { updatedAt?: number }>(docs: T[]): { latest: T | null; stale: T[] } {
  if (!docs || docs.length === 0) return { latest: null, stale: [] }
  const sorted = docs.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  return { latest: sorted[0], stale: sorted.slice(1) }
}
