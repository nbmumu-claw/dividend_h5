import { useMemo, useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useStore } from '../store'
import Disclaimer from '../components/Disclaimer'
import Modal from '../components/Modal'
import { Toast, useToast } from '../components/Toast'
import { afterTax } from '../utils/tax'
import { fetchStockPrices } from '../utils/api'
import { toCnyPrice, isBShare } from '../utils/market'
import { isIncluded, resolveCategory, labelOf, colorOf, CATEGORIES, type Category } from '../utils/categories'
import { computeHolding } from '../utils/holdings'
import { makeFeeCalc } from '../utils/fees'
import type { WatchlistStock } from '../types'

const COLORS = ['#E03025','#3B82F6','#F59E0B','#EF4444','#8B5CF6','#EC4899','#14B8A6','#F97316','#6366F1','#84CC16']
const LABEL_TO_CAT: Record<string, string> = { 弱周期: 'weak', 强周期: 'strong', 消费: 'consume', 未分类: '' }

export default function Portfolio() {
  const navigate = useNavigate()
  const watchlist = useStore(s => s.watchlist)
  const exchangeRate = useStore(s => s.exchangeRate)
  const usdRate = useStore(s => s.usdRate)
  const batchUpdateWatchlist = useStore(s => s.batchUpdateWatchlist)
  const feeConfig = useStore(s => s.feeConfig)
  const categoryOverrides = useStore(s => s.categoryOverrides)
  const statsScope = useStore(s => s.statsScope)
  const accounts = useStore(s => s.accounts)
  const activeAccountId = useStore(s => s.activeAccountId)
  const switchAccount = useStore(s => s.switchAccount)
  const [showAccountSheet, setShowAccountSheet] = useState(false)
  const activeAccountName = accounts.find(a => a.id === activeAccountId)?.name || '我的账户'
  const { message, showToast } = useToast()
  const [chartType, setChartType] = useState<'div' | 'market' | 'cost'>('div')
  const [chartGroup, setChartGroup] = useState<'sector' | 'stock' | 'category'>('sector')
  // 明细弹窗（沪/深市值、三大类成分股）
  const [detail, setDetail] = useState<{ title: string; items: { name: string; value: number }[] } | null>(null)
  const [showPnl, setShowPnl] = useState(false)
  const [showRealizedPnl, setShowRealizedPnl] = useState(false)
  const [pnlDesc, setPnlDesc] = useState(true)
  // 持仓市值 / 成本金额 明细弹窗（按美股 / AH股分组）
  const [valueDetail, setValueDetail] = useState<'market' | 'cost' | null>(null)
  // 实际分红明细弹窗
  const [divDetail, setDivDetail] = useState<'currentYear' | 'allTime' | null>(null)
  const [divSort, setDivSort] = useState<'amount' | 'date'>('date')
  // 「只看美股」下「三大类」无意义（美股不纳入三大类分类）：正选着则回落到「板块」
  useEffect(() => {
    if (statsScope === 'us' && chartGroup === 'category') setChartGroup('sector')
  }, [statsScope, chartGroup])

  useEffect(() => {
    if (!watchlist.length) return
    const inputs = watchlist.map(s => ({ code: s.code, isHK: s.isHK, isUS: s.isUS, isFund: s.isFund }))
    fetchStockPrices(inputs, false).then(priceMap => {
      const updates: Record<string, Partial<WatchlistStock>> = {}
      watchlist.forEach(s => {
        const pd = priceMap[s.code]
        if (!pd) return
        const priceCny = toCnyPrice(pd.price, s, exchangeRate, usdRate)
        const divCny = toCnyPrice(s.dividendPerShare, s, exchangeRate, usdRate)
        const rawYield = priceCny > 0 ? (divCny / priceCny) * 100 : 0
        updates[s.code] = {
          price: pd.price,
          pctChg: pd.pctChg,
          yieldRate: rawYield > 30 ? s.yieldRate : rawYield,
        }
      })
      if (Object.keys(updates).length) batchUpdateWatchlist(updates)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId])
  const holdings = useMemo(
    () => watchlist.filter(s => {
      if (!(s.shares && Number(s.shares) > 0)) return false
      if (statsScope === 'us') return !!s.isUS
      if (statsScope === 'nonus') return !s.isUS
      return true
    }),
    [watchlist, statsScope]
  )

  // 收益历史不应随清仓消失：统计范围只按市场筛选，不按当前持股数筛选。
  const historyStocks = useMemo(
    () => watchlist.filter(s => {
      if (statsScope === 'us') return !!s.isUS
      if (statsScope === 'nonus') return !s.isUS
      return true
    }),
    [watchlist, statsScope]
  )

  const holdingsWithDisplay = useMemo(() => {
    const nameCounts: Record<string, number> = {}
    for (const s of holdings) nameCounts[s.name] = (nameCounts[s.name] || 0) + 1
    return holdings.map(s => ({
      stock: s,
      displayName: nameCounts[s.name] > 1 ? `${s.name}(${s.isHK ? '港' : s.isUS ? '美' : isBShare(s.code) ? 'B' : 'A'})` : s.name,
    }))
  }, [holdings])

  const metrics = useMemo(() => {
    let totalAnnual = 0
    let totalCost = 0
    let totalMarket = 0
    let shMarket = 0   // 沪市市值（仅 A 股）
    let szMarket = 0   // 深市市值（仅 A 股）
    const shItems: { name: string; value: number }[] = []
    const szItems: { name: string; value: number }[] = []
    // 实际分红（从交易流水中提取 dividend 交易）
    let currentYearDiv = 0
    let allTimeDiv = 0
    const currentYearDivItems: { name: string; amount: number; ts: number }[] = []
    const allTimeByYear: Record<number, number> = {}
    const realizedPnlItems: { name: string; code: string; amount: number }[] = []
    let realizedPnl = 0
    const thisYear = new Date().getFullYear()

    holdings.forEach(s => {
      const shares = Number(s.shares) || 0
      const costPrice = Number(s.costPrice) || 0
      const priceCny = toCnyPrice(s.price, s, exchangeRate, usdRate)
      const divCny = toCnyPrice(s.dividendPerShare, s, exchangeRate, usdRate)
      const annualDiv = afterTax(divCny * shares, s)
      const market = priceCny * shares

      totalAnnual += annualDiv
      totalMarket += market
      // 沪深细分：境内标的(非港非美)，6/9 开头沪市(含沪B 900) / 0、2、3 开头深市(含深B 200)
      if (!s.isHK && !s.isUS && !isBShare(s.code) && market > 0) {
        const head = String(s.code).charAt(0)
        if (head === '6' || head === '9') { shMarket += market; shItems.push({ name: s.name, value: market }) }
        else if (head === '0' || head === '2' || head === '3') { szMarket += market; szItems.push({ name: s.name, value: market }) }
      }
      const hasCost = s.costPrice !== undefined && s.costPrice !== null && s.costPrice !== ''
      const costPriceCny = hasCost
        ? toCnyPrice(costPrice, s, exchangeRate, usdRate)
        : priceCny
      totalCost += costPriceCny * shares

    })

    // 实际分红汇总使用完整历史标的，清仓（0 股）后仍保留累计分红。
    historyStocks.forEach(s => {
      const txs = s.transactions || []
      const result = computeHolding(txs, makeFeeCalc(s, feeConfig))
      if (result.cleared && txs.some(t => t.type === 'buy' || t.type === 'sell')) {
        const amount = toCnyPrice(-result.netAmount, s, exchangeRate, usdRate)
        realizedPnl += amount
        realizedPnlItems.push({ name: s.name, code: s.code, amount })
      }
      for (const t of txs) {
        if (t.type !== 'dividend') continue
        const amount = toCnyPrice((Number(t.qty) || 0) * (Number(t.price) || 0), s, exchangeRate, usdRate)
        const year = new Date(t.ts || 0).getFullYear()
        if (year === thisYear) {
          currentYearDiv += amount
          const name = s.name.length > 1 ? s.name : s.code
          currentYearDivItems.push({ name, amount, ts: t.ts || 0 })
        }
        allTimeByYear[year] = (allTimeByYear[year] || 0) + amount
      }
    })
    allTimeDiv = Object.values(allTimeByYear).reduce((a, b) => a + b, 0)

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
      shItems: shItems.sort((a, b) => b.value - a.value),
      szItems: szItems.sort((a, b) => b.value - a.value),
      stockCount: watchlist.length,
      hasHoldings: holdings.length > 0,
      hasHistory: historyStocks.some(s => (s.transactions?.length ?? 0) > 0),
      realizedPnl,
      realizedPnlItems: realizedPnlItems.sort((a, b) => b.amount - a.amount),
      // 实际分红
      currentYearDiv,
      currentYearDivItems, // 渲染时按 divSort 排序
      allTimeDiv,
      allTimeDivByYear: Object.entries(allTimeByYear)
        .map(([year, total]) => ({ year: Number(year), total }))
        .sort((a, b) => b.year - a.year),
    }
  }, [holdings, historyStocks, watchlist.length, exchangeRate, usdRate, feeConfig])

  const valOf = useCallback((s: WatchlistStock) => {
    const shares = Number(s.shares) || 0
    if (chartType === 'market') {
      const priceCny = toCnyPrice(s.price, s, exchangeRate, usdRate)
      return priceCny * shares
    }
    if (chartType === 'cost') {
      const costPrice = Number(s.costPrice) || 0
      const costPriceCny = toCnyPrice(costPrice, s, exchangeRate, usdRate)
      return costPriceCny * shares
    }
    const divCny = toCnyPrice(s.dividendPerShare, s, exchangeRate, usdRate)
    return afterTax(divCny * shares, s)
  }, [chartType, exchangeRate, usdRate])

  // 三大类成分股明细（含未分类）
  const categoryMembers = useMemo(() => {
    const m: Record<string, { name: string; value: number }[]> = { weak: [], strong: [], consume: [], '': [] }
    if (chartGroup !== 'category') return m
    holdingsWithDisplay.forEach(({ stock: s, displayName }) => {
      if (!isIncluded(s)) return
      const v = valOf(s)
      if (v <= 0) return
      m[resolveCategory(s, categoryOverrides)].push({ name: displayName, value: v })
    })
    Object.values(m).forEach(arr => arr.sort((a, b) => b.value - a.value))
    return m
  }, [holdingsWithDisplay, chartGroup, valOf, categoryOverrides])

  const chartData = useMemo<{ name: string; value: number; color?: string }[]>(() => {
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
  }, [holdings, holdingsWithDisplay, chartGroup, categoryOverrides, valOf])

  // 持仓盈亏明细（按盈亏倒序）
  const pnlDetail = useMemo(() => {
    return holdingsWithDisplay
      .map(({ stock: s, displayName }) => {
        const shares = Number(s.shares) || 0
        const priceCny = toCnyPrice(s.price, s, exchangeRate, usdRate)
        const market = priceCny * shares
        const hasCost = s.costPrice !== undefined && s.costPrice !== '' && !Number.isNaN(Number(s.costPrice))
        const cost = hasCost
          ? toCnyPrice(Number(s.costPrice), s, exchangeRate, usdRate) * shares
          : market
        const pl = market - cost
        const pct = cost > 0 ? (pl / cost) * 100 : null
        return { name: displayName, code: s.code, market, cost, pl, pct }
      })
      .filter(d => d.market > 0)
  }, [holdingsWithDisplay, exchangeRate, usdRate])

  const pnlSorted = useMemo(() => {
    const arr = [...pnlDetail]
    arr.sort((a, b) => pnlDesc ? b.pl - a.pl : a.pl - b.pl)
    return arr
  }, [pnlDetail, pnlDesc])

  // 持仓市值 / 成本金额 按美股 / AH股分组的明细
  const valueDetailData = useMemo(() => {
    if (!valueDetail) return null
    const key = valueDetail // 'market' | 'cost'
    const us: typeof pnlDetail = []
    const ah: typeof pnlDetail = []
    pnlDetail.forEach(d => {
      const s = holdings.find(h => h.code === d.code)
      ;(s?.isUS ? us : ah).push(d)
    })
    const groups = [
      { label: '美股', items: us },
      { label: 'AH股', items: ah },
    ]
      .map(g => ({
        label: g.label,
        items: [...g.items].sort((a, b) => b[key] - a[key]),
        subtotal: g.items.reduce((sum, d) => sum + d[key], 0),
      }))
      .filter(g => g.items.length > 0)
    const total = groups.reduce((sum, g) => sum + g.subtotal, 0)
    return {
      key,
      groups,
      total,
      multi: groups.length > 1,
      title: key === 'market' ? '持仓市值明细' : '成本金额明细',
    }
  }, [valueDetail, pnlDetail, holdings])

  // 当年分红明细排序
  const currentYearDivSorted = useMemo(() => {
    const arr = [...metrics.currentYearDivItems]
    if (divSort === 'amount') arr.sort((a, b) => b.amount - a.amount)
    else arr.sort((a, b) => b.ts - a.ts)
    return arr
  }, [metrics.currentYearDivItems, divSort])



  return (
    <div className="page-content page-narrow">
      <div className="px-4 pt-12 pb-3">
        <div className="relative flex items-center justify-center">
          <h1 className="text-xl font-bold text-gray-900">收益</h1>
          <button
            onClick={() => setShowAccountSheet(true)}
            className="absolute right-0 flex items-center gap-0.5 text-sm text-gray-600 bg-gray-100 rounded-full px-3 py-1 max-w-[40%]"
          >
            <span className="truncate">{activeAccountName}</span>
            <svg className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
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
                <div className="text-xs text-gray-400 mb-1 flex items-center justify-end gap-1">
                  持仓盈亏
                  <button onClick={() => setShowPnl(true)} className="text-red-500 flex items-center">明细
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                </div>
                <div className={`text-3xl font-bold ${metrics.profitLoss >= 0 ? 'text-red-500' : 'text-green-600'}`}>
                  {metrics.profitLoss >= 0 ? '+' : ''}¥{Math.abs(metrics.profitLoss).toFixed(0)}
                </div>
                <div className={`text-sm font-semibold ${metrics.profitLossRatio >= 0 ? 'text-red-400' : 'text-green-500'}`}>
                  {metrics.profitLossRatio >= 0 ? '+' : ''}{metrics.profitLossRatio.toFixed(2)}%
                </div>
              </div>
            ) : (
              <div className="text-right">
                <div className="text-xs text-gray-400 mb-1 flex items-center justify-end gap-1">
                  已实现盈亏
                  {metrics.realizedPnlItems.length > 0 && (
                    <button onClick={() => setShowRealizedPnl(true)} className="text-red-500 flex items-center">明细
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                  )}
                </div>
                <div className={`text-3xl font-bold ${metrics.realizedPnl >= 0 ? 'text-red-500' : 'text-green-600'}`}>
                  {metrics.realizedPnl >= 0 ? '+' : '-'}¥{Math.abs(metrics.realizedPnl).toFixed(0)}
                </div>
              </div>
            )}
          </div>

          {/* 辅助数据：两列 */}
          {(metrics.hasHoldings || metrics.hasHistory) && (
            <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-y-3 gap-x-6">
              {metrics.hasHoldings && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">月均收入</span>
                    <span className="font-medium text-red-600">¥{metrics.monthlyIncome.toFixed(0)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">整体股息率</span>
                    <span className="font-medium text-red-600">{metrics.overallYield.toFixed(2)}%</span>
                  </div>
                  <button className="flex justify-between items-center text-sm active:opacity-60" onClick={() => setValueDetail('market')}>
                    <span className="text-gray-500 flex items-center gap-0.5">
                      持仓市值
                      <svg className="w-3.5 h-3.5 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                    <span className="font-medium text-red-600">¥{metrics.totalMarket.toFixed(0)}</span>
                  </button>
                  <button className="flex justify-between items-center text-sm active:opacity-60" onClick={() => setValueDetail('cost')}>
                    <span className="text-gray-500 flex items-center gap-0.5">
                      成本金额
                      <svg className="w-3.5 h-3.5 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                    <span className="font-medium text-red-600">¥{metrics.totalCost.toFixed(0)}</span>
                  </button>
                </>
              )}
              {metrics.hasShSz && (
                <>
                  <button
                    className="flex justify-between items-center text-sm active:opacity-60"
                    onClick={() => setDetail({ title: '沪市市值明细', items: metrics.shItems })}
                  >
                    <span className="text-gray-500 flex items-center gap-0.5">
                      沪市市值
                      <svg className="w-3.5 h-3.5 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                    <span className="font-medium text-gray-700">¥{metrics.shMarket.toFixed(0)} <span className="text-xs text-gray-400">{metrics.shPct.toFixed(1)}%</span></span>
                  </button>
                  <button
                    className="flex justify-between items-center text-sm active:opacity-60"
                    onClick={() => setDetail({ title: '深市市值明细', items: metrics.szItems })}
                  >
                    <span className="text-gray-500 flex items-center gap-0.5">
                      深市市值
                      <svg className="w-3.5 h-3.5 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                    <span className="font-medium text-gray-700">¥{metrics.szMarket.toFixed(0)} <span className="text-xs text-gray-400">{metrics.szPct.toFixed(1)}%</span></span>
                  </button>
                </>
              )}
              <button className="flex justify-between items-center text-sm active:opacity-60" onClick={() => setDivDetail('currentYear')}>
                <span className="text-gray-500 flex items-center gap-0.5">
                  当年累计分红
                  <svg className="w-3.5 h-3.5 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </span>
                <span className="font-medium text-red-600">¥{metrics.currentYearDiv.toFixed(0)}</span>
              </button>
              <button className="flex justify-between items-center text-sm active:opacity-60" onClick={() => setDivDetail('allTime')}>
                <span className="text-gray-500 flex items-center gap-0.5">
                  历史累计分红
                  <svg className="w-3.5 h-3.5 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </span>
                <span className="font-medium text-red-600">¥{metrics.allTimeDiv.toFixed(0)}</span>
              </button>
              {metrics.hasHoldings && metrics.realizedPnlItems.length > 0 && (
                <button className="col-span-2 flex justify-between items-center text-sm active:opacity-60" onClick={() => setShowRealizedPnl(true)}>
                  <span className="text-gray-500 flex items-center gap-0.5">
                    已实现盈亏
                    <svg className="w-3.5 h-3.5 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </span>
                  <span className={`font-medium ${metrics.realizedPnl >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {metrics.realizedPnl >= 0 ? '+' : '-'}¥{Math.abs(metrics.realizedPnl).toFixed(0)}
                  </span>
                </button>
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
                {chartGroup === 'category' ? '三大类占比' : chartType === 'market' ? '市值分布' : chartType === 'cost' ? '成本分布' : '红利分布'}
              </span>
              <div className="flex gap-1">
                {(['div', 'market', 'cost'] as const).map(t => (
                  <button key={t} onClick={() => setChartType(t)}
                    className={`text-xs px-3 py-1 rounded-full border ${chartType === t ? 'bg-red-600 text-white border-red-600' : 'border-gray-200 text-gray-500'}`}>
                    {t === 'div' ? '红利' : t === 'market' ? '市值' : '成本'}
                  </button>
                ))}
                <div className="w-px bg-gray-200 mx-0.5" />
                {(statsScope === 'us' ? (['sector', 'stock'] as const) : (['sector', 'stock', 'category'] as const)).map(g => (
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
                      const label = chartType === 'market' ? '持仓市值' : chartType === 'cost' ? '成本金额' : '年红利'
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
                    const cat = chartGroup === 'category' ? LABEL_TO_CAT[d.name] : undefined
                    const clickable = cat !== undefined
                    return (
                      <div
                        key={d.name}
                        className={`flex items-center gap-1 text-xs text-gray-600 ${clickable ? 'cursor-pointer active:opacity-60' : ''}`}
                        onClick={clickable ? () => setDetail({ title: `${d.name}明细`, items: categoryMembers[cat as string] }) : undefined}
                      >
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                        <span>{d.name}</span>
                        <span className="text-gray-400">¥{d.value.toFixed(0)}</span>
                        <span className="font-medium" style={{ color }}>
                          {total > 0 ? ((d.value / total) * 100).toFixed(1) : 0}%
                        </span>
                        {clickable && (
                          <svg className="w-3 h-3 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        )}
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
              <div className="text-xs text-gray-400">如果这个工具对你有帮助，欢迎为这个工具提供一些支持。</div>
            </div>
          </div>
          <svg className="w-4 h-4 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.title}>
        {detail && (() => {
          const total = detail.items.reduce((s, d) => s + d.value, 0)
          if (!detail.items.length) return <div className="py-6 text-center text-sm text-gray-400">暂无明细</div>
          return (
            <div className="divide-y divide-gray-50">
              {detail.items.map(it => (
                <div key={it.name} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="text-gray-700">{it.name}</span>
                  <span className="text-gray-600">
                    ¥{it.value.toFixed(0)}
                    <span className="ml-2 text-xs text-gray-400">{total > 0 ? ((it.value / total) * 100).toFixed(1) : 0}%</span>
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between py-2.5 text-sm font-semibold">
                <span className="text-gray-800">合计</span>
                <span className="text-gray-800">¥{total.toFixed(0)}</span>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* 持仓盈亏明细 */}
      <Modal
        open={showPnl}
        onClose={() => setShowPnl(false)}
        title="持仓盈亏明细"
        headerRight={
          <button
            onClick={() => setPnlDesc(v => !v)}
            className="text-xs text-red-500 bg-red-50 rounded-full px-2.5 py-1 flex items-center gap-0.5"
          >
            按盈亏
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d={pnlDesc ? 'm6 9 6 6 6-6' : 'm6 15 6-6 6 6'} strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        }
      >
        {pnlDetail.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-400">暂无持仓</div>
        ) : (
          <div>
            <div className="flex items-center justify-between pb-2.5 mb-1 border-b border-gray-100 text-sm">
              <span className="text-gray-400">合计</span>
              <span className="text-right">
                <span className={`font-bold ${metrics.profitLoss >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {metrics.profitLoss >= 0 ? '+' : '-'}¥{Math.abs(metrics.profitLoss).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </span>
                <span className={`ml-2 text-xs ${metrics.profitLossRatio >= 0 ? 'text-red-400' : 'text-green-500'}`}>
                  {metrics.profitLossRatio >= 0 ? '+' : ''}{metrics.profitLossRatio.toFixed(2)}%
                </span>
              </span>
            </div>
            <div className="divide-y divide-gray-50">
              {pnlSorted.map(d => (
                <div key={d.code} className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-800 truncate">{d.name}</div>
                    <div className="text-xs text-gray-400">
                      {d.code} · 市值 ¥{d.market.toLocaleString('en-US', { maximumFractionDigits: 0 })} / 成本 ¥{d.cost.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-3">
                    <div className={`text-sm font-bold ${d.pl >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {d.pl >= 0 ? '+' : '-'}¥{Math.abs(d.pl).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </div>
                    <div className={`text-xs ${d.pl >= 0 ? 'text-red-400' : 'text-green-500'}`}>
                      {d.pct != null ? `${d.pct >= 0 ? '+' : ''}${d.pct.toFixed(2)}%` : '已回本'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* 清仓股票已实现盈亏明细 */}
      <Modal open={showRealizedPnl} onClose={() => setShowRealizedPnl(false)} title="已实现盈亏明细">
        {metrics.realizedPnlItems.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-400">暂无清仓记录</div>
        ) : (
          <div>
            <div className="flex items-center justify-between pb-2.5 mb-1 border-b border-gray-100 text-sm">
              <span className="text-gray-400">合计</span>
              <span className={`font-bold ${metrics.realizedPnl >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                {metrics.realizedPnl >= 0 ? '+' : '-'}¥{Math.abs(metrics.realizedPnl).toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div className="divide-y divide-gray-50">
              {metrics.realizedPnlItems.map(item => (
                <div key={item.code} className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-800 truncate">{item.name}</div>
                    <div className="text-xs text-gray-400">{item.code} · 已清仓</div>
                  </div>
                  <div className={`text-sm font-bold ${item.amount >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {item.amount >= 0 ? '+' : '-'}¥{Math.abs(item.amount).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </div>
                </div>
              ))}
            </div>
            <p className="pt-3 text-[11px] leading-relaxed text-gray-400">
              已实现盈亏 = 累计卖出额 + 累计分红 − 累计买入额 − 交易费用，仅统计当前持仓为 0 的股票。
            </p>
          </div>
        )}
      </Modal>

      {/* 持仓市值 / 成本金额明细（美股 / AH股分组） */}
      <Modal open={!!valueDetail} onClose={() => setValueDetail(null)} title={valueDetailData?.title}>
        {valueDetailData && (valueDetailData.total <= 0 ? (
          <div className="py-6 text-center text-sm text-gray-400">暂无持仓</div>
        ) : (
          <div>
            <div className="flex items-center justify-between pb-2.5 mb-1 border-b border-gray-100 text-sm">
              <span className="text-gray-400">合计</span>
              <span className="font-bold text-gray-800">¥{valueDetailData.total.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
            </div>
            {valueDetailData.groups.map(g => (
              <div key={g.label}>
                {valueDetailData.multi && (
                  <div className="flex items-center justify-between pt-3 pb-1 text-xs">
                    <span className="font-semibold text-gray-500">{g.label}</span>
                    <span className="text-gray-400">
                      ¥{g.subtotal.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      <span className="ml-1.5">{((g.subtotal / valueDetailData.total) * 100).toFixed(1)}%</span>
                    </span>
                  </div>
                )}
                <div className="divide-y divide-gray-50">
                  {g.items.map(d => {
                    const v = d[valueDetailData.key]
                    return (
                      <div key={d.code} className="flex items-center justify-between py-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-800 truncate">{d.name}</div>
                          <div className="text-xs text-gray-400">{d.code}</div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-3">
                          <div className="text-sm font-bold text-gray-800">¥{v.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
                          <div className="text-xs text-gray-400">{((v / valueDetailData.total) * 100).toFixed(1)}%</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
      </Modal>

      {/* 当年累计分红明细 */}
      <Modal open={divDetail === 'currentYear'} onClose={() => setDivDetail(null)} title="当年累计分红明细">
        {metrics.currentYearDiv <= 0 ? (
          <div className="py-6 text-center text-sm text-gray-400">暂无实际分红记录</div>
        ) : (
          <div>
            <div className="flex items-center justify-between pb-2.5 mb-1 border-b border-gray-100 text-sm">
              <span className="text-gray-400">合计</span>
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  {(['date', 'amount'] as const).map(k => (
                    <button key={k} onClick={() => setDivSort(k)}
                      className={`text-xs px-2 py-0.5 rounded-full border ${divSort === k ? 'bg-red-600 text-white border-red-600' : 'border-gray-200 text-gray-500'}`}>
                      {k === 'date' ? '时间' : '金额'}
                    </button>
                  ))}
                </div>
                <span className="font-bold text-gray-800">¥{metrics.currentYearDiv.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
              </div>
            </div>
            <div className="divide-y divide-gray-50">
              {currentYearDivSorted.map((d, i) => (
                <div key={i} className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-800 truncate">{d.name}</div>
                    <div className="text-xs text-gray-400">{d.ts ? new Date(d.ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : '--'}</div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-3">
                    <div className="text-sm font-bold text-gray-800">¥{d.amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
                    <div className="text-xs text-gray-400">{((d.amount / metrics.currentYearDiv) * 100).toFixed(1)}%</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* 历史累计分红明细 */}
      <Modal open={divDetail === 'allTime'} onClose={() => setDivDetail(null)} title="历史累计分红明细">
        {metrics.allTimeDiv <= 0 ? (
          <div className="py-6 text-center text-sm text-gray-400">暂无实际分红记录</div>
        ) : (
          <div>
            <div className="flex items-center justify-between pb-2.5 mb-1 border-b border-gray-100 text-sm">
              <span className="text-gray-400">合计</span>
              <span className="font-bold text-gray-800">¥{metrics.allTimeDiv.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="divide-y divide-gray-50">
              {metrics.allTimeDivByYear.map(d => (
                <div key={d.year} className="flex items-center justify-between py-3">
                  <span className="text-sm font-semibold text-gray-800">{d.year}年</span>
                  <div className="text-right flex-shrink-0 ml-3">
                    <div className="text-sm font-bold text-gray-800">¥{d.total.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
                    <div className="text-xs text-gray-400">{((d.total / metrics.allTimeDiv) * 100).toFixed(1)}%</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Disclaimer />
      <Toast message={message} />

      <Modal open={showAccountSheet} onClose={() => setShowAccountSheet(false)} title="切换账户">
        <div className="space-y-1">
          {accounts.map(a => {
            const active = a.id === activeAccountId
            return (
              <button
                key={a.id}
                onClick={() => { switchAccount(a.id); setShowAccountSheet(false); if (!active) showToast(`已切换到「${a.name}」`) }}
                className={`w-full flex items-center gap-2 px-3 py-3 rounded-lg ${active ? 'bg-red-50' : 'active:bg-gray-50'}`}
              >
                <span className={`w-4 h-4 flex-shrink-0 ${active ? 'text-red-600' : 'text-transparent'}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </span>
                <span className={`text-sm ${active ? 'font-semibold text-red-700' : 'text-gray-800'}`}>{a.name}</span>
              </button>
            )
          })}
          <button
            onClick={() => { setShowAccountSheet(false); navigate('/account-manager') }}
            className="w-full flex items-center gap-2 px-3 py-3 rounded-lg active:bg-gray-50 text-gray-500 text-sm border-t border-gray-50 mt-1"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" strokeLinecap="round" strokeLinejoin="round"/></svg>
            管理账户
          </button>
        </div>
      </Modal>
    </div>
  )
}
