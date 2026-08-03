import { useEffect, useMemo, useRef, useState } from 'react'
import Modal from '../components/Modal'
import { Toast, useToast } from '../components/Toast'
import { YIELD_GRID_STOCKS, type YieldGridStock } from '../data/yieldGridStocks'
import { cacheGet, cacheSetPermanent } from '../utils/cache'
import {
  disclosureDate,
  fetchInterimReportData,
  ANNUAL_REPORT_YEARS,
  FIRST_QUARTER_REPORT_YEARS,
  INTERIM_REPORT_YEARS,
  searchInterimStocks,
  type InterimReportRecord,
  type InterimReportResult,
  type InterimReportYear,
  type InterimStockSearchResult,
} from '../utils/interimReports'
import './InterimReport.css'

type Metric = 'netProfit' | 'revenue' | 'eps' | 'roe'
type StatusFilter = 'all' | 'published' | 'pending'
type SortKey = 'disclosure' | 'pool' | 'profit2025'

interface CustomStock extends YieldGridStock {
  custom: true
}

interface DisplayStock extends YieldGridStock {
  custom?: true
  poolIndex: number
}

const CUSTOM_STORAGE_KEY = 'interim-report-custom-stocks'
const REPORT_CACHE_KEY = 'interim-report-data'
const LEGACY_REPORT_CACHE_KEY_PREFIX = 'interim-report-data:'
const MAX_CUSTOM_STOCKS = 5
const TABLE_COLUMN_COUNT = 4 + INTERIM_REPORT_YEARS.length

const METRICS: { key: Metric; label: string; unit: string }[] = [
  { key: 'netProfit', label: '归母净利润', unit: '亿元' },
  { key: 'revenue', label: '营业收入', unit: '亿元' },
  { key: 'eps', label: '基本 EPS', unit: '元/股' },
  { key: 'roe', label: '加权 ROE', unit: '%' },
]

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'disclosure', label: '披露时间' },
  { key: 'pool', label: '股票池顺序' },
  { key: 'profit2025', label: '2025 年报净利润' },
]

function loadCustomStocks(): CustomStock[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CUSTOM_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(value)) return []
    return value
      .filter((item): item is CustomStock => {
        if (typeof item !== 'object' || item === null) return false
        const stock = item as Partial<CustomStock>
        return stock.custom === true
          && typeof stock.code === 'string'
          && typeof stock.name === 'string'
          && typeof stock.sector === 'string'
      })
      .slice(0, MAX_CUSTOM_STOCKS)
  } catch {
    return []
  }
}

function formatDate(value: string | null): string {
  return value ? value.slice(5, 10).replace('-', '/') : '待定'
}

