import { useState, useMemo, useRef, useEffect } from 'react'
import { useStore } from '../store'
import { fetchStockPrices, searchStocks, searchStocksLocal } from '../utils/api'
import Disclaimer from '../components/Disclaimer'
import type { SearchResult } from '../utils/api'
import { STATIC_STOCKS } from '../data/stocks'
import type { Stock } from '../types'
import Modal from '../components/Modal'
import { Toast, useToast } from '../components/Toast'

const CHART_COLORS = ['#E03025','#3B82F6','#F59E0B','#EF4444','#8B5CF6','#EC4899','#14B8A6','#F97316','#6366F1','#84CC16']

function YieldBadge({ rate }: { rate: number }) {
  const cls = rate >= 5 ? 'tag-green' : rate >= 4 ? 'tag-yellow' : 'tag-gray'
  return <span className={`tag ${cls}`}>{rate.toFixed(2)}%</span>
}

export default function Discovery() {
  const customSectors = useStore(s => s.customSectors)
  const watchlist = useStore(s => s.watchlist)
  const manualStocks = useStore(s => s.manualStocks)
  const staticEdits = useStore(s => s.staticEdits)
  const hiddenStocks = useStore(s => s.hiddenStocks)
  const exchangeRate = useStore(s => s.exchangeRate)
  const addToWatchlist = useStore(s => s.addToWatchlist)
  const removeFromWatchlist = useStore(s => s.removeFromWatchlist)
  const addManualStock = useStore(s => s.addManualStock)
  const removeManualStock = useStore(s => s.removeManualStock)
  const updateManualStock = useStore(s => s.updateManualStock)
  const updateStaticEdit = useStore(s => s.updateStaticEdit)
  const hideStock = useStore(s => s.hideStock)
  const addSector = useStore(s => s.addSector)
  const renameSector = useStore(s => s.renameSector)
  const deleteSector = useStore(s => s.deleteSector)
  const setCustomSectors = useStore(s => s.setCustomSectors)

  const [activeSector, setActiveSector] = useState(customSectors[0] || '')
  const [loading, setLoading] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [showSectorModal, setShowSectorModal] = useState(false)
  const [editStock, setEditStock] = useState<Stock | null>(null)
  const [swipeOpenCode, setSwipeOpenCode] = useState<string | null>(null)
  const [stockContextMenu, setStockContextMenu] = useState<{ x: number; y: number; stock: Stock; isManual: boolean } | null>(null)
  const [sectorContextMenu, setSectorContextMenu] = useState<string | null>(null)
  const sectorLongPressTimer = useRef<number | null>(null)
  const [sectorInput, setSectorInput] = useState('')
  const [renamingSector, setRenamingSector] = useState<string | null>(null)
  const { message, showToast } = useToast()
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const dragInner = useRef<HTMLElement | null>(null)
  const dragActions = useRef<HTMLElement | null>(null)
  const dragLocked = useRef<'h' | 'v' | null>(null)

  const [form, setForm] = useState({ name: '', code: '', sector: activeSector, price: '', dividendPerShare: '', isHK: false, isETF: false, confirmed: false })
  const [formErrors, setFormErrors] = useState<{ name?: boolean; code?: boolean; price?: boolean; dividendPerShare?: boolean }>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef<number | null>(null)
  const activeQuery = useRef('')

  const displayStocks = useMemo(() => {
    const hidden = new Set(hiddenStocks)
    const result: Stock[] = []
    for (const s of STATIC_STOCKS) {
      if (hidden.has(s.code)) continue
      const merged = { ...s, ...(staticEdits[s.code] || {}) }
      if (merged.sector === activeSector) result.push(merged)
    }
    for (const s of manualStocks) {
      if (s.sector === activeSector) result.push(s)
    }
    return result
  }, [activeSector, manualStocks, staticEdits, hiddenStocks])

  // 首次加载静默拉价格（含涨跌）
  useEffect(() => {
    if (!displayStocks.length) return
    const stockInputs = displayStocks.map(s => ({ code: s.code, isHK: s.isHK }))
    fetchStockPrices(stockInputs, false).then(priceMap => {
      displayStocks.forEach(s => {
        const pd = priceMap[s.code]
        if (!pd) return
        const priceCny = s.isHK ? pd.price * exchangeRate : pd.price
        const divCny = s.isHK ? s.dividendPerShare * exchangeRate : s.dividendPerShare
        const rawYield = priceCny > 0 ? (divCny / priceCny) * 100 : 0
        const yieldRate = rawYield > 30 ? s.yieldRate : rawYield
        const patch = { price: pd.price, pctChg: pd.pctChg, yieldRate }
        if (s.isManual) updateManualStock(s.code, patch)
        else updateStaticEdit(s.code, patch)
      })
    })
  }, [activeSector]) // activeSector 切换时重新拉

  const handleRefresh = async () => {
    setLoading(true)
    try {
      const stockInputs = displayStocks.map(s => ({ code: s.code, isHK: s.isHK }))
      const priceMap = await fetchStockPrices(stockInputs, true)
      const updated = displayStocks.map(s => {
        const pd = priceMap[s.code]
        if (!pd) return s
        const price = pd.price
        const priceCny = s.isHK ? price * exchangeRate : price
        const divCny = s.isHK ? s.dividendPerShare * exchangeRate : s.dividendPerShare
        const rawYield = priceCny > 0 ? (divCny / priceCny) * 100 : 0
        return { ...s, price, priceCny, yieldRate: rawYield > 30 ? s.yieldRate : rawYield, pctChg: pd.pctChg }
      })
      // persist price updates
      updated.forEach(s => {
        const patch = { price: s.price, yieldRate: s.yieldRate, pctChg: s.pctChg ?? null }
        if (s.isManual) updateManualStock(s.code, patch)
        else updateStaticEdit(s.code, patch)
      })
      showToast('价格已更新')
    } catch {
      showToast('更新失败，请重试')
    }
    setLoading(false)
  }

  const handleAddToWatchlist = (stock: Stock) => {
    if (watchlist.find(w => w.code === stock.code)) {
      removeFromWatchlist(stock.code)
      showToast('已移出自选')
      return
    }
    addToWatchlist(stock)
    showToast('已加入自选')
  }

  const openAddForm = () => {
    const sector = activeSector || customSectors[0] || ''
    setForm({ name: '', code: '', sector, price: '', dividendPerShare: '', isHK: false, isETF: sector === '红利ETF', confirmed: false })
    setEditStock(null)
    setShowAdd(true)
  }

  const openEditModal = (stock: Stock, isManual: boolean) => {
    setEditStock(stock)
    setForm({
      name: stock.name,
      code: stock.code,
      sector: stock.sector,
      price: String(stock.price),
      dividendPerShare: String(stock.dividendPerShare),
      isHK: stock.isHK || false,
      isETF: stock.isETF || false,
      confirmed: stock.confirmed,
    })
    setShowAdd(true)
  }

  const handleSearchInput = (q: string) => {
    setSearchQuery(q)
    activeQuery.current = q
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!q.trim()) { setSearchResults([]); setSearching(false); return }
    const local = searchStocksLocal(q)
    setSearchResults(local.slice(0, 6))
    setSearching(true)
    searchTimer.current = window.setTimeout(async () => {
      const results = await searchStocks(q, true)
      if (activeQuery.current !== q) return // 查询已变，丢弃过期结果
      setSearchResults(prev => {
        const existing = new Set(prev.map(r => r.code))
        const newOnes = results.filter(r => !existing.has(r.code))
        return [...prev, ...newOnes].slice(0, 6)
      })
      setSearching(false)
    }, 350)
  }

  const selectSearchResult = (r: SearchResult) => {
    setForm(f => ({ ...f, name: r.name, code: r.code, isHK: r.isHK, price: '', dividendPerShare: '' }))
    setSearchQuery('')
    setSearchResults([])

    // fetch live price
    fetchStockPrices([{ code: r.code, isHK: r.isHK }], true).then(priceMap => {
      const pd = priceMap[r.code]
      if (pd?.price) {
        setForm(f => ({ ...f, price: String(pd.price) }))
      }
    })
  }

  const submitForm = () => {
    const price = parseFloat(form.price)
    const div = parseFloat(form.dividendPerShare)
    const errors = {
      name: !form.name,
      code: !form.code,
      price: isNaN(price) || !form.price,
      dividendPerShare: isNaN(div) || !form.dividendPerShare,
    }
    if (errors.name || errors.code || errors.price || errors.dividendPerShare) {
      setFormErrors(errors)
      return
    }
    setFormErrors({})
    const priceCny = form.isHK ? price * exchangeRate : price
    const divCny = form.isHK ? div * exchangeRate : div
    const yieldRate = priceCny > 0 ? (divCny / priceCny) * 100 : 0
    const code = form.isHK ? form.code.replace(/^0+/, '').padStart(4, '0') : form.code.padStart(6, '0')

    if (editStock) {
      const isManualStock = manualStocks.find(m => m.code === editStock.code)
      if (isManualStock) {
        updateManualStock(editStock.code, { name: form.name, price, dividendPerShare: div, sector: form.sector, isHK: form.isHK, isETF: form.isETF, yieldRate, confirmed: form.confirmed })
      } else {
        updateStaticEdit(editStock.code, { name: form.name, price, dividendPerShare: div, yieldRate, sector: form.sector, isETF: form.isETF, confirmed: form.confirmed })
      }
      showToast('已保存')
    } else {
      addManualStock({ code, name: form.name, sector: form.sector, price, dividendPerShare: div, yieldRate, confirmed: form.confirmed, isHK: form.isHK, isETF: form.isETF, isManual: true })
      showToast('已添加')
    }
    setShowAdd(false)
  }

  const handleDeleteStock = (stock: Stock, isManual: boolean) => {
    if (isManual) removeManualStock(stock.code)
    else hideStock(stock.code)
    showToast('已删除')
  }

  const handleStockRightClick = (e: React.MouseEvent, stock: Stock) => {
    e.preventDefault()
    const isManual = !!manualStocks.find(m => m.code === stock.code)
    setStockContextMenu({ x: e.clientX, y: e.clientY, stock, isManual })
  }

  const handleStockTouchStart = (e: React.TouchEvent, code: string) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    dragLocked.current = null
    dragInner.current = e.currentTarget as HTMLElement
    dragActions.current = e.currentTarget.nextElementSibling as HTMLElement
    if (swipeOpenCode && swipeOpenCode !== code) setSwipeOpenCode(null)
  }

  const handleStockTouchMove = (e: React.TouchEvent, code: string) => {
    const dx = e.touches[0].clientX - touchStartX.current
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current)
    if (!dragLocked.current) {
      dragLocked.current = dy > Math.abs(dx) ? 'v' : 'h'
    }
    if (dragLocked.current === 'v') return
    const base = swipeOpenCode === code ? -130 : 0
    const offset = Math.max(-130, Math.min(0, base + dx))
    if (dragInner.current) {
      dragInner.current.style.transform = `translateX(${offset}px)`
      dragInner.current.classList.add('dragging')
    }
    if (dragActions.current) {
      dragActions.current.style.transform = `translateX(${100 + (offset / 130) * 100}%)`
      dragActions.current.classList.add('dragging')
    }
  }

  const handleStockTouchEnd = (e: React.TouchEvent, code: string) => {
    if (dragInner.current) {
      dragInner.current.style.transform = ''
      dragInner.current.classList.remove('dragging')
    }
    if (dragActions.current) {
      dragActions.current.style.transform = ''
      dragActions.current.classList.remove('dragging')
    }
    if (dragLocked.current === 'v') return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const base = swipeOpenCode === code ? -130 : 0
    const finalOffset = base + dx
    if (finalOffset < -50) setSwipeOpenCode(code)
    else setSwipeOpenCode(null)
  }

  const submitSector = () => {
    if (!sectorInput.trim()) return
    if (renamingSector) {
      renameSector(renamingSector, sectorInput.trim())
      setRenamingSector(null)
    } else {
      addSector(sectorInput.trim())
    }
    setSectorInput('')
    setShowSectorModal(false)
  }

  return (
    <div className="page-content">
      {/* Header */}
      <div className="relative flex items-center justify-between px-4 pt-12 pb-3">
        <h1 className="absolute inset-x-0 text-center text-xl font-bold text-gray-900 pointer-events-none">发现</h1>
        <div className="flex gap-2">
          <button onClick={handleRefresh} className="p-2 text-gray-500">
            <svg className={`w-5 h-5 ${loading ? 'spinner' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M4 12a8 8 0 0 1 14.93-4M20 12a8 8 0 0 1-14.93 4" strokeLinecap="round"/>
              <path d="M20 4v4h-4M4 20v-4h4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button onClick={openAddForm} className="p-2 text-red-600">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="9"/>
              <path d="M12 8v8M8 12h8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Sector tabs */}
      <div className="sector-tabs">
        {customSectors.map(sector => (
          <button
            key={sector}
            className={`sector-tab ${activeSector === sector ? 'active' : ''}`}
            onClick={() => setActiveSector(sector)}
            onContextMenu={e => { e.preventDefault(); setSectorContextMenu(sector) }}
            onTouchStart={() => {
              sectorLongPressTimer.current = window.setTimeout(() => {
                setSectorContextMenu(sector)
              }, 500)
            }}
            onTouchEnd={() => { if (sectorLongPressTimer.current) { clearTimeout(sectorLongPressTimer.current); sectorLongPressTimer.current = null } }}
            onTouchMove={() => { if (sectorLongPressTimer.current) { clearTimeout(sectorLongPressTimer.current); sectorLongPressTimer.current = null } }}
          >
            {sector}
          </button>
        ))}
        <button
          className="sector-tab"
          onClick={() => { setSectorInput(''); setRenamingSector(null); setShowSectorModal(true) }}
        >
          + 板块
        </button>
      </div>

      {/* Stocks list */}
      <div className="px-4 pb-4">
        <div className="card overflow-hidden">
          {displayStocks.length === 0 ? (
            <div className="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" strokeLinecap="round"/>
              </svg>
              <p className="text-sm">该板块暂无股票</p>
              <button onClick={openAddForm} className="mt-3 text-red-600 text-sm font-medium">+ 添加股票</button>
            </div>
          ) : (
            displayStocks.map((stock) => {
              const inWatchlist = !!watchlist.find(w => w.code === stock.code)
              const isManual = !!manualStocks.find(m => m.code === stock.code)
              const isOpen = swipeOpenCode === stock.code
              return (
                <div key={stock.code} className="stock-item-wrapper">
                  <div
                    className={`stock-item-inner ${isOpen ? 'swiped' : ''}`}
                    onContextMenu={e => handleStockRightClick(e, stock)}
                    onTouchStart={e => handleStockTouchStart(e, stock.code)}
                    onTouchMove={e => handleStockTouchMove(e, stock.code)}
                    onTouchEnd={e => handleStockTouchEnd(e, stock.code)}
                    onClick={() => isOpen && setSwipeOpenCode(null)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-semibold text-gray-900">{stock.name}</span>
                        {stock.confirmed ? <span className="tag tag-blue">确认</span> : <span className="tag tag-gray">预估</span>}
                        {isManual && !stock.isETF && <span className="tag tag-gray">手动</span>}
                        {stock.isETF && <span className="tag tag-blue">ETF</span>}
                        {stock.isHK && <span className="tag tag-yellow">港股</span>}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span>{stock.code}</span>
                        <span>{stock.isETF ? '每份红利' : '每股红利'} ¥{stock.dividendPerShare.toFixed(3)}</span>
                        {stock.pctChg != null && (
                          <span className={stock.pctChg >= 0 ? 'text-red-500' : 'text-green-600'}>
                            {stock.pctChg >= 0 ? '+' : ''}{stock.pctChg.toFixed(2)}%
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 ml-3">
                      <span className="text-sm font-semibold text-gray-900">
                        ¥{stock.isHK ? stock.price.toFixed(3) : stock.price.toFixed(2)}
                        {stock.isHK && <span className="text-xs text-gray-400 ml-1">HKD</span>}
                      </span>
                      <YieldBadge rate={stock.yieldRate} />
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); handleAddToWatchlist(stock) }}
                      className={`ml-3 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                        inWatchlist ? 'bg-red-600 text-white' : 'bg-red-50 text-red-300'
                      }`}
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill={inWatchlist ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                      </svg>
                    </button>
                  </div>
                  <div className={`stock-swipe-actions ${isOpen ? 'visible' : ''}`}>
                    <button className="swipe-action-edit" onClick={() => { openEditModal(stock, isManual); setSwipeOpenCode(null) }}>编辑</button>
                    <button className="swipe-action-delete" onClick={() => { handleDeleteStock(stock, isManual); setSwipeOpenCode(null) }}>删除</button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Add/Edit Stock Modal */}
      <Modal open={showAdd} onClose={() => { setShowAdd(false); setSearchQuery(''); setSearchResults([]); setFormErrors({}) }} title={editStock ? '编辑股票' : '添加股票'}>
        <div className="space-y-3">
          {!editStock && (
            <div className="relative">
              <label className="text-xs text-gray-500 mb-1 block">搜索股票</label>
              <input
                className="input-field"
                placeholder="输入名称或代码搜索"
                value={searchQuery}
                onChange={e => handleSearchInput(e.target.value)}
                autoComplete="off"
              />
              {searching && <div className="absolute right-3 top-9 text-gray-400 text-xs">搜索中…</div>}
              {searchResults.length > 0 && (
                <div className="absolute z-50 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg mt-1 overflow-hidden">
                  {searchResults.map(r => (
                    <button
                      key={r.code}
                      className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 text-left"
                      onClick={() => selectSearchResult(r)}
                    >
                      <span className="text-sm font-medium text-gray-900">{r.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{r.code}</span>
                        {r.isHK && <span className="tag tag-yellow">港股</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">股票名称</label>
            <input className={`input-field ${formErrors.name ? 'border-red-400 bg-red-50' : ''}`} placeholder="如：招商银行" value={form.name} onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setFormErrors(fe => ({ ...fe, name: false })) }} />
            {formErrors.name && <p className="text-xs text-red-500 mt-1">请输入股票名称</p>}
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">股票代码</label>
            <input className={`input-field ${formErrors.code ? 'border-red-400 bg-red-50' : ''}`} placeholder="如：600036" value={form.code} onChange={e => { setForm(f => ({ ...f, code: e.target.value })); setFormErrors(fe => ({ ...fe, code: false })) }} disabled={!!editStock} />
            {formErrors.code && <p className="text-xs text-red-500 mt-1">请输入股票代码</p>}
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">当前价格</label>
              <input className={`input-field ${formErrors.price ? 'border-red-400 bg-red-50' : ''}`} type="number" placeholder="0.00" value={form.price} onChange={e => { setForm(f => ({ ...f, price: e.target.value })); setFormErrors(fe => ({ ...fe, price: false })) }} />
              {formErrors.price && <p className="text-xs text-red-500 mt-1">请输入价格</p>}
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">每股红利</label>
              <input className={`input-field ${formErrors.dividendPerShare ? 'border-red-400 bg-red-50' : ''}`} type="number" placeholder="0.000" value={form.dividendPerShare} onChange={e => { setForm(f => ({ ...f, dividendPerShare: e.target.value })); setFormErrors(fe => ({ ...fe, dividendPerShare: false })) }} />
              {formErrors.dividendPerShare && <p className="text-xs text-red-500 mt-1">请输入红利</p>}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">所属板块</label>
            <select className="input-field" value={form.sector} onChange={e => setForm(f => ({ ...f, sector: e.target.value, isETF: e.target.value === '红利ETF' ? true : f.isETF }))}>
              {customSectors.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="isHK" checked={form.isHK} onChange={e => setForm(f => ({ ...f, isHK: e.target.checked }))} />
            <label htmlFor="isHK" className="text-sm text-gray-700">港股（价格单位：HKD）</label>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="isETF" checked={form.isETF} onChange={e => setForm(f => ({ ...f, isETF: e.target.checked }))} />
            <label htmlFor="isETF" className="text-sm text-gray-700">ETF 基金</label>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="confirmed" checked={form.confirmed} onChange={e => setForm(f => ({ ...f, confirmed: e.target.checked }))} />
            <label htmlFor="confirmed" className="text-sm text-gray-700">股息已确认（取消勾选为预估）</label>
          </div>
          {form.price && form.dividendPerShare && (
            <div className="bg-red-50 rounded-lg p-3 text-sm">
              <span className="text-gray-500">预计股息率：</span>
              <span className="text-red-600 font-semibold ml-1">
                {(() => {
                  const p = parseFloat(form.price)
                  const d = parseFloat(form.dividendPerShare)
                  const pCny = form.isHK ? p * exchangeRate : p
                  const dCny = form.isHK ? d * exchangeRate : d
                  return pCny > 0 ? ((dCny / pCny) * 100).toFixed(2) + '%' : '-'
                })()}
              </span>
            </div>
          )}
          <button className="btn-primary mt-2" onClick={submitForm}>
            {editStock ? '保存修改' : '添加股票'}
          </button>
        </div>
      </Modal>

      {/* Add Sector Modal */}
      <Modal open={showSectorModal} onClose={() => setShowSectorModal(false)} title={renamingSector ? '重命名板块' : '添加板块'}>
        <div className="space-y-3">
          <input
            className="input-field"
            placeholder="板块名称"
            value={sectorInput}
            onChange={e => setSectorInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submitSector()}
            autoFocus
          />
          <button className="btn-primary" onClick={submitSector}>确认</button>
        </div>
      </Modal>

      {/* Stock right-click context menu (PC) */}
      {stockContextMenu && (
        <>
          <div className="fixed inset-0 z-[200]" onClick={() => setStockContextMenu(null)} />
          <div
            className="context-menu"
            style={{ left: Math.min(stockContextMenu.x, window.innerWidth - 160), top: stockContextMenu.y, position: 'fixed', zIndex: 300 }}
          >
            <div className="context-menu-item" onClick={() => { openEditModal(stockContextMenu.stock, stockContextMenu.isManual); setStockContextMenu(null) }}>编辑</div>
            <div className="context-menu-item danger" onClick={() => { handleDeleteStock(stockContextMenu.stock, stockContextMenu.isManual); setStockContextMenu(null) }}>删除</div>
          </div>
        </>
      )}

      {/* Sector context menu */}
      {sectorContextMenu && (
        <>
          <div className="fixed inset-0 z-[200]" onClick={() => setSectorContextMenu(null)} />
          <div
            className="context-menu"
            style={{ left: Math.min(16, window.innerWidth - 160), top: 140, position: 'fixed', zIndex: 300 }}
          >
            <div className="context-menu-item" onClick={() => {
              setSectorInput(sectorContextMenu)
              setRenamingSector(sectorContextMenu)
              setShowSectorModal(true)
              setSectorContextMenu(null)
            }}>
              重命名
            </div>
            <div className="context-menu-item danger" onClick={() => {
              const sec = sectorContextMenu
              const stocksInSector = manualStocks.filter(m => m.sector === sec)
              if (stocksInSector.length > 0) {
                const target = customSectors.find(s => s !== sec) || '其他'
                stocksInSector.forEach(s => updateManualStock(s.code, { sector: target }))
              }
              if (activeSector === sec) setActiveSector(customSectors.find(s => s !== sec) || '其他')
              deleteSector(sec)
              setSectorContextMenu(null)
              showToast('已删除板块')
            }}>
              删除板块
            </div>
          </div>
        </>
      )}

      <Disclaimer />
      <Toast message={message} />
    </div>
  )
}
