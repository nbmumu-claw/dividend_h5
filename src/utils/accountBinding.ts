import { cbDb } from './cloudbase'
import { getCurrentUid } from './cloudSync'

export const ACCOUNT_BINDING_ALLOWED_UIDS = new Set([
  '2069679426588643328', // 渔人
  '2069652702966587392', // 渔人 test
  '2077682590818500608', // 阿木
])

const TOKEN_COLLECTION = 'accountBindingTokens'
const BINDING_COLLECTION = 'userIdentityBindings'
const TOKEN_TTL_MS = 5 * 60 * 1000
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export interface MiniProgramBinding {
  _id: string
  h5Uid: string
  emailMasked?: string
  wxOpenidMasked?: string
  status: 'active'
  createdAt?: unknown
  updatedAt?: unknown
}

export function maskEmail(email?: string): string {
  if (!email || !email.includes('@')) return '当前 H5 账号'
  const [name, domain] = email.split('@')
  const head = name.slice(0, Math.min(2, name.length))
  return `${head}${name.length > 2 ? '***' : '*'}@${domain}`
}

function randomCode(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

export async function canUseAccountBinding(): Promise<boolean> {
  const uid = await getCurrentUid()
  return !!uid && ACCOUNT_BINDING_ALLOWED_UIDS.has(uid)
}

export async function loadMiniProgramBindings(): Promise<MiniProgramBinding[]> {
  const uid = await getCurrentUid()
  if (!uid || !ACCOUNT_BINDING_ALLOWED_UIDS.has(uid)) return []
  const res = await cbDb.collection(BINDING_COLLECTION)
    .where({ h5Uid: uid, status: 'active' })
    .limit(10)
    .get()
  return (res.data || []) as MiniProgramBinding[]
}

export async function createAccountBindingCode(email?: string): Promise<{ code: string; expiresAt: number }> {
  const uid = await getCurrentUid()
  if (!uid || !ACCOUNT_BINDING_ALLOWED_UIDS.has(uid)) throw new Error('当前账号未开放小程序绑定')

  const code = randomCode()
  const normalized = code.toUpperCase()
  const tokenHash = await sha256(normalized)
  const expiresAt = Date.now() + TOKEN_TTL_MS

  await cbDb.collection(TOKEN_COLLECTION).doc(tokenHash).set({
    h5Uid: uid,
    emailMasked: maskEmail(email),
    expiresAt,
    usedAt: null,
    createdAt: Date.now(),
  })

  return { code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt }
}

export async function removeMiniProgramBindings(bindings: MiniProgramBinding[]): Promise<void> {
  await Promise.all(bindings.map(binding => cbDb.collection(BINDING_COLLECTION).doc(binding._id).remove()))
}