function formatGeneratedAt(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function formatNumber(value: number | null, digits: number): string {
  if (value === null) return '—'
  return value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function metricValue(report: InterimReportRecord | undefined, metric: Metric): number | null {
  if (!report) return null
  if (metric === 'netProfit') return report.netProfit === null ? null : report.netProfit / 100_000_000
  if (metric === 'revenue') return report.revenue === null ? null : report.revenue / 100_000_000
  if (metric === 'eps') return report.eps
  return report.roe
}

function metricYoy(report: InterimReportRecord | undefined, metric: Metric): number | null {
  if (!report) return null
  if (metric === 'netProfit') return report.netProfitYoy
  if (metric === 'revenue') return report.revenueYoy
  return null
}

function reportsForCodes(data: InterimReportResult, codes: string[]): InterimReportResult {
  const stocks: InterimReportResult['stocks'] = {}
  for (const code of codes) {
    if (data.stocks[code]) stocks[code] = data.stocks[code]
  }
  return { generatedAt: data.generatedAt, stocks }
}

function mergeReports(cached: InterimReportResult | null, latest: InterimReportResult): InterimReportResult {
  return {
    generatedAt: latest.generatedAt,
    stocks: { ...cached?.stocks, ...latest.stocks },
  }
}

function loadLegacyReportCache(): InterimReportResult | null {
  const prefix = `dh_cache_${LEGACY_REPORT_CACHE_KEY_PREFIX}`
  return Object.keys(localStorage)
    .filter(key => key.startsWith(prefix))
    .reduce<InterimReportResult | null>((merged, key) => {
      const cached = cacheGet<InterimReportResult>(key.slice('dh_cache_'.length))
      return cached ? mergeReports(merged, cached) : merged
    }, null)
}

function MetricReading({ report, metric, period }: {
  report: InterimReportRecord | undefined
  metric: Metric
  period: '一' | '中' | '年'
}) {
  const value = metricValue(report, metric)
  const yoy = metricYoy(report, metric)
  return (
    <div className="interim-period-reading">
      <em>{period}</em>
      <div>
        <strong>{formatNumber(value, 2)}</strong>
        {yoy !== null && (
          <span className={yoy > 0 ? 'up' : yoy < 0 ? 'down' : ''}>
            同比 {yoy > 0 ? '+' : ''}{formatNumber(yoy, 2)}%
          </span>
        )}
      </div>
    </div>
  )
}

function PeriodPlaceholder() {
  return <div className="interim-period-placeholder" aria-label="该报告期暂未披露" />
}

export default function InterimReport() {
  const { message, showToast } = useToast()
  const [customStocks, setCustomStocks] = useState<CustomStock[]>(loadCustomStocks)
  const [result, setResult] = useState<InterimReportResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const forceRefreshRef = useRef(false)
  const [query, setQuery] = useState('')
  const [sector, setSector] = useState('全部')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [metric, setMetric] = useState<Metric>('netProfit')
  const [showFirstQuarter, setShowFirstQuarter] = useState(false)
  const [sort, setSort] = useState<SortKey>('disclosure')
  const [addOpen, setAddOpen] = useState(false)
  const [addQuery, setAddQuery] = useState('')
  const [addSector, setAddSector] = useState('其他')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<InterimStockSearchResult[]>([])

  const stocks = useMemo<DisplayStock[]>(() => [
    ...YIELD_GRID_STOCKS.map((stock, poolIndex) => ({ ...stock, poolIndex })),
    ...customStocks.map((stock, index) => ({ ...stock, poolIndex: YIELD_GRID_STOCKS.length + index })),
  ], [customStocks])

  const codesKey = stocks.map(stock => stock.code).join(',')

  useEffect(() => {
    let cancelled = false
    setError('')
    const codes = codesKey.split(',')
    const cached = cacheGet<InterimReportResult>(REPORT_CACHE_KEY) ?? loadLegacyReportCache()
    if (cached) cacheSetPermanent(REPORT_CACHE_KEY, cached)
    const forceRefresh = forceRefreshRef.current
    forceRefreshRef.current = false
    const missingCodes = forceRefresh
      ? codes
      : codes.filter(code => !cached?.stocks[code])
    if (cached && !forceRefresh) {
      setResult(reportsForCodes(cached, codes))
      setLoading(false)
      if (!missingCodes.length) return () => { cancelled = true }
    }

    setLoading(!result && !cached)
    setRefreshing(Boolean(result || cached))
    fetchInterimReportData(missingCodes)
      .then(data => {
        const merged = mergeReports(cached, data)
        cacheSetPermanent(REPORT_CACHE_KEY, merged)
        if (!cancelled) setResult(reportsForCodes(merged, codes))
      })
      .catch(reason => {
        if (cancelled) return
        setError(reason instanceof Error ? reason.message : '中报数据加载失败')
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
        setRefreshing(false)
      })
    return () => { cancelled = true }
  }, [codesKey, refreshKey])

  useEffect(() => {
    const keyword = addQuery.trim()
    if (!keyword) {
      setSearchResults([])
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = window.setTimeout(() => {
      searchInterimStocks(keyword)
        .then(items => { if (!cancelled) setSearchResults(items) })
        .catch(() => { if (!cancelled) setSearchResults([]) })
        .finally(() => { if (!cancelled) setSearching(false) })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [addQuery])

  const sectors = useMemo(() => [
    '全部',
    ...Array.from(new Set(stocks.map(stock => stock.sector))),
  ], [stocks])
  const addSectors = useMemo(() => [
    '其他',
    ...sectors.filter(item => item !== '全部' && item !== '其他'),
  ], [sectors])

  const visibleStocks = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return stocks
      .filter(stock => sector === '全部' || stock.sector === sector)
      .filter(stock => !keyword || stock.name.toLowerCase().includes(keyword) || stock.code.includes(keyword))
      .filter(stock => {
        if (status === 'all') return true
        const published = Boolean(result?.stocks[stock.code]?.reports[2026])
        return status === 'published' ? published : !published
      })
      .sort((a, b) => {
        if (sort === 'pool') return a.poolIndex - b.poolIndex
        if (sort === 'profit2025') {
          const av = result?.stocks[a.code]?.annualReports?.[2025]?.netProfit ?? Number.NEGATIVE_INFINITY
          const bv = result?.stocks[b.code]?.annualReports?.[2025]?.netProfit ?? Number.NEGATIVE_INFINITY
          return bv - av || a.poolIndex - b.poolIndex
        }
        const ad = disclosureDate(result?.stocks[a.code]) ?? '9999-12-31'
        const bd = disclosureDate(result?.stocks[b.code]) ?? '9999-12-31'
        return ad.localeCompare(bd) || a.poolIndex - b.poolIndex
      })
  }, [query, result, sector, sort, status, stocks])

  const publishedCount = stocks.filter(stock => Boolean(result?.stocks[stock.code]?.reports[2026])).length

  const persistCustomStocks = (next: CustomStock[]) => {
    setCustomStocks(next)
    localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(next))
  }

  const addStock = (stock: InterimStockSearchResult) => {
    if (customStocks.length >= MAX_CUSTOM_STOCKS) {
      showToast('最多只能添加 5 只标的')
      return
    }
    if (stocks.some(item => item.code === stock.code)) {
      showToast('该标的已在列表中')
      return
    }
    persistCustomStocks([...customStocks, {
      custom: true,
      code: stock.code,
      name: stock.name,
      sector: addSector,
      dive: 0,
    }])
    setAddOpen(false)
    setAddQuery('')
    setAddSector('其他')
    showToast(`已添加 ${stock.name}`)
  }

  const removeStock = (code: string) => {
    persistCustomStocks(customStocks.filter(stock => stock.code !== code))
    showToast('已移除自定义标的')
  }

  return (
    <main className="interim-page">
      <header className="interim-hero">
        <div className="interim-hero-main">
          <div>
            <p className="interim-eyebrow">MID-YEAR EARNINGS / 2026</p>
            <h1>财报五年对比</h1>
            <p className="interim-subtitle">2026 中报披露进度与 2022–2025 年报 / 中报经营数据</p>
          </div>
        </div>
        <div className="interim-summary" aria-label="披露进度摘要">
          <div><strong>{publishedCount}</strong><span>已披露</span></div>
          <i />
          <div><strong>{stocks.length - publishedCount}</strong><span>待披露</span></div>
          <i />
          <div><strong>{stocks.length}</strong><span>总标的</span></div>
        </div>
      </header>

      <section className="interim-toolbar" aria-label="中报筛选工具">
        <div className="interim-search-row">
          <label className="interim-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="搜索股票名称或代码"
              aria-label="搜索股票名称或代码"
            />
          </label>
          <button
            className="interim-add-button"
            onClick={() => setAddOpen(true)}
            disabled={customStocks.length >= MAX_CUSTOM_STOCKS}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            添加标的 <span>{customStocks.length}/{MAX_CUSTOM_STOCKS}</span>
          </button>
        </div>

        <div className="interim-chip-track" aria-label="板块筛选">
          {sectors.map(item => (
            <button key={item} className={sector === item ? 'active' : ''} onClick={() => setSector(item)}>
              {item}
            </button>
          ))}
        </div>

        <div className="interim-control-row">
          <div className="interim-segmented" aria-label="披露状态筛选">
            {([
              ['all', '全部'],
              ['published', '已披露'],
              ['pending', '待披露'],
            ] as const).map(([key, label]) => (
              <button key={key} className={status === key ? 'active' : ''} onClick={() => setStatus(key)}>{label}</button>
            ))}
          </div>
          <label className="interim-sort">
            <span>排序</span>
            <select value={sort} onChange={event => setSort(event.target.value as SortKey)}>
              {SORT_OPTIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="interim-data-panel">
        <div className="interim-panel-topline">
          <div>
            <span className="interim-count">当前 {visibleStocks.length} 只</span>
            <span className="interim-generated">
              {result ? `生成于 ${formatGeneratedAt(result.generatedAt)}` : '正在获取最新数据'}
            </span>
          </div>
          <div className="interim-panel-actions">
            <button
              className={`interim-quarter-toggle${showFirstQuarter ? ' active' : ''}`}
              onClick={() => setShowFirstQuarter(value => !value)}
              aria-pressed={showFirstQuarter}
            >
              <i />显示一季报
            </button>
            <button className="interim-refresh" onClick={() => {
              forceRefreshRef.current = true
              setRefreshKey(value => value + 1)
            }} disabled={loading || refreshing} title="强制重新拉取财报数据">
              <svg className={loading || refreshing ? 'spinning' : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              强制刷新
            </button>
          </div>
        </div>

        <div className="interim-metric-tabs" aria-label="对比指标">
          {METRICS.map(item => (
            <button
              key={item.key}
              className={`metric-${item.key}${metric === item.key ? ' active' : ''}`}
              onClick={() => setMetric(item.key)}
            >
              <strong>{item.label}</strong>
              <span>{item.unit}</span>
            </button>
          ))}
        </div>

        {error && (
          <div className="interim-error">
            <span>{error}</span>
            <button onClick={() => setRefreshKey(value => value + 1)}>重新加载</button>
          </div>
        )}

        <div className="interim-table-scroll">
          <table className="interim-table">
            <thead>
              <tr>
                <th rowSpan={2} className="stock-column">标的</th>
                <th rowSpan={2}>板块</th>
                <th colSpan={2} className="progress-group">2026 披露进度</th>
                <th colSpan={INTERIM_REPORT_YEARS.length} className="years-group">财报数据对比 · {METRICS.find(item => item.key === metric)?.label}</th>
              </tr>
              <tr>
                <th>状态</th>
                <th>披露日期</th>
                {INTERIM_REPORT_YEARS.map(year => <th key={year} className={`year-column year-${year}`}>{year}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading && !result ? (
                Array.from({ length: 8 }, (_, index) => (
                  <tr key={index} className="interim-skeleton-row">
                    {Array.from({ length: TABLE_COLUMN_COUNT }, (__, cell) => <td key={cell}><span /></td>)}
                  </tr>
                ))
              ) : visibleStocks.length === 0 ? (
                <tr><td colSpan={TABLE_COLUMN_COUNT} className="interim-empty">没有符合当前筛选条件的标的</td></tr>
              ) : visibleStocks.map(stock => {
                const snapshot = result?.stocks[stock.code]
                const isPublished = Boolean(snapshot?.reports[2026])
                return (
                  <tr key={stock.code}>
                    <td className="stock-column">
                      <div className="interim-stock-name">
                        <strong>{stock.name}</strong>
                        {stock.custom && (
                          <button onClick={() => removeStock(stock.code)} aria-label={`移除 ${stock.name}`} title="移除自定义标的">
                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <path d="M5 5l10 10M15 5 5 15" strokeLinecap="round" />
                            </svg>
                          </button>
                        )}
                      </div>
                      <span>{stock.code}{stock.custom ? ' · 自定义' : ''}</span>
                    </td>
                    <td><span className="interim-sector-tag">{stock.sector}</span></td>
                    <td><span className={`interim-status ${isPublished ? 'published' : 'pending'}`}>{isPublished ? '已披露' : '待披露'}</span></td>
                    <td className="interim-date">{formatDate(disclosureDate(snapshot))}</td>
                    {INTERIM_REPORT_YEARS.map((year: InterimReportYear) => {
                      const isHistorical = ANNUAL_REPORT_YEARS.some(item => item === year)
                      return (
                        <td key={year} className={`interim-value year-column year-${year}`}>
                          {showFirstQuarter && (
                            <MetricReading
                              report={snapshot?.firstQuarterReports?.[year as (typeof FIRST_QUARTER_REPORT_YEARS)[number]]}
                              metric={metric}
                              period="一"
                            />
                          )}
                          <MetricReading report={snapshot?.reports[year]} metric={metric} period="中" />
                          {isHistorical ? (
                            <MetricReading
                              report={snapshot?.annualReports?.[year as (typeof ANNUAL_REPORT_YEARS)[number]]}
                              metric={metric}
                              period="年"
                            />
                          ) : <PeriodPlaceholder />}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p className="interim-note">
          数据来自东方财富业绩报表与预约披露表；ROE 为各期披露口径。聚合数据如有差异，以交易所或公司正式公告为准。
        </p>
      </section>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={`添加中报标的（${customStocks.length}/${MAX_CUSTOM_STOCKS}）`}
      >
        <label className="interim-modal-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" strokeLinecap="round" />
          </svg>
          <input autoFocus value={addQuery} onChange={event => setAddQuery(event.target.value)} placeholder="输入 A 股名称或 6 位代码" />
        </label>
        <label className="interim-sector-select">
          <span>板块</span>
          <select value={addSector} onChange={event => setAddSector(event.target.value)} aria-label="选择标的板块">
            {addSectors.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <div className="interim-search-results">
          {searching ? (
            <p>搜索中…</p>
          ) : searchResults.length > 0 ? searchResults.map(stock => {
            const exists = stocks.some(item => item.code === stock.code)
            return (
              <button key={stock.code} onClick={() => addStock(stock)} disabled={exists || customStocks.length >= MAX_CUSTOM_STOCKS}>
                <span><strong>{stock.name}</strong><small>{stock.code}</small></span>
                <em>{exists ? '已存在' : '添加'}</em>
              </button>
            )
          }) : addQuery ? (
            <p>未找到可添加的 A 股标的</p>
          ) : (
            <p>支持添加最多 5 只，数据会保存在当前浏览器。</p>
          )}
        </div>
      </Modal>

      <Toast message={message} />
    </main>
  )
}
