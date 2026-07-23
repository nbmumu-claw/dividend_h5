import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import Modal from '../components/Modal'
import { Toast, useToast } from '../components/Toast'
import { CASH_CURRENCIES, EMPTY_CASH, type CashCurrency } from '../utils/cash'

const MAX_ACCOUNTS = 3

export default function AccountManager() {
  const navigate = useNavigate()
  const accounts = useStore(s => s.accounts)
  const activeAccountId = useStore(s => s.activeAccountId)
  const switchAccount = useStore(s => s.switchAccount)
  const addAccount = useStore(s => s.addAccount)
  const renameAccount = useStore(s => s.renameAccount)
  const removeAccount = useStore(s => s.removeAccount)
  const cashBalance = useStore(s => s.cashBalance)
  const accountCashBalances = useStore(s => s.accountCashBalances)
  const cashOpeningBalance = useStore(s => s.cashOpeningBalance)
  const accountCashOpeningBalances = useStore(s => s.accountCashOpeningBalances)
  const changeCashBalance = useStore(s => s.changeCashBalance)
  const setOpeningCashBalance = useStore(s => s.setOpeningCashBalance)
  const addOpeningCashBalance = useStore(s => s.addOpeningCashBalance)
  const { message, showToast } = useToast()

  const [showAdd, setShowAdd] = useState(false)
  const [addName, setAddName] = useState('')
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameName, setRenameName] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [cashAccountId, setCashAccountId] = useState<string | null>(null)
  const [cashCurrency, setCashCurrency] = useState<CashCurrency>('CNY')
  const [cashAction, setCashAction] = useState<'opening' | 'deposit' | 'withdrawal'>('deposit')
  const [cashInput, setCashInput] = useState('')

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
  const openCashEditor = (id: string, action: 'opening' | 'deposit' | 'withdrawal' = 'deposit') => {
    setCashAccountId(id)
    const opening = id === activeAccountId ? cashOpeningBalance : (accountCashOpeningBalances[id] ?? EMPTY_CASH)
    const balance = id === activeAccountId ? cashBalance : (accountCashBalances[id] ?? EMPTY_CASH)
    setCashCurrency('CNY'); setCashAction(action); setCashInput(action === 'opening' ? String(opening.CNY || balance.CNY) : '')
  }
  const saveCash = () => {
    if (cashAccountId) {
      if (cashAction === 'opening') {
        const opening = cashAccountId === activeAccountId ? cashOpeningBalance : (accountCashOpeningBalances[cashAccountId] ?? EMPTY_CASH)
        if (opening[cashCurrency] > 0) setOpeningCashBalance(cashAccountId, cashCurrency, Number(cashInput))
        else addOpeningCashBalance(cashAccountId, cashCurrency, Number(cashInput))
      }
      else changeCashBalance(cashAccountId, cashCurrency, (cashAction === 'withdrawal' ? -1 : 1) * (Number(cashInput) || 0))
    }
    setCashAccountId(null)
    showToast(cashAction === 'withdrawal' ? '资金已转出' : cashAction === 'opening' ? '期初现金已录入' : '资金已转入')
  }

  return (
    <div className="page-content page-narrow">
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
          每个账户的持仓记录、现金余额与交易手续费各自独立，可分别管理；板块顺序、汇率、三大类分类等设置全局共享。最多 {MAX_ACCOUNTS} 个账户。
        </p>
      </div>

      <div className="px-4 mb-3">
        <div className="card">
          {accounts.map(a => {
            const active = a.id === activeAccountId
            return (
              <div key={a.id} className="px-4 py-3.5 border-b border-gray-50 last:border-0">
                <div className="flex items-center gap-3">
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
                <button className="mt-3 w-full rounded-lg bg-gray-50 px-3 py-2 text-left text-sm active:opacity-60" onClick={() => openCashEditor(a.id)}>
                  <div className="mb-1.5 flex justify-between"><span className="text-gray-500">现金余额</span><span className="text-xs text-red-500">期初/转入/转出</span></div>
                  <div className="flex gap-3 text-xs text-gray-700">
                    {CASH_CURRENCIES.map(currency => <span key={currency}>{currency === 'CNY' ? '¥' : currency === 'USD' ? 'US$' : 'HK$'}{(active ? cashBalance : (accountCashBalances[a.id] ?? EMPTY_CASH))[currency].toFixed(2)}</span>)}
                  </div>
                </button>
                <button className="mt-2 text-xs text-gray-400 underline" onClick={() => openCashEditor(a.id, 'opening')}>{(active ? cashOpeningBalance : (accountCashOpeningBalances[a.id] ?? EMPTY_CASH)).CNY > 0 ? '修改期初资金' : '补录期初资金'}</button>
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

      <Modal open={cashAccountId != null} onClose={() => setCashAccountId(null)} title="资金管理">
        <div className="space-y-3">
          <p className="text-sm text-gray-500">按原币种登记资金，买卖和税后分红会自动更新对应现金余额。</p>
          <div className="grid grid-cols-3 gap-2">
            {(['opening', 'deposit', 'withdrawal'] as const).map(action => <button key={action} onClick={() => setCashAction(action)} className={`py-2 rounded-lg text-sm border ${cashAction === action ? 'border-red-600 bg-red-50 text-red-600' : 'border-gray-200 text-gray-500'}`}>{action === 'opening' ? '期初现金' : action === 'deposit' ? '资金转入' : '资金转出'}</button>)}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {CASH_CURRENCIES.map(currency => <button key={currency} onClick={() => setCashCurrency(currency)} className={`py-2 rounded-lg text-sm border ${cashCurrency === currency ? 'border-red-600 bg-red-50 text-red-600' : 'border-gray-200 text-gray-500'}`}>{currency}</button>)}
          </div>
          <input className="input-field" type="number" min="0" step="0.01" inputMode="decimal" placeholder="例如 10000" value={cashInput} onChange={e => setCashInput(e.target.value)} autoFocus />
          <button className="btn-primary" onClick={saveCash}>确认{cashAction === 'opening' ? '录入期初' : cashAction === 'deposit' ? '转入' : '转出'}</button>
          <button className="btn-secondary" onClick={() => setCashAccountId(null)}>取消</button>
        </div>
      </Modal>

      <Toast message={message} />
    </div>
  )
}
