import { useState, useRef, useEffect } from 'react'
import Modal from './Modal'
import { cbAuth } from '../utils/cloudbase'

type Mode = 'login' | 'register' | 'otp'
type VerifyOtp = (arg: { token: string }) => Promise<{ data?: unknown; error?: { message?: string } | null }>

// 记住用户名/密码（存本机，仅本设备；密码为明文本地存储，勾选即视为你信任本设备）
const REMEMBER_KEY = 'auth-remember'
interface Remembered { email?: string; password?: string; rememberEmail?: boolean; rememberPwd?: boolean }
function loadRemembered(): Remembered {
  try { return JSON.parse(localStorage.getItem(REMEMBER_KEY) || '{}') } catch { return {} }
}
function saveRemembered(r: Remembered) { try { localStorage.setItem(REMEMBER_KEY, JSON.stringify(r)) } catch { /* ignore */ } }

interface Props {
  open: boolean
  onClose: () => void
  onAuthed: () => void
}

const TABS: { key: Mode; label: string }[] = [
  { key: 'login', label: '登录' },
  { key: 'register', label: '注册' },
  { key: 'otp', label: '验证码登录' },
]

export default function AuthModal({ open, onClose, onAuthed }: Props) {
  const [mode, setMode] = useState<Mode>('login')
  const [step, setStep] = useState<'form' | 'code'>('form') // 注册/验证码登录的二步
  const [email, setEmail] = useState(() => { const r = loadRemembered(); return r.rememberEmail ? (r.email || '') : '' })
  const [password, setPassword] = useState(() => { const r = loadRemembered(); return r.rememberPwd ? (r.password || '') : '' })
  const [nickname, setNickname] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [rememberEmail, setRememberEmail] = useState(() => !!loadRemembered().rememberEmail)
  const [rememberPwd, setRememberPwd] = useState(() => !!loadRemembered().rememberPwd)
  const verifyRef = useRef<VerifyOtp | null>(null)

  // 记住密码必然记住用户名；取消记住用户名则一并取消记住密码
  const toggleRememberEmail = (v: boolean) => { setRememberEmail(v); if (!v) setRememberPwd(false) }
  const toggleRememberPwd = (v: boolean) => { setRememberPwd(v); if (v) setRememberEmail(true) }
  const persistRemember = () => {
    const prev = loadRemembered()
    saveRemembered({
      rememberEmail,
      rememberPwd,
      email: rememberEmail ? (email || prev.email) : undefined,
      password: rememberPwd ? (password || prev.password) : undefined,
    })
  }

  const reset = () => { setStep('form'); setPassword(''); setCode(''); setErr(''); verifyRef.current = null }
  const switchMode = (m: Mode) => { setMode(m); reset() }
  const close = () => { reset(); setEmail(''); setNickname(''); onClose() }

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

  const finish = () => { persistRemember(); setLoading(false); onAuthed(); close() }

  // 每次打开登录框，按本机记忆回填邮箱/密码与勾选状态
  useEffect(() => {
    if (!open) return
    const r = loadRemembered()
    setRememberEmail(!!r.rememberEmail)
    setRememberPwd(!!r.rememberPwd)
    if (r.rememberEmail && r.email) setEmail(r.email)
    if (r.rememberPwd && r.password) setPassword(r.password)
  }, [open])

  // 密码登录
  const doLogin = async () => {
    setLoading(true); setErr('')
    const { error } = await cbAuth.signInWithPassword({ email, password })
    if (error) { setLoading(false); setErr(error.message || '登录失败'); return }
    finish()
  }

  // 注册：发验证码
  const doRegisterSend = async () => {
    setLoading(true); setErr('')
    const { data, error } = await cbAuth.signUp({ email, password, nickname: nickname || email.split('@')[0] }) as { data?: { verifyOtp?: VerifyOtp }; error?: { message?: string } }
    setLoading(false)
    if (error) { setErr(error.message || '注册失败'); return }
    verifyRef.current = data?.verifyOtp || null
    setStep('code')
  }

  // 验证码登录（兼忘记密码）：发验证码
  const doOtpSend = async () => {
    setLoading(true); setErr('')
    const { data, error } = await cbAuth.signInWithOtp({ email }) as { data?: { verifyOtp?: VerifyOtp }; error?: { message?: string } }
    setLoading(false)
    if (error) { setErr(error.message || '发送失败'); return }
    verifyRef.current = data?.verifyOtp || null
    setStep('code')
  }

  // 输入验证码后完成
  const doVerify = async () => {
    if (!verifyRef.current) { setErr('请先获取验证码'); return }
    setLoading(true); setErr('')
    const { error } = await verifyRef.current({ token: code })
    if (error) { setLoading(false); setErr(error.message || '验证码错误'); return }
    // 注册：验证完成后强制设一次昵称（signUp 阶段的 nickname 不一定生效）
    if (mode === 'register' && nickname.trim()) {
      try { await cbAuth.updateUser({ nickname: nickname.trim() }) } catch { /* 失败可后续在设置里改 */ }
    }
    finish()
  }

  return (
    <Modal open={open} onClose={close} title="登录 / 注册以云端同步">
      {/* tabs */}
      <div className="flex items-center gap-1 mb-4 bg-gray-100 rounded-lg p-1">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => switchMode(t.key)}
            className={`flex-1 text-sm py-1.5 rounded-md transition-colors ${mode === t.key ? 'bg-white text-gray-900 font-medium shadow-sm' : 'text-gray-500'}`}
          >{t.label}</button>
        ))}
      </div>

      {step === 'form' ? (
        <div className="space-y-3">
          <input className="input-field" type="email" inputMode="email" placeholder="邮箱" value={email} onChange={e => setEmail(e.target.value)} />
          {mode !== 'otp' && (
            <div className="relative">
              <input
                className="input-field pr-10"
                type={showPwd ? 'text' : 'password'}
                placeholder="密码"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 p-1"
                onClick={() => setShowPwd(v => !v)}
              >
                {showPwd ? (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeLinecap="round" strokeLinejoin="round"/>
                    <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
            </div>
          )}
          {mode === 'login' && (
            <div className="flex items-center gap-4 px-0.5">
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                <input type="checkbox" className="accent-red-500 w-3.5 h-3.5" checked={rememberEmail} onChange={e => toggleRememberEmail(e.target.checked)} />
                记住用户名
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                <input type="checkbox" className="accent-red-500 w-3.5 h-3.5" checked={rememberPwd} onChange={e => toggleRememberPwd(e.target.checked)} />
                记住密码
              </label>
            </div>
          )}
          {mode === 'register' && (
            <input className="input-field" type="text" placeholder="昵称（显示名，可留空）" value={nickname} onChange={e => setNickname(e.target.value)} />
          )}
          {mode === 'otp' && (
            <p className="text-xs text-gray-400">忘记密码？用验证码直接登录，进去后可在设置里改密码。</p>
          )}
          {err && <p className="text-xs text-red-500">{err}</p>}
          <button
            className="btn-primary w-full py-2.5 rounded-xl"
            disabled={loading || !emailOk || (mode !== 'otp' && password.length < 6)}
            onClick={mode === 'login' ? doLogin : mode === 'register' ? doRegisterSend : doOtpSend}
          >
            {loading ? '处理中…' : mode === 'login' ? '登录' : mode === 'register' ? '发送验证码' : '发送验证码'}
          </button>
          {mode !== 'otp' && <p className="text-[11px] text-gray-300 text-center">密码至少 6 位</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">验证码已发送到 <span className="text-gray-800">{email}</span></p>
          <input className="input-field" type="text" inputMode="numeric" placeholder="邮箱验证码" value={code} onChange={e => setCode(e.target.value)} />
          {err && <p className="text-xs text-red-500">{err}</p>}
          <button className="btn-primary w-full py-2.5 rounded-xl" disabled={loading || !code} onClick={doVerify}>
            {loading ? '验证中…' : mode === 'register' ? '完成注册' : '登录'}
          </button>
          <button className="w-full text-xs text-gray-400 py-1" onClick={() => { setStep('form'); setErr('') }}>返回</button>
        </div>
      )}
    </Modal>
  )
}
