import { cbAuth, cbDb, USER_DATA_COLLECTION } from './cloudbase'
import { useStore } from '../store'

// 本地同步元信息：记录上次同步时间与云端文档 id（与登录账号无关，按设备存）
const META_KEY = 'cloud-sync-meta'

interface SyncMeta { updatedAt: number; docId: string | null }
interface Backup {
  watchlist: unknown[]
  accounts: unknown
  discoveryManualStocks: unknown
  discoveryStaticEdits: unknown
  discoveryHiddenStocks: unknown
  discoveryCustomSectors: unknown
  gridPrefs?: unknown
  simStrategy?: unknown
}

function loadMeta(): SyncMeta {
  try { const m = JSON.parse(localStorage.getItem(META_KEY) || ''); return { updatedAt: m.updatedAt || 0, docId: m.docId || null } }
  catch { return { updatedAt: 0, docId: null } }
}
function saveMeta(m: SyncMeta) { try { localStorage.setItem(META_KEY, JSON.stringify(m)) } catch { /* ignore */ } }
export function clearMeta() { try { localStorage.removeItem(META_KEY) } catch { /* ignore */ } }

// 构造与「设置→导出备份」一致的数据快照
function buildBackup(): Backup {
  const s = useStore.getState()
  return {
    watchlist: s.watchlist,
    accounts: s.gatherAccounts(),
    discoveryManualStocks: s.manualStocks,
    discoveryStaticEdits: s.staticEdits,
    discoveryHiddenStocks: s.hiddenStocks,
    discoveryCustomSectors: s.customSectors,
    gridPrefs: s.gridPrefs,
    simStrategy: s.simStrategy,
  }
}
function backupHasData(b?: Backup | null): boolean {
  return !!b && (countStocks(b) > 0)
}
// 统计所有账户的持仓/自选总数（用于判断数据是否骤减）
function countStocks(b?: Backup | null): number {
  if (!b) return 0
  let n = Array.isArray(b.watchlist) ? b.watchlist.length : 0
  const accs = (b.accounts as { watchlist?: unknown[] }[]) || []
  for (const a of accs) n += Array.isArray(a.watchlist) ? a.watchlist.length : 0
  return n
}

export async function getSession() {
  const { data } = await cbAuth.getSession()
  return data?.session ?? null
}

interface CloudDoc { data: Backup; updatedAt: number; _id: string }
async function loadFromCloud(): Promise<CloudDoc | null> {
  const res = await cbDb.collection(USER_DATA_COLLECTION).get()
  const doc = (res.data && res.data[0]) as { data: Backup; updatedAt?: number; _id: string } | undefined
  return doc ? { data: doc.data, updatedAt: doc.updatedAt || 0, _id: doc._id } : null
}

async function saveToCloud(payload: Backup, updatedAt: number): Promise<string> {
  const meta = loadMeta()
  if (meta.docId) {
    const r = await cbDb.collection(USER_DATA_COLLECTION).doc(meta.docId).update({ data: payload, updatedAt }) as { updated?: number }
    if (r && r.updated === 0) {
      // 文档已不存在（被删），改为新增
      const add = await cbDb.collection(USER_DATA_COLLECTION).add({ data: payload, updatedAt }) as unknown as { _id: string }
      saveMeta({ updatedAt, docId: add._id })
      return add._id
    }
    saveMeta({ updatedAt, docId: meta.docId })
    return meta.docId
  }
  // 没有本地 docId：先看云端是否已有（可能另一设备建过），避免重复新增
  const existing = await loadFromCloud()
  if (existing) {
    await cbDb.collection(USER_DATA_COLLECTION).doc(existing._id).update({ data: payload, updatedAt })
    saveMeta({ updatedAt, docId: existing._id })
    return existing._id
  }
  const add = await cbDb.collection(USER_DATA_COLLECTION).add({ data: payload, updatedAt }) as unknown as { _id: string }
  saveMeta({ updatedAt, docId: add._id })
  return add._id
}

// 应用云端数据到本地 store（期间暂停自动上传，避免回环）
let applyingRemote = false
function applyRemote(data: Backup, updatedAt: number, docId: string) {
  applyingRemote = true
  try {
    useStore.getState().importBackup(data as unknown as Record<string, unknown>)
    saveMeta({ updatedAt, docId })
    lastPushedJson = JSON.stringify(buildBackup())
  } finally {
    setTimeout(() => { applyingRemote = false }, 0)
  }
}

export type SyncOutcome =
  | { action: 'pushed-initial' }   // 云端空，上传本地为初始（老用户首登）
  | { action: 'pulled' }           // 云端较新，已拉到本地
  | { action: 'pushed' }           // 本地较新，已上传
  | { action: 'conflict'; cloud: CloudDoc; local: Backup } // 首登且两边都有数据，需用户选

// 登录成功后调用：决定 拉 / 推 / 冲突
export async function syncOnLogin(): Promise<SyncOutcome> {
  const cloud = await loadFromCloud()
  const meta = loadMeta()
  const local = buildBackup()
  const firstSync = meta.updatedAt === 0 && !meta.docId

  if (!cloud) {
    // 云端空：上传本地（老用户本地数据被原样保留并上传，绝不丢）
    const now = Date.now()
    await saveToCloud(local, now)
    return { action: 'pushed-initial' }
  }

  // 老用户红线：首次同步且本地与云端都有数据 → 不自动覆盖，交给用户选
  if (firstSync && backupHasData(local) && backupHasData(cloud.data)) {
    saveMeta({ updatedAt: 0, docId: cloud._id })
    return { action: 'conflict', cloud, local }
  }

  // 云端更新、或时间相等（本地可能被异常清空但 meta 没更新）→ 一律以云端为准拉取，
  // 绝不用「时间相等的本地」覆盖云端，避免清空/异常状态把云端真实数据冲掉。
  // 仅当本地确有更晚的、已记录的改动（cloud < meta）才上传。
  if (cloud.updatedAt >= meta.updatedAt) {
    applyRemote(cloud.data, cloud.updatedAt, cloud._id)
    return { action: 'pulled' }
  }
  const now = Date.now()
  await saveToCloud(local, now)
  return { action: 'pushed' }
}

// 用户在冲突弹窗里的选择
export async function resolveConflict(useCloud: boolean, cloud: CloudDoc) {
  if (useCloud) {
    applyRemote(cloud.data, cloud.updatedAt, cloud._id)
  } else {
    const now = Date.now()
    saveMeta({ updatedAt: 0, docId: cloud._id })
    await saveToCloud(buildBackup(), now)
  }
}

// 自动上传：本地数据变化后 debounce 上传（登录态才生效）
let pushTimer: ReturnType<typeof setTimeout> | null = null
let lastPushedJson = ''
let unsub: (() => void) | null = null

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(async () => {
    const session = await getSession()
    if (!session) return
    const backup = buildBackup()
    const json = JSON.stringify(backup)
    if (json === lastPushedJson) return
    try {
      await saveToCloud(backup, Date.now())
      lastPushedJson = json
    } catch { /* 网络失败下次再传 */ }
  }, 4000)
}

export function startAutoPush() {
  if (unsub) return
  lastPushedJson = JSON.stringify(buildBackup())
  unsub = useStore.subscribe(() => {
    if (applyingRemote) return
    schedulePush()
  })
}
export function stopAutoPush() {
  if (unsub) { unsub(); unsub = null }
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null }
}
