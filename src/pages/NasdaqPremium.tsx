import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchTxRawQuotes } from '../utils/api'
import { compareNasdaqFunds, formatQuoteTime, parseNasdaqQuotes, type NasdaqQuote, type NasdaqSort, type NasdaqSortKey } from '../utils/nasdaqPremium'
import './NasdaqPremium.css'

const funds = [
  { name: '华泰柏瑞纳斯达克100交易型开放式指数证券投资基金（QDII）', code: '513110', manage: 0.80, custody: 0.20 },
  { name: '大成纳斯达克100交易型开放式指数证券投资基金（QDII）', code: '159513', manage: 0.80, custody: 0.20 },
  { name: '华安纳斯达克100交易型开放式指数证券投资基金（QDII）', code: '159632', manage: 0.60, custody: 0.20 },
  { name: '汇添富纳斯达克100交易型开放式指数证券投资基金（QDII）', code: '159660', manage: 0.50, custody: 0.15 },
  { name: '博时纳斯达克100交易型开放式指数证券投资基金（QDII）', code: '513390', manage: 0.50, custody: 0.15 },
  { name: '富国纳斯达克100交易型开放式指数证券投资基金（QDII）', code: '513870', manage: 0.50, custody: 0.10 },
  { name: '华夏纳斯达克100交易型开放式指数证券投资基金（QDII）', code: '513300', manage: 0.60, custody: 0.20 },
  { name: '招商纳斯达克100交易型开放式指数证券投资基金（QDII）', code: '159659', manage: 0.50, custody: 0.15 },
  { name: '广发纳斯达克100交易型开放式指数证券投资基金', code: '159941', manage: 0.80, custody: 0.20 },
  { name: '易方达纳斯达克100交易型开放式指数证券投资基金（QDII）', code: '159696', manage: 0.50, custody: 0.10 },
  { name: '纳斯达克100交易型开放式指数证券投资基金', code: '513100', manage: 0.60, custody: 0.20 },
  { name: '嘉实纳斯达克100交易型开放式指数证券投资基金（QDII）', code: '159501', manage: 0.50, custody: 0.10 },
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
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 5 * 60_000)
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
        <div className="nasdaq-nav">
          <span>MARKET NOTE / 100</span>
        </div>

        <header className="nasdaq-hero">
          <div className="nasdaq-hero-copy">
            <p className="nasdaq-eyebrow"><i aria-hidden="true" /> ETF 行情观察</p>
            <h1>纳指100 ETF<br />实时溢价</h1>
            <p className="nasdaq-intro">12 只基金，同一口径查看溢价、成交与费率。</p>
          </div>
          <div className="nasdaq-range">
            <span>当前参考溢价区间</span>
            <strong>{available.length ? `${premiumMin.toFixed(2)}%` : '—'}<small>至</small>{available.length ? `${premiumMax.toFixed(2)}%` : '—'}</strong>
            <p>{available.length} / 12 只有效行情</p>
          </div>
        </header>

        <div className="nasdaq-status" role="status">
          <div><span className="nasdaq-status-label">最近行情</span><strong>{timeLabel}</strong><span>北京时间 · 页面可见时每 5 分钟刷新</span></div>
          <button type="button" onClick={() => { void refresh() }} disabled={refreshing}>{refreshing ? '刷新中…' : '立即刷新'}<span aria-hidden="true">↗</span></button>
        </div>
        {error && <p className="nasdaq-error" role="alert">{error}。{available.length ? '当前显示上次成功获取的数据。' : '请稍后重试。'}</p>}

        <section className="nasdaq-panel" aria-label="纳指100 ETF 溢价清单">
          <div className="nasdaq-panel-head">
            <div><span>01 / ETF SCAN</span><h2>基金清单</h2></div>
            <p>按指标排序，点击当前指标可切换升降序</p>
          </div>
          {!loading && <>
          <div className="nasdaq-sort-bar" role="group" aria-label="基金排序方式">
            {sortColumns.map(column => <button
              type="button"
              key={column.key}
              className={`nasdaq-sort${sort.key === column.key ? ' active' : ''}`}
              onClick={() => toggleSort(column.key)}
              aria-pressed={sort.key === column.key}
              aria-label={`按${column.key === 'fee' ? '合计年费率' : column.key === 'change' ? '日涨跌幅' : column.label}${sort.key === column.key && sort.direction === 'desc' ? '升序' : '降序'}排列`}
            >
              <span>{column.label}{column.detail && <small>{column.detail}</small>}</span>
              <span className="nasdaq-sort-icons" aria-hidden="true"><i className={`nasdaq-sort-up${sort.key === column.key && sort.direction === 'asc' ? ' active' : ''}`} /><i className={`nasdaq-sort-down${sort.key === column.key && sort.direction === 'desc' ? ' active' : ''}`} /></span>
            </button>)}
          </div>
          <div className="nasdaq-table-scroll">
            <table className="nasdaq-table">
              <colgroup>
                <col className="nasdaq-col-fund" />
                <col className="nasdaq-col-price" />
                <col className="nasdaq-col-premium" />
                <col className="nasdaq-col-iopv" />
                <col className="nasdaq-col-size" />
                <col className="nasdaq-col-turnover" />
                <col className="nasdaq-col-fee" />
              </colgroup>
              <thead><tr>
                <th scope="col">基金 / 代码</th>
                {sortColumns.map(column => <th
                  scope="col"
                  key={column.key}
                  aria-sort={sort.key === column.key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}
                >
                  <button
                    type="button"
                    className={`nasdaq-table-sort${sort.key === column.key ? ' active' : ''}`}
                    onClick={() => toggleSort(column.key)}
                    aria-label={`按${column.key === 'fee' ? '合计年费率' : column.key === 'change' ? '日涨跌幅' : column.label}${sort.key === column.key && sort.direction === 'desc' ? '升序' : '降序'}排列`}
                  >
                    <span>{column.label}{column.detail && <small>{column.detail}</small>}</span>
                    <span className="nasdaq-sort-icons" aria-hidden="true"><i className={`nasdaq-sort-up${sort.key === column.key && sort.direction === 'asc' ? ' active' : ''}`} /><i className={`nasdaq-sort-down${sort.key === column.key && sort.direction === 'desc' ? ' active' : ''}`} /></span>
                  </button>
                </th>)}
              </tr></thead>
              <tbody>{sortedFunds.map((fund, index) => {
                const quote = quotes[fund.code]
                return <tr key={fund.code}>
                  <th scope="row" className="nasdaq-table-fund"><span className="nasdaq-table-fund-content"><span className="nasdaq-table-rank">{String(index + 1).padStart(2, '0')}</span><span><strong>{fund.name}</strong><small>{fund.code}</small></span></span></th>
                  <td><strong>{quote?.price.toFixed(3) ?? '—'}</strong><small className={quote && quote.change >= 0 ? 'nasdaq-up' : 'nasdaq-down'}>{quote ? `${quote.change > 0 ? '+' : ''}${quote.change.toFixed(2)}%` : '—'}</small></td>
                  <td className="nasdaq-table-premium"><strong>{quote ? `${quote.premium.toFixed(2)}%` : '—'}</strong></td>
                  <td><strong>{quote?.iopv.toFixed(4) ?? '—'}</strong></td>
                  <td><strong>{quote?.size.toFixed(2) ?? '—'}</strong></td>
                  <td><strong>{quote?.turnover.toFixed(2) ?? '—'}</strong></td>
                  <td><strong>{fund.manage.toFixed(2)} / {fund.custody.toFixed(2)}</strong><small>合计 {(fund.manage + fund.custody).toFixed(2)}%</small></td>
                </tr>
              })}</tbody>
            </table>
          </div>
          <ol className="nasdaq-grid">
            {sortedFunds.map((fund, index) => {
              const quote = quotes[fund.code]
              return (
                <li className="nasdaq-fund-card" key={fund.code}>
                  <article aria-label={`${fund.name} ${fund.code}`}>
                    <div className="nasdaq-card-head">
                      <span className="nasdaq-rank">{String(index + 1).padStart(2, '0')}</span>
                      <div><h3>{fund.name}</h3><span>{fund.code}</span></div>
                      <span className="nasdaq-card-tag">NDX 100</span>
                    </div>
                    <div className="nasdaq-card-primary">
                      <div className="nasdaq-card-premium"><span>参考溢价</span><strong>{quote ? `${quote.premium.toFixed(2)}%` : '—'}</strong></div>
                      <div className="nasdaq-card-price"><span>现价 / 日涨跌</span><strong>{quote?.price.toFixed(3) ?? '—'}</strong><small className={quote && quote.change >= 0 ? 'nasdaq-up' : 'nasdaq-down'}>{quote ? `${quote.change > 0 ? '+' : ''}${quote.change.toFixed(2)}%` : '—'}</small></div>
                    </div>
                    <dl className="nasdaq-card-facts">
                      <div><dt>IOPV · 盘中参考净值</dt><dd>{quote?.iopv.toFixed(4) ?? '—'}</dd></div>
                      <div><dt>估算规模 · 亿元</dt><dd>{quote?.size.toFixed(2) ?? '—'}</dd></div>
                      <div><dt>成交额 · 亿元</dt><dd>{quote?.turnover.toFixed(2) ?? '—'}</dd></div>
                      <div><dt>管理 / 托管 · 年费率</dt><dd>{fund.manage.toFixed(2)}% / {fund.custody.toFixed(2)}%<small>合计 {(fund.manage + fund.custody).toFixed(2)}%</small></dd></div>
                    </dl>
                  </article>
                </li>
              )
            })}
          </ol>
          </>}
          {loading && <p className="nasdaq-empty">正在获取最新行情…</p>}
        </section>

        <footer className="nasdaq-note">
          <span>阅读提示 / DATA NOTES</span>
          <p>参考溢价 = 现价 ÷ 报价 IOPV − 1；估算规模 = 基金份额 × IOPV。费率为静态参考值，非实时数据且不含券商佣金，请以基金正式披露为准。</p>
          <p>行情来自腾讯公开报价，经本站接口获取，可能存在延迟；页面可见时每 5 分钟刷新。休市时显示最近一次报价，请以“行情时间”为准。IOPV 是盘中参考净值，并非正式基金净值。</p>
          <p>仅供参考，不构成投资建议。</p>
        </footer>
      </div>
    </main>
  )
}
