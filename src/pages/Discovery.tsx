import { useState, useCallback, useRef } from 'react'
import { useStore, getDiscoveryStocks } from '../store'
import { fetchStockPrices } from '../utils/api'
import { STATIC_STOCKS } from '../data/stocks'
import type { Stock } from '../types'
import Modal from '../components/Modal'
import { Toast, useToast } from '../components/Toast'

const CHART_COLORS = ['#10B981','#3B82F6','#F59E0B','#EF4444','#8B5CF6','#EC4899','#14B8A6','#F97316','#6366F1','#84CC16']

function YieldBadge({ rate }: { rate: number }) {
  const cls = rate >= 5 ? 'tag-green' : rate >= 4 ? 'tag-yellow' : 'tag-gray'
  return <span className={`tag ${cls}`}>{rate.toFixed(2)}%</span>
}

interface ContextMenu {
  x: number; y: number
  stock: Stock
  isManual: boolean
}

export default function Discovery() {
  const { customSectors, watchlist, manualStocks, staticEdits, hiddenStocks,
    addToWatchlist, addManualStock, removeManualStock, updateManualStock,
    updateStaticEdit, hideStock, addSector, renameSector, deleteSector, setCustomSectors, exchangeRate } = useStore()

  const [activeSector, setActiveSector] = useState(customSectors[0] || '')
  const [stocks, setStocks] = useState<Stock[]>([])
  const [loading, setLoading] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [showSectorModal, setShowSectorModal] = useState(false)
  const [editStock, setEditStock] = useState<Stock | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [sectorInput, setSectorInput] = useState('')
  const [renamingSector, setRenamingSector] = useState<string | null>(null)
  const { message, showToast } = useToast()
  const longPressTimer = useRef<number | null>(null)

  const [form, setForm] = useState({ name: '', code: '', sector: activeSector, price: '', dividendPerShare: '', isHK: false })

  const currentStocks = useCallback(() => {
    const { staticEdits, hiddenStocks, manualStocks } = useStore.getState()
    const staticForSector = STATIC_STOCKS
      .filter(s => s.sector === activeSector && !hiddenStocks.includes(s.code))
      .map(s => ({ ...s, ...staticEdits[s.code] }))
    const manualForSector = manualStocks.filter(s => s.sector === activeSector)
    return [...staticForSector, ...manualForSector]
  }, [activeSector])

  const displayStocks = currentStocks()

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
        if (s.isManual) updateManualStock(s.code, { price: s.price, yieldRate: s.yieldRate })
        else updateStaticEdit(s.code, { price: s.price, yieldRate: s.yieldRate })
      })
      showToast('价格已更新')
    } catch {
      showToast('更新失败，请重试')
    }
    setLoading(false)
  }

  const handleAddToWatchlist = (stock: Stock) => {
    if (watchlist.find(w => w.code === stock.code)) {
      showToast('已在自选中')
      return
    }
    addToWatchlist(stock)
    showToast('已加入自选')
  }

  const openAddForm = () => {
    setForm({ name: '', code: '', sector: activeSector, price: '', dividendPerShare: '', isHK: false })
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
    })
    setContextMenu(null)
    setShowAdd(true)
  }

  const submitForm = () => {
    const price = parseFloat(form.price)
    const div = parseFloat(form.dividendPerShare)
    if (!form.name || !form.code || isNaN(price) || isNaN(div)) {
      showToast('请填写完整信息')
      return
    }
    const priceCny = form.isHK ? price * exchangeRate : price
    const divCny = form.isHK ? div * exchangeRate : div
    const yieldRate = priceCny > 0 ? (divCny / priceCny) * 100 : 0
    const code = form.isHK ? form.code.padStart(4, '0') : form.code.padStart(6, '0')

    if (editStock) {
      const isManualStock = manualStocks.find(m => m.code === editStock.code)
      if (isManualStock) {
        updateManualStock(editStock.code, { name: form.name, price, dividendPerShare: div, sector: form.sector, isHK: form.isHK, yieldRate })
      } else {
        updateStaticEdit(editStock.code, { price, dividendPerShare: div, yieldRate, sector: form.sector })
      }
      showToast('已保存')
    } else {
      addManualStock({ code, name: form.name, sector: form.sector, price, dividendPerShare: div, yieldRate, confirmed: false, isHK: form.isHK, isManual: true })
      showToast('已添加')
    }
    setShowAdd(false)
  }

  const handleDeleteStock = (stock: Stock, isManual: boolean) => {
    if (isManual) removeManualStock(stock.code)
    else hideStock(stock.code)
    setContextMenu(null)
    showToast('已删除')
  }

  const handleLongPress = (e: React.MouseEvent | React.TouchEvent, stock: Stock) => {
    const isManual = !!manualStocks.find(m => m.code === stock.code)
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    setContextMenu({ x: rect.left, y: rect.bottom + 4, stock, isManual })
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
      <div className="flex items-center justify-between px-4 pt-12 pb-3">
        <h1 className="text-xl font-bold text-gray-900">发现</h1>
        <div className="flex gap-2">
          <button onClick={handleRefresh} className="p-2 text-gray-500">
            <svg className={`w-5 h-5 ${loading ? 'spinner' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M4 12a8 8 0 0 1 14.93-4M20 12a8 8 0 0 1-14.93 4" strokeLinecap="round"/>
              <path d="M20 4v4h-4M4 20v-4h4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button onClick={openAddForm} className="p-2 text-primary">
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
            onContextMenu={e => { e.preventDefault() }}
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
              <button onClick={openAddForm} className="mt-3 text-primary text-sm font-medium">+ 添加股票</button>
            </div>
          ) : (
            displayStocks.map((stock, idx) => {
              const inWatchlist = !!watchlist.find(w => w.code === stock.code)
              const isManual = !!manualStocks.find(m => m.code === stock.code)
              return (
                <div
                  key={stock.code}
                  className="stock-item"
                  onContextMenu={e => { e.preventDefault(); handleLongPress(e, stock) }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-gray-900">{stock.name}</span>
                      {stock.confirmed && <span className="tag tag-blue">确认</span>}
                      {isManual && <span className="tag tag-gray">手动</span>}
                      {stock.isHK && <span className="tag tag-yellow">港股</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>{stock.code}</span>
                      <span>每股红利 ¥{stock.dividendPerShare.toFixed(3)}</span>
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
                    onClick={() => handleAddToWatchlist(stock)}
                    className={`ml-3 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                      inWatchlist ? 'bg-primary-light text-primary' : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill={inWatchlist ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                    </svg>
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Add/Edit Stock Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={editStock ? '编辑股票' : '添加股票'}>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">股票名称</label>
            <input className="input-field" placeholder="如：招商银行" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">股票代码</label>
            <input className="input-field" placeholder="如：600036" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} disabled={!!editStock} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">当前价格</label>
              <input className="input-field" type="number" placeholder="0.00" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">每股红利</label>
              <input className="input-field" type="number" placeholder="0.000" value={form.dividendPerShare} onChange={e => setForm(f => ({ ...f, dividendPerShare: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">所属板块</label>
            <select className="input-field" value={form.sector} onChange={e => setForm(f => ({ ...f, sector: e.target.value }))}>
              {customSectors.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="isHK" checked={form.isHK} onChange={e => setForm(f => ({ ...f, isHK: e.target.checked }))} />
            <label htmlFor="isHK" className="text-sm text-gray-700">港股（价格单位：HKD）</label>
          </div>
          {form.price && form.dividendPerShare && (
            <div className="bg-green-50 rounded-lg p-3 text-sm">
              <span className="text-gray-500">预计股息率：</span>
              <span className="text-primary font-semibold ml-1">
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

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-[200]" onClick={() => setContextMenu(null)} />
          <div
            className="context-menu"
            style={{ left: Math.min(contextMenu.x, window.innerWidth - 160), top: contextMenu.y, position: 'fixed', zIndex: 300 }}
          >
            <div className="context-menu-item" onClick={() => openEditModal(contextMenu.stock, contextMenu.isManual)}>
              编辑
            </div>
            <div
              className="context-menu-item"
              onClick={() => { setSectorInput(''); setRenamingSector(activeSector); setShowSectorModal(true); setContextMenu(null) }}
            >
              重命名板块
            </div>
            <div className="context-menu-item danger" onClick={() => handleDeleteStock(contextMenu.stock, contextMenu.isManual)}>
              删除
            </div>
          </div>
        </>
      )}

      <Toast message={message} />
    </div>
  )
}
