import { describe, it, expect } from 'vitest'
import { migrateStatsScope } from './statsScopeMigrate'

describe('migrateStatsScope（布尔美股开关→三态，v8→v9，无损兼容）', () => {
  it('旧 includeUsInStats === false（关闭=不计美股）→ 只看非美股', () => {
    const o: Record<string, unknown> = { includeUsInStats: false }
    migrateStatsScope(o)
    expect(o.statsScope).toBe('nonus')
    expect('includeUsInStats' in o).toBe(false) // 旧字段清除
  })

  it('旧 includeUsInStats === true（纳入）→ 全部', () => {
    const o: Record<string, unknown> = { includeUsInStats: true }
    migrateStatsScope(o)
    expect(o.statsScope).toBe('all')
    expect('includeUsInStats' in o).toBe(false)
  })

  it('从未设置过（老早版本，无该字段）→ 全部', () => {
    const o: Record<string, unknown> = {}
    migrateStatsScope(o)
    expect(o.statsScope).toBe('all')
  })

  it('已有 statsScope 时不覆盖（幂等，且不被残留旧布尔干扰）', () => {
    const o: Record<string, unknown> = { statsScope: 'us', includeUsInStats: false }
    migrateStatsScope(o)
    expect(o.statsScope).toBe('us') // 保留用户已选
    expect('includeUsInStats' in o).toBe(false)
  })

  it('幂等：连跑两次结果一致', () => {
    const o: Record<string, unknown> = { includeUsInStats: false }
    migrateStatsScope(o)
    migrateStatsScope(o)
    expect(o.statsScope).toBe('nonus')
  })

  it('空/非对象安全，不抛错', () => {
    expect(() => migrateStatsScope(null)).not.toThrow()
    expect(() => migrateStatsScope(undefined)).not.toThrow()
    expect(() => migrateStatsScope({})).not.toThrow()
  })
})
