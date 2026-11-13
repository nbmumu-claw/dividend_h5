import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchNasdaqEtfSnapshot } from '../utils/api'
import { isChinaTradingSession, readNasdaqEtfCache, writeNasdaqEtfCache } from '../utils/nasdaqEtfCache'
import { fetchNasdaqMarketQuote, formatNasdaqMarketTime, type NasdaqMarketQuote } from '../utils/nasdaqMarket'
import { compareNasdaqFunds, formatQuoteTime, parseNasdaqQuotes, type NasdaqQuote, type NasdaqSort, type NasdaqSortKey } from '../utils/nasdaqPremium'
import './NasdaqPremium.css'

const funds = [
  { name: '华泰柏瑞纳斯达克100ETF（QDII）', code: '513110', manage: 0.80, custody: 0.20 },
  { name: '大成纳斯达克100ETF（QDII）', code: '159513', manage: 0.80, custody: 0.20 },
  { name: '华安纳斯达克100ETF（QDII）', code: '159632', manage: 0.60, custody: 0.20 },
  { name: '汇添富纳斯达克100ETF', code: '159660', manage: 0.50, custody: 0.15 },
  { name: '博时纳斯达克100ETF', code: '513390', manage: 0.50, custody: 0.15 },
  { name: '富国纳斯达克100ETF（QDII）', code: '513870', manage: 0.50, custody: 0.10 },
  { name: '华夏纳斯达克100ETF（QDII）', code: '513300', manage: 0.60, custody: 0.20 },
  { name: '招商纳斯达克100ETF（QDII）', code: '159659', manage: 0.50, custody: 0.15 },
  { name: '广发纳指100ETF', code: '159941', manage: 0.80, custody: 0.20 },
  { name: '易方达纳斯达克100ETF（QDII）', code: '159696', manage: 0.50, custody: 0.10 },
  { name: '国泰纳斯达克100（QDII-ETF）', code: '513100', manage: 0.60, custody: 0.20 },
  { name: '嘉实纳斯达克100ETF（QDII）', code: '159501', manage: 0.50, custody: 0.10 },
]

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
  const [marketQuotes, setMarketQuotes] = useState<{ index: NasdaqMarketQuote | null; futures: NasdaqMarketQuote | null }>({ index: null, futures: null })
  const [marketError, setMarketError] = useState(false)
  const [sort, setSort] = useState<NasdaqSort>({ key: 'premium', direction: 'asc' })

  const refresh = useCallback(async () => {
    setRefreshing(true)
    const cached = !isChinaTradingSession() && readNasdaqEtfCache()
    const [etfResult, indexResult, futuresResult] = await Promise.allSettled([
      cached ? Promise.resolve(cached) : fetchNasdaqEtfSnapshot(), fetchNasdaqMarketQuote('^NDX'), fetchNasdaqMarketQuote('NQ=F'),
    ])
    try {
      if (etfResult.status === 'rejected') throw etfResult.reason
      const next = parseNasdaqQuotes(etfResult.value)
      if (Object.keys(next).length === 0) throw new Error('暂未取得有效行情')
      if (!cached) writeNasdaqEtfCache(etfResult.value)
      setQuotes(next)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '行情获取失败')
    }
    setMarketQuotes(current => ({
      index: indexResult.status === 'fulfilled' ? indexResult.value : current.index,
      futures: futuresResult.status === 'fulfilled' ? futuresResult.value : current.futures,
    }))
    setMarketError(indexResult.status === 'rejected' || futuresResult.status === 'rejected')
    setLoading(false)
    setRefreshing(false)
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

        <section className="nasdaq-market" aria-label="纳斯达克100市场行情">
          <div className="nasdaq-market-item">
            <div className="nasdaq-market-title"><span>NASDAQ 100 / NDX</span><h2>纳指100指数现价</h2></div>
            <div className="nasdaq-market-value"><strong>{marketQuotes.index?.price.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—'}</strong><span className={marketQuotes.index ? marketQuotes.index.change >= 0 ? 'nasdaq-up' : 'nasdaq-down' : ''}>{marketQuotes.index ? `${marketQuotes.index.change >= 0 ? '+' : ''}${marketQuotes.index.change.toFixed(2)} / ${marketQuotes.index.changePercent >= 0 ? '+' : ''}${marketQuotes.index.changePercent.toFixed(2)}%` : '等待行情'}</span></div>
            <p>{marketQuotes.index ? `指数行情 ${formatNasdaqMarketTime(marketQuotes.index.quoteTime)} · 北京时间` : '指数行情暂不可用'}</p>
          </div>
          <div className="nasdaq-market-item nasdaq-market-futures">
            <div className="nasdaq-market-title"><span>NASDAQ 100 FUTURES / NQ</span><h2>期货涨跌 · 盘前参考</h2></div>
            <div className="nasdaq-market-value"><strong>{marketQuotes.futures?.price.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—'}</strong><span className={marketQuotes.futures ? marketQuotes.futures.change >= 0 ? 'nasdaq-up' : 'nasdaq-down' : ''}>{marketQuotes.futures ? `${marketQuotes.futures.change >= 0 ? '+' : ''}${marketQuotes.futures.change.toFixed(2)} / ${marketQuotes.futures.changePercent >= 0 ? '+' : ''}${marketQuotes.futures.changePercent.toFixed(2)}%` : '等待行情'}</span></div>
            <p>{marketQuotes.futures ? `期货行情 ${formatNasdaqMarketTime(marketQuotes.futures.quoteTime)} · 北京时间` : '期货行情暂不可用'}</p>
          </div>
          <p className="nasdaq-market-caption">盘前涨跌以纳指100期货相对前收的涨跌作参考，不是纳指100指数的盘前成交价。数据来自 Yahoo Finance，可能延迟。{marketError && '指数或期货行情更新失败；已获取的报价可能为上次成功更新值。'}</p>
        </section>

        <div className="nasdaq-status" role="status">
          <div><span className="nasdaq-status-label">最近行情</span><strong>{timeLabel}</strong><span>北京时间 · ETF 交易时段每 5 分钟更新，盘后使用缓存</span></div>
          <button type="button" onClick={() => { void refresh() }} disabled={refreshing}>{refreshing ? '刷新中…' : '立即刷新'}<span aria-hidden="true">↗</span></button>
        </div>
        {error && <p className="nasdaq-error" role="alert">{error}。{available.length ? '当前显示上次成功获取的数据。' : '请稍后重试。'}</p>}

        <section className="nasdaq-panel" aria-label="纳指100 ETF 溢价清单">
          <div className="nasdaq-panel-head">
            <div><span>01 / ETF SCAN</span><h2>基金清单</h2></div>
            <p>按指标排序，点击当前指标可切换升降序</p>
          </div>
          <aside className="nasdaq-iopv-notice" aria-label="IOPV 时效提示">
            <strong>IOPV 时效提示</strong>
            <p>美股与 A 股交易时段不重合，盘中 IOPV 可能无法实时反映美股变化。参考溢价仅基于报价 IOPV；上方“最近行情”是 ETF 行情时间，不代表 IOPV 更新时间。</p>
          </aside>
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
          <p>ETF 行情来自腾讯公开报价，交易时段页面可见时每 5 分钟更新；休市后优先使用浏览器及数据库快照，不再周期性请求 ETF 实时行情。请以“行情时间”为准。IOPV 是盘中参考净值，并非正式基金净值。</p>
          <p>仅供参考，不构成投资建议。</p>
        </footer>
      </div>
    </main>
  )
}
