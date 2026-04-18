import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fetchStockPrices } from '../utils/api'
import { getTaxRate, getTaxLabel, afterTax } from '../utils/tax'
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

export default function Watchlist() {
  const { watchlist, customSectors, removeFromWatchlist, updateWatchlistStock, exchangeRate } = useStore()
  const [activeSector, setActiveSector] = useState('全部')
  const [loading, setLoading] = useState(false)
  const [swipeOpen, setSwipeOpen] = useState<string | null>(null)
  const { message, showToast } = useToast()
  const navigate = useNavigate()

  const sectors = ['全部', ...customSectors.filter(s => watchlist.some(w => w.sector === s))]
  const filtered = activeSector === '全部' ? watchlist : watchlist.filter(w => w.sector === activeSector)

  const handleRefresh = async () => {
    if (!watchlist.length) return
    setLoading(true)
    try {
      const inputs = watchlist.map(s => ({ code: s.code, isHK: s.isHK }))
      const priceMap = await fetchStockPrices(inputs, true)
      watchlist.forEach(s => {
        const pd = priceMap[s.code]
        if (!pd) return
        const priceCny = s.isHK ? pd.price * exchangeRate : pd.price
        const divCny = s.isHK ? s.dividendPerShare * exchangeRate : s.dividendPerShare
        const rawYield = priceCny > 0 ? (divCny / priceCny) * 100 : 0
        updateWatchlistStock(s.code, {
          price: pd.price,
          priceCny,
          yieldRate: rawYield > 30 ? s.yieldRate : rawYield,
          pctChg: pd.pctChg,
        })
      })
      showToast('价格已更新')
    } catch {
      showToast('更新失败')
    }
    setLoading(false)
  }

  const getAnnualDividend = (stock: WatchlistStock): number => {
    const shares = Number(stock.shares) || 0
    if (!shares) return 0
    const divCny = stock.isHK ? stock.dividendPerShare * exchangeRate : stock.dividendPerShare
    return afterTax(divCny * shares, stock)
  }

  const totalAnnual = filtered.reduce((sum, s) => sum + getAnnualDividend(s), 0)
  const totalMonthly = totalAnnual / 12

  return (
    <div className="page-content">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-12 pb-2">
        <h1 className="text-xl font-bold text-gray-900">自选</h1>
        <button onClick={handleRefresh} className="p-2 text-gray-500">
          <svg className={`w-5 h-5 ${loading ? 'spinner' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M4 12a8 8 0 0 1 14.93-4M20 12a8 8 0 0 1-14.93 4" strokeLinecap="round"/>
            <path d="M20 4v4h-4M4 20v-4h4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Income summary */}
      {totalAnnual > 0 && (
        <div className="mx-4 mb-3 card p-4">
          <div className="flex gap-4">
            <div>
              <div className="stat-number text-primary">¥{totalAnnual.toFixed(0)}</div>
              <div className="stat-label">年度红利（税后）</div>
            </div>
            <div className="w-px bg-gray-100" />
            <div>
              <div className="stat-number">¥{totalMonthly.toFixed(0)}</div>
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
        {filtered.length === 0 ? (
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p className="text-sm">暂无自选股票</p>
            <p className="text-xs text-gray-400 mt-1">在"发现"页面添加股票</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(stock => {
              const annualDiv = getAnnualDividend(stock)
              const priceCny = stock.isHK ? stock.price * exchangeRate : stock.price
              return (
                <div key={stock.code} className="card overflow-hidden">
                  {/* Main row */}
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900">{stock.name}</span>
                          <span className="text-xs text-gray-400">{stock.code}</span>
                          {stock.isHK && <span className="tag tag-yellow">港股</span>}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          每股红利 ¥{stock.dividendPerShare.toFixed(3)}
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
                                  ? 'bg-primary text-white border-primary'
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

                    {annualDiv > 0 && (
                      <div className="mt-3 bg-green-50 rounded-lg p-2.5 flex gap-4 text-sm">
                        <div>
                          <span className="text-gray-500 text-xs">年红利</span>
                          <div className="font-semibold text-primary">¥{annualDiv.toFixed(2)}</div>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">月均</span>
                          <div className="font-semibold text-gray-800">¥{(annualDiv / 12).toFixed(2)}</div>
                        </div>
                        {stock.costPrice && Number(stock.costPrice) > 0 && stock.shares && (
                          <div>
                            <span className="text-gray-500 text-xs">成本收益率</span>
                            <div className="font-semibold text-gray-800">
                              {((annualDiv / (Number(stock.costPrice) * Number(stock.shares))) * 100).toFixed(2)}%
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
                      onClick={() => { removeFromWatchlist(stock.code); showToast('已移除') }}
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

      <Toast message={message} />
    </div>
  )
}
