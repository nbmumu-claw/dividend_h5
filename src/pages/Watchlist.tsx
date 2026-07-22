import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fetchStockPrices, fetchOwnerType } from '../utils/api'
import Disclaimer from '../components/Disclaimer'
import { afterTax } from '../utils/tax'
import type { WatchlistStock } from '../types'
import { toCnyPrice, currencySymbol, isBShare } from '../utils/market'
import { Toast, useToast } from '../components/Toast'
import Modal from '../components/Modal'
import DividendReminderCard from '../components/DividendReminderCard'
import { usePendingDividends } from '../utils/dividendReminder'
import { getCurrentUid } from '../utils/cloudSync'
import { parseTradeScreenshot, nameMatch, buildTs, FISHERMAN_UID, type ParsedTrade } from '../utils/tradeShot'
import { getShotUsage, bumpShotUsage, SHOT_DAILY_LIMIT } from '../utils/shotQuota'
import { ensureTransactions, type Transaction } from '../utils/holdings'

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

// 判断识别到的一笔是否与该股已有交易重复（同方向 + 同数量 + 同价 + 同一天）
const txDayStr = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function isDupTrade(stock: WatchlistStock, t: ParsedTrade): boolean {
  return (stock.transactions ?? []).some(x =>
    x.type === t.type && Number(x.qty) === t.qty && Math.abs(Number(x.price) - t.price) < 0.001 && txDayStr(x.ts) === t.date)
}

