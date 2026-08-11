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
type SortKey = 'disclosure' | 'profit2025' | 'latestNetProfitYoy' | 'latestRevenueYoy' | 'firstQuarterNetProfitYoy' | 'firstQuarterRevenueYoy'
type GrowthFilterKey = 'revenueYoy' | 'netProfitYoy'
type GrowthReportPeriod = 'interim' | 'firstQuarter'
type ReportPeriod = '一' | '中' | '年'
type ReportView = 'interim' | 'firstQuarter' | 'annual' | 'all'
type SingleColumnSort = { field: 'disclosure' | 'metric'; year?: InterimReportYear; direction: 'asc' | 'desc' }

type GrowthFilters = Record<GrowthFilterKey, string>

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

const REPORT_VIEW_OPTIONS: { key: ReportView; label: string }[] = [
  { key: 'interim', label: '中报' },
  { key: 'firstQuarter', label: '一季报' },
  { key: 'annual', label: '年报' },
  { key: 'all', label: '全量' },
]

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'disclosure', label: '披露时间' },
  { key: 'latestNetProfitYoy', label: '2026 中报净利润同比' },
  { key: 'latestRevenueYoy', label: '2026 中报营收同比' },
  { key: 'firstQuarterNetProfitYoy', label: '2026 一季报净利润同比' },
  { key: 'firstQuarterRevenueYoy', label: '2026 一季报营收同比' },
  { key: 'profit2025', label: '2025 年报净利润同比' },
]

const GROWTH_FILTERS: { key: GrowthFilterKey; label: string }[] = [
  { key: 'revenueYoy', label: '营收同比' },
  { key: 'netProfitYoy', label: '净利润同比' },
]

const GROWTH_PRESETS = ['', 'negative', '-20', '-10', '0', '10', '20', '30'] as const

const EMPTY_GROWTH_FILTERS: GrowthFilters = {
  revenueYoy: '',
  netProfitYoy: '',
}

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

function growthValue(report: InterimReportRecord, key: GrowthFilterKey): number | null {
  if (key === 'revenueYoy') return report.revenueYoy
  return report.netProfitYoy
}

function sortValue(snapshot: InterimReportResult['stocks'][string] | undefined, key: SortKey): number {
  if (key === 'profit2025') return snapshot?.annualReports?.[2025]?.netProfitYoy ?? Number.NEGATIVE_INFINITY
  if (key === 'latestNetProfitYoy') return snapshot?.reports[2026]?.netProfitYoy ?? Number.NEGATIVE_INFINITY
  if (key === 'latestRevenueYoy') return snapshot?.reports[2026]?.revenueYoy ?? Number.NEGATIVE_INFINITY
  if (key === 'firstQuarterNetProfitYoy') return snapshot?.firstQuarterReports?.[2026]?.netProfitYoy ?? Number.NEGATIVE_INFINITY
  if (key === 'firstQuarterRevenueYoy') return snapshot?.firstQuarterReports?.[2026]?.revenueYoy ?? Number.NEGATIVE_INFINITY
  return Number.NEGATIVE_INFINITY
}

function meetsGrowthMinimum(value: number | null, minimum: string): boolean {
  if (!minimum) return true
  if (value === null) return false
  if (minimum === 'negative') return value < 0
  return value >= Number(minimum)
}

function isSortedReading(sort: SortKey, year: number, period: ReportPeriod): boolean {
  if (year === 2026 && period === '中') return sort === 'latestNetProfitYoy' || sort === 'latestRevenueYoy'
  if (year === 2026 && period === '一') return sort === 'firstQuarterNetProfitYoy' || sort === 'firstQuarterRevenueYoy'
  return year === 2025 && period === '年' && sort === 'profit2025'
}

