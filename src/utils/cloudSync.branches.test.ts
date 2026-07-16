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

// 假 CloudBase db：记录 add/update/remove/set 调用，模拟最终状态
type Doc = { _id: string; data?: unknown; updatedAt?: number }
const state: { docs: Doc[]; calls: { add: Doc[]; update: { id: string }[]; remove: string[]; set: string[] } } = {
  docs: [], calls: { add: [], update: [], remove: [], set: [] },
}
let idSeq = 0

// 可变的假登录态：默认已登录 uid=u1；置 null 可模拟「拿不到 uid → 走兜底旧逻辑」
// 用 vi.hoisted 提升，供 vi.mock 工厂在返回对象里直接引用（否则 TDZ 报错）
const fakeAuth = vi.hoisted(() => ({ currentUser: { uid: 'u1' } as { uid: string } | null }))
const fakeStore = vi.hoisted(() => ({
  state: {
    watchlist: [] as unknown[], accounts: [] as unknown[], manualStocks: [] as unknown[],
    staticEdits: {} as Record<string, unknown>, hiddenStocks: [] as unknown[], customSectors: [] as unknown[],
    gridPrefs: {}, simStrategy: {}, gatherAccounts: () => [] as unknown[],
    importBackup(data: Record<string, unknown>) {
      fakeStore.state.watchlist = (data.watchlist as unknown[]) || []
      fakeStore.state.accounts = (data.accounts as unknown[]) || []
      fakeStore.state.manualStocks = (data.discoveryManualStocks as unknown[]) || []
    },
  },
}))

vi.mock('../store', () => ({ useStore: { getState: () => fakeStore.state } }))
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
        set: async (u: Partial<Doc>) => {
          state.calls.set.push(id)
          const d = state.docs.find(x => x._id === id)
          if (d) { Object.assign(d, u); return { updated: 1 } }
          state.docs.push({ ...u, _id: id }); return { upserted: id }
        },
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
  return {
    cbAuth: fakeAuth,
    cbDb: { collection: () => collection() },
    USER_DATA_COLLECTION: 'userData',
  }
})

import { activateUserStorage, deactivateUserStorage, loadFromCloud, saveToCloud, shouldPullRemote } from './cloudSync'

const META = 'cloud-sync-meta'

beforeEach(() => {
  state.docs = []
  state.calls = { add: [], update: [], remove: [], set: [] }
  idSeq = 0
  fakeAuth.currentUser = { uid: 'u1' } // 默认已登录
  for (const k of Object.keys(mem)) delete mem[k]
  fakeStore.state.watchlist = []
  fakeStore.state.accounts = []
})

describe('浏览器多登录账号隔离', () => {
  it('事故 UID 的污染快照只清理一次，之后新产生的正常快照不再被删除', () => {
    const uid = '2069395240412368898'
    fakeStore.state.watchlist = [{ code: 'POISONED' }]
    mem['cloud-sync-active-uid'] = uid
    mem['cloud-sync-user-backup:' + uid] = JSON.stringify({ watchlist: [{ code: 'POISONED' }] })
    mem[META] = JSON.stringify({ updatedAt: 1, docId: uid })
    activateUserStorage(uid)
    expect(fakeStore.state.watchlist).toEqual([])
    expect(mem['cloud-sync-user-backup:' + uid]).toBeUndefined()
    expect(mem['cloud-sync-local-purge:' + uid]).toBe('2026-07-16-v1')

    mem['cloud-sync-user-backup:' + uid] = JSON.stringify({ watchlist: [{ code: 'FUTURE' }] })
    mem['cloud-sync-active-uid'] = 'another-user'
    activateUserStorage(uid)
    expect(fakeStore.state.watchlist).toEqual([{ code: 'FUTURE' }])
  })

  it('升级旧版本时用 meta.docId 识别旧数据主人，新账号得到空仓', () => {
    fakeStore.state.watchlist = [{ code: 'OLD' }]
    mem[META] = JSON.stringify({ updatedAt: 10, docId: 'old-uid' })
    activateUserStorage('new-uid')
    expect(fakeStore.state.watchlist).toEqual([])
    expect(JSON.parse(mem['cloud-sync-user-backup:old-uid']).watchlist).toEqual([{ code: 'OLD' }])
    expect(mem['cloud-sync-active-uid']).toBe('new-uid')
    expect(mem[META]).toBeUndefined()
  })

  it('退出保存本账号快照并清空公共页面，重新登录恢复自己的快照', () => {
    fakeStore.state.watchlist = [{ code: 'U1' }]
    mem[META] = JSON.stringify({ updatedAt: 20, docId: 'u1' })
    mem['cloud-sync-active-uid'] = 'u1'
    deactivateUserStorage('u1')
    expect(fakeStore.state.watchlist).toEqual([])
    activateUserStorage('u1')
    expect(fakeStore.state.watchlist).toEqual([{ code: 'U1' }])
    expect(JSON.parse(mem[META]).docId).toBe('u1')
  })
})

