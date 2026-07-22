import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { currencySymbol } from '../utils/market'
import type { Transaction } from '../utils/holdings'

type Period = 'day' | 'week' | 'month'
type Trade = Transaction & { name: string; code: string; symbol: string }

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

export default function TradeSummary() {
  const navigate = useNavigate()
  const watchlist = useStore(s => s.watchlist)
  const accounts = useStore(s => s.accounts)
  const activeAccountId = useStore(s => s.activeAccountId)
  const [period, setPeriod] = useState<Period>('month')
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

      <div className="px-4 pb-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-gray-400">当前账户：{activeAccountName}</p>
          <div className="flex bg-gray-100 rounded-lg p-1" aria-label="统计周期">
            {([['day', '日'], ['week', '周'], ['month', '月']] as const).map(([key, label]) => (
              <button key={key} onClick={() => setPeriod(key)} className={`min-w-11 py-1.5 rounded-md text-xs transition-colors ${period === key ? 'bg-white text-gray-900 font-medium shadow-sm' : 'text-gray-500'}`}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 space-y-3">
        {!groups.length ? (
          <div className="card py-12 text-center text-sm text-gray-400">还没有买卖记录，去自选股详情中添加吧</div>
        ) : groups.map(group => {
          const totals = new Map<string, { buy: number; sell: number; buyCount: number; sellCount: number }>()
          group.trades.forEach(trade => {
            const total = totals.get(trade.symbol) || { buy: 0, sell: 0, buyCount: 0, sellCount: 0 }
            const amount = Number(trade.qty) * Number(trade.price)
            if (trade.type === 'buy') { total.buy += amount; total.buyCount++ } else { total.sell += amount; total.sellCount++ }
            totals.set(trade.symbol, total)
          })
          return <section key={group.label} className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
              <h2 className="text-sm font-semibold text-gray-800">{group.label}</h2>
              <span className="text-xs text-gray-400">{group.trades.length} 笔交易</span>
            </div>
            <div className="px-4 py-3 space-y-2.5">
              {[...totals.entries()].map(([symbol, total]) => <div key={symbol} className="grid grid-cols-3 gap-2 text-right font-tabular">
                <div><div className="text-[11px] text-gray-400">买入 {total.buyCount} 笔</div><div className="text-sm font-medium text-red-600">{formatAmount(total.buy, symbol)}</div></div>
                <div><div className="text-[11px] text-gray-400">卖出 {total.sellCount} 笔</div><div className="text-sm font-medium text-emerald-600">{formatAmount(total.sell, symbol)}</div></div>
                <div><div className="text-[11px] text-gray-400">净买入</div><div className={`text-sm font-semibold ${total.buy - total.sell > 0 ? 'text-gray-900' : 'text-emerald-600'}`}>{formatAmount(total.buy - total.sell, symbol)}</div></div>
              </div>)}
            </div>
            <div className="border-t border-gray-50 divide-y divide-gray-50">
              {group.trades.map((trade, index) => <div key={`${trade.code}-${trade.ts}-${index}`} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                <span className={`w-8 text-center py-0.5 rounded ${trade.type === 'buy' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>{trade.type === 'buy' ? '买入' : '卖出'}</span>
                <span className="flex-1 text-gray-700 truncate">{trade.name}</span>
                <span className="text-gray-400 font-tabular">{Number(trade.qty).toLocaleString()} 股 @ {formatAmount(Number(trade.price), trade.symbol)}</span>
              </div>)}
            </div>
          </section>
        })}
      </div>
    </div>
  )
}
