import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchStockPrices, searchStocks, type SearchResult } from '../utils/api'
import { fetchDividendPayouts, type DividendPayoutRecord } from '../utils/dividendPayout'
import { fetchDividendHistory, type DividendYearRecord } from '../utils/dividendHistory'
import { YIELD_GRID_STOCKS } from '../data/yieldGridStocks'

type ReportRow = { REPORTDATE: string; PARENT_NETPROFIT: number }
type ForecastRemote = { name: string; reports: ReportRow[]; latestShare: { TOTAL_SHARES: number; REPORT_DATE?: string; NOTICE_DATE?: string } | null; interimDividend: { PRETAX_BONUS_RMB: number } | null; priorInterimDividend: { PRETAX_BONUS_RMB: number } | null }
type Seasonality = { year: number; h1Profit: number; annualProfit: number; ratio: number }
type ForecastResult = { code: string; name: string; annualDps: number; terminalDps: number | null; yieldRate: number | null; price: number | null; annualProfit: number; h1Profit: number; payout: number; payoutAverage: number; payoutMedian: number; payoutLatest: number; payoutMethod: 'average' | 'median' | 'latest'; shares: number; shareSourceDate: string | null; interim: number | null; priorInterim: number | null; priorAnnualDps: number | null; profitDps: number; interimAnchor: number | null; usesInterimAnchor: boolean; seasonality: Seasonality[]; payouts: DividendPayoutRecord[]; history: DividendYearRecord[]; interimExceedsModel: boolean }

const gateway = 'https://vercel-dividend-d8faqegf03442b6c.service.tcloudbase.com/stockPrice'
const percent = (value: number) => `${(value * 100).toFixed(2)}%`
const billion = (value: number) => `${(value / 1e8).toFixed(2)} 亿`
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
const forecastSectors = ['全部', ...new Set(YIELD_GRID_STOCKS.map(stock => stock.sector))]

function BackIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11.75 4.25 6 10l5.75 5.75" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> }
function RefreshIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 8.25A6 6 0 1 0 16 12M15.5 4.5v3.75h-3.75" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg> }