describe('跨端版本保护', () => {
  it('仅当云端更新时间严格更新时拉取，避免旧 H5 内存覆盖小程序更新', () => {
    expect(shouldPullRemote(200, 100)).toBe(true)
    expect(shouldPullRemote(100, 100)).toBe(false)
    expect(shouldPullRemote(99, 100)).toBe(false)
  })
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

describe('saveToCloud（uid 幂等 upsert：根因修复）', () => {
  it('已登录：写入命中 doc(uid).set，永不 add，落到 _id=uid 一条', async () => {
    const id = await saveToCloud({ x: 1 } as never, 5)
    expect(id).toBe('u1')
    expect(state.calls.set).toEqual(['u1'])
    expect(state.calls.add).toHaveLength(0)
    expect(state.docs.map(d => d._id)).toEqual(['u1'])
  })

  it('历史随机 id 旧副本：set 到 uid 并删掉旧副本，最终只剩 uid 一条', async () => {
    state.docs = [{ _id: 'legacy-rand', data: { a: 1 }, updatedAt: 1 }]
    mem[META] = JSON.stringify({ updatedAt: 1, docId: 'legacy-rand' })
    const id = await saveToCloud({ x: 2 } as never, 5)
    expect(id).toBe('u1')
    expect(state.calls.set).toEqual(['u1'])
    expect(state.calls.remove).toEqual(['legacy-rand']) // 旧副本被清
    expect(state.docs.map(d => d._id)).toEqual(['u1'])
  })

  it('已经是 uid 文档：再次保存只覆盖，不删除、不新增', async () => {
    state.docs = [{ _id: 'u1', updatedAt: 1 }]
    mem[META] = JSON.stringify({ updatedAt: 1, docId: 'u1' })
    await saveToCloud({ x: 3 } as never, 9)
    expect(state.calls.set).toEqual(['u1'])
    expect(state.calls.remove).toEqual([])
    expect(state.calls.add).toHaveLength(0)
    expect(state.docs).toHaveLength(1)
  })

  it('根因验证：多设备/多标签并发保存 → 全部命中同一 uid，零新增、只剩一条', async () => {
    await Promise.all([
      saveToCloud({ x: 1 } as never, 1),
      saveToCloud({ x: 2 } as never, 2),
      saveToCloud({ x: 3 } as never, 3),
    ])
    expect(state.calls.add).toHaveLength(0)
    expect(state.docs.map(d => d._id)).toEqual(['u1']) // 物理上不可能造出第二条
  })
})

describe('saveToCloud（拿不到 uid 的兜底旧逻辑）', () => {
  beforeEach(() => { fakeAuth.currentUser = null })

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

  it('根因验证：两次并发保存（初始无 docId）→ 串行化后只新增 1 条', async () => {
    await Promise.all([
      saveToCloud({ x: 1 } as never, 1),
      saveToCloud({ x: 2 } as never, 2),
    ])
    expect(state.calls.add).toHaveLength(1)
    expect(state.docs).toHaveLength(1)
  })
})
