import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { currencySymbol } from '../utils/market'
import type { Transaction } from '../utils/holdings'

type Period = 'day' | 'week' | 'month'
type ViewMode = 'trade' | 'stock'
type SortMode = 'amountDesc' | 'amountAsc'
type Trade = Transaction & { name: string; code: string; symbol: string }
type Totals = { buy: number; sell: number; buyQty: number; sellQty: number; buyCount: number; sellCount: number }

function formatAmount(value: number, symbol: string) {
  return `${symbol}${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
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
    if (trade.type === 'buy') { total.buy += amount; total.buyQty += Number(trade.qty); total.buyCount++ } else { total.sell += amount; total.sellQty += Number(trade.qty); total.sellCount++ }
    return total
  }, { buy: 0, sell: 0, buyQty: 0, sellQty: 0, buyCount: 0, sellCount: 0 })
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
  const [period, setPeriod] = useState<Period>('day')
  const [viewMode, setViewMode] = useState<ViewMode>('trade')
  const [sortMode, setSortMode] = useState<SortMode>('amountDesc')
  const activeAccountName = accounts.find(a => a.id === activeAccountId)?.name || '我的账户'

  const groups = useMemo(() => {
    const trades: Trade[] = watchlist.flatMap(stock => (stock.transactions || [])
      .filter(tx => tx.type === 'buy' || tx.type === 'sell')
      .map(tx => ({ ...tx, name: stock.name, code: stock.code, symbol: currencySymbol(stock) })))
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
  }, [watchlist, period])

  return (
    <div className="page-content page-narrow pb-6">
      <div className="relative flex items-center px-4 pt-12 pb-4">
        <button aria-label="返回我的页面" onClick={() => navigate(-1)} className="p-2 -ml-2 text-gray-500 rounded-lg active:bg-gray-100">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="absolute inset-x-0 text-center pointer-events-none"><h1 className="text-base font-bold text-gray-900">买卖记录汇总</h1></div>
      </div>

      <div className="px-4 pb-4">
        <p className="text-xs text-gray-400 mb-3">当前账户：{activeAccountName}</p>
        <div className="flex gap-2">
          <div className="flex flex-1 bg-gray-100 rounded-xl p-1" aria-label="查看方式">
            {([['trade', '按交易'], ['stock', '按股票']] as const).map(([key, label]) => (
              <button key={key} aria-pressed={viewMode === key} onClick={() => setViewMode(key)} className={`flex-1 min-h-9 rounded-lg text-xs transition-colors ${viewMode === key ? 'bg-white text-gray-900 font-semibold shadow-sm' : 'text-gray-500'}`}>{label}</button>
            ))}
          </div>
          <div className="flex bg-gray-100 rounded-xl p-1" aria-label="统计周期">
            {([['day', '日'], ['week', '周'], ['month', '月']] as const).map(([key, label]) => (
              <button key={key} aria-pressed={period === key} onClick={() => setPeriod(key)} className={`min-w-10 min-h-9 rounded-lg text-xs transition-colors ${period === key ? 'bg-white text-gray-900 font-semibold shadow-sm' : 'text-gray-500'}`}>{label}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3" aria-label="排序方式">
          <span className="text-xs text-gray-400 shrink-0">排序</span>
          <div className="flex flex-1 bg-gray-100 rounded-xl p-1">
            {([['amountDesc', '金额高→低'], ['amountAsc', '金额低→高']] as const).map(([key, label]) => (
              <button key={key} aria-pressed={sortMode === key} onClick={() => setSortMode(key)} className={`flex-1 min-h-8 rounded-lg text-[11px] transition-colors ${sortMode === key ? 'bg-white text-gray-900 font-semibold shadow-sm' : 'text-gray-500'}`}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 space-y-3">
        {!groups.length ? (
          <div className="card py-12 text-center text-sm text-gray-400">还没有买卖记录，去自选股详情中添加吧</div>
        ) : groups.map(group => {
          const currencyTotals = new Map<string, Totals>()
          group.trades.forEach(trade => {
            const current = currencyTotals.get(trade.symbol) || { buy: 0, sell: 0, buyQty: 0, sellQty: 0, buyCount: 0, sellCount: 0 }
            const next = sumTrades([trade])
            currencyTotals.set(trade.symbol, { buy: current.buy + next.buy, sell: current.sell + next.sell, buyQty: current.buyQty + next.buyQty, sellQty: current.sellQty + next.sellQty, buyCount: current.buyCount + next.buyCount, sellCount: current.sellCount + next.sellCount })
          })
          const stocks = [...new Map(group.trades.map(trade => [trade.code, trade])).values()].map(stock => {
            const trades = group.trades.filter(trade => trade.code === stock.code)
            return { ...stock, trades, total: sumTrades(trades) }
          })
          const orderedTrades = [...group.trades].sort((a, b) => {
            const diff = Number(a.qty) * Number(a.price) - Number(b.qty) * Number(b.price)
            return sortMode === 'amountDesc' ? -diff : diff
          })
          const orderedStocks = [...stocks].sort((a, b) => {
            const diff = (a.total.buy + a.total.sell) - (b.total.buy + b.total.sell)
            return sortMode === 'amountDesc' ? -diff : diff
          })
          return <section key={group.label} className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-3.5 pb-3 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">{group.label}</h2>
              <span className="text-xs text-gray-400">{viewMode === 'trade' ? `${group.trades.length} 笔交易` : `${stocks.length} 只股票`}</span>
            </div>
            <div className="px-4 py-3.5 space-y-3 bg-gradient-to-b from-gray-50/70 to-white">
              {[...currencyTotals.entries()].map(([symbol, total]) => <div key={symbol} className="grid grid-cols-3 gap-2 text-right font-tabular">
                <div><div className="text-[11px] text-gray-400 mb-0.5">买入 {total.buyCount} 笔</div><div className="text-sm font-semibold text-red-600">{formatAmount(total.buy, symbol)}</div></div>
                <div><div className="text-[11px] text-gray-400 mb-0.5">卖出 {total.sellCount} 笔</div><div className="text-sm font-semibold text-emerald-600">{formatAmount(total.sell, symbol)}</div></div>
                <div><div className="text-[11px] text-gray-400 mb-0.5">净买入</div><div className={`text-sm font-bold ${total.buy - total.sell > 0 ? 'text-gray-900' : 'text-emerald-600'}`}>{formatAmount(total.buy - total.sell, symbol)}</div></div>
              </div>)}
            </div>
            <div className="border-t border-gray-100 divide-y divide-gray-50">
              {viewMode === 'trade' ? orderedTrades.map((trade, index) => {
                const date = formatTradeDate(trade.ts)
                return <div key={`${trade.code}-${trade.ts}-${index}`} className="flex items-center gap-3 px-4 py-3.5 text-xs">
                  <div className="w-9 shrink-0 text-center font-tabular text-sm font-semibold text-gray-700">{date}</div>
                  <span className={`w-9 shrink-0 text-center py-1 rounded-md font-medium ${trade.type === 'buy' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>{trade.type === 'buy' ? '买入' : '卖出'}</span>
                  <div className="flex-1 min-w-0"><div className="text-sm font-semibold text-gray-800 truncate">{trade.name}</div><div className="text-[11px] text-gray-400 mt-1 font-tabular">{trade.code} · {Number(trade.qty).toLocaleString()} 股 × {formatAmount(Number(trade.price), trade.symbol)}</div></div>
                  <div className={`text-right font-tabular ${trade.type === 'buy' ? 'text-red-600' : 'text-emerald-600'}`}><div className="text-sm font-bold">{trade.type === 'buy' ? '+' : '-'}{formatAmount(Number(trade.qty) * Number(trade.price), trade.symbol)}</div><div className="text-[10px] text-gray-400 mt-1">成交额</div></div>
                </div>
              }) : orderedStocks.map(stock => <div key={stock.code} className="px-4 py-3.5">
                <div className="flex items-center justify-between gap-3"><div className="min-w-0"><div className="text-sm font-semibold text-gray-800 truncate">{stock.name}</div><div className="text-[11px] text-gray-400 mt-0.5">{stock.code} · {stock.trades.length} 笔交易</div></div><div className={`text-right font-tabular text-sm font-bold ${stock.total.buy - stock.total.sell > 0 ? 'text-gray-900' : 'text-emerald-600'}`}><div>{formatAmount(stock.total.buy - stock.total.sell, stock.symbol)}</div><div className="text-[11px] text-gray-400 font-normal mt-0.5">净买入</div></div></div>
                <div className="grid grid-cols-2 gap-3 mt-3 text-xs font-tabular"><div className="rounded-lg bg-red-50 px-2.5 py-2.5"><div className="flex justify-between text-red-500"><span>买入 {stock.total.buyCount} 笔</span><span>{stock.total.buyQty.toLocaleString()} 股</span></div><div className="flex justify-between mt-1.5 text-red-600 font-semibold"><span>均价 {stock.total.buyQty ? formatAmount(stock.total.buy / stock.total.buyQty, stock.symbol) : '—'}</span><span>{formatAmount(stock.total.buy, stock.symbol)}</span></div></div><div className="rounded-lg bg-emerald-50 px-2.5 py-2.5"><div className="flex justify-between text-emerald-600"><span>卖出 {stock.total.sellCount} 笔</span><span>{stock.total.sellQty.toLocaleString()} 股</span></div><div className="flex justify-between mt-1.5 text-emerald-700 font-semibold"><span>均价 {stock.total.sellQty ? formatAmount(stock.total.sell / stock.total.sellQty, stock.symbol) : '—'}</span><span>{formatAmount(stock.total.sell, stock.symbol)}</span></div></div></div>
                <div className="flex justify-between mt-2.5 px-0.5 text-[11px] text-gray-400 font-tabular"><span>净买入股数</span><span className="text-gray-600 font-semibold">{(stock.total.buyQty - stock.total.sellQty).toLocaleString()} 股</span></div>
              </div>)}
            </div>
          </section>
        })}
      </div>
    </div>
  )
}
