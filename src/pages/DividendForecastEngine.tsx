import { useEffect, useState } from 'react'
import { fetchStockPrices } from '../utils/api'

type Engine = { name: string; h1: number; ratios: number[]; payout: number; shares: number; interim: number; date: string; dividends: number[] }
const DATA: Record<string, Engine> = {
  '601318': { name: '中国平安', h1: 925.85, ratios: [.8153, .5894, .5049], payout: .3647, shares: 18.107641995, interim: .98, date: '2026-08-21', dividends: [2.43, 2.55, 2.70] },
  '601728': { name: '中国电信', h1: 195.88, ratios: [.664, .661, .694], payout: .75, shares: 91.507, interim: .1606, date: '2026-08-21', dividends: [.213, .2598, .272] },
  '000423': { name: '东阿阿胶', h1: 8.6038, ratios: [.4615, .4742, .4615], payout: 1, shares: .639826824, interim: 1.344811, date: '2026-08-25', dividends: [1.2, 2.5, 2.7] },
}
const pct = (n: number) => `${(n * 100).toFixed(2)}%`

export default function DividendForecastEngine() {
  const [query, setQuery] = useState('601318'), [code, setCode] = useState('601318'), [price, setPrice] = useState<number | null>(null), [loading, setLoading] = useState(false)
  const input = DATA[code]
  useEffect(() => { if (!input) return; setLoading(true); fetchStockPrices([{ code }], true).then(r => setPrice(r[code]?.price ?? null)).finally(() => setLoading(false)) }, [code, input])
  if (!input) return <main className="forecast-page"><h1>分红预测引擎</h1><section className="forecast-search"><input value={query} onChange={e => setQuery(e.target.value)} /><button onClick={() => setCode(query.trim())}>查询</button></section><p>该标的尚未补齐可审计的中报、派息率与股本，第一版暂不预测。</p></main>
  const rs = [...input.ratios].sort((a, b) => a - b), median = rs[1], annual = input.h1 / median, dps = Math.max(input.interim, annual * input.payout / input.shares / 10), low = Math.max(input.interim, input.h1 / rs[2] * input.payout / input.shares / 10), high = Math.max(input.interim, input.h1 / rs[0] * input.payout / input.shares / 10)
  const max = Math.max(...input.dividends, dps)
  return <main className="forecast-page"><header><small>DIVIDEND FORECAST ENGINE · V1</small><h1>分红预测引擎</h1><p>中报锚定；实时股价仅影响预期股息率。</p></header><section className="forecast-search"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="输入代码" /><button onClick={() => setCode(query.trim())}>查询</button></section><section><h2>{input.name} · {code}</h2><div className="forecast-kpis"><div><small>26E 每股股息</small><b>{dps.toFixed(3)} 元</b></div><div><small>26E 预期股息率</small><b>{price ? pct(dps / price) : loading ? '加载中' : '—'}</b></div><div><small>历史季节性区间</small><b>{low.toFixed(3)}–{high.toFixed(3)}</b></div><div><small>数据日期</small><b>{input.date}</b></div></div></section><section><h2>计算过程</h2><div className="forecast-flow"><span>26H1 归母净利<br/><b>{input.h1} 亿元</b></span><i>→</i><span>H1/全年中位数<br/><b>{pct(median)}</b></span><i>→</i><span>全年利润<br/><b>{annual.toFixed(1)} 亿元</b></span><i>→</i><span>常规派息率<br/><b>{pct(input.payout)}</b></span><i>→</i><span>26E 股息<br/><b>{dps.toFixed(3)} 元</b></span></div><pre>全年利润 = {input.h1} ÷ {pct(median)} × 1.00{`\n`}全年每股股息 = 全年利润 × {pct(input.payout)} ÷ {input.shares.toFixed(3)} 十亿股 ÷ 10</pre></section><section><h2>与历史实际股息对比</h2><div className="forecast-bars">{[...input.dividends, dps].map((v, i) => <div key={i}><b style={{ height: `${v / max * 140}px` }}>{v.toFixed(3)}</b><span>{i === 3 ? '2026E' : 2023 + i}</span></div>)}</div></section><section><h2>所有输入</h2><p>中期息：{input.interim} 元/股 · 股本：{input.shares.toFixed(3)} 十亿股 · 23–25 H1/全年：{input.ratios.map(pct).join(' / ')} · 下半年修正：1.00</p></section></main>
}
