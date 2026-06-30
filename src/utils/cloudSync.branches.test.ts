import { describe, it, expect, beforeEach, vi } from 'vitest'

// 内存 localStorage（loadMeta/saveMeta 依赖）
const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (k in mem ? mem[k] : null),
  setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] },
  clear: () => { for (const k of Object.keys(mem)) delete mem[k] },
  key: () => null,
  length: 0,
} as Storage

// 假 CloudBase db：记录 add/update/remove 调用，模拟最终状态
type Doc = { _id: string; data?: unknown; updatedAt?: number }
const state: { docs: Doc[]; calls: { add: Doc[]; update: { id: string }[]; remove: string[] } } = {
  docs: [], calls: { add: [], update: [], remove: [] },
}
let idSeq = 0

vi.mock('../store', () => ({ useStore: { getState: () => ({}) } }))
vi.mock('./cloudbase', () => {
  const collection = () => {
    const api: Record<string, unknown> = {
      orderBy: () => api,
      limit: () => api,
      get: async () => ({ data: state.docs.slice() }),
      add: async (doc: Omit<Doc, '_id'>) => {
        const _id = 'doc' + (++idSeq)
        const full = { ...doc, _id }
        state.docs.push(full); state.calls.add.push(full)
        return { _id }
      },
      doc: (id: string) => ({
        update: async (u: Partial<Doc>) => {
          state.calls.update.push({ id })
          const d = state.docs.find(x => x._id === id)
          if (!d) return { updated: 0 }
          Object.assign(d, u)
          return { updated: 1 }
        },
        remove: async () => {
          state.calls.remove.push(id)
          state.docs = state.docs.filter(x => x._id !== id)
          return { deleted: 1 }
        },
      }),
    }
    return api
  }
  return { cbAuth: {}, cbDb: { collection: () => collection() }, USER_DATA_COLLECTION: 'userData' }
})

import { loadFromCloud, saveToCloud } from './cloudSync'

const META = 'cloud-sync-meta'

beforeEach(() => {
  state.docs = []
  state.calls = { add: [], update: [], remove: [] }
  idSeq = 0
  for (const k of Object.keys(mem)) delete mem[k]
})

describe('loadFromCloud（读取 + 读时自愈）', () => {
  it('云端空：返回 null、不删任何文档', async () => {
    expect(await loadFromCloud()).toBeNull()
    expect(state.calls.remove).toEqual([])
  })

  it('正常单文档用户：原样返回、绝不删除（与旧行为等价）', async () => {
    state.docs = [{ _id: 'd1', data: { a: 1 }, updatedAt: 100 }]
    const r = await loadFromCloud()
    expect(r?._id).toBe('d1')
    expect(state.calls.remove).toEqual([]) // 关键：单文档用户无感、零删除
  })

  it('多文档：返回最新一条，删除其余冗余', async () => {
    state.docs = [
      { _id: 'old', updatedAt: 100 },
      { _id: 'new', updatedAt: 300 },
      { _id: 'mid', updatedAt: 200 },
    ]
    const r = await loadFromCloud()
    expect(r?._id).toBe('new') // 最新
    expect(state.calls.remove.sort()).toEqual(['mid', 'old']) // 旧的被删
    expect(state.docs.map(d => d._id)).toEqual(['new']) // 只剩最新
  })
})

describe('saveToCloud（写入分支）', () => {
  it('有本地 docId 且文档存在：走 update，不新增', async () => {
    state.docs = [{ _id: 'd1', updatedAt: 1 }]
    mem[META] = JSON.stringify({ updatedAt: 1, docId: 'd1' })
    const id = await saveToCloud({ x: 1 } as never, 5)
    expect(id).toBe('d1')
    expect(state.calls.add).toHaveLength(0)
    expect(state.calls.update.map(u => u.id)).toContain('d1')
  })

  it('本地 docId 指向已删文档：update 返回 0 → 兜底新增', async () => {
    mem[META] = JSON.stringify({ updatedAt: 1, docId: 'ghost' })
    await saveToCloud({ x: 1 } as never, 5)
    expect(state.calls.add).toHaveLength(1)
  })

  it('无 docId 但云端已有：复用现有文档 update，不新增', async () => {
    state.docs = [{ _id: 'd9', updatedAt: 1 }]
    const id = await saveToCloud({ x: 1 } as never, 5)
    expect(id).toBe('d9')
    expect(state.calls.add).toHaveLength(0)
  })

  it('无 docId 且云端空：新增一条', async () => {
    await saveToCloud({ x: 1 } as never, 5)
    expect(state.calls.add).toHaveLength(1)
    expect(state.docs).toHaveLength(1)
  })

  it('根因验证：两次并发保存（初始无 docId）→ 只新增 1 条', async () => {
    await Promise.all([
      saveToCloud({ x: 1 } as never, 1),
      saveToCloud({ x: 2 } as never, 2),
    ])
    expect(state.calls.add).toHaveLength(1) // 串行化后第二次看到 docId → update
    expect(state.docs).toHaveLength(1)
  })
})
