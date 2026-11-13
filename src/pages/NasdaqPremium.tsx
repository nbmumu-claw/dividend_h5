import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchTxRawQuotes } from '../utils/api'
import { compareNasdaqFunds, formatQuoteTime, parseNasdaqQuotes, type NasdaqQuote, type NasdaqSort, type NasdaqSortKey } from '../utils/nasdaqPremium'
import './NasdaqPremium.css'

const funds = [
  { name: '华泰柏瑞', code: '513110', manage: 0.80, custody: 0.20 },
  { name: '大成', code: '159513', manage: 0.80, custody: 0.20 },
  { name: '华安', code: '159632', manage: 0.60, custody: 0.20 },
  { name: '汇添富', code: '159660', manage: 0.50, custody: 0.15 },
  { name: '博时', code: '513390', manage: 0.50, custody: 0.15 },
  { name: '富国', code: '513870', manage: 0.50, custody: 0.10 },
  { name: '华夏', code: '513300', manage: 0.60, custody: 0.20 },
  { name: '招商', code: '159659', manage: 0.50, custody: 0.15 },
  { name: '广发', code: '159941', manage: 0.80, custody: 0.20 },
  { name: '易方达', code: '159696', manage: 0.50, custody: 0.10 },
  { name: '国泰', code: '513100', manage: 0.60, custody: 0.20 },
  { name: '嘉实', code: '159501', manage: 0.50, custody: 0.10 },
]

const quoteCodes = funds.map(fund => `${fund.code.startsWith('5') ? 'sh' : 'sz'}${fund.code}`)
const sortColumns: { key: NasdaqSortKey; label: string; detail?: string }[] = [
  { key: 'change', label: '现价', detail: '日涨跌' },
  { key: 'premium', label: '参考溢价' },
  { key: 'iopv', label: 'IOPV', detail: '盘中参考净值' },
  { key: 'size', label: '估算规模', detail: '亿元' },
  { key: 'turnover', label: '成交额', detail: '亿元' },
  { key: 'fee', label: '管理 / 托管', detail: '年费率 %' },
]

export default function NasdaqPremium() {
  const navigate = useNavigate()
  const [quotes, setQuotes] = useState<Record<string, NasdaqQuote>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [sort, setSort] = useState<NasdaqSort>({ key: 'premium', direction: 'asc' })

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const next = parseNasdaqQuotes(await fetchTxRawQuotes(quoteCodes))
      if (Object.keys(next).length === 0) throw new Error('暂未取得有效行情')
      setQuotes(next)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '行情获取失败')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 60_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const sortedFunds = useMemo(() => [...funds].sort((a, b) => compareNasdaqFunds(a, b, quotes, sort)), [quotes, sort])
  const toggleSort = (key: NasdaqSortKey) => setSort(current => ({
    key,
    direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
  }))
  const available = Object.values(quotes)
  const premiumMin = Math.min(...available.map(quote => quote.premium))
  const premiumMax = Math.max(...available.map(quote => quote.premium))
  const latestTradeTime = available.reduce((latest, quote) => quote.tradeTime > latest ? quote.tradeTime : latest, '')
  const timeLabel = latestTradeTime ? formatQuoteTime(latestTradeTime) : '等待行情'

  return (
    <main className="nasdaq-page">
      <div className="nasdaq-wrap">
        <button className="nasdaq-back" onClick={() => navigate('/yield-grid')} aria-label="返回股息率网格">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          返回股息率网格
        </button>

        <header className="nasdaq-heading">
          <div>
            <p className="nasdaq-eyebrow">ETF 溢价观察 · 行情自动更新</p>
            <h1>纳指100 ETF 实时溢价</h1>
            <p className="nasdaq-intro">12 只基金 · 点击表头切换排序</p>
          </div>
          <div className="nasdaq-range"><span>参考溢价区间</span><strong>{available.length ? `${premiumMin.toFixed(2)}%—${premiumMax.toFixed(2)}%` : '—'}</strong></div>
        </header>

        <div className="nasdaq-status" role="status">
          <span>行情时间：{timeLabel}（北京时间）· 页面打开期间每 60 秒刷新</span>
          <button type="button" onClick={() => { void refresh() }} disabled={refreshing}>{refreshing ? '刷新中…' : '立即刷新'}</button>
        </div>
        {error && <p className="nasdaq-error" role="alert">{error}。{available.length ? '当前显示上次成功获取的数据。' : '请稍后重试。'}</p>}

        <section className="nasdaq-panel" aria-label="纳指100 ETF 溢价表">
          <div className="nasdaq-panel-head"><strong>纳斯达克100 ETF</strong><span>{latestTradeTime ? `${timeLabel} · ${available.length} 只有效行情` : '加载中'}</span></div>
          <p className="nasdaq-swipe-hint">左右滑动查看 IOPV、规模、成交额及费率 →</p>
          <div className="nasdaq-scroll" role="region" aria-label="可横向滚动的基金数据表" tabIndex={0}>
            <table>
              <thead><tr>
                <th scope="col">基金<br />代码</th>
                {sortColumns.map(column => <th scope="col" key={column.key} aria-sort={sort.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" className="nasdaq-sort" onClick={() => toggleSort(column.key)} aria-label={`按${column.key === 'fee' ? '合计年费率' : column.key === 'change' ? '日涨跌幅' : column.label}${sort.key === column.key && sort.direction === 'desc' ? '升序' : '降序'}排列`}>
                    <span>{column.label}{column.detail && <><br />{column.detail}</>}</span>
                    <span className="nasdaq-sort-icons" aria-hidden="true"><i className={`nasdaq-sort-up${sort.key === column.key && sort.direction === 'asc' ? ' active' : ''}`} /><i className={`nasdaq-sort-down${sort.key === column.key && sort.direction === 'desc' ? ' active' : ''}`} /></span>
                  </button>
                </th>)}
              </tr></thead>
              <tbody>{sortedFunds.map(fund => {
                const quote = quotes[fund.code]
                return (
                  <tr key={fund.code}>
                    <th scope="row"><strong>{fund.name}</strong><small>{fund.code}</small></th>
                    <td><strong>{quote?.price.toFixed(3) ?? '—'}</strong><small className={quote && quote.change >= 0 ? 'nasdaq-up' : 'nasdaq-down'}>{quote ? `${quote.change > 0 ? '+' : ''}${quote.change.toFixed(2)}%` : '—'}</small></td>
                    <td className="nasdaq-premium">{quote ? `${quote.premium.toFixed(2)}%` : '—'}</td>
                    <td><strong>{quote?.iopv.toFixed(4) ?? '—'}</strong></td>
                    <td><strong>{quote?.size.toFixed(2) ?? '—'}</strong></td>
                    <td><strong>{quote?.turnover.toFixed(2) ?? '—'}</strong></td>
                    <td><strong>{fund.manage.toFixed(2)} / {fund.custody.toFixed(2)}</strong><small>合计 {(fund.manage + fund.custody).toFixed(2)}%</small></td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
          {loading && <p className="nasdaq-empty">正在获取最新行情…</p>}
        </section>

        <footer className="nasdaq-note">
          <p>参考溢价 = 现价 ÷ 报价 IOPV − 1；估算规模 = 基金份额 × IOPV。费率参考原图，非实时数据，且不含券商佣金。</p>
          <p>行情来自腾讯公开报价，经本站接口获取，可能存在延迟；页面打开期间每 60 秒刷新。休市时显示最近一次报价，请以“行情时间”为准。IOPV 是盘中参考净值，并非正式基金净值。</p>
          <p>仅供参考，不构成投资建议。</p>
        </footer>
      </div>
    </main>
  )
}
