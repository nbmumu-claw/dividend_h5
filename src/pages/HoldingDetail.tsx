import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store'
import { fetchStockPrices } from '../utils/api'
import { afterTax } from '../utils/tax'
import { currencySymbol, isAShare, isBShare } from '../utils/market'
import { computeHolding, ensureTransactions, findFirstOversell, sharesAsOf, dividendShares, TX_LABEL, type TxType, type Transaction } from '../utils/holdings'
import { makeFeeCalc } from '../utils/fees'
import { estimateDividendTax } from '../utils/dividendTax'
import Modal from '../components/Modal'
import { Toast, useToast } from '../components/Toast'
import DividendReminderCard from '../components/DividendReminderCard'
import { usePendingDividends } from '../utils/dividendReminder'
import DividendTaxReminderCard from '../components/DividendTaxReminderCard'
import { usePendingDividendTax } from '../utils/dividendTaxReminder'
import { fetchDividendHistory } from '../utils/dividendHistory'

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
  const [taxAmountAuto, setTaxAmountAuto] = useState(false)
  const [txNegative, setTxNegative] = useState(false)
  const [txDate, setTxDate] = useState(todayStr())
  const [deleteIdx, setDeleteIdx] = useState<number | null>(null)
  const [consecutiveDividendYears, setConsecutiveDividendYears] = useState<number | null>(null)
  // 每股红利输入缓冲：编辑中保留原始输入，失焦后按 4 位小数展示
  const [divText, setDivText] = useState<string | null>(null)

  // 进页：刷新现价；老数据懒迁移成一笔买入
  useEffect(() => {
    if (!stock) return
    fetchStockPrices([{ code: stock.code, isHK: stock.isHK, isUS: stock.isUS, isFund: stock.isFund }], false)
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

  useEffect(() => {
    if (!stock || stock.isFund) {
      setConsecutiveDividendYears(null)
      return
    }

    let cancelled = false
    fetchDividendHistory(stock.code, stock.isHK, stock.isUS)
      .then(history => {
        if (!cancelled) setConsecutiveDividendYears(history?.consecutiveYears ?? null)
      })
      .catch(() => {
        if (!cancelled) setConsecutiveDividendYears(null)
      })

    return () => { cancelled = true }
  }, [stock?.code, stock?.isFund, stock?.isHK, stock?.isUS])

  const txs = useMemo(() => stock?.transactions ?? [], [stock])
  // 交易 ts：日期取所选日，时刻取「录入当下」(新增) 或「原记录时刻」(编辑)，精确到毫秒。
  // 同一天多笔据此按录入先后排序，分红不会算进当天「之后」录入的买入；显示仍只到日。
  const previewTs = useMemo(() => {
    if (!txDate) return Date.now()
    const src = editingIdx >= 0 && txs[editingIdx]?.ts ? new Date(txs[editingIdx].ts as number) : new Date()
    const [y, m, d] = txDate.split('-').map(Number)
    return new Date(y, m - 1, d, src.getHours(), src.getMinutes(), src.getSeconds(), src.getMilliseconds()).getTime()
  }, [txDate, editingIdx, txs])
  const holding = useMemo(
    () => computeHolding(txs, stock ? makeFeeCalc(stock, feeConfig) : null),
    [txs, stock, feeConfig]
  )
  const pendingDiv = usePendingDividends(useMemo(() => (stock ? [stock] : []), [stock]))
  const pendingDividendTax = usePendingDividendTax(stock ?? ({ code: '', name: '', sector: '', price: 0, dividendPerShare: 0, yieldRate: 0, confirmed: false }))

  const dividendTaxEstimate = useMemo(() => {
    const base = editingIdx >= 0 ? txs.filter((_, index) => index !== editingIdx) : txs
    return estimateDividendTax(base, previewTs, Number(txQty) || 0)
  }, [editingIdx, previewTs, txQty, txs])

  useEffect(() => {
    if (txType === 'dividendTax' && taxAmountAuto) {
      setTxPrice(dividendTaxEstimate.tax.toFixed(2))
    }
  }, [dividendTaxEstimate.tax, taxAmountAuto, txType])

  if (!stock) {
    return (
      <div className="page-content page-narrow">
        <div className="px-4 pt-12 text-center text-gray-400 text-sm">记录不存在</div>
        <button onClick={() => navigate(-1)} className="mt-4 mx-auto block text-red-500 text-sm">返回</button>
      </div>
    )
  }

  const curSym = currencySymbol(stock)
  const canEstimateDividendTax = isAShare(stock)
  const price = Number(stock.price) || 0
  const dividend = Number(stock.dividendPerShare) || 0
  const yieldRate = price > 0 && dividend > 0 ? (dividend / price) * 100 : 0
  const openDividendHistory = () => {
    const params = new URLSearchParams({
      code: stock.code,
      name: stock.name,
      dividend: String(dividend),
      price: String(price),
      isHK: String(!!stock.isHK),
      isUS: String(!!stock.isUS),
      section: 'history',
    })
    navigate(`/matrix?${params}`)
  }

  const { shares, costPrice, netAmount, cleared } = holding
  const hasCost = typeof costPrice === 'number'
  const costNum = hasCost ? (costPrice as number) : 0
  const marketValue = shares > 0 && price > 0 ? shares * price : 0
  // 清仓后成本价会置空，但净投入仍保留；此时 -netAmount 就是包含分红和费用的已实现累计盈亏。
  const hasProfitLoss = hasCost || (cleared && txs.some(t => t.type === 'buy' || t.type === 'sell'))
  const pl = cleared ? -netAmount : hasCost ? (price - costNum) * shares : 0
  const cdy = hasCost && costNum > 0 && dividend > 0 ? (dividend / costNum) * 100 : null
  const totalDividend = txs.reduce((sum, t) => (t.type === 'dividend' ? sum + dividendShares(txs, t) * Number(t.price) : sum), 0)
  // 某笔交易的实际作用股数（分红按当时持仓）
  const rowQty = (t: Transaction) => (t.type === 'dividend' ? dividendShares(txs, t) : Number(t.qty))

  const txList = txs
    .map((t, i) => ({ ...t, idx: i }))
    .sort((a, b) => {
      const dateOrder = fmtDate(b.ts || 0).localeCompare(fmtDate(a.ts || 0))
      if (dateOrder !== 0) return dateOrder
      // 列表按时间倒序；分红税属于当日卖出后的补缴记录，应显示在卖出记录上方。
      if (a.type === 'dividendTax' && b.type !== 'dividendTax') return -1
      if (b.type === 'dividendTax' && a.type !== 'dividendTax') return 1
      return (b.ts || 0) - (a.ts || 0)
    })
  const visibleTx = expanded ? txList : txList.slice(0, 3)

  const openAdd = () => {
    setEditingIdx(-1); setTxType('buy'); setTxQty(''); setTxPrice(price > 0 ? price.toFixed(2) : '')
    setTaxAmountAuto(false); setTxNegative(false); setTxDate(todayStr()); setShowForm(true)
  }
  const openEdit = (t: Transaction & { idx: number }) => {
    const raw = t.type === 'dividend' ? (t.gross ?? t.price) : t.price
    setEditingIdx(t.idx); setTxType(t.type)
    setTxQty(t.type === 'dividend' ? '' : String(t.qty))
    setTxPrice(String(Math.abs(Number(raw))))
    setTaxAmountAuto(false)
    setTxNegative(t.type === 'buy' && Number(t.price) < 0)
    setTxDate(t.ts ? fmtDate(t.ts) : todayStr()); setShowForm(true)
  }

  const openDividendTaxReview = (item: NonNullable<typeof pendingDividendTax.item>) => {
    setEditingIdx(-1)
    setTxType('dividendTax')
    setTxDate(item.saleDate)
    setTxQty(String(item.qty))
    setTxPrice(item.tax.toFixed(2))
    setTaxAmountAuto(false)
    setTxNegative(false)
    setShowForm(true)
  }

  const changeType = (val: TxType) => {
    if (val === 'dividendTax' && !canEstimateDividendTax) {
      showToast('分红税预估仅适用于沪深北普通 A 股')
      return
    }
    setTxType(val)
    if (val === 'dividend') setTxPrice(dividend > 0 ? String(Number(dividend.toFixed(3))) : '')
    if (val === 'dividendTax') {
      const latestSell = txs
        .filter(t => t.type === 'sell')
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))[0]
      const taxDate = latestSell?.ts ? fmtDate(latestSell.ts) : txDate
      const sellQty = txs
        .filter(t => t.type === 'sell' && fmtDate(t.ts) === taxDate)
        .reduce((sum, t) => sum + (Number(t.qty) || 0), 0)
      if (latestSell?.ts) setTxDate(taxDate)
      if (sellQty > 0) setTxQty(String(sellQty))
      setTaxAmountAuto(true)
    } else {
      setTaxAmountAuto(false)
    }
    if (val !== 'buy') setTxNegative(false)
  }

  const confirmTx = () => {
    const p = Number(txPrice.trim())
    const ts = previewTs
    const base = editingIdx >= 0 ? txs.filter((_, i) => i !== editingIdx) : txs

    let qty: number
    let storedPrice = p
    if (txType === 'dividend') {
      // 分红按「分红日期当时的持仓」算，而非当前总持仓
      qty = sharesAsOf(base, ts)
      if (qty <= 0) { showToast('该日期当时无持仓，无法记录分红'); return }
      if (!Number.isFinite(p) || p <= 0) { showToast('请填写有效的每股分红'); return }
      storedPrice = afterTax(p, stock)
    } else if (txType === 'dividendTax') {
      if (!canEstimateDividendTax) { showToast('分红税记录仅适用于沪深北普通 A 股'); return }
      qty = Number(txQty.trim())
      if (!Number.isInteger(qty) || qty <= 0) { showToast('请填写有效的整数数量'); return }
      if (qty > dividendTaxEstimate.availableQty) { showToast(`该日期当时仅剩 ${dividendTaxEstimate.availableQty} 股可供估算`); return }
      storedPrice = txPrice.trim() === '' ? dividendTaxEstimate.tax : p
      if (!Number.isFinite(storedPrice) || storedPrice <= 0) { showToast('暂无可估算税额，请核对分红记录或手动填写金额'); return }
    } else {
      qty = Number(txQty.trim())
      const isValidQty = stock.isFund ? Number.isFinite(qty) : Number.isInteger(qty)
      if (!isValidQty || qty <= 0) { showToast(stock.isFund ? '请填写有效的份额数量' : '请填写有效的整数数量'); return }
      if (!Number.isFinite(p) || p <= 0) { showToast('请填写有效的价格'); return }
      if (txType === 'buy' && txNegative) storedPrice = -p
    }

    const tx: Transaction = { type: txType, qty, price: storedPrice, ts }
    if (txType === 'dividend') tx.gross = p

    const next = txs.slice()
    if (editingIdx >= 0) next[editingIdx] = tx
    else next.push(tx)
    if (txType === 'buy' || txType === 'sell') {
      const issue = findFirstOversell(next)
      if (issue) {
        const ownIndex = editingIdx >= 0 ? editingIdx : txs.length
        const prefix = issue.index === ownIndex && txType === 'sell'
          ? '卖出数量不能超过该日期当时的可用持仓'
          : `修改后 ${fmtDate(issue.transaction.ts)} 的卖出将超过当日可用持仓`
        showToast(`${prefix}（${issue.available}股）`)
        return
      }
    }
    setTransactions(stock.code, next)
    setShowForm(false); setEditingIdx(-1)
    showToast(editingIdx >= 0 ? '已更新' : '已记录')
  }

  const doDelete = (idx: number) => {
    const next = txs.filter((_, i) => i !== idx)
    const issue = findFirstOversell(next)
    if (issue) {
      showToast(`删除后 ${fmtDate(issue.transaction.ts)} 的卖出将超过当日可用持仓（${issue.available}股）`)
      setDeleteIdx(null)
      return
    }
    setTransactions(stock.code, next)
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
        <div className="card p-4 grid grid-cols-4 text-center divide-x divide-gray-100">
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
          <div>
            <div className="text-xs text-gray-400 mb-1">连续分红</div>
            <button type="button" onClick={openDividendHistory} disabled={consecutiveDividendYears === null} className="inline-flex items-center gap-0.5 font-bold text-red-600 underline decoration-red-200 underline-offset-4 disabled:text-gray-900 disabled:no-underline disabled:cursor-default">
              {consecutiveDividendYears === null ? '--' : <>{consecutiveDividendYears}年 <span className="text-xs">›</span></>}
            </button>
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
              <label className="text-xs text-gray-400 block mb-1">交易结算币种</label>
              <div className="flex gap-1 mb-3">
                {([
                  { value: 'CNY', label: '港股通·人民币' },
                  { value: 'HKD', label: '港户·港币' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => updateWatchlistStock(stock.code, { cashCurrency: opt.value })}
                    className={`text-xs px-3 py-1 rounded-full border ${(stock.cashCurrency ?? 'CNY') === opt.value ? 'bg-red-600 text-white border-red-600' : 'border-gray-200 text-gray-500'}`}
                  >{opt.label}</button>
                ))}
              </div>
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
            <Ov label={cleared ? '累计盈亏' : '浮动盈亏'} value={hasProfitLoss ? `${pl >= 0 ? '+' : '-'}${curSym}${Math.abs(pl).toFixed(2)}` : '--'} valueClass={pl >= 0 ? 'text-red-600' : 'text-green-600'} />
            <Ov label="累计已收分红" value={totalDividend > 0 ? `${curSym}${totalDividend.toFixed(2)}` : '--'} valueClass="text-red-600" />
          </div>
          <div className="text-[11px] text-gray-400 leading-relaxed mt-3">
            摊薄成本 =（累计买入额 − 累计卖出额 − 累计分红 + 分红税）÷ 当前持仓，卖出与分红均冲减成本；浮动盈亏已含税后分红收益
          </div>
        </div>
      </div>

      {/* 记录管理 */}
      <div className="px-4 pb-28">
        <DividendTaxReminderCard
          item={pendingDividendTax.item}
          onConfirm={(item) => { pendingDividendTax.confirm(item); showToast('已记录分红税') }}
          onDismiss={(item) => { pendingDividendTax.dismiss(item); showToast('已忽略分红税提醒') }}
          onReview={openDividendTaxReview}
        />
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
                    <span className={`tag flex-shrink-0 ${t.type === 'sell' ? 'tag-sell' : t.type === 'dividend' || t.type === 'dividendTax' ? 'tag-yellow' : 'tag-red'}`}>{TX_LABEL[t.type]}</span>
                    <div>
                      <div className="text-sm text-gray-800">
                        {t.type === 'dividendTax' ? `${rowQty(t)} ${stock.isFund ? '份' : '股'} · 预估税额` : `${rowQty(t)} ${stock.isFund ? '份' : '股'} @ ${curSym}${Number(t.price).toFixed(3)}`}
                        {t.type === 'dividend' && <span className="ml-1 text-xs text-gray-400">税后</span>}
                      </div>
                      <div className="text-xs text-gray-400">{t.ts ? fmtDate(t.ts) : ''}</div>
                    </div>
                  </button>
                  <span className="text-sm text-gray-600 tabular-nums">{curSym}{(t.type === 'dividendTax' ? Number(t.price) : rowQty(t) * Number(t.price)).toFixed(2)}</span>
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
          <div className="grid grid-cols-4 gap-2">
            {(['buy', 'sell', 'dividend', 'dividendTax'] as TxType[]).map(t => (
              <button
                key={t}
                onClick={() => changeType(t)}
                disabled={t === 'dividendTax' && !canEstimateDividendTax}
                className={`py-2.5 rounded-lg text-sm font-semibold ${txType === t ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-500'} disabled:opacity-40`}
              >{TX_LABEL[t]}</button>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-500">日期</label>
            <input type="date" max={todayStr()} value={txDate} onChange={e => setTxDate(e.target.value)} className="input-field text-sm w-44" />
          </div>

          {txType !== 'dividend' && (
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-500">数量（{stock.isFund ? '份' : '股'}）</label>
              <input type="number" min="0" step={stock.isFund ? 'any' : '1'} value={txQty} onChange={e => setTxQty(e.target.value)} placeholder="0" className="input-field text-sm w-44" />
            </div>
          )}

          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-500">{txType === 'dividend' ? `每${stock.isFund ? '份' : '股'}分红` : txType === 'dividendTax' ? '税额' : '价格'}</label>
            <input type="number" min="0" value={txPrice} onChange={e => { setTaxAmountAuto(false); setTxPrice(e.target.value) }} placeholder="0.00" className="input-field text-sm w-44" />
          </div>

          {txType === 'buy' && (
            <label className="flex items-center gap-2 text-sm text-gray-500">
              <input type="checkbox" checked={txNegative} onChange={e => setTxNegative(e.target.checked)} />
              成本为负（已回本，按负价计入）
            </label>
          )}
          {txType === 'dividend' && (
            <div className="text-xs text-gray-400">分红按 {txDate} 当时持仓 {sharesAsOf(editingIdx >= 0 ? txs.filter((_, i) => i !== editingIdx) : txs, previewTs)} {stock.isFund ? '份' : '股'}计；{stock.isHK ? '港股按所选税率扣税后' : isBShare(stock.code) ? 'B股按10%扣税后' : 'A股免税'}冲减成本。</div>
          )}

          {txType === 'dividendTax' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
              <div className="font-semibold">预估分红税 {curSym}{dividendTaxEstimate.tax.toFixed(2)}</div>
              <div className="mt-1">同日买入会先抵扣卖出数量。税额已自动填入上方，可手动修改；基于已录入的 {dividendTaxEstimate.dividendCount} 笔分红，先进先出估算：1 个月内分红 {curSym}{dividendTaxEstimate.withinMonth.toFixed(2)} × 20%；1 个月至 1 年分红 {curSym}{dividendTaxEstimate.withinYear.toFixed(2)} × 10%。</div>
              <div className="mt-1 text-amber-700">仅供审核：请以券商实际扣缴为准；未录入历史分红、跨账户持仓或公司行动可能造成差异。</div>
            </div>
          )}

          {(() => {
            const fc = makeFeeCalc(stock, feeConfig)
            if (!fc || txType === 'dividend' || txType === 'dividendTax') return null
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
