import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fetchStockPrices } from '../utils/api'
import Disclaimer from '../components/Disclaimer'
import { afterTax } from '../utils/tax'
import type { WatchlistStock } from '../types'
import { Toast, useToast } from '../components/Toast'

const TAX_OPTIONS: { value: WatchlistStock['taxType']; label: string }[] = [
  { value: 'h', label: 'H股 20%' },
  { value: 'n', label: '非H股 28%' },
  { value: 'a', label: '港户 10%' },
]

function YieldBadge({ rate }: { rate: number }) {
  const cls = rate >= 5 ? 'tag-green' : rate >= 4 ? 'tag-yellow' : 'tag-gray'
  return <span className={`tag ${cls}`}>{rate.toFixed(2)}%</span>
}

function SkeletonCard() {
  return (
    <div className="card overflow-hidden animate-pulse">
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="h-4 bg-gray-200 rounded w-24 mb-2" />
            <div className="h-3 bg-gray-100 rounded w-16" />
          </div>
          <div className="text-right">
            <div className="h-4 bg-gray-200 rounded w-16 mb-2" />
            <div className="h-3 bg-gray-100 rounded w-10 ml-auto" />
          </div>
        </div>
        <div className="h-5 bg-gray-100 rounded-full w-20 mb-3" />
        <div className="flex gap-3">
          <div className="flex-1 h-9 bg-gray-100 rounded-lg" />
          <div className="flex-1 h-9 bg-gray-100 rounded-lg" />
        </div>
      </div>
      <div className="flex border-t border-gray-50">
        <div className="flex-1 py-2.5 flex justify-center">
          <div className="h-3 bg-gray-100 rounded w-16" />
        </div>
        <div className="w-px bg-gray-50" />
        <div className="flex-1 py-2.5 flex justify-center">
          <div className="h-3 bg-gray-100 rounded w-12" />
        </div>
      </div>
    </div>
  )
}

const PULL_THRESHOLD = 65

type SortKey = 'default' | 'yield' | 'annual' | 'pnl'

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'default', label: '默认' },
  { key: 'yield', label: '股息率' },
  { key: 'annual', label: '年红利' },
  { key: 'pnl', label: '盈亏%' },
]

