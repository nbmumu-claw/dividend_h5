import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store'
import { fetchStockPrices } from '../utils/api'
import { afterTax } from '../utils/tax'
import { currencySymbol, isBShare } from '../utils/market'
import { computeHolding, ensureTransactions, sharesAsOf, dividendShares, TX_LABEL, type TxType, type Transaction } from '../utils/holdings'
import { makeFeeCalc } from '../utils/fees'
import Modal from '../components/Modal'
import { Toast, useToast } from '../components/Toast'
import DividendReminderCard from '../components/DividendReminderCard'
import { usePendingDividends } from '../utils/dividendReminder'

const TAX_OPTIONS: { value: 'h' | 'n' | 'a'; label: string }[] = [
  { value: 'a', label: '港户' },
  { value: 'h', label: 'H股' },
  { value: 'n', label: '非H股' },
]

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtDate(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function HoldingDetail() {
  const navigate = useNavigate()
  const { code = '' } = useParams()
  const stock = useStore(s => s.watchlist.find(w => String(w.code) === String(code)))
  const setTransactions = useStore(s => s.setTransactions)
  const updateWatchlistStock = useStore(s => s.updateWatchlistStock)
  const customSectors = useStore(s => s.customSectors)
  const feeConfig = useStore(s => s.feeConfig)
  const { message, showToast } = useToast()

  const [expanded, setExpanded] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingIdx, setEditingIdx] = useState(-1)
  const [txType, setTxType] = useState<TxType>('buy')
  const [txQty, setTxQty] = useState('')
  const [txPrice, setTxPrice] = useState('')
  const [txNegative, setTxNegative] = useState(false)
  const [txDate, setTxDate] = useState(todayStr())
  const [deleteIdx, setDeleteIdx] = useState<number | null>(null)
  // 每股红利输入缓冲：编辑中保留原始输入，失焦后按 4 位小数展示
  const [divText, setDivText] = useState<string | null>(null)

  // 进页：刷新现价；老数据懒迁移成一笔买入
  useEffect(() => {
    if (!stock) return
    fetchStockPrices([{ code: stock.code, isHK: stock.isHK, isUS: stock.isUS }], false)
      .then(pm => {
        const pd = pm[stock.code]
        if (pd?.price) updateWatchlistStock(stock.code, { price: pd.price, pctChg: pd.pctChg })
      })
      .catch(() => {})
    if (!Array.isArray(stock.transactions)) {
      setTransactions(stock.code, ensureTransactions(stock))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  const txs = useMemo(() => stock?.transactions ?? [], [stock])
  const holding = useMemo(
    () => computeHolding(txs, stock ? makeFeeCalc(stock, feeConfig) : null),
    [txs, stock, feeConfig]
  )
  const pendingDiv = usePendingDividends(useMemo(() => (stock ? [stock] : []), [stock]))

  if (!stock) {
    return (
      <div className="page-content page-narrow">
        <div className="px-4 pt-12 text-center text-gray-400 text-sm">记录不存在</div>
        <button onClick={() => navigate(-1)} className="mt-4 mx-auto block text-red-500 text-sm">返回</button>
      </div>
    )
  }

  const curSym = currencySymbol(stock)
  const price = Number(stock.price) || 0
  const dividend = Number(stock.dividendPerShare) || 0
  const yieldRate = price > 0 && dividend > 0 ? (dividend / price) * 100 : 0

  const { shares, costPrice, cleared } = holding
  const hasCost = typeof costPrice === 'number'
  const costNum = hasCost ? (costPrice as number) : 0
  const marketValue = shares > 0 && price > 0 ? shares * price : 0
  const pl = hasCost ? (price - costNum) * shares : 0
  const cdy = hasCost && costNum > 0 && dividend > 0 ? (dividend / costNum) * 100 : null
  const totalDividend = txs.reduce((sum, t) => (t.type === 'dividend' ? sum + dividendShares(txs, t) * Number(t.price) : sum), 0)
  // 某笔交易的实际作用股数（分红按当时持仓）
  const rowQty = (t: Transaction) => (t.type === 'dividend' ? dividendShares(txs, t) : Number(t.qty))

  const txList = txs
    .map((t, i) => ({ ...t, idx: i }))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
  const visibleTx = expanded ? txList : txList.slice(0, 3)

  const openAdd = () => {
    setEditingIdx(-1); setTxType('buy'); setTxQty(''); setTxPrice(price > 0 ? price.toFixed(2) : '')
    setTxNegative(false); setTxDate(todayStr()); setShowForm(true)
  }
  const openEdit = (t: Transaction & { idx: number }) => {
    const raw = t.type === 'dividend' ? (t.gross ?? t.price) : t.price
    setEditingIdx(t.idx); setTxType(t.type)
    setTxQty(t.type === 'dividend' ? '' : String(t.qty))
    setTxPrice(String(Math.abs(Number(raw))))
    setTxNegative(t.type === 'buy' && Number(t.price) < 0)
    setTxDate(t.ts ? fmtDate(t.ts) : todayStr()); setShowForm(true)
  }

  const changeType = (val: TxType) => {
    setTxType(val)
    if (val === 'dividend') setTxPrice(dividend > 0 ? String(Number(dividend.toFixed(3))) : '')
    if (val !== 'buy') setTxNegative(false)
  }

  const confirmTx = () => {
    const p = parseFloat(txPrice) || 0
    const ts = txDate ? new Date(txDate + 'T12:00:00').getTime() : Date.now()
    const base = editingIdx >= 0 ? txs.filter((_, i) => i !== editingIdx) : txs
    const curShares = computeHolding(base).shares

    let qty: number
    let storedPrice = p
    if (txType === 'dividend') {
      // 分红按「分红日期当时的持仓」算，而非当前总持仓
      qty = sharesAsOf(base, ts)
      if (qty <= 0) { showToast('该日期当时无持仓，无法记录分红'); return }
      if (p <= 0) { showToast('请填写每股分红'); return }
      storedPrice = afterTax(p, stock)
    } else {
      qty = parseInt(txQty, 10) || 0
      if (qty <= 0) { showToast('请填写数量'); return }
      if (p <= 0) { showToast('请填写价格'); return }
      if (txType === 'sell' && qty > curShares) { showToast(`卖出不能超过持仓 ${curShares} 股`); return }
      if (txType === 'buy' && txNegative) storedPrice = -p
    }

    const tx: Transaction = { type: txType, qty, price: storedPrice, ts }
    if (txType === 'dividend') tx.gross = p

    const next = txs.slice()
    if (editingIdx >= 0) next[editingIdx] = tx
    else next.push(tx)
    setTransactions(stock.code, next)
    setShowForm(false); setEditingIdx(-1)
    showToast(editingIdx >= 0 ? '已更新' : '已记录')
  }

  const doDelete = (idx: number) => {
    setTransactions(stock.code, txs.filter((_, i) => i !== idx))
    setDeleteIdx(null)
    showToast('已删除')
  }

  const sectorOptions = [...new Set([...customSectors, stock.sector].filter(Boolean))]

  return (
    <div className="page-content page-narrow">
      {/* Header */}
      <div className="relative flex items-center px-4 pt-12 pb-3">
        <button onClick={() => navigate(-1)} className="p-1.5 text-gray-500">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="absolute inset-x-0 text-center pointer-events-none">
          <h1 className="text-base font-bold text-gray-900">{stock.name}</h1>
          <div className="text-xs text-gray-400">代码 {stock.code}</div>
        </div>
      </div>

      {/* 价格行 */}
      <div className="px-4 mb-3">
        <div className="card p-4 grid grid-cols-3 text-center divide-x divide-gray-100">
          <div>
            <div className="text-xs text-gray-400 mb-1">现价</div>
            <div className="font-bold text-gray-900">{curSym}{price.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">每股分红</div>
            <div className="font-bold text-gray-900">{curSym}{Number(dividend.toFixed(3))}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">股息率</div>
            <div className="font-bold text-red-600">{yieldRate.toFixed(2)}%</div>
          </div>
        </div>
      </div>

      {/* 基础信息（可编辑） */}
      <div className="px-4 mb-3">
        <div className="card p-4">
          <div className="text-sm font-semibold text-gray-800 mb-3">基础信息</div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-400 mb-1 flex items-center h-5">所属板块</label>
              <select
                className="input-field text-sm"
                value={stock.sector || ''}
                onChange={e => updateWatchlistStock(stock.code, { sector: e.target.value })}
              >
                {sectorOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-400 mb-1 flex items-center gap-1 h-5">
                每股红利
                <span className="inline-flex items-center gap-0.5 text-[10px] text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">
                  <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                    <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  可修改
                </span>
              </label>
              <input
                className="input-field text-sm border-red-300 bg-red-50/40 font-semibold"
                type="text"
                inputMode="decimal"
                value={divText !== null ? divText : (stock.dividendPerShare ? Number(stock.dividendPerShare).toFixed(4) : '')}
                onFocus={() => setDivText(stock.dividendPerShare ? String(stock.dividendPerShare) : '')}
                onChange={e => {
                  setDivText(e.target.value)
                  const v = Number(e.target.value) || 0
                  updateWatchlistStock(stock.code, { dividendPerShare: v, yieldRate: price > 0 && v > 0 ? (v / price) * 100 : 0, dividendManual: true })
                }}
                onBlur={() => setDivText(null)}
              />
            </div>
          </div>
          {stock.isHK && (
            <div className="mt-3">
              <label className="text-xs text-gray-400 block mb-1">分红税率</label>
              <div className="flex gap-1">
                {TAX_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => updateWatchlistStock(stock.code, { taxType: opt.value })}
                    className={`text-xs px-3 py-1 rounded-full border ${stock.taxType === opt.value ? 'bg-red-600 text-white border-red-600' : 'border-gray-200 text-gray-500'}`}
                  >{opt.label}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 记录概览 */}
      <div className="px-4 mb-3">
        <div className="card p-4">
          <div className="text-sm font-semibold text-gray-800 mb-3">记录概览</div>
          <div className="grid grid-cols-2 gap-y-3 gap-x-6">
            <Ov label="持有" value={`${shares} 股`} />
            <Ov label="摊薄成本" value={cleared ? '已清仓' : hasCost ? `${curSym}${costNum.toFixed(3)}` : '--'} valueClass={hasCost && costNum < 0 ? 'text-red-600' : 'text-gray-800'} sub={hasCost && costNum < 0 ? '已回本' : undefined} />
            <Ov label="成本股息率 CDY" value={cdy != null ? `${cdy.toFixed(2)}%` : '--'} valueClass="text-red-600" />
            <Ov label="市值" value={marketValue > 0 ? `${curSym}${marketValue.toFixed(2)}` : '--'} />
            <Ov label="浮动盈亏" value={hasCost ? `${pl >= 0 ? '+' : '-'}${curSym}${Math.abs(pl).toFixed(2)}` : '--'} valueClass={pl >= 0 ? 'text-red-600' : 'text-green-600'} />
            <Ov label="累计已收分红" value={totalDividend > 0 ? `${curSym}${totalDividend.toFixed(2)}` : '--'} valueClass="text-red-600" />
          </div>
          <div className="text-[11px] text-gray-400 leading-relaxed mt-3">
            摊薄成本 =（累计买入额 − 累计卖出额 − 累计分红）÷ 当前持仓，卖出与分红均冲减成本；浮动盈亏已含分红收益
          </div>
        </div>
      </div>

      {/* 记录管理 */}
      <div className="px-4 pb-28">
        <DividendReminderCard
          items={pendingDiv.items}
          onConfirm={(it) => { pendingDiv.confirm(it); showToast('已录入分红') }}
          onDismiss={pendingDiv.dismiss}
          variant="single"
        />
        <div className="card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
            <span className="text-sm font-semibold text-gray-800">记录管理</span>
            <span className="text-xs text-gray-400">点击可修改</span>
          </div>
          {txList.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">还没有记录，点下方「增加记录」</div>
          ) : (
            <>
              {visibleTx.map(t => (
                <div key={t.idx} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
                  <button className="flex-1 flex items-center gap-3 text-left" onClick={() => openEdit(t)}>
                    <span className={`tag flex-shrink-0 ${t.type === 'sell' ? 'tag-green' : t.type === 'dividend' ? 'tag-yellow' : 'tag-red'}`}>{TX_LABEL[t.type]}</span>
                    <div>
                      <div className="text-sm text-gray-800">{rowQty(t)} 股 @ {curSym}{Number(t.price).toFixed(3)}</div>
                      <div className="text-xs text-gray-400">{t.ts ? fmtDate(t.ts) : ''}</div>
                    </div>
                  </button>
                  <span className="text-sm text-gray-600 tabular-nums">{curSym}{(rowQty(t) * Number(t.price)).toFixed(2)}</span>
                  <button onClick={() => setDeleteIdx(t.idx)} className="text-gray-300 p-1">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" /></svg>
                  </button>
                </div>
              ))}
              {txList.length > 3 && (
                <button onClick={() => setExpanded(v => !v)} className="w-full py-2.5 text-xs text-red-500 font-medium">
                  {expanded ? '收起' : `展开全部 ${txList.length} 条`}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 增加记录 悬浮按钮（置于底部 TabBar 之上） */}
      <div
        className="fixed inset-x-0 mx-auto px-4 pt-2 pb-3 bg-gradient-to-t from-white via-white z-50"
        style={{ bottom: 'var(--tab-bar-height)', maxWidth: 'var(--shell-max)' }}
      >
        <button onClick={openAdd} className="w-full py-3.5 bg-red-600 text-white rounded-xl font-semibold">+ 增加记录</button>
      </div>

      {/* 记录表单 */}
      <Modal open={showForm} onClose={() => { setShowForm(false); setEditingIdx(-1) }} title={editingIdx >= 0 ? '修改记录' : '变更记录'}>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {(['buy', 'sell', 'dividend'] as TxType[]).map(t => (
              <button
                key={t}
                onClick={() => changeType(t)}
                className={`py-2.5 rounded-lg text-sm font-semibold ${txType === t ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-500'}`}
              >{TX_LABEL[t]}</button>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-500">日期</label>
            <input type="date" max={todayStr()} value={txDate} onChange={e => setTxDate(e.target.value)} className="input-field text-sm w-44" />
          </div>

          {txType !== 'dividend' && (
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-500">数量（股）</label>
              <input type="number" min="0" value={txQty} onChange={e => setTxQty(e.target.value)} placeholder="0" className="input-field text-sm w-44" />
            </div>
          )}

          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-500">{txType === 'dividend' ? '每股分红' : '价格'}</label>
            <input type="number" min="0" value={txPrice} onChange={e => setTxPrice(e.target.value)} placeholder="0.00" className="input-field text-sm w-44" />
          </div>

          {txType === 'buy' && (
            <label className="flex items-center gap-2 text-sm text-gray-500">
              <input type="checkbox" checked={txNegative} onChange={e => setTxNegative(e.target.checked)} />
              成本为负（已回本，按负价计入）
            </label>
          )}
          {txType === 'dividend' && (
            <div className="text-xs text-gray-400">分红按 {txDate} 当时持仓 {sharesAsOf(editingIdx >= 0 ? txs.filter((_, i) => i !== editingIdx) : txs, txDate ? new Date(txDate + 'T12:00:00').getTime() : Date.now())} 股计；{stock.isHK ? '港股按所选税率扣税后' : isBShare(stock.code) ? 'B股按10%扣税后' : 'A股免税'}冲减成本。</div>
          )}

          {(() => {
            const fc = makeFeeCalc(stock, feeConfig)
            if (!fc || txType === 'dividend') return null
            const amt = (parseInt(txQty, 10) || 0) * (parseFloat(txPrice) || 0)
            if (amt <= 0 || (txType === 'buy' && txNegative)) return null
            const fee = fc(txType, amt)
            return <div className="text-xs text-gray-400">预计手续费 ¥{fee.toFixed(2)}（已计入成本）</div>
          })()}

          <button onClick={confirmTx} className="w-full py-3 bg-red-600 text-white rounded-xl font-semibold">
            确认{TX_LABEL[txType]}
          </button>
        </div>
      </Modal>

      {/* 删除确认 */}
      <Modal open={deleteIdx != null} onClose={() => setDeleteIdx(null)} title="删除这笔记录？">
        <p className="text-sm text-gray-500 mb-5">删除后将重新计算摊薄成本。</p>
        <div className="flex gap-3">
          <button className="btn-secondary flex-1" onClick={() => setDeleteIdx(null)}>取消</button>
          <button className="flex-1 py-3 bg-red-600 text-white rounded-xl font-semibold" onClick={() => deleteIdx != null && doDelete(deleteIdx)}>确认删除</button>
        </div>
      </Modal>

      <Toast message={message} />
    </div>
  )
}

function Ov({ label, value, valueClass = 'text-gray-800', sub }: { label: string; value: string; valueClass?: string; sub?: string }) {
  return (
    <div className="text-center">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className={`font-bold ${valueClass}`}>{value}{sub && <span className="text-xs ml-1 text-red-500">{sub}</span>}</div>
    </div>
  )
}
