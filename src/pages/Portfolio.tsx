import { useMemo, useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useStore } from '../store'
import Disclaimer from '../components/Disclaimer'
import { afterTax } from '../utils/tax'
import type { WatchlistStock } from '../types'

const COLORS = ['#E03025','#3B82F6','#F59E0B','#EF4444','#8B5CF6','#EC4899','#14B8A6','#F97316','#6366F1','#84CC16']

interface Achievement {
  id: string
  label: string
  description: string
  unlocked: boolean
  icon: string
}

function buildAchievements(annualDiv: number, monthlyIncome: number, yieldRate: number, stockCount: number, hasHoldings: boolean): Achievement[] {
  return [
    { id: 'first_stock', label: '起步', description: '添加第一只自选股', unlocked: stockCount >= 1, icon: '🌱' },
    { id: 'first_holding', label: '入场', description: '填入第一笔持股', unlocked: hasHoldings, icon: '💼' },
    { id: 'income_50', label: '月入50', description: '月均红利达到 ¥50', unlocked: monthlyIncome >= 50, icon: '☕' },
    { id: 'income_200', label: '月入200', description: '月均红利达到 ¥200', unlocked: monthlyIncome >= 200, icon: '🍜' },
    { id: 'income_500', label: '月入500', description: '月均红利达到 ¥500', unlocked: monthlyIncome >= 500, icon: '🛒' },
    { id: 'income_1000', label: '月入千元', description: '月均红利达到 ¥1000', unlocked: monthlyIncome >= 1000, icon: '🎯' },
    { id: 'income_3000', label: '月入3000', description: '月均红利达到 ¥3000', unlocked: monthlyIncome >= 3000, icon: '🏆' },
    { id: 'income_5000', label: '月入5000', description: '月均红利达到 ¥5000', unlocked: monthlyIncome >= 5000, icon: '🚀' },
    { id: 'income_10000', label: '月入万元', description: '月均红利达到 ¥10000', unlocked: monthlyIncome >= 10000, icon: '👑' },
    { id: 'stocks_5', label: '小组合', description: '持有5只以上股票', unlocked: stockCount >= 5, icon: '📦' },
    { id: 'stocks_10', label: '多元化', description: '持有10只以上股票', unlocked: stockCount >= 10, icon: '🌈' },
    { id: 'yield_5', label: '5%收益率', description: '整体股息率达到5%', unlocked: yieldRate >= 5, icon: '📈' },
    { id: 'yield_6', label: '6%收益率', description: '整体股息率达到6%', unlocked: yieldRate >= 6, icon: '⚡' },
    { id: 'annual_1k', label: '年入千元', description: '年红利收入超过¥1000', unlocked: annualDiv >= 1000, icon: '💰' },
    { id: 'annual_5k', label: '年入5千', description: '年红利收入超过¥5000', unlocked: annualDiv >= 5000, icon: '💎' },
    { id: 'annual_10k', label: '年入万元', description: '年红利收入超过¥10000', unlocked: annualDiv >= 10000, icon: '🏅' },
    { id: 'daily_latte', label: '拿铁自由', description: '月收入覆盖30杯拿铁', unlocked: monthlyIncome >= 30 * 38, icon: '☕' },
    { id: 'daily_boba', label: '奶茶自由', description: '月收入覆盖60杯奶茶', unlocked: monthlyIncome >= 60 * 20, icon: '🧋' },
    { id: 'rent_cover', label: '房租刺客', description: '年红利超过¥36000', unlocked: annualDiv >= 36000, icon: '🏠' },
    { id: 'yield_8', label: '高息猎手', description: '整体股息率达到8%', unlocked: yieldRate >= 8, icon: '🦅' },
    { id: 'stocks_20', label: '散户之王', description: '持有20只以上股票', unlocked: stockCount >= 20, icon: '🃏' },
    { id: 'annual_100k', label: '年入十万', description: '年红利收入超过¥100000', unlocked: annualDiv >= 100000, icon: '🌊' },
    { id: 'monthly_salary', label: '工资替代', description: '月红利超过¥8000', unlocked: monthlyIncome >= 8000, icon: '😤' },
    { id: 'income_500_daily', label: '日入500', description: '日均红利超过¥500', unlocked: annualDiv >= 500 * 365, icon: '🌅' },
    { id: 'hk_investor', label: '南下资金', description: '持有港股股票', unlocked: stockCount >= 1 && annualDiv > 0, icon: '🦁' },
    { id: 'zen_investor', label: '躺平投资', description: '年红利超过¥60000', unlocked: annualDiv >= 60000, icon: '🧘' },
  ]
}