export default function Watchlist() {
  const watchlist = useStore(s => s.watchlist)
  const customSectors = useStore(s => s.customSectors)
  const exchangeRate = useStore(s => s.exchangeRate)
  const removeFromWatchlist = useStore(s => s.removeFromWatchlist)
  const updateWatchlistStock = useStore(s => s.updateWatchlistStock)
  const batchUpdateWatchlist = useStore(s => s.batchUpdateWatchlist)
  const [activeSector, setActiveSector] = useState('全部')
  const [loading, setLoading] = useState(false)
  const [pricesLoaded, setPricesLoaded] = useState(() => watchlist.every(s => s.price > 0))
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('default')
  const { message, showToast } = useToast()
  const navigate = useNavigate()

  // Pull-to-refresh
  const scrollRef = useRef<HTMLDivElement>(null)
  const touchStartY = useRef(0)
  const [pullY, setPullY] = useState(0)
  const [isPulling, setIsPulling] = useState(false)

  const sectors = ['全部', ...customSectors.filter(s => watchlist.some(w => w.sector === s))]
  const filtered = activeSector === '全部' ? watchlist : watchlist.filter(w => w.sector === activeSector)

  // 首次加载静默拉价格
  useEffect(() => {
    if (!watchlist.length) { setPricesLoaded(true); return }
    const inputs = watchlist.map(s => ({ code: s.code, isHK: s.isHK }))
    fetchStockPrices(inputs, false).then(priceMap => {
      const updates: Record<string, Partial<WatchlistStock>> = {}
      watchlist.forEach(s => {
        const pd = priceMap[s.code]
        if (!pd) return
        const priceCny = s.isHK ? pd.price * exchangeRate : pd.price
        const divCny = s.isHK ? s.dividendPerShare * exchangeRate : s.dividendPerShare
        const rawYield = priceCny > 0 ? (divCny / priceCny) * 100 : 0
        updates[s.code] = {
          price: pd.price,
          pctChg: pd.pctChg,
          yieldRate: rawYield > 30 ? s.yieldRate : rawYield,
        }
      })
      if (Object.keys(updates).length) batchUpdateWatchlist(updates)
      setPricesLoaded(true)
    }).catch(() => setPricesLoaded(true))
  }, [])

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    const scrollEl = scrollRef.current
    if (!scrollEl || scrollEl.scrollTop > 0 || loading) return
    const dy = e.touches[0].clientY - touchStartY.current
    if (dy > 0) {
      setPullY(Math.min(dy * 0.45, PULL_THRESHOLD + 16))
      setIsPulling(true)
    }
  }

  const handleTouchEnd = async () => {
    if (isPulling && pullY >= PULL_THRESHOLD && !loading) {
      setPullY(PULL_THRESHOLD)
      await handleRefresh()
    }
    setPullY(0)
    setIsPulling(false)
  }

  const handleRefresh = async () => {
    if (!watchlist.length) return
    setLoading(true)
    try {
      const inputs = watchlist.map(s => ({ code: s.code, isHK: s.isHK }))
      const priceMap = await fetchStockPrices(inputs, true)
      const updates: Record<string, Partial<WatchlistStock>> = {}
      watchlist.forEach(s => {
        const pd = priceMap[s.code]
        if (!pd) return
        const priceCny = s.isHK ? pd.price * exchangeRate : pd.price
        const divCny = s.isHK ? s.dividendPerShare * exchangeRate : s.dividendPerShare
        const rawYield = priceCny > 0 ? (divCny / priceCny) * 100 : 0
        updates[s.code] = {
          price: pd.price,
          priceCny,
          yieldRate: rawYield > 30 ? s.yieldRate : rawYield,
          pctChg: pd.pctChg,
        }
      })
      if (Object.keys(updates).length) batchUpdateWatchlist(updates)
      showToast('价格已更新')
    } catch {
      showToast('更新失败')
    } finally {
      setLoading(false)
      setPullY(0)
      setIsPulling(false)
    }
  }

  const getAnnualDividend = (stock: WatchlistStock): number => {
    const shares = Number(stock.shares) || 0
    if (!shares) return 0
    const divCny = stock.isHK ? stock.dividendPerShare * exchangeRate : stock.dividendPerShare
    return afterTax(divCny * shares, stock)
  }

  const getLiveYield = (s: WatchlistStock) =>
    s.price > 0 ? (s.dividendPerShare / s.price) * 100 : 0

  const sortedFiltered = [...filtered].sort((a, b) => {
    if (sortKey === 'yield') return getLiveYield(b) - getLiveYield(a)
    if (sortKey === 'annual') return getAnnualDividend(b) - getAnnualDividend(a)
    if (sortKey === 'pnl') {
      const getCostCny = (s: WatchlistStock) => {
        const cost = Number(s.costPrice)
        if (!cost) return null
        return s.isHK ? cost * exchangeRate : cost
      }
      const costA = getCostCny(a), costB = getCostCny(b)
      const negA = costA !== null && costA < 0
      const negB = costB !== null && costB < 0
      // 负成本置顶，越负越前
      if (negA && negB) return (costA ?? 0) - (costB ?? 0)
      if (negA) return -1
      if (negB) return 1
      // 无成本排最后
      if (costA === null && costB === null) return 0
      if (costA === null) return 1
      if (costB === null) return -1
      // 正成本按盈亏%降序
      const priceCnyA = a.isHK ? a.price * exchangeRate : a.price
      const priceCnyB = b.isHK ? b.price * exchangeRate : b.price
      const pnlA = (priceCnyA - costA) / costA * 100
      const pnlB = (priceCnyB - costB) / costB * 100
      return pnlB - pnlA
    }
    return 0
  })

  const totalAnnual = filtered.reduce((sum, s) => sum + getAnnualDividend(s), 0)
  const totalMonthly = totalAnnual / 12

  return (
    <div
      className="page-content"
      ref={scrollRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      <div
        style={{
          height: pullY,
          overflow: 'hidden',
          transition: isPulling ? 'none' : 'height 0.25s ease',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          paddingBottom: pullY > 0 ? 8 : 0,
        }}
      >
        <svg
          className={`w-5 h-5 text-gray-400 ${loading ? 'spinner' : ''}`}
          style={{
            transform: loading ? 'none' : `rotate(${Math.min((pullY / PULL_THRESHOLD) * 180, 180)}deg)`,
            transition: isPulling ? 'none' : 'transform 0.25s ease',
          }}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
        >
          <path d="M4 12a8 8 0 0 1 14.93-4M20 12a8 8 0 0 1-14.93 4" strokeLinecap="round"/>
          <path d="M20 4v4h-4M4 20v-4h4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {/* Header */}
      <div className="px-4 pt-12 pb-2">
        <div className="flex items-center justify-center mb-2">
          <h1 className="text-xl font-bold text-gray-900">自选</h1>
        </div>
        <div className="flex items-center justify-center gap-1">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setSortKey(opt.key)}
              className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                sortKey === opt.key
                  ? 'bg-red-600 text-white'
                  : 'text-gray-400'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Income summary */}
      {totalAnnual > 0 && (
        <div className="mx-4 mb-3 card p-4">
          <div className="flex gap-4">
            <div>
              <div className="stat-number text-red-600">¥{totalAnnual.toFixed(0)}</div>
              <div className="stat-label">年度红利（税后）</div>
            </div>
            <div className="w-px bg-gray-100" />
            <div>
              <div className="stat-number text-red-600">¥{totalMonthly.toFixed(0)}</div>
              <div className="stat-label">月均收入</div>
            </div>
          </div>
        </div>
      )}

      {/* Sector filter */}
      {sectors.length > 1 && (
        <div className="sector-tabs">
          {sectors.map(s => (
            <button key={s} className={`sector-tab ${activeSector === s ? 'active' : ''}`} onClick={() => setActiveSector(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Stock list */}
      <div className="px-4 pb-4">
        {!pricesLoaded && watchlist.length > 0 ? (
          <div className="space-y-3">
            {watchlist.slice(0, 4).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p className="text-sm">暂无自选股票</p>
            <p className="text-xs text-gray-400 mt-1">在"发现"页面添加股票</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedFiltered.map(stock => {
              const annualDiv = getAnnualDividend(stock)
              const priceCny = stock.isHK ? stock.price * exchangeRate : stock.price
              const costPriceCny = stock.costPrice && Number(stock.costPrice) > 0
                ? (stock.isHK ? Number(stock.costPrice) * exchangeRate : Number(stock.costPrice))
                : null
              const shares = Number(stock.shares) || 0
              const unrealized = costPriceCny && shares ? (priceCny - costPriceCny) * shares : null
              const unrealizedPct = costPriceCny ? ((priceCny - costPriceCny) / costPriceCny) * 100 : null
              return (
                <div key={stock.code} className="card overflow-hidden">
                  {/* Main row */}
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900">{stock.name}</span>
                          <span className="text-xs text-gray-400">{stock.code}</span>
                          {stock.isETF && <span className="tag tag-blue">ETF</span>}
                          {stock.isHK && <span className="tag tag-yellow">港股</span>}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {stock.isETF ? '每份红利' : '每股红利'} ¥{stock.dividendPerShare.toFixed(3)}
                          {stock.isHK && <span className="ml-1 text-gray-400">(≈¥{(stock.dividendPerShare * exchangeRate).toFixed(3)} CNY)</span>}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-gray-900">
                          ¥{stock.price.toFixed(2)}
                          {stock.isHK && <span className="text-xs text-gray-400 ml-1">HKD</span>}
                        </div>
                        {stock.pctChg != null && (
                          <div className={`text-xs ${stock.pctChg >= 0 ? 'text-red-500' : 'text-green-600'}`}>
                            {stock.pctChg >= 0 ? '+' : ''}{stock.pctChg.toFixed(2)}%
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mb-3">
                      <YieldBadge rate={stock.yieldRate} />
                      {stock.isHK && (
                        <div className="flex gap-1">
                          {TAX_OPTIONS.map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => updateWatchlistStock(stock.code, { taxType: opt.value })}
                              className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                                stock.taxType === opt.value
                                  ? 'bg-red-600 text-white border-red-600'
                                  : 'border-gray-200 text-gray-500'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                      {!stock.isHK && <span className="tag tag-green">免税</span>}
                    </div>

                    {/* Holdings */}
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className="text-xs text-gray-400 block mb-1">持股数量</label>
                        <input
                          className="input-field text-sm"
                          type="number"
                          min="0"
                          placeholder="0"
                          value={stock.shares || ''}
                          onChange={e => updateWatchlistStock(stock.code, { shares: Number(e.target.value) || undefined })}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-gray-400 block mb-1">成本价</label>
                        <input
                          className="input-field text-sm"
                          type="number"
                          min="0"
                          placeholder="0.00"
                          value={stock.costPrice || ''}
                          onChange={e => updateWatchlistStock(stock.code, { costPrice: e.target.value })}
                        />
                      </div>
                    </div>

                    {(annualDiv > 0 || unrealized != null) && (
                      <div className="mt-3 bg-red-50 rounded-lg p-2.5 flex justify-around text-sm">
                        {annualDiv > 0 && (
                          <>
                            <div>
                              <span className="text-gray-500 text-xs">年红利</span>
                              <div className="font-semibold text-red-600">¥{annualDiv.toFixed(2)}</div>
                            </div>
                            <div>
                              <span className="text-gray-500 text-xs">月均</span>
                              <div className="font-semibold text-red-600">¥{(annualDiv / 12).toFixed(2)}</div>
                            </div>
                          </>
                        )}
                        {unrealized != null && unrealizedPct != null && (
                          <div>
                            <span className="text-gray-500 text-xs">持仓盈亏</span>
                            <div className={`font-semibold ${unrealized >= 0 ? 'text-red-500' : 'text-green-600'}`}>
                              {unrealized >= 0 ? '+' : ''}¥{Math.abs(unrealized).toFixed(0)}
                              <span className="text-xs ml-1">({unrealizedPct >= 0 ? '+' : ''}{unrealizedPct.toFixed(2)}%)</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex border-t border-gray-50">
                    <button
                      className="flex-1 py-2.5 text-xs text-gray-500 flex items-center justify-center gap-1"
                      onClick={() => navigate(`/matrix?code=${stock.code}&name=${stock.name}&dividend=${stock.dividendPerShare}&price=${priceCny.toFixed(2)}&isHK=${stock.isHK || false}`)}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18" strokeLinecap="round"/>
                      </svg>
                      决策矩阵
                    </button>
                    <div className="w-px bg-gray-50" />
                    <button
                      className="flex-1 py-2.5 text-xs text-red-400 flex items-center justify-center gap-1"
                      onClick={() => setConfirmRemove(stock.code)}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      移除
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Disclaimer />
      <Toast message={message} />

      {confirmRemove && (
        <div className="modal-backdrop" style={{ alignItems: 'center' }} onClick={() => setConfirmRemove(null)}>
          <div className="bg-white rounded-2xl p-6 mx-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <p className="text-base font-semibold text-gray-900 mb-1">移除自选</p>
            <p className="text-sm text-gray-500 mb-5">确定要移除该股票吗？</p>
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setConfirmRemove(null)}>取消</button>
              <button
                className="flex-1 py-3 bg-red-600 text-white rounded-xl font-semibold"
                onClick={() => { removeFromWatchlist(confirmRemove); setConfirmRemove(null); showToast('已移除') }}
              >确认移除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
