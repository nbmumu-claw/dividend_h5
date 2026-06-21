import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import Modal from '../components/Modal'
import { Toast, useToast } from '../components/Toast'

const MAX_ACCOUNTS = 3

export default function AccountManager() {
  const navigate = useNavigate()
  const accounts = useStore(s => s.accounts)
  const activeAccountId = useStore(s => s.activeAccountId)
  const switchAccount = useStore(s => s.switchAccount)
  const addAccount = useStore(s => s.addAccount)
  const renameAccount = useStore(s => s.renameAccount)
  const removeAccount = useStore(s => s.removeAccount)
  const { message, showToast } = useToast()

  const [showAdd, setShowAdd] = useState(false)
  const [addName, setAddName] = useState('')
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameName, setRenameName] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const doAdd = () => {
    const id = addAccount(addName)
    setShowAdd(false); setAddName('')
    showToast(id ? '已新建并切换' : '账户已达上限')
  }
  const doRename = () => {
    if (renameId) renameAccount(renameId, renameName)
    setRenameId(null); showToast('已重命名')
  }
  const doDelete = () => {
    if (deleteId) removeAccount(deleteId)
    setDeleteId(null); showToast('已删除')
  }

  return (
    <div className="page-content">
      <div className="relative flex items-center px-4 pt-12 pb-4">
        <button onClick={() => navigate(-1)} className="p-1.5 text-gray-500">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="absolute inset-x-0 text-center pointer-events-none">
          <h1 className="text-base font-bold text-gray-900">账户管理</h1>
        </div>
      </div>

      <div className="px-4 pb-3">
        <p className="text-xs text-gray-400 leading-relaxed">
          每个账户的持仓记录互相独立，可分别管理；板块顺序、汇率、三大类分类、交易手续费等设置全局共享。最多 {MAX_ACCOUNTS} 个账户。
        </p>
      </div>

      <div className="px-4 mb-3">
        <div className="card">
          {accounts.map(a => {
            const active = a.id === activeAccountId
            return (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-50 last:border-0">
                <button className="flex-1 flex items-center gap-2 text-left" onClick={() => { switchAccount(a.id); showToast(`已切换到「${a.name}」`) }}>
                  <span className={`w-4 h-4 flex-shrink-0 ${active ? 'text-red-600' : 'text-transparent'}`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                  <span className={`text-sm ${active ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{a.name}</span>
                  {active && <span className="tag tag-red">当前</span>}
                </button>
                <button className="text-xs text-gray-400 px-2 py-1" onClick={() => { setRenameId(a.id); setRenameName(a.name) }}>改名</button>
                {accounts.length > 1 && (
                  <button className="text-xs text-red-400 px-2 py-1" onClick={() => setDeleteId(a.id)}>删除</button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="px-4">
        <button
          onClick={() => { setAddName(''); setShowAdd(true) }}
          disabled={accounts.length >= MAX_ACCOUNTS}
          className={`w-full card p-3.5 flex items-center justify-center gap-1 text-sm font-medium ${accounts.length >= MAX_ACCOUNTS ? 'text-gray-300' : 'text-red-600'}`}
        >
          + 新建账户{accounts.length >= MAX_ACCOUNTS ? `（已达 ${MAX_ACCOUNTS} 个上限）` : ''}
        </button>
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="新建账户">
        <div className="space-y-3">
          <input className="input-field" placeholder="账户名称，如「老婆的账户」" value={addName} onChange={e => setAddName(e.target.value)} maxLength={12} />
          <button className="btn-primary" onClick={doAdd}>创建并切换</button>
          <button className="btn-secondary" onClick={() => setShowAdd(false)}>取消</button>
        </div>
      </Modal>

      <Modal open={renameId != null} onClose={() => setRenameId(null)} title="重命名账户">
        <div className="space-y-3">
          <input className="input-field" value={renameName} onChange={e => setRenameName(e.target.value)} maxLength={12} />
          <button className="btn-primary" onClick={doRename}>确认</button>
          <button className="btn-secondary" onClick={() => setRenameId(null)}>取消</button>
        </div>
      </Modal>

      <Modal open={deleteId != null} onClose={() => setDeleteId(null)} title="删除账户？">
        <p className="text-sm text-gray-500 mb-5">该账户的持仓记录将一并删除，不可恢复。</p>
        <div className="flex gap-3">
          <button className="btn-secondary flex-1" onClick={() => setDeleteId(null)}>取消</button>
          <button className="flex-1 py-3 bg-red-600 text-white rounded-xl font-semibold" onClick={doDelete}>确认删除</button>
        </div>
      </Modal>

      <Toast message={message} />
    </div>
  )
}
