import { useEffect, useState } from 'react'
import {
  canUseAccountBinding,
  createAccountBindingCode,
  loadMiniProgramBindings,
  removeMiniProgramBindings,
  type MiniProgramBinding,
} from '../utils/accountBinding'

interface Props {
  email?: string
  showToast: (message: string) => void
}

export default function MiniProgramBindingCard({ email, showToast }: Props) {
  const [allowed, setAllowed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [bindings, setBindings] = useState<MiniProgramBinding[]>([])
  const [code, setCode] = useState('')
  const [expiresAt, setExpiresAt] = useState(0)

  const refresh = async () => {
    try {
      const ok = await canUseAccountBinding()
      setAllowed(ok)
      if (ok) setBindings(await loadMiniProgramBindings())
    } catch {
      setAllowed(false)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  if (loading || !allowed) return null

  const generate = async () => {
    try {
      const result = await createAccountBindingCode(email)
      setCode(result.code)
      setExpiresAt(result.expiresAt)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '生成绑定码失败')
    }
  }

  const copy = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      showToast('绑定码已复制')
    } catch { showToast('复制失败，请手动输入') }
  }

  const unbind = async () => {
    if (!bindings.length) return
    if (!window.confirm('确定解除小程序绑定？\n\n只会撤销授权，不会删除 H5 或小程序中的持仓数据。')) return
    try {
      await removeMiniProgramBindings(bindings)
      setBindings([])
      setCode('')
      showToast('已解除小程序绑定')
    } catch { showToast('解绑失败，请稍后重试') }
  }

  const minutes = Math.max(1, Math.ceil((expiresAt - Date.now()) / 60000))

  return (
    <div className="mx-4 mb-4 card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-800">绑定微信小程序</div>
          <div className="text-xs text-gray-400 mt-1">
            {bindings.length ? `已绑定 · ${bindings[0].wxOpenidMasked || '微信账号'}` : '将当前邮箱账号授权给小程序'}
          </div>
        </div>
        {bindings.length > 0 && (
          <button onClick={unbind} className="text-xs text-red-500 border border-red-100 rounded-full px-3 py-1">解除绑定</button>
        )}
      </div>

      {bindings.length === 0 && (
        <div className="mt-3">
          {code ? (
            <div className="rounded-xl bg-gray-50 p-3 text-center">
              <button onClick={copy} className="font-mono text-xl font-bold tracking-[0.18em] text-gray-900">{code}</button>
              <div className="text-[11px] text-gray-400 mt-1">在小程序“我的”中输入，约 {minutes} 分钟内有效</div>
              <button onClick={generate} className="text-xs text-gray-500 mt-2">重新生成</button>
            </div>
          ) : (
            <button onClick={generate} className="w-full rounded-xl bg-red-600 text-white text-sm font-medium py-2.5">生成一次性绑定码</button>
          )}
        </div>
      )}
    </div>
  )
}