function reportForView(
  snapshot: InterimReportResult['stocks'][string] | undefined,
  year: InterimReportYear,
  reportView: ReportView,
): InterimReportRecord | undefined {
  if (reportView === 'interim') return snapshot?.reports[year]
  if (reportView === 'firstQuarter') return snapshot?.firstQuarterReports?.[year as (typeof FIRST_QUARTER_REPORT_YEARS)[number]]
  return snapshot?.annualReports?.[year as (typeof ANNUAL_REPORT_YEARS)[number]]
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

function MetricReading({ report, metric, period, sorted }: {
  report: InterimReportRecord | undefined
  metric: Metric
  period?: ReportPeriod
  sorted?: boolean
}) {
  const value = metricValue(report, metric)
  const yoy = metricYoy(report, metric)
  return (
    <div className={`interim-period-reading${sorted ? ' sorted-reading' : ''}`}>
      {period && <em>{period}</em>}
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
  const [reportView, setReportView] = useState<ReportView>('interim')
  const [sort, setSort] = useState<SortKey>('disclosure')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [singleColumnSort, setSingleColumnSort] = useState<SingleColumnSort | null>(null)
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false)
  const [growthReportPeriod, setGrowthReportPeriod] = useState<GrowthReportPeriod>('interim')
  const [growthFilters, setGrowthFilters] = useState<GrowthFilters>(EMPTY_GROWTH_FILTERS)
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

  const activeFilterCount = useMemo(
    () => GROWTH_FILTERS.reduce((count, { key }) => count + Number(Boolean(growthFilters[key])), 0),
    [growthFilters],
  )

  const hasGrowthFilters = GROWTH_FILTERS.some(({ key }) => Boolean(growthFilters[key]))

  const updateGrowthFilter = (key: GrowthFilterKey, value: string) => {
    setGrowthFilters(current => ({
      ...current,
      [key]: value,
    }))
  }

  const clearMoreFilters = () => {
    setGrowthFilters(EMPTY_GROWTH_FILTERS)
  }

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
      .filter(stock => {
        const snapshot = result?.stocks[stock.code]
        const report = growthReportPeriod === 'interim'
          ? snapshot?.reports[2026]
          : snapshot?.firstQuarterReports?.[2026]
        if (hasGrowthFilters && !report) return false
        return !report || GROWTH_FILTERS.every(({ key }) => meetsGrowthMinimum(growthValue(report, key), growthFilters[key]))
      })
      .sort((a, b) => {
        if (reportView !== 'all' && singleColumnSort) {
          const snapshotA = result?.stocks[a.code]
          const snapshotB = result?.stocks[b.code]
          if (singleColumnSort.field === 'disclosure') {
            const av = disclosureDate(snapshotA)
            const bv = disclosureDate(snapshotB)
            if (av === null) return bv === null ? a.poolIndex - b.poolIndex : 1
            if (bv === null) return -1
            return (singleColumnSort.direction === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv)) || a.poolIndex - b.poolIndex
          }
          const year = singleColumnSort.year!
          const av = metricYoy(reportForView(snapshotA, year, reportView), metric)
          const bv = metricYoy(reportForView(snapshotB, year, reportView), metric)
          if (av === null) return bv === null ? a.poolIndex - b.poolIndex : 1
          if (bv === null) return -1
          return (singleColumnSort.direction === 'desc' ? bv - av : av - bv) || a.poolIndex - b.poolIndex
        }
        if (sort !== 'disclosure') {
          const av = sortValue(result?.stocks[a.code], sort)
          const bv = sortValue(result?.stocks[b.code], sort)
          return (sortDirection === 'desc' ? bv - av : av - bv) || a.poolIndex - b.poolIndex
        }
        const ad = disclosureDate(result?.stocks[a.code]) ?? '9999-12-31'
        const bd = disclosureDate(result?.stocks[b.code]) ?? '9999-12-31'
        return ad.localeCompare(bd) || a.poolIndex - b.poolIndex
      })
  }, [growthFilters, growthReportPeriod, hasGrowthFilters, metric, query, reportView, result, sector, singleColumnSort, sort, sortDirection, status, stocks])

  const publishedCount = stocks.filter(stock => Boolean(result?.stocks[stock.code]?.reports[2026])).length
  const disclosureProgress = stocks.length ? Math.round((publishedCount / stocks.length) * 100) : 0
  const recentDisclosure = useMemo(() => stocks
    .map(stock => ({ stock, date: result?.stocks[stock.code]?.reports[2026]?.noticeDate ?? null }))
    .filter((item): item is { stock: DisplayStock; date: string } => item.date !== null)
    .sort((a, b) => b.date.localeCompare(a.date))[0], [result, stocks])
  const nextDisclosure = useMemo(() => stocks
    .filter(stock => !result?.stocks[stock.code]?.reports[2026])
    .map(stock => ({ stock, date: disclosureDate(result?.stocks[stock.code]) }))
    .filter((item): item is { stock: DisplayStock; date: string } => item.date !== null)
    .sort((a, b) => a.date.localeCompare(b.date))[0], [result, stocks])
  const sortedYear = sort === 'latestNetProfitYoy' || sort === 'latestRevenueYoy' || sort === 'firstQuarterNetProfitYoy' || sort === 'firstQuarterRevenueYoy'
    ? 2026
    : sort === 'profit2025' ? 2025 : null
  const highlightedYear = reportView === 'all' ? sortedYear : singleColumnSort?.year ?? null

  const toggleSingleColumnSort = (field: SingleColumnSort['field'], year?: InterimReportYear) => {
    setSingleColumnSort(current => current?.field === field && current.year === year
      ? { ...current, direction: current.direction === 'desc' ? 'asc' : 'desc' }
      : { field, year, direction: 'desc' })
  }

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
          <div className="interim-summary-stats">
            <div><strong>{publishedCount}</strong><span>已披露</span></div>
            <i />
            <div><strong>{stocks.length - publishedCount}</strong><span>待披露</span></div>
            <i />
            <div><strong>{stocks.length}</strong><span>总标的</span></div>
          </div>
          <div className="interim-progress" aria-label={`披露进度 ${disclosureProgress}%`}>
            <div><span>披露进度</span><strong>{disclosureProgress}%</strong></div>
            <i><b style={{ width: `${disclosureProgress}%` }} /></i>
          </div>
          <div className="interim-disclosure-glance" aria-label="披露节奏">
            <div><span>最近披露</span><strong>{recentDisclosure ? `${recentDisclosure.stock.name} · ${formatDate(recentDisclosure.date)}` : '待更新'}</strong></div>
            <i />
            <div><span>下一只待披露</span><strong>{nextDisclosure ? `${nextDisclosure.stock.name} · ${formatDate(nextDisclosure.date)}` : '待更新'}</strong></div>
          </div>
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
          <div className="interim-more-filter-wrap">
            <button
              className={`interim-more-filter-button${activeFilterCount ? ' active' : ''}`}
              onClick={() => setMoreFiltersOpen(value => !value)}
              aria-expanded={moreFiltersOpen}
              aria-controls="interim-more-filters"
            >
              更多筛选{activeFilterCount ? ` · ${activeFilterCount}` : ''}
            </button>
            {moreFiltersOpen && (
              <>
                <button
                  className="interim-more-filter-backdrop"
                  onClick={() => setMoreFiltersOpen(false)}
                  aria-label="关闭更多筛选"
                />
                <div id="interim-more-filters" className="interim-more-filters">
                  <div className="interim-more-filter-heading">
                    <div>
                      <strong>增长率筛选</strong>
                      <span>选择同一报告期进行同比筛选</span>
                    </div>
                    {activeFilterCount > 0 && <button onClick={clearMoreFilters}>清空</button>}
                  </div>
                  <div className="interim-report-period" aria-label="增长率筛选报告期">
                    <span>筛选口径</span>
                    <div>
                      {([
                        ['interim', '2026 中报'],
                        ['firstQuarter', '2026 一季报'],
                      ] as const).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          className={growthReportPeriod === key ? 'active' : ''}
                          onClick={() => setGrowthReportPeriod(key)}
                          aria-pressed={growthReportPeriod === key}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="interim-financial-filter-grid">
                    {GROWTH_FILTERS.map(({ key, label }) => (
                      <label key={key} className="interim-range-filter">
                        <span>{label}<small>不低于 %</small></span>
                        <input
                          type="number"
                          inputMode="decimal"
                          value={growthFilters[key] === 'negative' ? '' : growthFilters[key]}
                          onChange={event => updateGrowthFilter(key, event.target.value)}
                          placeholder="例如：10"
                          aria-label={`${label}最低增速（%）`}
                        />
                        <div className="interim-growth-presets" aria-label={`${label}快捷选项`}>
                          {GROWTH_PRESETS.map(value => (
                            <button
                              key={value || 'all'}
                              type="button"
                              className={growthFilters[key] === value ? 'active' : ''}
                              onClick={() => updateGrowthFilter(key, value)}
                              aria-pressed={growthFilters[key] === value}
                            >
                              {value === 'negative' ? '仅负增长' : value ? `≥${value}%` : '不限'}
                            </button>
                          ))}
                        </div>
                      </label>
                    ))}
                  </div>
                  <p>填写最低增速即可；缺少{growthReportPeriod === 'interim' ? '2026 中报' : '2026 一季报'}数据的标的将自动排除。</p>
                </div>
              </>
            )}
          </div>
          {reportView === 'all' && (
            <label className="interim-sort">
              <span>排序</span>
              <select value={sort} onChange={event => {
                const nextSort = event.target.value as SortKey
                setSort(nextSort)
                setSortDirection('desc')
                if (nextSort === 'latestRevenueYoy' || nextSort === 'firstQuarterRevenueYoy') setMetric('revenue')
                if (nextSort === 'latestNetProfitYoy' || nextSort === 'firstQuarterNetProfitYoy' || nextSort === 'profit2025') setMetric('netProfit')
              }}>
                {SORT_OPTIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
            </label>
          )}
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
            <div className="interim-report-view" aria-label="表格报告口径">
              <span>报告口径</span>
              <div>
                {REPORT_VIEW_OPTIONS.map(option => (
                  <button
                    key={option.key}
                    type="button"
                    className={reportView === option.key ? 'active' : ''}
                    onClick={() => {
                      setReportView(option.key)
                      if (option.key === 'all') setSortDirection('desc')
                      if (option.key !== 'all' && sort !== 'disclosure') setSort('disclosure')
                      setSingleColumnSort(null)
                    }}
                    aria-pressed={reportView === option.key}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
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
                <th colSpan={INTERIM_REPORT_YEARS.length} className="years-group">财报数据对比 · {METRICS.find(item => item.key === metric)?.label} · {REPORT_VIEW_OPTIONS.find(item => item.key === reportView)?.label}</th>
              </tr>
              <tr>
                <th>状态</th>
                <th className={reportView === 'all' && sort === 'disclosure' ? 'sorted-column' : ''} aria-sort={singleColumnSort?.field === 'disclosure' ? (singleColumnSort.direction === 'desc' ? 'descending' : 'ascending') : undefined}>
                  {reportView === 'all' ? '披露日期' : (
                    <button className={`interim-year-sort${singleColumnSort?.field === 'disclosure' ? ' active' : ''}${singleColumnSort?.field === 'disclosure' && singleColumnSort.direction === 'asc' ? ' asc' : ''}`} onClick={() => toggleSingleColumnSort('disclosure')} title={singleColumnSort?.field === 'disclosure' ? `当前${singleColumnSort.direction === 'desc' ? '倒序' : '正序'}，点击切换` : '按披露日期倒序排列'}>
                      披露日期
                      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m3 4 3 3 3-3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  )}
                </th>
                {INTERIM_REPORT_YEARS.map(year => {
                  const sortable = reportView !== 'all'
                  const active = sortable && singleColumnSort?.field === 'metric' && singleColumnSort.year === year
                  return (
                    <th key={year} className={`year-column year-${year}${highlightedYear === year ? ' sorted-column' : ''}`} aria-sort={active ? (singleColumnSort.direction === 'desc' ? 'descending' : 'ascending') : undefined}>
                      {sortable ? (
                        <button className={`interim-year-sort${active ? ' active' : ''}${active && singleColumnSort.direction === 'asc' ? ' asc' : ''}`} onClick={() => toggleSingleColumnSort('metric', year)} title={active ? `当前${singleColumnSort.direction === 'desc' ? '同比倒序' : '同比正序'}，点击切换` : '按当前字段同比倒序排列'}>
                          {year}
                          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                            <path d="m3 4 3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      ) : year}
                    </th>
                  )
                })}
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
                    <td className={`interim-date${reportView === 'all' && sort === 'disclosure' ? ' sorted-column' : ''}`}>{formatDate(disclosureDate(snapshot))}</td>
                    {INTERIM_REPORT_YEARS.map((year: InterimReportYear) => {
                      const isHistorical = ANNUAL_REPORT_YEARS.some(item => item === year)
                      return (
                        <td key={year} className={`interim-value year-column year-${year}${sortedYear === year ? ' sorted-column' : ''}`}>
                          {reportView === 'all' ? (
                            <>
                              <MetricReading
                                report={snapshot?.firstQuarterReports?.[year as (typeof FIRST_QUARTER_REPORT_YEARS)[number]]}
                                metric={metric}
                                period="一"
                                sorted={isSortedReading(sort, year, '一')}
                              />
                              <MetricReading
                                report={snapshot?.reports[year]}
                                metric={metric}
                                period="中"
                                sorted={isSortedReading(sort, year, '中')}
                              />
                              {isHistorical ? (
                                <MetricReading
                                  report={snapshot?.annualReports?.[year as (typeof ANNUAL_REPORT_YEARS)[number]]}
                                  metric={metric}
                                  period="年"
                                  sorted={isSortedReading(sort, year, '年')}
                                />
                              ) : <PeriodPlaceholder />}
                            </>
                          ) : (
                            <MetricReading report={reportForView(snapshot, year, reportView)} metric={metric} />
                          )}
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
        {customStocks.length > 0 && (
          <section className="interim-added-stocks" aria-label="已添加的中报标的">
            <div className="interim-added-stocks-heading">
              <strong>已添加标的</strong>
              <span>{customStocks.length}/{MAX_CUSTOM_STOCKS}</span>
            </div>
            <div className="interim-added-stocks-list">
              {customStocks.map(stock => (
                <div key={stock.code} className="interim-added-stock">
                  <span><strong>{stock.name}</strong><small>{stock.code} · {stock.sector}</small></span>
                  <button onClick={() => removeStock(stock.code)} aria-label={`移除 ${stock.name}`} title={`移除 ${stock.name}`}>
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M5 5l10 10M15 5 5 15" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
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
