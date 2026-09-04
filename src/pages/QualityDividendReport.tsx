import { useCallback, useEffect, useState } from 'react'
import { QUALITY_DIVIDEND_HIGHLIGHTED_YIELDS, QUALITY_DIVIDEND_SECTIONS } from '../data/qualityDividendReport'
import { fetchStockPrices } from '../utils/api'
import type { PriceMap } from '../types'
import { fetchWeeklyChanges, type WeeklyChange } from '../utils/weeklyChange'
import './QualityDividendReport.css'

const TARGET_YIELDS = [3, 4, 5, 6, 7, 8, 9]
const WATCHLIST_STORAGE_KEY = 'quality-dividend-report-watchlist'
const YIELD_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'watchlist', label: '自选' },
  { value: 7, label: '7%+' },
  { value: 6, label: '6%-7%' },
  { value: 5, label: '5%-6%' },
  { value: 4, label: '4%-5%' },
  { value: '3-4', label: '3%-4%' },
  { value: 3, label: '3%以下' },
] as const

type YieldFilter = (typeof YIELD_FILTERS)[number]['value']
type YieldSortOrder = 'desc' | 'asc' | null

const stockKey = (code: string, isHK?: boolean) => `${isHK ? 'hk' : 'cn'}-${code}`
const DEFAULT_WATCHLIST = QUALITY_DIVIDEND_SECTIONS
  .flatMap(section => section.rows)
  .filter(row => row.featured)
  .map(row => stockKey(row.code, row.isHK))

const loadWatchlist = () => {
  try {
    const saved = localStorage.getItem(WATCHLIST_STORAGE_KEY)
    if (!saved) return DEFAULT_WATCHLIST
    const parsed: unknown = JSON.parse(saved)
    return Array.isArray(parsed) && parsed.every(item => typeof item === 'string') ? parsed : DEFAULT_WATCHLIST
  } catch {
    return DEFAULT_WATCHLIST
  }
}

const fmtPrice = (price: number, isHK?: boolean) => `${isHK ? 'HK$' : '¥'}${price.toFixed(2)}`
const targetPrice = (dividend: number, yieldPct: number) => dividend / (yieldPct / 100)
const matchesYieldFilter = (yieldRate: number | null, filter: YieldFilter) => {
  if (filter === 'all') return true
  if (filter === 'watchlist') return true
  if (yieldRate == null) return false
  if (filter === 7) return yieldRate >= 7
  if (filter === 3) return yieldRate < 3
  if (filter === '3-4') return yieldRate >= 3 && yieldRate < 4
  return yieldRate >= filter && yieldRate < filter + 1
}

