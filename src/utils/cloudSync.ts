import { cbAuth, cbDb, USER_DATA_COLLECTION } from './cloudbase'
import { pickLatest } from './dedup'
import { useStore } from '../store'

// 当前账号的同步元信息；账号切换时会归档到 USER_META_PREFIX + uid。
const META_KEY = 'cloud-sync-meta'
const ACTIVE_UID_KEY = 'cloud-sync-active-uid'
const USER_BACKUP_PREFIX = 'cloud-sync-user-backup:'
const USER_META_PREFIX = 'cloud-sync-user-meta:'
const LOCAL_PURGE_PREFIX = 'cloud-sync-local-purge:'
// 2026-07-16 浏览器跨账号缓存事故定向修复：每台设备仅清理一次，不影响该用户后续正常缓存。
const LOCAL_PURGE_VERSIONS: Record<string, string> = { '2069395240412368898': '2026-07-16-v1' }

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

function emptyBackup(): Backup {
  return {
    watchlist: [], accounts: [], discoveryManualStocks: [], discoveryStaticEdits: {},
    discoveryHiddenStocks: [], discoveryCustomSectors: undefined, gridPrefs: undefined, simStrategy: {},
  }
}

function applyPendingLocalPurge(uid: string) {
  const version = LOCAL_PURGE_VERSIONS[uid]
  if (!version || localStorage.getItem(LOCAL_PURGE_PREFIX + uid) === version) return false
  localStorage.removeItem(USER_BACKUP_PREFIX + uid)
  localStorage.removeItem(USER_META_PREFIX + uid)
  if (localStorage.getItem(ACTIVE_UID_KEY) === uid) {
    useStore.getState().importBackup(emptyBackup() as unknown as Record<string, unknown>)
    localStorage.removeItem(META_KEY)
    localStorage.removeItem(ACTIVE_UID_KEY)
  }
  localStorage.setItem(LOCAL_PURGE_PREFIX + uid, version)
  return true
}

/**
 * 同一浏览器切换 H5 用户时，把业务数据和同步游标按 uid 分仓。
 * 旧版本没有 ACTIVE_UID_KEY 时，可由确定性 docId 推断旧数据主人，避免把旧账号数据上传给新账号。
 */
export function activateUserStorage(uid: string) {
  if (!uid) return
  applyPendingLocalPurge(uid)
  const meta = loadMeta()
  const recorded = localStorage.getItem(ACTIVE_UID_KEY) || ''
  const previousUid = recorded || meta.docId || ''
  if (previousUid === uid) {
    localStorage.setItem(ACTIVE_UID_KEY, uid)
    return
  }
  if (previousUid) {
    localStorage.setItem(USER_BACKUP_PREFIX + previousUid, JSON.stringify(buildBackup()))
    localStorage.setItem(USER_META_PREFIX + previousUid, JSON.stringify(meta))
  }
  const savedBackup = localStorage.getItem(USER_BACKUP_PREFIX + uid)
  const savedMeta = localStorage.getItem(USER_META_PREFIX + uid)
  let backup: Backup = emptyBackup()
  if (savedBackup) {
    try { backup = JSON.parse(savedBackup) as Backup } catch { /* 损坏的单用户缓存按空数据处理，云端仍可恢复 */ }
  }
  useStore.getState().importBackup(backup as unknown as Record<string, unknown>)
  if (savedMeta) localStorage.setItem(META_KEY, savedMeta)
  else localStorage.removeItem(META_KEY)
  localStorage.setItem(ACTIVE_UID_KEY, uid)
  lastPushedJson = ''
}

/** 退出后归档当前用户数据，并把公共页面切回空白，防止下一个登录者先看到旧数据。 */
export function deactivateUserStorage(uid: string) {
  if (!uid) return
  localStorage.setItem(USER_BACKUP_PREFIX + uid, JSON.stringify(buildBackup()))
  localStorage.setItem(USER_META_PREFIX + uid, JSON.stringify(loadMeta()))
  useStore.getState().importBackup(emptyBackup() as unknown as Record<string, unknown>)
  localStorage.removeItem(META_KEY)
  localStorage.removeItem(ACTIVE_UID_KEY)
  lastPushedJson = ''
}

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

export async function loadFromCloud(): Promise<CloudDoc | null> {
  // 历史竞态可能让同一用户存在多条文档：按 updatedAt 倒序取最新，避免读到旧快照
  const res = await cbDb.collection(USER_DATA_COLLECTION).orderBy('updatedAt', 'desc').limit(100).get()
  const all = (res.data || []) as Array<{ data: Backup; updatedAt?: number; _id: string }>
  const { latest, stale } = pickLatest(all)
  if (!latest) return null
  // 读时自愈：删除冗余副本（部署前已整体备份；删除失败下次登录再清）
  for (const d of stale) {
    try { await cbDb.collection(USER_DATA_COLLECTION).doc(d._id).remove() } catch { /* 下次再清 */ }
  }
  return { data: latest.data, updatedAt: latest.updatedAt || 0, _id: latest._id }
}

