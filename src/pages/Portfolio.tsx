import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useStore } from '../store'
import Disclaimer from '../components/Disclaimer'
import { afterTax } from '../utils/tax'
import { fetchStockPrices } from '../utils/api'
import { isIncluded, resolveCategory, labelOf, colorOf, CATEGORIES, type Category } from '../utils/categories'
import type { WatchlistStock } from '../types'

const COLORS = ['#E03025','#3B82F6','#F59E0B','#EF4444','#8B5CF6','#EC4899','#14B8A6','#F97316','#6366F1','#84CC16']

export default function Portfolio() {
  const navigate = useNavigate()
  const watchlist = useStore(s => s.watchlist)
  const exchangeRate = useStore(s => s.exchangeRate)
  const usdRate = useStore(s => s.usdRate)
  const batchUpdateWatchlist = useStore(s => s.batchUpdateWatchlist)
  const categoryOverrides = useStore(s => s.categoryOverrides)
  const [chartType, setChartType] = useState<'div' | 'cost'>('div')
  const [chartGroup, setChartGroup] = useState<'sector' | 'stock' | 'category'>('sector')

  useEffect(() => {
    if (!watchlist.length) return
    const inputs = watchlist.map(s => ({ code: s.code, isHK: s.isHK, isUS: s.isUS }))
    fetchStockPrices(inputs, false).then(priceMap => {
      const updates: Record<string, Partial<WatchlistStock>> = {}
      watchlist.forEach(s => {
        const pd = priceMap[s.code]
        if (!pd) return
        const priceCny = s.isHK ? pd.price * exchangeRate : s.isUS ? pd.price * usdRate : pd.price
        const divCny = s.isHK ? s.dividendPerShare * exchangeRate : s.isUS ? s.dividendPerShare * usdRate : s.dividendPerShare
        const rawYield = priceCny > 0 ? (divCny / priceCny) * 100 : 0
        updates[s.code] = {
          price: pd.price,
          pctChg: pd.pctChg,
          yieldRate: rawYield > 30 ? s.yieldRate : rawYield,
        }
      })
      if (Object.keys(updates).length) batchUpdateWatchlist(updates)
    })
  }, [])
  const holdings = useMemo(
    () => watchlist.filter(s => s.shares && Number(s.shares) > 0),
    [watchlist]
  )

  const holdingsWithDisplay = useMemo(() => {
    const nameCounts: Record<string, number> = {}
    for (const s of holdings) nameCounts[s.name] = (nameCounts[s.name] || 0) + 1
    return holdings.map(s => ({
      stock: s,
      displayName: nameCounts[s.name] > 1 ? `${s.name}(${s.isHK ? '港' : s.isUS ? '美' : 'A'})` : s.name,
    }))
  }, [holdings])

  const metrics = useMemo(() => {
    let totalAnnual = 0
    let totalCost = 0
    let totalMarket = 0
    let shMarket = 0   // 沪市市值（仅 A 股）
    let szMarket = 0   // 深市市值（仅 A 股）

    holdings.forEach(s => {
      const shares = Number(s.shares) || 0
      const costPrice = Number(s.costPrice) || 0
      const priceCny = s.isHK ? s.price * exchangeRate : s.isUS ? s.price * usdRate : s.price
      const divCny = s.isHK ? s.dividendPerShare * exchangeRate : s.isUS ? s.dividendPerShare * usdRate : s.dividendPerShare
      const annualDiv = afterTax(divCny * shares, s)
      const market = priceCny * shares

      totalAnnual += annualDiv
      totalMarket += market
      // 沪深细分：境内标的(非港非美)，6/9 开头沪市(含沪B 900) / 0、2、3 开头深市(含深B 200)
      if (!s.isHK && !s.isUS) {
        const head = String(s.code).charAt(0)
        if (head === '6' || head === '9') shMarket += market
        else if (head === '0' || head === '2' || head === '3') szMarket += market
      }
      const hasCost = s.costPrice !== undefined && s.costPrice !== null && s.costPrice !== ''
      const costPriceCny = hasCost
        ? (s.isHK ? costPrice * exchangeRate : s.isUS ? costPrice * usdRate : costPrice)
        : priceCny
      totalCost += costPriceCny * shares
    })

    const overallYield = totalCost > 0 ? (totalAnnual / totalCost) * 100 : 0
    const profitLoss = totalMarket - totalCost

    return {
      annualDiv: totalAnnual,
      monthlyIncome: totalAnnual / 12,
      totalCost,
      totalMarket,
      profitLoss,
      profitLossRatio: totalCost > 0 ? (profitLoss / totalCost) * 100 : 0,
      overallYield,
      shMarket,
      szMarket,
      shPct: totalMarket > 0 ? (shMarket / totalMarket) * 100 : 0,
      szPct: totalMarket > 0 ? (szMarket / totalMarket) * 100 : 0,
      hasShSz: shMarket > 0 || szMarket > 0,
      stockCount: watchlist.length,
      hasHoldings: holdings.length > 0,
    }
  }, [holdings, watchlist.length, exchangeRate, usdRate])

  const chartData = useMemo<{ name: string; value: number; color?: string }[]>(() => {
    const useCost = chartType === 'cost'
    const valOf = (s: WatchlistStock) => {
      const shares = Number(s.shares) || 0
      if (useCost) {
        const priceCny = s.isHK ? s.price * exchangeRate : s.isUS ? s.price * usdRate : s.price
        return priceCny * shares
      }
      const divCny = s.isHK ? s.dividendPerShare * exchangeRate : s.isUS ? s.dividendPerShare * usdRate : s.dividendPerShare
      return afterTax(divCny * shares, s)
    }

    // 三大类：排除美股/ETF，固定配色与顺序，未分类垫底
    if (chartGroup === 'category') {
      const sums: Record<string, number> = { weak: 0, strong: 0, consume: 0, '': 0 }
      holdings.forEach(s => {
        if (!isIncluded(s)) return
        const v = valOf(s)
        if (v <= 0) return
        const cat = resolveCategory(s, categoryOverrides)
        sums[cat] = (sums[cat] || 0) + v
      })
      const order: (Category | '')[] = [...CATEGORIES, '']
      return order
        .filter(cat => (sums[cat] || 0) > 0)
        .map(cat => ({ name: labelOf(cat), value: parseFloat(sums[cat].toFixed(2)), color: colorOf(cat) }))
    }

    if (chartGroup === 'sector') {
      const bySector: Record<string, number> = {}
      holdings.forEach(s => {
        const sector = (s.sector || '').trim() || '其他'
        bySector[sector] = (bySector[sector] || 0) + valOf(s)
      })
      return Object.entries(bySector)
        .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }))
        .filter(d => d.value > 0)
    }

    // 个股
    return holdingsWithDisplay
      .map(({ stock: s, displayName }) => ({ name: displayName, value: parseFloat(valOf(s).toFixed(2)) }))
      .filter(d => d.value > 0)
  }, [holdings, holdingsWithDisplay, exchangeRate, usdRate, chartType, chartGroup, categoryOverrides])



  return (
    <div className="page-content">
      <div className="px-4 pt-12 pb-3">
        <h1 className="text-xl font-bold text-gray-900 text-center">收益</h1>
      </div>

      {/* Summary cards */}
      <div className="px-4 mb-4">
        <div className="card p-4">
          {/* 顶部：两个大数字并排 */}
          <div className="flex justify-between items-start">
            <div>
              <div className="text-xs text-gray-400 mb-1">年度红利（税后）</div>
              <div className="text-3xl font-bold text-red-600">¥{metrics.annualDiv.toFixed(0)}</div>
            </div>
            {metrics.hasHoldings ? (
              <div className="text-right">
                <div className="text-xs text-gray-400 mb-1">持仓盈亏</div>
                <div className={`text-3xl font-bold ${metrics.profitLoss >= 0 ? 'text-red-500' : 'text-green-600'}`}>
                  {metrics.profitLoss >= 0 ? '+' : ''}¥{Math.abs(metrics.profitLoss).toFixed(0)}
                </div>
                <div className={`text-sm font-semibold ${metrics.profitLossRatio >= 0 ? 'text-red-400' : 'text-green-500'}`}>
                  {metrics.profitLossRatio >= 0 ? '+' : ''}{metrics.profitLossRatio.toFixed(2)}%
                </div>
              </div>
            ) : (
              <div className="text-right">
                <div className="text-xs text-gray-400 mb-1">月均收入</div>
                <div className="text-3xl font-bold text-red-600">¥{metrics.monthlyIncome.toFixed(0)}</div>
              </div>
            )}
          </div>

          {/* 辅助数据：两列 */}
          {metrics.hasHoldings && (
            <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-y-3 gap-x-6">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">月均收入</span>
                <span className="font-medium text-red-600">¥{metrics.monthlyIncome.toFixed(0)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">整体股息率</span>
                <span className="font-medium text-red-600">{metrics.overallYield.toFixed(2)}%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">持仓市值</span>
                <span className="font-medium text-red-600">¥{metrics.totalMarket.toFixed(0)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">成本金额</span>
                <span className="font-medium text-red-600">¥{metrics.totalCost.toFixed(0)}</span>
              </div>
              {metrics.hasShSz && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">沪市市值</span>
                    <span className="font-medium text-gray-700">¥{metrics.shMarket.toFixed(0)} <span className="text-xs text-gray-400">{metrics.shPct.toFixed(1)}%</span></span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">深市市值</span>
                    <span className="font-medium text-gray-700">¥{metrics.szMarket.toFixed(0)} <span className="text-xs text-gray-400">{metrics.szPct.toFixed(1)}%</span></span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Distribution chart */}
      {chartData.length > 0 && (
        <div className="px-4 mb-4">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-gray-800">
                {chartGroup === 'category' ? '三大类占比' : chartType === 'cost' ? '市值分布' : '红利分布'}
              </span>
              <div className="flex gap-1">
                {(['div', 'cost'] as const).map(t => (
                  <button key={t} onClick={() => setChartType(t)}
                    className={`text-xs px-3 py-1 rounded-full border ${chartType === t ? 'bg-red-600 text-white border-red-600' : 'border-gray-200 text-gray-500'}`}>
                    {t === 'div' ? '红利' : '市值'}
                  </button>
                ))}
                <div className="w-px bg-gray-200 mx-0.5" />
                {(['sector', 'stock', 'category'] as const).map(g => (
                  <button key={g} onClick={() => setChartGroup(g)}
                    className={`text-xs px-3 py-1 rounded-full border ${chartGroup === g ? 'bg-gray-700 text-white border-gray-700' : 'border-gray-200 text-gray-500'}`}>
                    {g === 'sector' ? '板块' : g === 'stock' ? '个股' : '三大类'}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={d.color || COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => {
                      const total = chartData.reduce((s, d) => s + d.value, 0)
                      const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0'
                      const label = chartType === 'cost' ? '持仓市值' : '年红利'
                      return [`¥${value.toFixed(2)} (${pct}%)`, label]
                    }}
                    contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(() => {
                const total = chartData.reduce((s, d) => s + d.value, 0)
                return [...chartData]
                  .sort((a, b) => b.value - a.value)
                  .map((d) => {
                    const origIdx = chartData.indexOf(d)
                    const color = d.color || COLORS[origIdx % COLORS.length]
                    return (
                      <div key={d.name} className="flex items-center gap-1 text-xs text-gray-600">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                        <span>{d.name}</span>
                        <span className="text-gray-400">¥{d.value.toFixed(0)}</span>
                        <span className="font-medium" style={{ color }}>
                          {total > 0 ? ((d.value / total) * 100).toFixed(1) : 0}%
                        </span>
                      </div>
                    )
                  })
              })()}
            </div>
          </div>
        </div>
      )}

      <div className="px-4 pb-2">
        <button
          onClick={() => navigate('/support')}
          className="w-full card p-4 flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">☕</span>
            <div className="text-left">
              <div className="text-sm font-semibold text-gray-800">支持与联系</div>
              <div className="text-xs text-gray-400">如果有帮助，欢迎请我喝杯咖啡</div>
            </div>
          </div>
          <svg className="w-4 h-4 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
      <Disclaimer />
    </div>
  )
}
