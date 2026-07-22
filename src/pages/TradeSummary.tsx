import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { currencySymbol, toCnyPrice } from '../utils/market'
import type { Transaction } from '../utils/holdings'
import Modal from '../components/Modal'

type Period = 'day' | 'week' | 'month'
type ViewMode = 'trade' | 'stock'
type SortMode = 'amountDesc' | 'amountAsc'
type TradeFilter = 'all' | 'buy' | 'sell'
type Trade = Transaction & { name: string; code: string; symbol: string; amountCny: number }
type Totals = { buy: number; sell: number; buyCny: number; sellCny: number; buyQty: number; sellQty: number; buyCount: number; sellCount: number }

function formatAmount(value: number, symbol: string) {
  return `${symbol}${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}

function formatCny(value: number) {
  return `≈${formatAmount(value, '¥')}`
}

function periodOf(ts: number, period: Period) {
  const date = new Date(ts)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  if (period === 'day') return { key: `${y}-${m}-${d}`, label: `${y}年${Number(m)}月${Number(d)}日` }
  if (period === 'month') return { key: `${y}-${m}`, label: `${y}年${Number(m)}月` }

  const monday = new Date(y, date.getMonth(), date.getDate())
  monday.setHours(0, 0, 0, 0)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`
  return { key: `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`, label: `${monday.getFullYear()}年 ${fmt(monday)}–${fmt(sunday)}` }
}

function sumTrades(trades: Trade[]) {
  return trades.reduce<Totals>((total, trade) => {
    const amount = Number(trade.qty) * Number(trade.price)
    if (trade.type === 'buy') { total.buy += amount; total.buyCny += trade.amountCny; total.buyQty += Number(trade.qty); total.buyCount++ } else { total.sell += amount; total.sellCny += trade.amountCny; total.sellQty += Number(trade.qty); total.sellCount++ }
    return total
  }, { buy: 0, sell: 0, buyCny: 0, sellCny: 0, buyQty: 0, sellQty: 0, buyCount: 0, sellCount: 0 })
}