// 串行化所有云端保存：同一时刻只允许一个保存在跑，杜绝并发各自 add 造成重复文档（根因修复）
let saveChain: Promise<unknown> = Promise.resolve()
export function saveToCloud(payload: Backup, updatedAt: number): Promise<string> {
  const run = saveChain.then(
    () => doSaveToCloud(payload, updatedAt),
    () => doSaveToCloud(payload, updatedAt),
  )
  saveChain = run.catch(() => { /* 保持链路不因单次失败中断 */ })
  return run
}

// 取当前登录用户的 uid（= 云端 _openid）。currentUser 在刚开 App 时可能尚未就绪，兜底走 getLoginState。
async function resolveUid(): Promise<string | null> {
  const u = cbAuth.currentUser?.uid
  if (u) return u
  try { return (await cbAuth.getLoginState())?.user?.uid ?? null } catch { return null }
}

// 供 UI 做「当前登录用户」判断（如按 uid 灰度功能）。未登录返回 null。
export async function getCurrentUid(): Promise<string | null> {
  return resolveUid()
}

async function doSaveToCloud(payload: Backup, updatedAt: number): Promise<string> {
  // 根因修复：以 uid 作为确定性文档 _id，写入一律 set（幂等 upsert）。
  // 无论多少设备/标签并发写，都命中同一条 _id，物理上无法再造出第二条文档。
  const uid = await resolveUid()
  if (uid) {
    await cbDb.collection(USER_DATA_COLLECTION).doc(uid).set({ data: payload, updatedAt })
    const meta = loadMeta()
    // 过渡期：把历史随机 id 的旧副本删掉（本人自有文档，ACL 允许；失败下次登录 loadFromCloud 自愈）
    if (meta.docId && meta.docId !== uid) {
      try { await cbDb.collection(USER_DATA_COLLECTION).doc(meta.docId).remove() } catch { /* 下次再清 */ }
    }
    saveMeta({ updatedAt, docId: uid })
    return uid
  }

  // 兜底：极端情况下拿不到 uid（saveToCloud 仅登录态调用，理论不会走到）→ 保留旧「查-再-加」逻辑
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
  const uid = await resolveUid()
  if (!uid) throw new Error('无法识别当前登录账号')
  activateUserStorage(uid)
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
let pullPromise: Promise<boolean> | null = null
let remoteListenersAttached = false

export function shouldPullRemote(remoteUpdatedAt: number, localUpdatedAt: number): boolean {
  return Number(remoteUpdatedAt) > Number(localUpdatedAt)
}

async function doPullIfRemoteNewer(): Promise<boolean> {
  if (applyingRemote) return false
  const session = await getSession()
  if (!session || session.user?.is_anonymous) return false
  const cloud = await loadFromCloud()
  if (!cloud || !shouldPullRemote(cloud.updatedAt, loadMeta().updatedAt)) return false
  applyRemote(cloud.data, cloud.updatedAt, cloud._id)
  return true
}

function pullIfRemoteNewer(): Promise<boolean> {
  if (pullPromise) return pullPromise
  pullPromise = doPullIfRemoteNewer().finally(() => { pullPromise = null })
  return pullPromise
}

function onWindowFocus() {
  pullIfRemoteNewer().catch(() => {})
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') onWindowFocus()
}

function attachRemoteListeners() {
  if (remoteListenersAttached || typeof window === 'undefined' || typeof document === 'undefined') return
  window.addEventListener('focus', onWindowFocus)
  document.addEventListener('visibilitychange', onVisibilityChange)
  remoteListenersAttached = true
}

function detachRemoteListeners() {
  if (!remoteListenersAttached || typeof window === 'undefined' || typeof document === 'undefined') return
  window.removeEventListener('focus', onWindowFocus)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  remoteListenersAttached = false
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(async () => {
    const session = await getSession()
    if (!session) return
    // 小程序可能刚更新同一份 H5 云文档。上传前先比较版本，绝不用旧内存覆盖较新的云端。
    if (await pullIfRemoteNewer()) return
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
  if (!unsub) {
    lastPushedJson = JSON.stringify(buildBackup())
    unsub = useStore.subscribe(() => {
      if (applyingRemote) return
      schedulePush()
    })
  }
  attachRemoteListeners()
}
export function stopAutoPush() {
  if (unsub) { unsub(); unsub = null }
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null }
  detachRemoteListeners()
}