export default function QualityDividendReport() {
  const [prices, setPrices] = useState<PriceMap>({})
  const [weeklyChanges, setWeeklyChanges] = useState<Record<string, WeeklyChange>>({})
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [yieldFilter, setYieldFilter] = useState<YieldFilter>('all')
  const [yieldSortOrder, setYieldSortOrder] = useState<YieldSortOrder>(null)
  const [watchlist, setWatchlist] = useState<string[]>(loadWatchlist)

  const refreshPrices = useCallback(async () => {
    setRefreshing(true)
    try {
      const stocks = QUALITY_DIVIDEND_SECTIONS.flatMap(section => section.rows).map(row => ({ code: row.code, isHK: row.isHK }))
      const [nextPrices, nextWeeklyChanges] = await Promise.all([
        fetchStockPrices(stocks, true),
        fetchWeeklyChanges(stocks),
      ])
      setPrices(nextPrices)
      setWeeklyChanges(nextWeeklyChanges)
      setUpdatedAt(new Date())
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void refreshPrices() }, [refreshPrices])
  useEffect(() => { localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(watchlist)) }, [watchlist])

  const toggleWatchlist = (key: string) => {
    setWatchlist(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key])
  }

  const toggleYieldSort = () => {
    setYieldSortOrder(current => current === null ? 'desc' : current === 'desc' ? 'asc' : null)
  }

  return (
    <main className="quality-report">
      <header className="quality-report__masthead">
        <p className="quality-report__eyebrow">DIVIDEND WEEKLY · 2026.08.30</p>
        <h1>优质红利周点评及股息率表</h1>
        <p>中证红利优质红利企业预期股息率与对应价格</p>
      </header>

      <section className="quality-report__toolbar" aria-label="行情更新">
        <div>
          <strong>实时行情</strong>
          <span>{updatedAt ? `更新于 ${updatedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '正在获取行情…'}</span>
        </div>
        <button type="button" onClick={() => void refreshPrices()} disabled={refreshing}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0 2 5.3M20 4v7h-7" /></svg>
          {refreshing ? '更新中' : '刷新行情'}
        </button>
      </section>

      <section className="quality-report__notice" aria-label="阅读说明">
        港股预期股息率为直接买入税后股息率；目标价格根据 PDF 所列预计分红与目标股息率计算，实时股价仅作行情展示。
      </section>

      <nav className="quality-report__filters" aria-label="预期股息率筛选">
        {YIELD_FILTERS.map(filter => <button
          type="button"
          key={filter.value}
          className={yieldFilter === filter.value ? 'is-active' : ''}
          onClick={() => setYieldFilter(filter.value)}
          aria-pressed={yieldFilter === filter.value}
        >{filter.label}</button>)}
      </nav>

      {QUALITY_DIVIDEND_SECTIONS.map((section, index) => (
        <section className={`quality-report__section quality-report__section--${index}`} key={section.title}>
          <h2>{section.title}</h2>
          <div className="quality-report__table-wrap">
            <table>
              <thead>
                <tr>
                  <th>企业</th><th>代码</th><th>预计分红</th><th>现价</th><th>本周涨跌</th><th><button type="button" className="quality-report__sort-button" onClick={toggleYieldSort} aria-label="按实时股息率排序">实时股息率 {yieldSortOrder === 'desc' ? '↓' : yieldSortOrder === 'asc' ? '↑' : '↕'}</button></th>
                  {TARGET_YIELDS.map(yieldPct => <th key={yieldPct}>{yieldPct}%</th>)}
                </tr>
              </thead>
              <tbody>
                {section.rows.filter(row => {
                  if (yieldFilter === 'watchlist') return watchlist.includes(stockKey(row.code, row.isHK))
                  const price = prices[row.code]?.price
                  return matchesYieldFilter(price ? row.dividend / price * 100 : null, yieldFilter)
                }).sort((a, b) => {
                  if (!yieldSortOrder) return 0
                  const aYield = prices[a.code]?.price ? a.dividend / prices[a.code]!.price * 100 : null
                  const bYield = prices[b.code]?.price ? b.dividend / prices[b.code]!.price * 100 : null
                  if (aYield == null) return 1
                  if (bYield == null) return -1
                  return yieldSortOrder === 'desc' ? bYield - aYield : aYield - bYield
                }).map(row => {
                  const key = stockKey(row.code, row.isHK)
                  const watched = watchlist.includes(key)
                  const quote = prices[row.code]
                  const liveYield = quote?.price ? row.dividend / quote.price * 100 : null
                  const weeklyChange = weeklyChanges[row.code]?.pctChg
                  return <tr key={`${row.isHK ? 'hk' : 'cn'}-${row.code}`}>
                    <td><span>{row.name}</span><button className={`quality-report__watchlist ${watched ? 'is-watched' : ''}`} type="button" onClick={() => toggleWatchlist(key)} aria-pressed={watched}>{watched ? '已自选' : '加入自选'}</button></td><td>{row.isHK ? `HK${row.code.padStart(4, '0')}` : row.code}</td>
                    <td className="quality-report__dividend">{row.dividend.toFixed(2)}</td>
                    <td className={quote ? 'quality-report__live-price' : 'quality-report__unavailable'}>{quote ? fmtPrice(quote.price, row.isHK) : '—'}</td>
                    <td className={weeklyChange == null ? 'quality-report__unavailable' : weeklyChange > 0 ? 'quality-report__weekly-change quality-report__weekly-change--up' : weeklyChange < 0 ? 'quality-report__weekly-change quality-report__weekly-change--down' : 'quality-report__weekly-change'}>{weeklyChange == null ? '—' : `${weeklyChange > 0 ? '+' : ''}${weeklyChange.toFixed(2)}%`}</td>
                    <td className={liveYield ? 'quality-report__current-yield' : 'quality-report__unavailable'}>{liveYield == null ? '—' : `${liveYield.toFixed(2)}%`}</td>
                    {TARGET_YIELDS.map(yieldPct => {
                      const target = targetPrice(row.dividend, yieldPct)
                      const highlighted = QUALITY_DIVIDEND_HIGHLIGHTED_YIELDS[row.name]?.includes(yieldPct)
                      return <td className={highlighted ? 'quality-report__pdf-highlight' : ''} title={highlighted ? 'PDF 标注区间' : undefined} key={yieldPct}>
                        {fmtPrice(target, row.isHK)}
                      </td>
                    })}
                  </tr>
                })}
                {!section.rows.some(row => {
                  if (yieldFilter === 'watchlist') return watchlist.includes(stockKey(row.code, row.isHK))
                  const price = prices[row.code]?.price
                  return matchesYieldFilter(price ? row.dividend / price * 100 : null, yieldFilter)
                }) && <tr><td className="quality-report__empty" colSpan={13}>该区间暂无标的</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <footer className="quality-report__footer">
        免责声明：内容仅用于记录和分享市场见解与思考，仅供参考，不构成任何投资操作建议。
      </footer>
    </main>
  )
}
