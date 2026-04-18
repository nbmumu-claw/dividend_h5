import { useMemo, useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useStore } from '../store'
import { afterTax } from '../utils/tax'
import type { WatchlistStock } from '../types'

const COLORS = ['#10B981','#3B82F6','#F59E0B','#EF4444','#8B5CF6','#EC4899','#14B8A6','#F97316','#6366F1','#84CC16']

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
  ]
}

export default function Portfolio() {
  const { watchlist, exchangeRate } = useStore()
  const [chartMode, setChartMode] = useState<'sector' | 'stock'>('sector')
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
      totalCost += costPrice > 0 ? costPrice * shares : priceCny * shares
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
    if (chartMode === 'sector') {
      const byS: Record<string, number> = {}
      watchlist.forEach(s => {
        if (!s.shares) return
        const divCny = s.isHK ? s.dividendPerShare * exchangeRate : s.dividendPerShare
        const ann = afterTax(divCny * Number(s.shares), s)
        byS[s.sector] = (byS[s.sector] || 0) + ann
      })
      return Object.entries(byS).map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) })).filter(d => d.value > 0)
    } else {
      return watchlist
        .filter(s => s.shares)
        .map(s => {
          const divCny = s.isHK ? s.dividendPerShare * exchangeRate : s.dividendPerShare
          const ann = afterTax(divCny * Number(s.shares), s)
          return { name: s.name, value: parseFloat(ann.toFixed(2)) }
        })
        .filter(d => d.value > 0)
    }
  }, [watchlist, exchangeRate, chartMode])

  const achievements = buildAchievements(metrics.annualDiv, metrics.monthlyIncome, metrics.overallYield, metrics.stockCount, metrics.hasHoldings)
  const unlockedCount = achievements.filter(a => a.unlocked).length
  const displayedAchievements = showAll ? achievements : achievements.slice(0, 8)

  return (
    <div className="page-content">
      <div className="px-4 pt-12 pb-3">
        <h1 className="text-xl font-bold text-gray-900">收益</h1>
      </div>

      {/* Summary cards */}
      <div className="px-4 mb-4">
        <div className="card p-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="stat-number text-primary">¥{metrics.annualDiv.toFixed(0)}</div>
              <div className="stat-label">年度红利（税后）</div>
            </div>
            <div>
              <div className="stat-number">¥{metrics.monthlyIncome.toFixed(0)}</div>
              <div className="stat-label">月均收入</div>
            </div>
            {metrics.hasHoldings && (
              <>
                <div>
                  <div className="stat-number">{metrics.overallYield.toFixed(2)}%</div>
                  <div className="stat-label">整体股息率</div>
                </div>
                <div>
                  <div className={`stat-number ${metrics.profitLoss >= 0 ? 'text-red-500' : 'text-green-600'}`}>
                    {metrics.profitLoss >= 0 ? '+' : ''}{metrics.profitLossRatio.toFixed(2)}%
                  </div>
                  <div className="stat-label">持仓盈亏</div>
                </div>
              </>
            )}
          </div>
          {metrics.hasHoldings && (
            <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-2 text-sm">
              <div className="text-gray-500">持仓市值 <span className="font-medium text-gray-800">¥{metrics.totalMarket.toFixed(0)}</span></div>
              <div className="text-gray-500">成本金额 <span className="font-medium text-gray-800">¥{metrics.totalCost.toFixed(0)}</span></div>
            </div>
          )}
        </div>
      </div>

      {/* Distribution chart */}
      {chartData.length > 0 && (
        <div className="px-4 mb-4">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-gray-800">红利分布</span>
              <div className="flex gap-1">
                <button
                  onClick={() => setChartMode('sector')}
                  className={`text-xs px-3 py-1 rounded-full border ${chartMode === 'sector' ? 'bg-primary text-white border-primary' : 'border-gray-200 text-gray-500'}`}
                >
                  板块
                </button>
                <button
                  onClick={() => setChartMode('stock')}
                  className={`text-xs px-3 py-1 rounded-full border ${chartMode === 'stock' ? 'bg-primary text-white border-primary' : 'border-gray-200 text-gray-500'}`}
                >
                  个股
                </button>
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
                    formatter={(value: number) => [`¥${value.toFixed(2)}`, '年红利']}
                    contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {chartData.map((d, i) => (
                <div key={d.name} className="flex items-center gap-1 text-xs text-gray-600">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                  <span>{d.name}</span>
                  <span className="text-gray-400">¥{d.value.toFixed(0)}</span>
                </div>
              ))}
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
          <div className="space-y-2">
            {displayedAchievements.map(a => (
              <div key={a.id} className={`achievement ${a.unlocked ? 'unlocked' : 'locked'}`}>
                <span className="text-lg">{a.unlocked ? a.icon : '🔒'}</span>
                <div>
                  <div className="font-medium text-xs">{a.label}</div>
                  <div className="text-xs opacity-70">{a.description}</div>
                </div>
              </div>
            ))}
          </div>
          {achievements.length > 8 && (
            <button
              className="w-full mt-3 text-xs text-gray-400 py-2"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? '收起' : `查看全部 ${achievements.length} 个成就`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
