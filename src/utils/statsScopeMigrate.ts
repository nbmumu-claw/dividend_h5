// 收益页统计范围：全部 / 只看美股 / 只看非美股
export type StatsScope = 'all' | 'us' | 'nonus'

// 迁移（v8→v9）：旧布尔开关「美股纳入收益统计」→ 三态 statsScope。幂等、无副作用地就地改写。
// 语义对齐：旧 includeUsInStats === false（关闭 = 不计美股）→ 只看非美股；true / 未设 → 全部。
export function migrateStatsScope(obj: Record<string, unknown> | null | undefined): void {
  if (!obj || typeof obj !== 'object') return
  if (obj.statsScope === undefined) {
    obj.statsScope = obj.includeUsInStats === false ? 'nonus' : 'all'
  }
  delete obj.includeUsInStats
}
