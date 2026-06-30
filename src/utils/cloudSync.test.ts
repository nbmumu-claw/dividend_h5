import { describe, it, expect } from 'vitest'
import { pickLatest } from './dedup'

// 自愈去重的安全关键性质：最新（updatedAt 最大）那条永远是 latest、永远不进 stale
describe('pickLatest（同一用户多条文档去重选择）', () => {
  it('空数组：无 latest、无 stale', () => {
    expect(pickLatest([])).toEqual({ latest: null, stale: [] })
  })

  it('单条：原样保留、无冗余', () => {
    const a = { _id: 'a', updatedAt: 100 }
    expect(pickLatest([a])).toEqual({ latest: a, stale: [] })
  })

  it('多条乱序：选 updatedAt 最大者，其余全部为 stale', () => {
    const a = { _id: 'a', updatedAt: 100 }
    const b = { _id: 'b', updatedAt: 300 } // 最新
    const c = { _id: 'c', updatedAt: 200 }
    const { latest, stale } = pickLatest([a, b, c])
    expect(latest).toBe(b)
    expect(stale.map(d => d._id).sort()).toEqual(['a', 'c'])
  })

  it('真实场景：36 条里只留最新 1 条，删 35 条，且 latest 不在 stale 里', () => {
    const docs = Array.from({ length: 36 }, (_, i) => ({ _id: `d${i}`, updatedAt: 1_700_000_000_000 + i * 1000 }))
    const { latest, stale } = pickLatest(docs)
    expect(latest!._id).toBe('d35') // updatedAt 最大
    expect(stale).toHaveLength(35)
    expect(stale).not.toContainEqual(latest)
  })

  it('缺失 updatedAt 当作 0：有时间戳的那条胜出、不会误删', () => {
    const noTs = { _id: 'old' } as { _id: string; updatedAt?: number }
    const real = { _id: 'real', updatedAt: 5 }
    const { latest, stale } = pickLatest([noTs, real])
    expect(latest).toBe(real)
    expect(stale).toEqual([noTs])
  })

  it('不修改入参数组', () => {
    const docs = [{ _id: 'a', updatedAt: 1 }, { _id: 'b', updatedAt: 2 }]
    const copy = [...docs]
    pickLatest(docs)
    expect(docs).toEqual(copy)
  })
})