export default function Portfolio() {
  const { watchlist, exchangeRate } = useStore()
  const [chartType, setChartType] = useState<'div' | 'cost'>('div')
  const [chartGroup, setChartGroup] = useState<'sector' | 'stock'>('sector')
  const chartMode = chartType === 'div' ? chartGroup : `cost-${chartGroup}` as 'cost-sector' | 'cost-stock'
  const [showAll, setShowAll] = useState(false)

  const metrics = useMemo(() => {
    const holdings = watchlist.filter(s => s.shares && s.shares > 0)
    let totalAnnual = 0
    let totalCost = 0
    let totalMarket = 0

    holdings.forEach(s => {
      const shares = Number(s.shares) || 0
      const costPrice = Number(s.costPrice) || 0
      const priceCny = s.isHK ? s.price * exchangeRate : s.price
      const divCny = s.isHK ? s.dividendPerShare * exchangeRate : s.dividendPerShare
      const annualDiv = afterTax(divCny * shares, s)

      totalAnnual += annualDiv
      totalMarket += priceCny * shares
      const costPriceCny = (s.costPrice !== undefined && s.costPrice !== null && s.costPrice !== '')
        ? (s.isHK ? costPrice * exchangeRate : costPrice)
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
      stockCount: watchlist.length,
      hasHoldings: holdings.length > 0,
    }
  }, [watchlist, exchangeRate])

  const chartData = useMemo(() => {
    if (chartMode === 'sector' || chartMode === 'stock') {
      const bySector: Record<string, number> = {}
      const byStock = watchlist
        .filter(s => s.shares)
        .map(s => {
          const divCny = s.isHK ? s.dividendPerShare * exchangeRate : s.dividendPerShare
          const ann = afterTax(divCny * Number(s.shares), s)
          bySector[s.sector] = (bySector[s.sector] || 0) + ann
          return { name: s.name, value: parseFloat(ann.toFixed(2)) }
        })
        .filter(d => d.value > 0)
      if (chartMode === 'sector') {
        return Object.entries(bySector).map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) })).filter(d => d.value > 0)
      }
      return byStock
    } else {
      const bySector: Record<string, number> = {}
      const byStock = watchlist
        .filter(s => s.shares)
        .map(s => {
          const shares = Number(s.shares) || 0
          const priceCny = s.isHK ? s.price * exchangeRate : s.price
          const hasCostPrice = s.costPrice !== undefined && s.costPrice !== null && s.costPrice !== ''
          const cost = (hasCostPrice ? Number(s.costPrice) : priceCny) * shares
          bySector[s.sector] = (bySector[s.sector] || 0) + cost
          return { name: s.name, value: parseFloat(cost.toFixed(2)) }
        })
        .filter(d => d.value > 0)
      if (chartMode === 'cost-sector') {
        return Object.entries(bySector).map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) })).filter(d => d.value > 0)
      }
      return byStock
    }
  }, [watchlist, exchangeRate, chartMode])

  const achievements = buildAchievements(metrics.annualDiv, metrics.monthlyIncome, metrics.overallYield, metrics.stockCount, metrics.hasHoldings)
  const unlockedCount = achievements.filter(a => a.unlocked).length
  const sortedAchievements = [...achievements].sort((a, b) => (b.unlocked ? 1 : 0) - (a.unlocked ? 1 : 0))
  const displayedAchievements = showAll ? sortedAchievements : sortedAchievements.slice(0, 12)

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
                {chartType === 'cost' ? '成本分布' : '红利分布'}
              </span>
              <div className="flex gap-1">
                {(['div', 'cost'] as const).map(t => (
                  <button key={t} onClick={() => setChartType(t)}
                    className={`text-xs px-3 py-1 rounded-full border ${chartType === t ? 'bg-red-600 text-white border-red-600' : 'border-gray-200 text-gray-500'}`}>
                    {t === 'div' ? '红利' : '成本'}
                  </button>
                ))}
                <div className="w-px bg-gray-200 mx-0.5" />
                {(['sector', 'stock'] as const).map(g => (
                  <button key={g} onClick={() => setChartGroup(g)}
                    className={`text-xs px-3 py-1 rounded-full border ${chartGroup === g ? 'bg-gray-700 text-white border-gray-700' : 'border-gray-200 text-gray-500'}`}>
                    {g === 'sector' ? '板块' : '个股'}
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
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => {
                      const total = chartData.reduce((s, d) => s + d.value, 0)
                      const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0'
                      const label = chartMode.startsWith('cost') ? '持仓成本' : '年红利'
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
                    return (
                      <div key={d.name} className="flex items-center gap-1 text-xs text-gray-600">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[origIdx % COLORS.length] }} />
                        <span>{d.name}</span>
                        <span className="text-gray-400">¥{d.value.toFixed(0)}</span>
                        <span className="font-medium" style={{ color: COLORS[origIdx % COLORS.length] }}>
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

      {/* Achievements */}
      <div className="px-4 mb-6">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-800">成就</span>
            <span className="text-xs text-gray-400">{unlockedCount}/{achievements.length} 已解锁</span>
          </div>
          <div className="progress-bar mb-3">
            <div className="progress-fill" style={{ width: `${(unlockedCount / achievements.length) * 100}%` }} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {displayedAchievements.map(a => (
              <div
                key={a.id}
                className={`rounded-xl p-2.5 flex flex-col items-center text-center gap-1 ${a.unlocked ? 'bg-red-50' : 'bg-gray-50'}`}
              >
                <span className="text-2xl">{a.unlocked ? a.icon : '🔒'}</span>
                <div className={`text-xs font-semibold leading-tight ${a.unlocked ? 'text-red-700' : 'text-gray-400'}`}>{a.label}</div>
                <div className={`text-[10px] leading-tight ${a.unlocked ? 'text-red-400' : 'text-gray-300'}`}>{a.description}</div>
              </div>
            ))}
          </div>
          {sortedAchievements.length > 12 && (
            <button
              className="w-full mt-3 text-xs text-gray-400 py-2"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? '收起' : `查看全部 ${sortedAchievements.length} 个成就`}
            </button>
          )}
        </div>
      </div>
      <Disclaimer />
    </div>
  )
}
