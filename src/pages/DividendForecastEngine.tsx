import { useState } from 'react'
import { fetchStockPrices } from '../utils/api'
import { fetchDividendPayouts } from '../utils/dividendPayout'
import { fetchDividendHistory, type DividendYearRecord } from '../utils/dividendHistory'

type Row = { REPORTDATE: string; PARENT_NETPROFIT: number }
type Remote = { name: string; reports: Row[]; latestShare: { TOTAL_SHARES: number } | null; interimDividend: { PRETAX_BONUS_RMB: number } | null }
const gateway = 'https://vercel-dividend-d8faqegf03442b6c.service.tcloudbase.com/stockPrice'
const pct = (n: number) => `${(n * 100).toFixed(2)}%`

export default function DividendForecastEngine() {
  const [query, setQuery] = useState('000423'), [result, setResult] = useState<{ name: string; dps: number; yield: number | null; profit: number; payout: number; shares: number; interim: number; ratios: number[]; history: DividendYearRecord[] } | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const run = async () => {
    const code = query.trim(); if (!/^\d{6}$/.test(code)) { setError('请输入 6 位 A 股代码'); return }
    setLoading(true); setError(''); setResult(null)
    try {
      const [remote, payouts, prices, history] = await Promise.all([fetch(`${gateway}?action=forecastData&code=${code}`).then(r => r.json() as Promise<Remote>), fetchDividendPayouts(code), fetchStockPrices([{ code }], true), fetchDividendHistory(code)])
      const get = (date: string) => remote.reports.find(r => r.REPORTDATE?.startsWith(date))?.PARENT_NETPROFIT
      const h1 = ['2026-06-30', '2025-06-30', '2024-06-30', '2023-06-30'].map(get)
      const annual = ['2025-12-31', '2024-12-31', '2023-12-31'].map(get)
      if (h1.some(v => !v) || annual.some(v => !v) || !remote.latestShare || !remote.interimDividend || payouts.length < 3) throw new Error('缺少中报、年报、股本、中期息或三年派息率')
      const ratios = [0, 1, 2].map(i => (h1[i + 1]! / annual[i]!)).sort((a, b) => a - b)
      const payout = payouts.map(v => v.payoutRatio / 100).sort((a, b) => a - b)[1]
      const profit = h1[0]! / ratios[1], shares = remote.latestShare.TOTAL_SHARES, interim = remote.interimDividend.PRETAX_BONUS_RMB / 10
      const dps = Math.max(interim, profit * payout / shares)
      const price = prices[code]?.price ?? null
      setResult({ name: remote.name, dps, yield: price ? dps / price : null, profit, payout, shares: shares / 1e8, interim, ratios, history: history?.records ?? [] })
    } catch (e) { setError(e instanceof Error ? e.message : '查询失败') } finally { setLoading(false) }
  }
  const max = result ? Math.max(result.dps, ...result.history.map(item => item.perShare)) : 1
  return <main className="forecast-page"><header><small>DIVIDEND FORECAST ENGINE · LIVE</small><h1>分红预测引擎</h1><p>实时调用财报、权益股本、派息率、历史分红与行情接口。</p></header><section className="forecast-search"><input value={query} onChange={e => setQuery(e.target.value)} /><button onClick={run}>{loading ? '查询中…' : '查询'}</button></section>{error && <section className="forecast-warning">{error}</section>}{result && <><section><h2>{result.name} · {query}</h2><div className="forecast-kpis"><div><small>26E 每股股息</small><b>{result.dps.toFixed(3)} 元</b></div><div><small>26E 预期股息率</small><b>{result.yield ? pct(result.yield) : '—'}</b></div><div><small>全年归母净利</small><b>{(result.profit / 1e8).toFixed(2)} 亿元</b></div><div><small>中期已公告股息</small><b>{result.interim.toFixed(3)} 元</b></div></div></section><section><h2>关键输入</h2><div className="forecast-inputs"><div><b>利润季节性</b><span>{result.ratios.map(pct).join(' / ')}（中位数）</span></div><div><b>常规现金派息率</b><span>{pct(result.payout)}</span></div><div><b>权益分派股本</b><span>{result.shares.toFixed(3)} 亿股</span></div><div><b>下半年修正</b><span>1.00（无披露证据调整）</span></div></div></section><section><h2>计算路径</h2><div className="forecast-flow"><span>26H1 利润</span><i>→</i><span>历史季节性推全年</span><i>→</i><span>× 常规派息率</span><i>→</i><span>÷ 权益股本</span><i>→</i><span>26E 每股股息</span></div></section><section><h2>历史实际股息对比</h2><div className="forecast-bars">{[...result.history.filter(item => item.year >= 2023 && item.year <= 2025).sort((a,b)=>a.year-b.year), { year: 2026, perShare: result.dps }].map(item => <div key={item.year}><b style={{ height: `${item.perShare / max * 140}px` }}>{item.perShare.toFixed(3)}</b><span>{item.year === 2026 ? '2026E' : item.year}</span></div>)}</div></section></>}</main>
}