export default function DividendForecastEngine() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('000423')
  const [result, setResult] = useState<ForecastResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [matches, setMatches] = useState<SearchResult[]>([])
  const [activeSector, setActiveSector] = useState('全部')

  const runFor = async (keyword: string) => {
    let code = keyword.trim()
    if (!code) { setError('请输入 6 位 A 股代码或股票名称。'); return }
    setLoading(true); setError(''); setResult(null); setMatches([])
    try {
      if (!/^\d{6}$/.test(code)) {
        const candidates = (await searchStocks(code)).filter(item => !item.isHK && !item.isUS && /^\d{6}$/.test(item.code))
        if (candidates.length === 0) throw new Error(`未找到“${code}”对应的 A 股标的。`)
        if (candidates.length > 1) { setMatches(candidates.slice(0, 8)); return }
        code = candidates[0].code
      }
      const [response, payouts, prices, history] = await Promise.all([
        fetch(`${gateway}?action=forecastData&code=${code}`).then(async request => {
          if (!request.ok) throw new Error(`财报数据请求失败（${request.status}）`)
          return request.json() as Promise<ForecastRemote>
        }),
        fetchDividendPayouts(code), fetchStockPrices([{ code }], true), fetchDividendHistory(code),
      ])
      const report = (date: string) => response.reports.find(item => item.REPORTDATE.startsWith(date))?.PARENT_NETPROFIT
      const h1Profit = report('2026-06-30')
      const seasonality: Seasonality[] = [2025, 2024, 2023].map(year => {
        const h1 = report(`${year}-06-30`), annual = report(`${year}-12-31`)
        if (!h1 || !annual) throw new Error(`缺少 ${year} 年中报或年报归母净利润。`)
        return { year, h1Profit: h1, annualProfit: annual, ratio: h1 / annual }
      })
      if (!h1Profit) throw new Error('尚未取得 2026 年中报归母净利润。')
      if (!response.latestShare?.TOTAL_SHARES) throw new Error('尚未取得最新权益分派股本。')
      if (payouts.length < 3) throw new Error('尚未取得连续三年的常规现金派息率。')
      const annualProfit = h1Profit / median(seasonality.map(item => item.ratio))
      const payoutRates = payouts.map(item => item.payoutRatio / 100)
      const payoutAverage = average(payoutRates), payoutMedian = median(payoutRates)
      const payoutLatest = payouts.reduce((latest, item) => item.year > latest.year ? item : latest).payoutRatio / 100
      const profitSurge = annualProfit > seasonality[0].annualProfit * 1.25
      const payoutMethod = profitSurge && payoutLatest < payoutAverage - .03
        ? 'latest'
        : Math.max(...payoutRates) > 1 || Math.max(...payoutRates) - Math.min(...payoutRates) > .3 ? 'median' : 'average'
      const payout = payoutMethod === 'latest' ? payoutLatest : payoutMethod === 'median' ? payoutMedian : payoutAverage
      const shares = response.latestShare.TOTAL_SHARES, interim = response.interimDividend?.PRETAX_BONUS_RMB ? response.interimDividend.PRETAX_BONUS_RMB / 10 : null
      const profitDps = annualProfit * payout / shares
      const priorInterim = response.priorInterimDividend?.PRETAX_BONUS_RMB ? response.priorInterimDividend.PRETAX_BONUS_RMB / 10 : null
      const priorAnnualDps = history?.records.find(item => item.year === 2025)?.perShare ?? null
      const interimAnchor = interim !== null && priorInterim !== null && priorAnnualDps !== null ? priorAnnualDps * interim / priorInterim : null
      const usesInterimAnchor = payoutMethod === 'latest' && interimAnchor !== null && interimAnchor < profitDps
      const annualDps = usesInterimAnchor ? interimAnchor : profitDps
      const price = prices[code]?.price ?? null
      setResult({ code, name: response.name || code, annualDps, terminalDps: interim === null ? null : Math.max(annualDps - interim, 0), yieldRate: price && price > 0 ? annualDps / price : null, price, annualProfit, h1Profit, payout, payoutAverage, payoutMedian, payoutLatest, payoutMethod, shares, shareSourceDate: response.latestShare.REPORT_DATE || response.latestShare.NOTICE_DATE || null, interim, priorInterim, priorAnnualDps, profitDps, interimAnchor, usesInterimAnchor, seasonality, payouts: [...payouts].sort((a, b) => a.year - b.year), history: (history?.records ?? []).filter(item => item.year >= 2023 && item.year <= 2025).sort((a, b) => a.year - b.year), interimExceedsModel: interim !== null && interim > annualDps })
    } catch (reason) { setError(reason instanceof Error ? reason.message : '数据请求失败，请稍后重试。') } finally { setLoading(false) }
  }

  const run = async (event?: FormEvent) => { event?.preventDefault(); await runFor(query) }

  const maxDps = result ? Math.max(result.annualDps, ...result.history.map(item => item.perShare), .01) : 1
  return <main className="forecast-page"><div className="forecast-shell">
    <div className="forecast-toolbar"><button className="forecast-back" onClick={() => navigate('/yield-grid')}><BackIcon /> 返回网格页</button><span className="forecast-live"><i /> 实时数据</span></div>
    <header className="forecast-heading"><p className="forecast-kicker">DIVIDEND FORECAST · 2026E</p><h1>分红预测引擎</h1><p>用中报利润、三年季节性、常规派息率和权益股本，生成可追溯的全年每股股息预测。</p></header>
    <form className="forecast-search" onSubmit={run}><label htmlFor="forecast-code">证券代码 / 名称</label><input id="forecast-code" value={query} onChange={event => setQuery(event.target.value)} maxLength={20} placeholder="输入 6 位代码或股票名称" /><button type="submit" disabled={loading}>{loading ? '正在拉取数据' : '查询并计算'}</button><div className="forecast-examples"><span>试试</span><button type="button" onClick={() => setQuery('000423')}>东阿阿胶</button><button type="button" onClick={() => setQuery('601318')}>中国平安</button><button type="button" onClick={() => setQuery('600941')}>中国移动</button><button type="button" onClick={() => setQuery('601728')}>中国电信</button></div></form>
    <div className="forecast-rule"><b>本页规则</b><span>先用利润模型估算股息；当利润快速增长而派息率下行、且已公告两年中期息时，再与“上年全年股息 × 中期息同比”比较，采用更保守的结果。缺少任一可审计输入即暂不覆盖。</span></div>
    <section className="forecast-risk"><b>风险提示</b><span>本页为基于已披露财报、历史分红与中期息的模型估算，不代表公司分红承诺。利润、派息率、股本及分红方案均可能变化；股价波动也会改变预期股息率。仅供研究参考，不构成任何投资建议。</span></section>
    <section className="forecast-sector-picker"><div className="forecast-sector-tabs">{forecastSectors.map(sector => <button type="button" key={sector} className={activeSector === sector ? 'active' : ''} onClick={() => setActiveSector(sector)}>{sector}</button>)}</div>{activeSector === '全部' ? <p>选择一个板块，快速带入网格页标的。</p> : <div className="forecast-sector-stocks">{YIELD_GRID_STOCKS.filter(stock => stock.sector === activeSector).map(stock => <button type="button" key={stock.code} onClick={() => { setQuery(stock.code); void runFor(stock.code) }}><strong>{stock.name}</strong><span>{stock.code}</span></button>)}</div>}</section>
    {matches.length > 0 && <section className="forecast-search-results"><b>找到多个 A 股标的，请选择：</b><div>{matches.map(item => <button key={item.code} type="button" onClick={() => { setQuery(item.code); void runFor(item.code) }}><strong>{item.name}</strong><span>{item.code}</span></button>)}</div></section>}
    {error && <section className="forecast-error"><b>暂不覆盖</b><span>{error}</span></section>}
    {result && <>
      <section className="forecast-result-head"><div><div className="forecast-security"><span>{result.code}</span><h2>{result.name}</h2><em>中报锚定 · B级</em></div><p>数据按查询时实时拉取；每股预测不随盘中行情变动，预期股息率随现价更新。</p></div><button className="forecast-refresh" onClick={() => run()} disabled={loading}><RefreshIcon /> 刷新数据</button></section>
      <section className="forecast-hero-grid" aria-label="预测结果"><article className="forecast-main-kpi"><span>26E 每股股息</span><strong>{result.annualDps.toFixed(3)}<small>元</small></strong><p>{result.terminalDps === null ? '中期息尚未公告' : `预计末期：${result.terminalDps.toFixed(3)} 元`}</p></article><article><span>26E 预期股息率</span><strong className="forecast-accent">{result.yieldRate === null ? '—' : percent(result.yieldRate)}</strong><p>现价：{result.price === null ? '未取得' : `${result.price.toFixed(2)} 元`}</p></article><article><span>全年归母净利润</span><strong>{billion(result.annualProfit)}</strong><p>26H1：{billion(result.h1Profit)}</p></article><article className="forecast-payout-kpi"><span>常规现金派息率</span><strong>{percent(result.payout)}</strong><p>23–25 年{result.payoutMethod === 'latest' ? '最近一年' : result.payoutMethod === 'median' ? '中位数' : '平均值'}</p><button type="button" className="forecast-info-tip" aria-label="查看近三年派息率详情">i<span role="tooltip"><b>近三年常规现金派息率</b>{result.payouts.map(item => <em key={item.year}>{item.year}<strong>{percent(item.payoutRatio / 100)}</strong></em>)}<small>平均值{result.payoutMethod === 'average' ? '（模型采用）' : '（参考）'} <strong>{percent(result.payoutAverage)}</strong></small><small>中位数{result.payoutMethod === 'median' ? '（模型采用）' : '（参考）'} <strong>{percent(result.payoutMedian)}</strong></small><small>最近一年{result.payoutMethod === 'latest' ? '（模型采用：利润跃升/派息率下行）' : '（参考）'} <strong>{percent(result.payoutLatest)}</strong></small></span></button></article></section>
      {result.usesInterimAnchor && <section className="forecast-alert"><b>中期息锚定</b><span>利润模型为 {result.profitDps.toFixed(3)} 元/股；{result.priorAnnualDps?.toFixed(3)} 元/股（25年全年）× {result.interim?.toFixed(3)}（26H1）÷ {result.priorInterim?.toFixed(3)}（25H1）= {result.annualDps.toFixed(3)} 元/股。当前采用更保守的中期息同比结果。</span></section>}
      {result.interimExceedsModel && <section className="forecast-alert"><b>数据校验提示</b><span>模型推算的全年股息低于已公告中期息，结果未被“max”覆盖；请等待年末利润或分红方案更新后再判断。</span></section>}
      <section className="forecast-desktop-data"><div className="forecast-section-title"><div><h2>预测输入与计算过程</h2><p>所有展示值均为本次查询的原始输入或其直接计算结果。</p></div><span>单位：元 / 股 / 亿元</span></div><div className="forecast-data-layout"><div className="forecast-matrix"><div className="forecast-matrix-head"><span>利润季节性</span><span>H1 归母净利</span><span>全年归母净利</span><span>H1 / 全年</span></div><div className="forecast-matrix-row forecast-matrix-forecast"><b>2026E <small>预测</small></b><span>{billion(result.h1Profit)}</span><span>{billion(result.annualProfit)}</span><strong>{percent(median(result.seasonality.map(item => item.ratio)))}</strong></div>{result.seasonality.map(item => <div className="forecast-matrix-row" key={item.year}><b>{item.year}</b><span>{billion(item.h1Profit)}</span><span>{billion(item.annualProfit)}</span><strong>{percent(item.ratio)}</strong></div>)}<div className="forecast-matrix-row forecast-matrix-result"><b>中位数</b><span>—</span><span>—</span><strong>{percent(median(result.seasonality.map(item => item.ratio)))}</strong></div></div><div className="forecast-input-list"><div><span>已公告中期股息</span><b>{result.interim === null ? '尚未公告' : `${result.interim.toFixed(3)} 元/股`}</b></div><div><span>权益分派股本</span><b>{(result.shares / 1e8).toFixed(3)} 亿股<a className="forecast-source-link" href={`https://data.eastmoney.com/yjfp/detail/${result.code}.html`} target="_blank" rel="noreferrer">来源：东方财富分红方案</a></b></div><div><span>下半年修正系数</span><b>1.00 <small>无披露依据调整</small></b></div><div><span>预测末期股息</span><b>{result.terminalDps === null ? '待中期息公告后拆分' : `${result.terminalDps.toFixed(3)} 元/股`}</b></div></div></div><div className="forecast-formulas"><div className={`forecast-equation ${result.usesInterimAnchor ? '' : 'is-selected'}`}><b className="forecast-formula-label">利润模型</b><span>26H1 利润 <b>{billion(result.h1Profit)}</b></span><i>÷</i><span>季节性中位数 <b>{percent(median(result.seasonality.map(item => item.ratio)))}</b></span><i>×</i><span>常规派息率 <b>{percent(result.payout)}</b></span><i>÷</i><span>权益股本 <b>{(result.shares / 1e8).toFixed(3)} 亿股</b></span><i>=</i><strong>{result.profitDps.toFixed(3)} 元/股</strong><em>{result.usesInterimAnchor ? '未采用' : '已采用'}</em></div>{result.interimAnchor !== null && <div className={`forecast-equation ${result.usesInterimAnchor ? 'is-selected' : ''}`}><b className="forecast-formula-label">中期息同比锚定</b><span>25年全年股息 <b>{result.priorAnnualDps?.toFixed(3)} 元</b></span><i>×</i><span>26H1 中期息 <b>{result.interim?.toFixed(3)} 元</b></span><i>÷</i><span>25H1 中期息 <b>{result.priorInterim?.toFixed(3)} 元</b></span><i>=</i><strong>{result.interimAnchor.toFixed(3)} 元/股</strong><em>{result.usesInterimAnchor ? '已采用（更保守）' : '未采用'}</em></div>}<p>{result.usesInterimAnchor ? '选择中期息同比锚定：利润模型高于中期息同比推导值，采用更保守结果。' : '选择利润模型：未触发中期息锚定条件，或中期息同比结果不低于利润模型。'}</p></div></section>
      <section className="forecast-desktop-data forecast-history-panel"><div className="forecast-section-title"><div><h2>历史实际股息与派息率</h2><p>股息为已公告/实施口径；派息率在异常值出现时取三年中位数，否则取平均值，不用特别分红做外推。</p></div></div><div className="forecast-history-grid"><div className="forecast-bar-chart">{[...result.history, { year: 2026, perShare: result.annualDps }].map(item => <div className="forecast-bar-item" key={item.year}><span className="forecast-bar-value">{item.perShare.toFixed(3)}</span><div className={`forecast-bar ${item.year === 2026 ? 'is-forecast' : ''}`} style={{ height: `${Math.max(12, item.perShare / maxDps * 134)}px` }} /><b>{item.year === 2026 ? '2026E' : item.year}</b></div>)}</div><div className="forecast-payout-table"><div><span>年度</span><span>常规现金派息率</span></div>{result.payouts.map(item => <div key={item.year}><b>{item.year}</b><strong>{percent(item.payoutRatio / 100)}</strong></div>)}<div className="forecast-payout-median"><b>平均值{result.payoutMethod === 'average' ? '（模型）' : '（参考）'}</b><strong>{percent(result.payoutAverage)}</strong></div><div className="forecast-payout-median"><b>中位数{result.payoutMethod === 'median' ? '（模型）' : '（参考）'}</b><strong>{percent(result.payoutMedian)}</strong></div></div></div></section>
      <div className="forecast-mobile-data"><details open><summary>预测输入与计算过程 <span>展开</span></summary><div className="forecast-mobile-detail">{result.usesInterimAnchor ? <><p>模型采用 <b>中期息同比锚定</b></p><p>25年全年股息 <b>{result.priorAnnualDps?.toFixed(3)} 元/股</b></p><p>26H1 / 25H1 中期息 <b>{result.interim?.toFixed(3)} ÷ {result.priorInterim?.toFixed(3)}</b></p><p>利润模型（参考） <b>{result.profitDps.toFixed(3)} 元/股</b></p></> : <><p>26H1 归母净利 <b>{billion(result.h1Profit)}</b></p><p>季节性中位数 <b>{percent(median(result.seasonality.map(item => item.ratio)))}</b></p><p>常规现金派息率 <b>{percent(result.payout)}</b></p><p>权益分派股本 <b>{(result.shares / 1e8).toFixed(3)} 亿股</b></p></>}<p>已公告中期股息 <b>{result.interim === null ? '尚未公告' : `${result.interim.toFixed(3)} 元/股`}</b></p><p>预计末期股息 <b>{result.terminalDps === null ? '待中期息公告后拆分' : `${result.terminalDps.toFixed(3)} 元/股`}</b></p></div></details><details><summary>23–25 年利润季节性 <span>展开</span></summary><div className="forecast-mobile-detail">{result.seasonality.map(item => <p key={item.year}>{item.year} H1/全年 <b>{percent(item.ratio)}</b></p>)}</div></details><details><summary>历史股息与派息率 <span>展开</span></summary><div className="forecast-mobile-detail">{result.history.map(item => <p key={item.year}>{item.year} 实际股息 <b>{item.perShare.toFixed(3)} 元/股</b></p>)}{result.payouts.map(item => <p key={`payout-${item.year}`}>{item.year} 派息率 <b>{percent(item.payoutRatio / 100)}</b></p>)}</div></details></div>
    </>}
    {!result && !error && !loading && <section className="forecast-empty"><b>输入代码，开始一次可追溯的预测</b><span>会同时核验中报利润、近三年季节性、派息率、股本、中期息和实时价格。</span></section>}
  </div></main>
}