function formatTradeDate(ts: number) {
  const date = new Date(ts)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

export default function TradeSummary() {
  const navigate = useNavigate()
  const watchlist = useStore(s => s.watchlist)
  const accounts = useStore(s => s.accounts)
  const activeAccountId = useStore(s => s.activeAccountId)
  const switchAccount = useStore(s => s.switchAccount)
  const exchangeRate = useStore(s => s.exchangeRate)
  const usdRate = useStore(s => s.usdRate)
  const [period, setPeriod] = useState<Period>('day')
  const [viewMode, setViewMode] = useState<ViewMode>('trade')
  const [sortMode, setSortMode] = useState<SortMode>('amountDesc')
  const [tradeFilter, setTradeFilter] = useState<TradeFilter>('all')
  const [showAccountSheet, setShowAccountSheet] = useState(false)
  const activeAccountName = accounts.find(a => a.id === activeAccountId)?.name || '我的账户'

  const groups = useMemo(() => {
    const trades: Trade[] = watchlist.flatMap(stock => (stock.transactions || [])
      .filter(tx => (tx.type === 'buy' || tx.type === 'sell') && (tradeFilter === 'all' || tx.type === tradeFilter))
      .map(tx => ({ ...tx, name: stock.name, code: stock.code, symbol: currencySymbol(stock), amountCny: toCnyPrice(Number(tx.qty) * Number(tx.price), stock, exchangeRate, usdRate) })))
    const map = new Map<string, { label: string; trades: Trade[] }>()
    trades.forEach(trade => {
      const bucket = periodOf(trade.ts, period)
      const group = map.get(bucket.key) || { label: bucket.label, trades: [] }
      group.trades.push(trade)
      map.set(bucket.key, group)
    })
    return [...map.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([, group]) => ({ ...group, trades: group.trades.sort((a, b) => b.ts - a.ts) }))
  }, [watchlist, period, exchangeRate, usdRate, tradeFilter])

  return (
    <div className="page-content page-narrow pb-6">
      <div className="relative flex items-center px-4 pt-12 pb-4">
        <button aria-label="返回我的页面" onClick={() => navigate(-1)} className="p-2 -ml-2 text-gray-500 rounded-lg active:bg-gray-100">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="absolute inset-x-0 text-center pointer-events-none"><h1 className="text-base font-bold text-gray-900">买卖记录汇总</h1></div>
      </div>

      <div className="px-4 pb-4">
        <button
          onClick={() => setShowAccountSheet(true)}
          className="min-h-10 mb-3 px-3 flex items-center gap-2 rounded-xl border border-gray-200 bg-white text-xs text-gray-500 shadow-sm cursor-pointer active:bg-gray-50"
        >
          <span>当前账户</span>
          <span className="font-semibold text-gray-800">{activeAccountName}</span>
          <svg className="w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="flex gap-2">
          <div className="flex flex-1 gap-1" aria-label="查看方式">
            {([['trade', '按交易'], ['stock', '按股票']] as const).map(([key, label]) => (
              <button key={key} aria-pressed={viewMode === key} onClick={() => setViewMode(key)} className={`flex-1 min-h-11 rounded-xl border text-xs cursor-pointer transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 ${viewMode === key ? 'bg-red-600 border-red-600 text-white font-semibold shadow-sm' : 'bg-white border-gray-200 text-gray-600 font-medium shadow-sm active:bg-gray-100'}`}>{label}</button>
            ))}
          </div>
          <div className="flex gap-1" aria-label="统计周期">
            {([['day', '日'], ['week', '周'], ['month', '月']] as const).map(([key, label]) => (
              <button key={key} aria-pressed={period === key} onClick={() => setPeriod(key)} className={`min-w-11 min-h-11 rounded-xl border text-xs cursor-pointer transition-all active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 ${period === key ? 'bg-red-600 border-red-600 text-white font-semibold shadow-sm' : 'bg-white border-gray-200 text-gray-600 font-medium shadow-sm active:bg-gray-100'}`}>{label}</button>
            ))}
          </div>
        </div>
        <div className="flex items-stretch gap-2 mt-3">
          <div className="relative flex-1">
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M4 5h16l-6 7v5l-4 2v-7L4 5z" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <select
              aria-label="筛选交易范围"
              value={tradeFilter}
              onChange={event => setTradeFilter(event.target.value as TradeFilter)}
              className="appearance-none w-full min-h-11 pl-9 pr-9 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 shadow-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-200"
            >
              <option value="all">全部交易</option>
              <option value="buy">只看买入</option>
              <option value="sell">只看卖出</option>
            </select>
            <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <button aria-label="切换金额排序方向" onClick={() => setSortMode(mode => mode === 'amountDesc' ? 'amountAsc' : 'amountDesc')} className="min-h-11 min-w-24 px-3 rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-700 shadow-sm cursor-pointer active:bg-gray-100 active:scale-[0.98] transition-all">
            <span className="block">金额 {sortMode === 'amountDesc' ? '↓' : '↑'}</span>
            <span className="block text-[9px] font-normal text-gray-400 mt-0.5">折合人民币</span>
          </button>
        </div>
      </div>

      <div className="px-4 space-y-3">
        {!groups.length ? (
          <div className="card py-12 text-center text-sm text-gray-400">{tradeFilter === 'buy' ? '暂无买入记录' : tradeFilter === 'sell' ? '暂无卖出记录' : '还没有买卖记录，去自选股详情中添加吧'}</div>
        ) : groups.map(group => {
          const currencyTotals = new Map<string, Totals>()
          group.trades.forEach(trade => {
            const current = currencyTotals.get(trade.symbol) || { buy: 0, sell: 0, buyCny: 0, sellCny: 0, buyQty: 0, sellQty: 0, buyCount: 0, sellCount: 0 }
            const next = sumTrades([trade])
            currencyTotals.set(trade.symbol, { buy: current.buy + next.buy, sell: current.sell + next.sell, buyCny: current.buyCny + next.buyCny, sellCny: current.sellCny + next.sellCny, buyQty: current.buyQty + next.buyQty, sellQty: current.sellQty + next.sellQty, buyCount: current.buyCount + next.buyCount, sellCount: current.sellCount + next.sellCount })
          })
          const stocks = [...new Map(group.trades.map(trade => [trade.code, trade])).values()].map(stock => {
            const trades = group.trades.filter(trade => trade.code === stock.code)
            return { ...stock, trades, total: sumTrades(trades) }
          })
          const orderedTrades = [...group.trades].sort((a, b) => {
            const diff = a.amountCny - b.amountCny
            return sortMode === 'amountDesc' ? -diff : diff
          })
          const orderedStocks = [...stocks].sort((a, b) => {
            const diff = a.trades.reduce((sum, trade) => sum + trade.amountCny, 0) - b.trades.reduce((sum, trade) => sum + trade.amountCny, 0)
            return sortMode === 'amountDesc' ? -diff : diff
          })
          return <section key={group.label} className="card overflow-hidden ring-1 ring-gray-200">
            <div className="flex items-center justify-between px-4 pt-3.5 pb-3 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">{group.label}</h2>
              <span className="text-xs text-gray-400">{viewMode === 'trade' ? `${group.trades.length} 笔交易` : `${stocks.length} 只股票`}</span>
            </div>
            <div className="px-3 py-3 space-y-3 bg-gray-50 border-b border-gray-200">
              {[...currencyTotals.entries()].map(([symbol, total]) => <div key={symbol} className="grid grid-cols-3 gap-2 font-tabular text-center">
                <div className="min-w-0 rounded-xl border border-red-100 bg-red-50/80 px-1.5 py-2.5">
                  <div className="text-[11px] font-medium text-red-500 mb-1">买入 {total.buyCount} 笔</div>
                  <div className="text-sm font-bold text-red-600 whitespace-nowrap">{formatAmount(total.buy, symbol)}</div>
                  {symbol !== '¥' && <div className="text-[10px] text-red-400 mt-1 whitespace-nowrap">{formatCny(total.buyCny)}</div>}
                </div>
                <div className="min-w-0 rounded-xl border border-emerald-100 bg-emerald-50/80 px-1.5 py-2.5">
                  <div className="text-[11px] font-medium text-emerald-600 mb-1">卖出 {total.sellCount} 笔</div>
                  <div className="text-sm font-bold text-emerald-700 whitespace-nowrap">{formatAmount(total.sell, symbol)}</div>
                  {symbol !== '¥' && <div className="text-[10px] text-emerald-500 mt-1 whitespace-nowrap">{formatCny(total.sellCny)}</div>}
                </div>
                <div className="min-w-0 rounded-xl border border-gray-200 bg-white px-1.5 py-2.5 shadow-sm">
                  <div className="text-[11px] font-medium text-gray-500 mb-1">净买入</div>
                  <div className={`text-sm font-bold whitespace-nowrap ${total.buy - total.sell > 0 ? 'text-gray-900' : 'text-emerald-700'}`}>{formatAmount(total.buy - total.sell, symbol)}</div>
                  {symbol !== '¥' && <div className="text-[10px] text-gray-500 mt-1 whitespace-nowrap">{formatCny(total.buyCny - total.sellCny)}</div>}
                </div>
              </div>)}
            </div>
            <div className="divide-y divide-gray-100">
              {viewMode === 'trade' ? orderedTrades.map((trade, index) => {
                const date = formatTradeDate(trade.ts)
                return <div key={`${trade.code}-${trade.ts}-${index}`} className={`flex items-center gap-3 px-4 py-3.5 text-xs border-l-2 ${trade.type === 'buy' ? 'bg-red-50/40 border-red-300' : 'bg-emerald-50/40 border-emerald-300'}`}>
                  <div className={`w-9 shrink-0 text-center font-tabular text-sm font-semibold ${trade.type === 'buy' ? 'text-red-700' : 'text-emerald-700'}`}>{date}</div>
                  <span className={`w-9 shrink-0 text-center py-1 rounded-md font-medium ${trade.type === 'buy' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>{trade.type === 'buy' ? '买入' : '卖出'}</span>
                  <div className="flex-1 min-w-0"><div className="text-sm font-semibold text-gray-800 truncate">{trade.name}</div><div className="text-[11px] text-gray-400 mt-1 font-tabular">{trade.code} · {Number(trade.qty).toLocaleString()} 股 × {formatAmount(Number(trade.price), trade.symbol)}</div></div>
                  <div className={`text-right font-tabular ${trade.type === 'buy' ? 'text-red-600' : 'text-emerald-600'}`}><div className="text-sm font-bold">{trade.type === 'buy' ? '+' : '-'}{formatAmount(Number(trade.qty) * Number(trade.price), trade.symbol)}</div>{trade.symbol !== '¥' ? <div className="text-[10px] text-gray-500 mt-1">{trade.type === 'buy' ? '+' : '-'}{formatCny(trade.amountCny)}</div> : <div className="text-[10px] text-gray-400 mt-1">成交额</div>}</div>
                </div>
              }) : orderedStocks.map(stock => <div key={stock.code} className="px-4 py-3.5">
                <div className="flex items-center justify-between gap-3"><div className="min-w-0"><div className="text-sm font-semibold text-gray-800 truncate">{stock.name}</div><div className="text-[11px] text-gray-400 mt-0.5">{stock.code} · {stock.trades.length} 笔交易</div></div><div className={`text-right font-tabular text-sm font-bold ${stock.total.buy - stock.total.sell > 0 ? 'text-gray-900' : 'text-emerald-600'}`}><div>{formatAmount(stock.total.buy - stock.total.sell, stock.symbol)}</div>{stock.symbol !== '¥' && <div className="text-[10px] text-gray-500 font-normal mt-0.5">{formatCny(stock.total.buyCny - stock.total.sellCny)}</div>}<div className="text-[11px] text-gray-400 font-normal mt-0.5">净买入</div></div></div>
                <div className={`grid gap-3 mt-3 text-xs font-tabular ${stock.total.buyCount > 0 && stock.total.sellCount > 0 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {stock.total.buyCount > 0 && <div className="rounded-lg bg-red-50 px-2.5 py-2.5">
                    <div className="flex justify-between text-red-500"><span>买入 {stock.total.buyCount} 笔</span><span>{stock.total.buyQty.toLocaleString()} 股</span></div>
                    <div className="flex justify-between mt-1.5 text-red-600 font-semibold"><span>均价 {stock.total.buyQty ? formatAmount(stock.total.buy / stock.total.buyQty, stock.symbol) : '—'}</span><span>{formatAmount(stock.total.buy, stock.symbol)}</span></div>
                    {stock.symbol !== '¥' && <div className="mt-1 text-right text-[10px] text-red-400">{formatCny(stock.total.buyCny)}</div>}
                  </div>}
                  {stock.total.sellCount > 0 && <div className="rounded-lg bg-emerald-50 px-2.5 py-2.5">
                    <div className="flex justify-between text-emerald-600"><span>卖出 {stock.total.sellCount} 笔</span><span>{stock.total.sellQty.toLocaleString()} 股</span></div>
                    <div className="flex justify-between mt-1.5 text-emerald-700 font-semibold"><span>均价 {stock.total.sellQty ? formatAmount(stock.total.sell / stock.total.sellQty, stock.symbol) : '—'}</span><span>{formatAmount(stock.total.sell, stock.symbol)}</span></div>
                    {stock.symbol !== '¥' && <div className="mt-1 text-right text-[10px] text-emerald-500">{formatCny(stock.total.sellCny)}</div>}
                  </div>}
                </div>
                <div className="flex justify-between mt-2.5 px-0.5 text-[11px] text-gray-400 font-tabular"><span>净买入股数</span><span className="text-gray-600 font-semibold">{(stock.total.buyQty - stock.total.sellQty).toLocaleString()} 股</span></div>
              </div>)}
            </div>
          </section>
        })}
      </div>

      <Modal open={showAccountSheet} onClose={() => setShowAccountSheet(false)} title="切换账户">
        <div className="space-y-1">
          {accounts.map(account => {
            const active = account.id === activeAccountId
            return <button
              key={account.id}
              onClick={() => { switchAccount(account.id); setShowAccountSheet(false) }}
              className={`w-full min-h-11 flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer ${active ? 'bg-red-50 ring-1 ring-red-100' : 'active:bg-gray-50'}`}
            >
              <span className={`w-5 h-5 flex-shrink-0 ${active ? 'text-red-600' : 'text-transparent'}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <span className={`text-sm ${active ? 'font-semibold text-red-700' : 'text-gray-800'}`}>{account.name}</span>
              {active && <span className="ml-auto text-xs text-red-500">当前</span>}
            </button>
          })}
          <button onClick={() => { setShowAccountSheet(false); navigate('/account-manager') }} className="w-full min-h-11 flex items-center gap-3 px-3 py-3 mt-1 border-t border-gray-100 text-sm text-gray-500 cursor-pointer active:bg-gray-50">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" strokeLinecap="round" strokeLinejoin="round"/></svg>
            管理账户
          </button>
        </div>
      </Modal>
    </div>
  )
}