export default function Watchlist() {
  const watchlist = useStore(s => s.watchlist)
  const customSectors = useStore(s => s.customSectors)
  const exchangeRate = useStore(s => s.exchangeRate)
  const usdRate = useStore(s => s.usdRate)
  const removeFromWatchlist = useStore(s => s.removeFromWatchlist)
  const updateWatchlistStock = useStore(s => s.updateWatchlistStock)
  const batchUpdateWatchlist = useStore(s => s.batchUpdateWatchlist)
  const setTransactions = useStore(s => s.setTransactions)
  const accounts = useStore(s => s.accounts)
  const activeAccountId = useStore(s => s.activeAccountId)
  const switchAccount = useStore(s => s.switchAccount)
  const [showAccountSheet, setShowAccountSheet] = useState(false)
  const activeAccountName = accounts.find(a => a.id === activeAccountId)?.name || '我的账户'
  const [activeSector, setActiveSector] = useState(
    () => sessionStorage.getItem('watchlist-sector') || '全部'
  )
  const handleSetActiveSector = (s: string) => {
    sessionStorage.setItem('watchlist-sector', s)
    setActiveSector(s)
  }
  // 卡片折叠：记录已折叠的股票代码（localStorage 持久化，默认展开）
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('watchlist-collapsed') || '[]')) } catch { return new Set() }
  })
  const toggleCollapse = (code: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(code) ? next.delete(code) : next.add(code)
      try { localStorage.setItem('watchlist-collapsed', JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }
  const [loading, setLoading] = useState(false)
  const [pricesLoaded, setPricesLoaded] = useState(() => watchlist.every(s => s.price > 0))
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('default')
  const [ownerTypes, setOwnerTypes] = useState<Record<string, string>>({})
  const { message, showToast } = useToast()
  const navigate = useNavigate()
  const pendingDiv = usePendingDividends(watchlist)

  // 截图批量录入：一张图识别所有买卖 → 按名字匹配自选股 → 勾选批量导入
  const shotRef = useRef<HTMLInputElement>(null)
  const [uid, setUid] = useState<string | null>(null)
  const [shotUsed, setShotUsed] = useState(0) // 今日已用次数（进页从 CloudBase 预取，供同步判断）
  const [ocrLoading, setOcrLoading] = useState(false)
  const [batch, setBatch] = useState<{ items: { trade: ParsedTrade; stock?: WatchlistStock; dup?: boolean }[]; picked: boolean[] } | null>(null)
  useEffect(() => { getCurrentUid().then(u => { setUid(u); if (u) getShotUsage(u).then(setShotUsed).catch(() => {}) }).catch(() => {}) }, [])
  // 打开文件选择器必须在点击的同步上下文里、中间不能 await（否则手机上打不开），故次数用预取的 shotUsed 同步判断
  const overLimit = () => uid !== FISHERMAN_UID && shotUsed >= SHOT_DAILY_LIMIT // 渔人不受每天2次限制
  const onShotBtn = () => {
    if (!uid) { showToast('请先登录后使用'); return }
    if (overLimit()) { showToast(`每天最多识别 ${SHOT_DAILY_LIMIT} 次，明天再来`); return }
    shotRef.current?.click()
  }
  const onShotFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !uid) return
    if (overLimit()) { showToast(`每天最多识别 ${SHOT_DAILY_LIMIT} 次，明天再来`); return }
    setOcrLoading(true)
    if (uid !== FISHERMAN_UID) { setShotUsed(n => n + 1); bumpShotUsage(uid) } // 渔人不计次
    try {
      const trades = await parseTradeScreenshot(file, uid)
      if (!trades.length) { showToast('未识别到买卖记录'); return }
      const items = trades.map(t => {
        const stock = watchlist.find(w => nameMatch(t.name, w.name))
        return { trade: t, stock, dup: stock ? isDupTrade(stock, t) : false }
      })
      setBatch({ items, picked: items.map(it => !!it.stock && !it.dup) }) // 重复的默认不勾
    } catch { showToast('识别失败，请重试') }
    finally { setOcrLoading(false) }
  }
  const confirmBatch = () => {
    if (!batch) return
    const grouped = new Map<string, { base: Transaction[]; adds: Transaction[] }>()
    batch.items.forEach((it, i) => {
      if (!it.stock || !batch.picked[i]) return
      const code = it.stock.code
      if (!grouped.has(code)) grouped.set(code, { base: it.stock.transactions ?? ensureTransactions(it.stock), adds: [] })
      grouped.get(code)!.adds.push({ type: it.trade.type, qty: it.trade.qty, price: it.trade.price, ts: buildTs(it.trade.date, it.trade.time) })
    })
    let count = 0
    grouped.forEach(({ base, adds }, code) => { setTransactions(code, [...base, ...adds]); count += adds.length })
    setBatch(null)
    showToast(count ? `已导入 ${count} 笔` : '未选择可导入记录')
  }

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
          ...(pd.marketCap ? { marketCap: pd.marketCap } : {}),
        }
      })
      if (Object.keys(updates).length) batchUpdateWatchlist(updates)
      setPricesLoaded(true)
    }).catch(() => setPricesLoaded(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId])

  // 首次加载企业性质（仅A股非ETF），切账户后重新加载
  useEffect(() => {
    const aShares = watchlist.filter(s => !s.isHK && !s.isUS && !s.isETF && !s.isFund && !isBShare(s.code))
    if (!aShares.length) return
    Promise.all(aShares.map(s => fetchOwnerType(s.code).then(t => [s.code, t] as [string, string])))
      .then(results => setOwnerTypes(Object.fromEntries(results)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId])

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
      const inputs = watchlist.map(s => ({ code: s.code, isHK: s.isHK, isUS: s.isUS, isFund: s.isFund }))
      const priceMap = await fetchStockPrices(inputs, true)
      const updates: Record<string, Partial<WatchlistStock>> = {}
      watchlist.forEach(s => {
        const pd = priceMap[s.code]
        if (!pd) return
        const priceCny = toCnyPrice(pd.price, s, exchangeRate, usdRate)
        const divCny = toCnyPrice(s.dividendPerShare, s, exchangeRate, usdRate)
        const rawYield = priceCny > 0 ? (divCny / priceCny) * 100 : 0
        updates[s.code] = {
          price: pd.price,
          priceCny,
          yieldRate: rawYield > 30 ? s.yieldRate : rawYield,
          pctChg: pd.pctChg,
          ...(pd.marketCap ? { marketCap: pd.marketCap } : {}),
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
    const divCny = toCnyPrice(stock.dividendPerShare, stock, exchangeRate, usdRate)
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
        return toCnyPrice(cost, s, exchangeRate, usdRate)
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
      const priceCnyA = toCnyPrice(a.price, a, exchangeRate, usdRate)
      const priceCnyB = toCnyPrice(b.price, b, exchangeRate, usdRate)
      const pnlA = (priceCnyA - costA) / costA * 100
      const pnlB = (priceCnyB - costB) / costB * 100
      return pnlB - pnlA
    }
    return 0
  })

  const totalAnnual = filtered.reduce((sum, s) => sum + getAnnualDividend(s), 0)
  const totalMonthly = totalAnnual / 12

  // 总市值用全部自选（不随板块筛选变化）
  const totalMarketValue = watchlist.reduce((sum, s) => {
    const pCny = toCnyPrice(s.price, s, exchangeRate, usdRate)
    const sh = Number(s.shares) || 0
    return sum + (pCny > 0 && sh > 0 ? pCny * sh : 0)
  }, 0)

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
        <div className="relative flex items-center justify-center mb-2">
          <h1 className="text-xl font-bold text-gray-900">自选</h1>
          <div className="absolute right-0 flex items-center gap-1.5">
            <button
              aria-label="查看买卖记录汇总"
              onClick={() => navigate('/trade-summary')}
              className="min-h-11 flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 rounded-full px-2.5 active:bg-red-100"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 19V5M4 19h16M8 15v-3M12 15V8M16 15v-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              汇总
            </button>
            <button
              onClick={() => setShowAccountSheet(true)}
              className="min-h-11 flex items-center gap-0.5 text-sm text-gray-600 bg-gray-100 rounded-full px-3 py-1 max-w-[30vw]"
            >
              <span className="truncate">{activeAccountName}</span>
              <svg className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
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
        {/* 截图批量录入 */}
        <div className="flex justify-center mt-2">
          <button onClick={onShotBtn} disabled={ocrLoading} className="text-xs px-3 py-1.5 rounded-full border border-red-400 text-red-600 font-medium disabled:opacity-60 flex items-center gap-1">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="13" r="4"/></svg>
            {ocrLoading ? '识别中…' : '截图批量录入'}
          </button>
        </div>
        <input ref={shotRef} type="file" accept="image/*" className="hidden" onChange={onShotFile} />
      </div>

      {/* 待确认分红提示 */}
      <DividendReminderCard
        items={pendingDiv.items}
        onConfirm={(it) => { pendingDiv.confirm(it); showToast(`已录入 ${it.name} 分红`) }}
        onDismiss={pendingDiv.dismiss}
        variant="list"
      />

      {/* Income summary */}
      {totalAnnual > 0 && (
        <div className="mx-4 mb-3 card p-4">
          <div className="flex items-center">
            <div className="flex-1 text-center">
              <div className="stat-number text-red-600">¥{totalAnnual.toFixed(0)}</div>
              <div className="stat-label">年度红利（税后）</div>
            </div>
            <div className="w-px bg-gray-100 self-stretch" />
            <div className="flex-1 text-center">
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
            <button key={s} className={`sector-tab ${activeSector === s ? 'active' : ''}`} onClick={() => handleSetActiveSector(s)}>
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
          <div className="wl-list">
            {sortedFiltered.map(stock => {
              const annualDiv = getAnnualDividend(stock)
              const priceCny = toCnyPrice(stock.price, stock, exchangeRate, usdRate)
              const shares = Number(stock.shares) || 0
              // 成本由记录摊薄算出，可为负(已回本)；空串=无持仓/清仓
              const costRaw = stock.costPrice !== undefined && stock.costPrice !== '' ? Number(stock.costPrice) : null
              const hasCost = costRaw != null && !Number.isNaN(costRaw) && shares > 0
              const costPriceCny = hasCost
                ? toCnyPrice(costRaw!, stock, exchangeRate, usdRate)
                : null
              const unrealized = costPriceCny != null && shares ? (priceCny - costPriceCny) * shares : null
              const unrealizedPct = costPriceCny != null && costPriceCny > 0 ? ((priceCny - costPriceCny) / costPriceCny) * 100 : null
              const recovered = costPriceCny != null && costPriceCny <= 0  // 已回本（负成本）
              const marketValueCny = priceCny > 0 && shares > 0 ? priceCny * shares : null
              const marketValueDisplay = stock.price > 0 && shares > 0 ? stock.price * shares : null
              const positionPct = marketValueCny != null && totalMarketValue > 0 ? (marketValueCny / totalMarketValue) * 100 : null
              const costYield = costPriceCny && costPriceCny > 0 && stock.dividendPerShare > 0
                ? (stock.dividendPerShare / Number(stock.costPrice)) * 100
                : null
              const isCollapsed = collapsed.has(stock.code)
              return (
                <div key={stock.code} className="card overflow-hidden">
                  {/* Main row（点击折叠/展开） */}
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-3 cursor-pointer" onClick={() => toggleCollapse(stock.code)}>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900">{stock.name}</span>
                          <span className="text-xs text-gray-400">{stock.code}</span>
                          {stock.isETF && <span className="tag tag-blue">场内基金</span>}
                          {stock.isFund && <span className="tag tag-blue">场外基金</span>}
                          {stock.isHK && <span className="tag tag-yellow">港股</span>}
                          {stock.isUS && <span className="tag tag-blue">美股</span>}
                          {isBShare(stock.code) && <span className="tag tag-yellow">B股</span>}
                          {!stock.isHK && !stock.isUS && !isBShare(stock.code) && !stock.isETF && !stock.isFund && ownerTypes[stock.code] && ownerTypes[stock.code] !== '未知' && (
                            <span className={`tag ${ownerTypes[stock.code] === '央企' ? 'tag-blue' : ownerTypes[stock.code] === '地方国企' ? 'tag-yellow' : 'tag-gray'}`}>
                              {ownerTypes[stock.code]}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {stock.isETF || stock.isFund ? '每份红利' : '每股红利'} {currencySymbol(stock)}{stock.dividendPerShare.toFixed(3)}
                          {stock.isHK && <span className="ml-1 text-gray-400">(≈¥{(stock.dividendPerShare * exchangeRate).toFixed(3)} CNY)</span>}
                          {stock.isUS && <span className="ml-1 text-gray-400">(≈¥{(stock.dividendPerShare * usdRate).toFixed(3)} CNY)</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <div className="font-semibold text-gray-900">
                            {stock.isUS ? '$' : '¥'}{stock.price.toFixed(2)}
                            {stock.isHK && <span className="text-xs text-gray-400 ml-1">HKD</span>}
                            {stock.isUS && <span className="text-xs text-gray-400 ml-1">USD</span>}
                          </div>
                          {stock.pctChg != null && (
                            <div className={`text-xs ${stock.pctChg >= 0 ? 'text-red-500' : 'text-green-600'}`}>
                              {stock.pctChg >= 0 ? '+' : ''}{stock.pctChg.toFixed(2)}%
                            </div>
                          )}
                        </div>
                        <svg className="w-4 h-4 text-gray-300 shrink-0" style={{ transform: isCollapsed ? 'rotate(-90deg)' : undefined, transition: 'transform .15s' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    </div>

                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
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
                        {!stock.isHK && !stock.isUS && <span className="tag tag-green">免税</span>}
                      </div>
                      {costYield != null && (
                        <div className="flex items-center gap-1 text-xs">
                          <button
                            className="flex items-center gap-0.5 text-gray-400"
                            onClick={() => navigate('/data-guide#cdy')}
                          >
                            <span>成本股息率</span>
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                              <circle cx="12" cy="12" r="10"/>
                              <path d="M12 16v-4M12 8h.01" strokeLinecap="round"/>
                            </svg>
                          </button>
                          <span className={`tag ${costYield >= 5 ? 'tag-green' : costYield >= 4 ? 'tag-yellow' : 'tag-gray'}`}>
                            {costYield.toFixed(2)}%
                          </span>
                        </div>
                      )}
                    </div>

                    {!isCollapsed && (<>
                    {/* Holdings（只读，按买卖/分红记录算出，点「记录」编辑） */}
                    <div className="flex gap-3" onClick={() => navigate(`/holding/${stock.code}`)}>
                      <div className="flex-1">
                        <label className="text-xs text-gray-400 block mb-1">持股数量</label>
                        <div className="input-field text-sm bg-gray-50 text-gray-700 cursor-pointer">{shares > 0 ? shares : '0'}</div>
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-gray-400 block mb-1">成本价{recovered ? '（已回本）' : ''}</label>
                        <div className="input-field text-sm bg-gray-50 text-gray-700 cursor-pointer">{hasCost ? Number(costRaw).toFixed(3) : '--'}</div>
                      </div>
                    </div>

                    {(annualDiv > 0 || unrealized != null || marketValueDisplay != null || stock.marketCap) && (
                      <div className="mt-3 bg-red-50 rounded-lg overflow-hidden text-sm">
                        {/* 第一行：红利 / 盈亏 */}
                        {(annualDiv > 0 || unrealized != null) && (
                          <div className="flex justify-center gap-6 p-2.5">
                            {annualDiv > 0 && (
                              <>
                                <div className="text-center">
                                  <span className="text-gray-500 text-xs">年红利</span>
                                  <div className="font-semibold text-red-600">¥{annualDiv.toFixed(2)}</div>
                                </div>
                                <div className="text-center">
                                  <span className="text-gray-500 text-xs">月均</span>
                                  <div className="font-semibold text-red-600">¥{(annualDiv / 12).toFixed(2)}</div>
                                </div>
                              </>
                            )}
                            {unrealized != null && (
                              <div className="text-center">
                                <span className="text-gray-500 text-xs">持仓盈亏</span>
                                <div className={`font-semibold ${unrealized >= 0 ? 'text-red-500' : 'text-green-600'}`}>
                                  {unrealized >= 0 ? '+' : ''}¥{Math.abs(unrealized).toFixed(0)}
                                  {unrealizedPct != null
                                    ? <span className="text-xs ml-1">({unrealizedPct >= 0 ? '+' : ''}{unrealizedPct.toFixed(2)}%)</span>
                                    : recovered && <span className="text-xs ml-1">(已回本)</span>}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {/* 第二行：持有市值 / 仓位占比 / 公司总市值 */}
                        {(marketValueDisplay != null || stock.marketCap) && (
                          <>
                            {(annualDiv > 0 || unrealized != null) && (
                              <div className="h-px bg-red-100 mx-2.5" />
                            )}
                            <div className="flex justify-center gap-6 p-2.5">
                              {marketValueDisplay != null && (
                                <div className="text-center">
                                  <span className="text-gray-500 text-xs">持有市值</span>
                                  <div className="font-semibold text-gray-700">
                                    {stock.isHK ? 'HK$' : stock.isUS ? '$' : '¥'}{marketValueDisplay >= 10000 ? `${(marketValueDisplay / 10000).toFixed(2)}万` : marketValueDisplay.toFixed(0)}
                                  </div>
                                </div>
                              )}
                              {positionPct != null && (
                                <div className="text-center">
                                  <span className="text-gray-500 text-xs">仓位占比</span>
                                  <div className="font-semibold text-gray-700">{positionPct.toFixed(1)}%</div>
                                </div>
                              )}
                              {stock.marketCap && (
                                <div className="text-center">
                                  <span className="text-gray-500 text-xs">总市值</span>
                                  <div className="font-semibold text-gray-700">
                                    {stock.marketCap >= 10000 ? `${(stock.marketCap / 10000).toFixed(1)}万亿` : `${stock.marketCap.toFixed(0)}亿`}
                                  </div>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    </>)}
                  </div>

                  {/* Actions（折叠时隐藏） */}
                  {!isCollapsed && (
                  <div className="flex border-t border-gray-50">
                    <button
                      className="flex-1 py-2.5 text-xs text-gray-500 flex items-center justify-center gap-1"
                      onClick={() => navigate(`/holding/${stock.code}`)}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 12h6M9 16h6" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      记录
                    </button>
                    <div className="w-px bg-gray-50" />
                    <button
                      className="flex-1 py-2.5 text-xs text-gray-500 flex items-center justify-center gap-1"
                      onClick={() => navigate(`/matrix?code=${stock.code}&name=${stock.name}&dividend=${stock.dividendPerShare}&price=${stock.price.toFixed(2)}&isHK=${stock.isHK || false}&isUS=${stock.isUS || false}`)}
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
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Disclaimer />
      <Toast message={message} />

      {/* 账户切换 */}
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

      {confirmRemove && (() => {
        const target = watchlist.find(w => w.code === confirmRemove)
        const txCount = target?.transactions?.length ?? 0
        const hasHolding = txCount > 0 || (target?.shares ?? 0) > 0
        return (
        <div className="modal-backdrop" style={{ alignItems: 'center' }} onClick={() => setConfirmRemove(null)}>
          <div className="bg-white rounded-2xl p-6 mx-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <p className="text-base font-semibold text-gray-900 mb-1">移除自选</p>
            {hasHolding ? (
              <p className="text-sm text-red-500 mb-5">
                该股有持仓{txCount > 0 ? `及 ${txCount} 条交易记录` : ''}，移除将一并删除，且无法恢复。确定移除？
              </p>
            ) : (
              <p className="text-sm text-gray-500 mb-5">确定要移除该股票吗？</p>
            )}
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setConfirmRemove(null)}>取消</button>
              <button
                className="flex-1 py-3 bg-red-600 text-white rounded-xl font-semibold"
                onClick={() => { removeFromWatchlist(confirmRemove); setConfirmRemove(null); showToast('已移除') }}
              >确认移除</button>
            </div>
          </div>
        </div>
        )
      })()}

      {/* 截图批量录入确认 */}
      <Modal open={!!batch} onClose={() => setBatch(null)} title={batch ? `识别到 ${batch.items.length} 笔，可导入 ${batch.items.filter(it => it.stock && !it.dup).length} 笔` : ''}>
        {batch && (
          <div className="space-y-3">
            <div className="text-xs text-gray-400">仅可导入已在自选中的股票；重复的已标「已录入」默认不勾。请核对后确认。</div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {batch.items.map((it, i) => {
                const matched = !!it.stock
                const dup = !!it.dup
                return (
                  <label key={i} className={`flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-100 ${matched ? (dup ? 'opacity-60' : '') : 'opacity-50'}`}>
                    <input
                      type="checkbox"
                      disabled={!matched}
                      checked={batch.picked[i]}
                      onChange={e => setBatch(b => b ? { ...b, picked: b.picked.map((p, j) => j === i ? e.target.checked : p) } : b)}
                      className="accent-red-500"
                    />
                    <span className={`tag flex-shrink-0 ${it.trade.type === 'sell' ? 'tag-green' : 'tag-red'}`}>{it.trade.type === 'sell' ? '卖出' : '买入'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-800 truncate">{it.trade.name} · {it.trade.qty}股 @ {it.trade.price}</div>
                      <div className="text-xs text-gray-400">{it.trade.date}{it.trade.time ? ' ' + it.trade.time : ''}{matched ? (dup ? ' · 已录入' : '') : ' · 不在自选'}</div>
                    </div>
                  </label>
                )
              })}
            </div>
            <button onClick={confirmBatch} className="w-full py-3 bg-red-600 text-white rounded-xl font-semibold">确认导入</button>
          </div>
        )}
      </Modal>
    </div>
  )
}
