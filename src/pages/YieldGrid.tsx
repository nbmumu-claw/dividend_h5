import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchStockPrices, searchStocks, type SearchResult } from '../utils/api'
import { fetchDividendHistory } from '../utils/dividendHistory'
import { fetchDividendPayoutsForCodes, type DividendPayoutRecord } from '../utils/dividendPayout'
import { DIVIDEND_FORECAST_MODEL_VERSION, fetchDividendForecast, fetchDividendForecasts, type DividendCommitment, type ForecastResult, type PayoutMethod } from '../utils/dividendForecast'
import { loadForecastCache, loadForecastDetail, loadForecastOverrides, saveForecastCache, saveForecastDetail, saveForecastOverrides } from '../utils/dividendForecastCache'
import { resolveGridDividend, type DividendBasis } from '../utils/dividendBasis'
import { predictSector } from '../utils/sectorPredictor'
import { pickDividendForFill } from '../utils/dividendFill'
import Modal from '../components/Modal'
import { Toast, useToast } from '../components/Toast'
import { getLikes, addLike, hasLiked } from '../utils/gridLikes'
import { useStore, type GridPrefs } from '../store'
import { cbAuth } from '../utils/cloudbase'
import { fetchPeriodBoll, type BollPeriod, type PeriodBoll } from '../utils/periodBoll'
import WeeklyBollPosition from '../components/WeeklyBollPosition'
import BollPeriodSwitch, { BOLL_PERIOD_LABELS } from '../components/BollPeriodSwitch'
import BollPeriodOverview from '../components/BollPeriodOverview'
import { closeFinalizationDelayMs, hasSettledCloseQuote, isCloseSettled, shouldUsePriceCache } from '../utils/priceCachePolicy'
import { YIELD_GRID_STOCKS } from '../data/yieldGridStocks'
import { getSectorTrend } from '../utils/sectorTrend'
import UpcomingDividendReminder from '../components/UpcomingDividendReminder'
import { fetchUpcomingDividends } from '../utils/upcomingDividends'
import {
  EMPTY_BOLL_FILTERS,
  getSingleActiveBollPeriod,
  matchesBollPosition,
  matchesYieldStatus,
  type BollFilters,
  type BollPositionFilter,
  type YieldStatusFilter,
} from '../utils/yieldGridFilters'

// 静态配置：板块 / 名称 / 代码 / 25年度股息预估。现价每次打开实时拉取。
const STOCKS = YIELD_GRID_STOCKS

// 板块默认展示顺序（能源与白酒对调）；用户可手动调整并持久化
const SECTOR_ORDER = ['电力', '水电', '银行', '保险', '能源', '有色', '通讯', '白色家电', '中药', '运输', '白酒', '消费', '其他']
// 「其他」始终可用，作为预判不到板块时的兜底归属
const SECTORS = SECTOR_ORDER.filter(s => s === '其他' || STOCKS.some(x => x.sector === s))
const NONFERROUS_CODES = new Set(['000408', '601899', '000933', '000807'])
const ALL = '全部'
const LEGACY_SIGNAL_TABS = new Set(['买点下轨', '卖点上轨', '近下轨', '近上轨'])
const BOLL_PERIODS: BollPeriod[] = ['day', 'week', 'month']
const YIELD_FILTER_OPTIONS: { value: YieldStatusFilter; label: string; description: string }[] = [
  { value: 'all', label: '不限', description: '不判断当前股息率状态' },
  { value: 'buy-zone', label: '买点区', description: '包含接近买点及达到买点的标的' },
  { value: 'neutral', label: '中性区间', description: '位于买入与卖出标准之间' },
  { value: 'sell-zone', label: '卖点区', description: '包含接近卖点及达到卖点的标的' },
]
const BOLL_FILTER_OPTIONS: { value: Exclude<BollPositionFilter, 'all'>; short: string; summary: string; label: string }[] = [
  { value: 'lower-zone', short: '下轨', summary: '下', label: '下轨区' },
  { value: 'lower-half', short: '中下', summary: '中下', label: '中下区' },
  { value: 'middle-zone', short: '中附近', summary: '中附近', label: '中轨附近' },
  { value: 'upper-half', short: '中上', summary: '中上', label: '中上区' },
  { value: 'upper-zone', short: '上轨', summary: '上', label: '上轨区' },
]

// 板块顺序（localStorage）：保留已保存且仍存在的板块，新板块追加到末尾
const MAX_CUSTOM = 10
const MAX_YIELD_STARTS = 5
function loadOrder(): string[] {
  const saved = gp().sectorOrder
  const valid = saved.filter(s => SECTORS.includes(s))
  return [...valid, ...SECTORS.filter(s => !valid.includes(s))]
}
function saveOrder(o: string[]) { saveGp({ sectorOrder: o }) }

// 未单独设置的标的沿用原先的默认起始点。
const DEFAULT_BUY_START = 0.05
const DEFAULT_SELL_START = 0.04
const DEFAULT_YIELD_STARTS: YieldStart[] = [
  { code: '600900', buy: 0.04, sell: 0.03 },
  { code: '600886', buy: 0.04, sell: 0.03 },
]
// 中国广核、中国核电：低息成长属性，卖出档只展示价格，不着色、不判「已达」
const SELL_MUTED = new Set(['中国广核', '中国核电'])

// 网格设置（localStorage）：买入 / 卖出各自步长 + 档数
type GridCfg = { buyStep: number; buyCount: number; sellStep: number; sellCount: number; lowerTolerance: number; middleTolerance: number; upperTolerance: number; yieldTolerance: number }
const DEFAULT_CFG: GridCfg = { buyStep: 0.005, buyCount: 4, sellStep: 0.005, sellCount: 4, lowerTolerance: 0.0025, middleTolerance: 0.01, upperTolerance: 0.0025, yieldTolerance: 0.0025 }
const STEP_OPTIONS = [0.0025, 0.005]
const COUNT_OPTIONS = [0, 2, 4, 6, 8]
const ORDINAL_MARKS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧']
function loadCfg(): GridCfg {
  const c = gp().cfg as Record<string, unknown> | undefined
  if (c && typeof c === 'object') {
    const okStep = (v: unknown) => (STEP_OPTIONS.includes(v as number) ? (v as number) : undefined)
    const okCnt = (v: unknown) => (COUNT_OPTIONS.includes(v as number) ? (v as number) : undefined)
    return {
      buyStep: okStep(c.buyStep) ?? okStep(c.step) ?? DEFAULT_CFG.buyStep,
      sellStep: okStep(c.sellStep) ?? okStep(c.step) ?? DEFAULT_CFG.sellStep,
      buyCount: okCnt(c.buyCount) ?? okCnt(c.count) ?? DEFAULT_CFG.buyCount,
      sellCount: okCnt(c.sellCount) ?? okCnt(c.count) ?? DEFAULT_CFG.sellCount,
      lowerTolerance: typeof c.lowerTolerance === 'number' ? c.lowerTolerance : DEFAULT_CFG.lowerTolerance,
      middleTolerance: typeof c.middleTolerance === 'number' ? c.middleTolerance : DEFAULT_CFG.middleTolerance,
      upperTolerance: typeof c.upperTolerance === 'number' ? c.upperTolerance : DEFAULT_CFG.upperTolerance,
      yieldTolerance: typeof c.yieldTolerance === 'number' ? c.yieldTolerance : DEFAULT_CFG.yieldTolerance,
    }
  }
  return DEFAULT_CFG
}
function saveCfg(c: GridCfg) { saveGp({ cfg: c }) }

const round4 = (n: number) => Math.round(n * 10000) / 10000
// 动态生成档位：买入从基准向上 buyCount 档（升序）；卖出从基准向下 sellCount 档、过滤 ≤0 后升序
const buyGridFor = (r: Row, cfg: GridCfg, starts: Map<string, YieldStart>) =>
  Array.from({ length: cfg.buyCount }, (_, i) => round4((starts.get(r.code)?.buy ?? DEFAULT_BUY_START) + i * cfg.buyStep))
const sellGridFor = (r: Row, cfg: GridCfg, starts: Map<string, YieldStart>) =>
  Array.from({ length: cfg.sellCount }, (_, i) => round4((starts.get(r.code)?.sell ?? DEFAULT_SELL_START) - i * cfg.sellStep)).filter(y => y > 0).sort((a, b) => a - b)

// 已达档位底色：买入越高息越深（橙），卖出越低息越深（绿）。按档位在网格中的位次插值
function lerpHex(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16))
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')
}
const BUY_LIGHT = '#ffedd5', BUY_DARK = '#f97c3c', SELL_LIGHT = '#dcfce7', SELL_DARK = '#22c55e'
function hitBg(kind: 'buy' | 'sell', y: number, grid: number[]): string | undefined {
  const n = grid.length, idx = grid.indexOf(y)
  if (idx < 0) return undefined
  const t = n <= 1 ? 1 : (kind === 'buy' ? idx / (n - 1) : 1 - idx / (n - 1))
  return kind === 'buy' ? lerpHex(BUY_LIGHT, BUY_DARK, t) : lerpHex(SELL_LIGHT, SELL_DARK, t)
}

// 收益率展示：去尾零，支持 0.25% 步长（5% / 5.25% / 5.5%）
const fmtPct = (y: number) => +(y * 100).toFixed(2) + '%'

const cyClass = (cy: number) => (cy >= 0.05 ? 'cy-hi' : cy >= 0.04 ? 'cy-mid' : 'cy-lo')

const payoutForYear = (records: DividendPayoutRecord[] | undefined, year: number) => {
  const payout = records?.find(record => record.year === year)?.payoutRatio
  return payout == null ? '--' : `${payout.toFixed(2)}%`
}

function PayoutValue({ records }: { records: DividendPayoutRecord[] | undefined }) {
  const [open, setOpen] = useState(false)
  if (!records?.length) return <b>--</b>

  return (
    <span className="payout-popover" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="payout-trigger"
        onClick={() => setOpen(value => !value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-expanded={open}
      >
        <b>{payoutForYear(records, 2025)}</b>
      </button>
      {open && (
        <span role="tooltip" className="payout-tooltip">
          {[2025, 2024, 2023].map(year => <span key={year}><i>{year}年</i>{payoutForYear(records, year)}</span>)}
        </span>
      )}
    </span>
  )
}

function ForecastDividendValue({
  forecast,
  manual,
  isHK,
  onEdit,
}: {
  forecast: number | null | undefined
  manual: number | undefined
  isHK: boolean
  onEdit: () => void
}) {
  const value = manual ?? forecast
  const text = typeof value === 'number' ? String(+value.toFixed(4)) : !isHK && forecast === undefined ? '···' : '--'
  return (
    <button
      type="button"
      className={`forecast-edit-value${manual !== undefined ? ' manual' : ''}`}
      onClick={onEdit}
      title={manual !== undefined ? '手动修改值，点击编辑' : '算法预测值，点击手动修改'}
    >
      <b>{text}</b><i>{manual !== undefined ? '手动' : '✎'}</i>
    </button>
  )
}

// 涨跌幅：A 股惯例涨红跌绿
const chgClass = (p: number) => (p > 0 ? 'chg-up' : p < 0 ? 'chg-dn' : 'chg-flat')
const chgText = (p: number) => `${p > 0 ? '+' : ''}${p.toFixed(2)}%`

type Row = { sector: string; name: string; code: string; dive: number; gridDividend: number; dividendFallback: boolean; price: number; cy: number; pctChg: number; isHK: boolean }
type YieldStart = { code: string; buy: number; sell: number }
// 币种符号：网格内港股使用 $，A 股 ¥
const symOf = (isHK?: boolean, code?: string) => (isHK ? '$' : code && /^900/.test(String(code)) ? '$' : code && /^200/.test(String(code)) ? 'HK$' : '¥')

// 网格页自选（独立于主自选页，纳入账号云同步）
const FAV = '自选'
type Custom = { sector: string; name: string; code: string; dive: number; isHK?: boolean }
const EMPTY_FORECAST_OVERRIDES: Record<string, number> = {}
type ProfitRatioChoice = 'median' | 'average' | '2023' | '2024' | '2025' | 'manual'

const averageOf = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
const medianOf = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const toBillion = (value: number) => value / 1e8
const compactNumber = (value: number, digits = 2) => Number.isFinite(value) ? String(+value.toFixed(digits)) : '--'
const commitmentHighlights = (commitment: DividendCommitment) => {
  const items: string[] = []
  if (commitment.minPayoutRatio !== undefined) items.push(`2026 年现金分红比例 ≥ ${compactNumber(commitment.minPayoutRatio * 100)}%`)
  if (commitment.minCashAmount !== undefined) items.push(`现金分红总额 ≥ ${compactNumber(toBillion(commitment.minCashAmount))} 亿元`)
  if (commitment.minDps !== undefined) items.push(`每股现金红利 ≥ ${compactNumber(commitment.minDps, 4)} 元`)
  if (commitment.includesInterim) items.push('包含中期分红安排')
  return items
}
const PAYOUT_METHOD_LABELS: Record<PayoutMethod, string> = { average: '三年平均值', median: '三年中位数', latest: '最近一年' }
const profitRatioChoiceLabel = (choice: ProfitRatioChoice) => (
  choice === 'average' ? '三年平均值' : choice === 'median' ? '三年中位数' : choice === 'manual' ? '手动值' : `${choice} 年比例`
)
const payoutFor = (detail: ForecastResult, choice: PayoutMethod) => (
  choice === 'latest' ? detail.payoutLatest : choice === 'median' ? detail.payoutMedian : detail.payoutAverage
)
const profitRatioFor = (detail: ForecastResult, choice: ProfitRatioChoice) => {
  const ratios = detail.seasonality.map(item => item.ratio)
  if (choice === 'median') return medianOf(ratios)
  if (choice === 'average') return averageOf(ratios)
  if (choice === 'manual') return medianOf(ratios)
  return detail.seasonality.find(item => item.year === Number(choice))?.ratio ?? medianOf(ratios)
}

// 从 store 读取/写入网格偏好（替代旧 localStorage 直读直写）
const gp = () => useStore.getState().gridPrefs
const saveGp = (p: Partial<GridPrefs>) => useStore.getState().setGridPrefs(p)
function loadFavs(): Set<string> { return new Set(gp().favs) }
function saveFavs(s: Set<string>) { saveGp({ favs: [...s] }) }
function loadCustom(): Custom[] { return gp().custom }
function saveCustom(list: Custom[]) { saveGp({ custom: list }) }
function loadHidden(): Set<string> { return new Set(gp().hidden) }
function saveHidden(s: Set<string>) { saveGp({ hidden: [...s] }) }
function loadActive(): string { return gp().active || ALL }
function saveActive(v: string) { saveGp({ active: v }) }

// 标的排序
type SortKey = 'cy' | 'chg' | 'consecutiveYears' | 'price' | 'bollPosition'
type SortState = { key: SortKey; dir: 'asc' | 'desc' }
const DEFAULT_SORT: SortState = { key: 'cy', dir: 'desc' }
const SORT_OPTS: { key: SortKey; label: string }[] = [
  { key: 'cy', label: '股息率' }, { key: 'chg', label: '涨跌幅' }, { key: 'consecutiveYears', label: '连续分红年数' }, { key: 'bollPosition', label: '轨道下→上' }, { key: 'price', label: '现价' },
]
const SORT_KEYS = new Set<string>(SORT_OPTS.map(o => o.key))
function loadSort(): SortState { const s = gp().sort; return s?.key ? (s as SortState) : DEFAULT_SORT }
function saveSort(s: SortState) { saveGp({ sort: s }) }
function loadStockOrder(): string[] { return gp().stockOrder }
function saveStockOrder(a: string[]) { saveGp({ stockOrder: a }) }

// 行情缓存（localStorage）：盘后/非交易时段直接读缓存不刷新
type PriceSnap = { price: number; pctChg: number; tradeDate: string; tradeTime: string }
type PriceCache = { fetchedAt: number; latestDate: string; data: Record<string, PriceSnap> }
const PRICE_CACHE_KEY = 'yg-price-cache'
function loadPriceCache(): PriceCache | null {
  try { const c = JSON.parse(localStorage.getItem(PRICE_CACHE_KEY) || 'null'); return c && c.data ? c : null } catch { return null }
}
function savePriceCache(c: PriceCache) { try { localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(c)) } catch { /* ignore */ } }
// 日期展示：MM-DD
function fmtDate(ts: number): string {
  const d = new Date(ts), p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
// 时间戳展示：当天显示 HH:MM，跨天显示 MM-DD HH:MM
function fmtTs(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts), p = (n: number) => String(n).padStart(2, '0')
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
  return new Date().toDateString() === d.toDateString() ? hm : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`
}

// 单档计算：买入「已达」= 现价≤目标价；卖出「已达」= 现价≥目标价
function tier(r: Row, y: number, kind: 'buy' | 'sell') {
  const target = r.gridDividend / y
  const reached = kind === 'buy' ? r.price <= target : r.price >= target
  const pct = Math.round((kind === 'buy' ? (r.price - target) : (target - r.price)) / r.price * 100)
  const label = reached ? '已达' : `${kind === 'buy' ? '↓' : '↑'}${pct}%`
  return { target, reached, label }
}

function useMediaQuery(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const h = (e: MediaQueryListEvent) => setM(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [q])
  return m
}

// 竖屏手机使用卡片；横屏手机恢复表格，并允许横向滑动。
const useIsMobile = () => useMediaQuery('(max-width: 719px)')

export default function YieldGrid() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const isNarrowDesktop = useMediaQuery('(max-width: 1100px)')
  const { message, showToast } = useToast()

  // 一次性迁移：旧 localStorage 数据 → Zustand store（纳入账号云同步）
  useEffect(() => {
    const prefs = useStore.getState().gridPrefs
    if (prefs.custom.length > 0 || prefs.favs.length > 0 || prefs.hidden.length > 0) return
    try {
      const oldCustom = JSON.parse(localStorage.getItem('yg-custom') || 'null')
      const oldFavs = JSON.parse(localStorage.getItem('yg-favs') || 'null')
      const oldHidden = JSON.parse(localStorage.getItem('yg-hidden') || 'null')
      const oldOrder = localStorage.getItem('yg-sector-order')
      const oldCfg = localStorage.getItem('yg-grid-cfg')
      const oldSort = localStorage.getItem('yg-sort')
      const oldStockOrder = localStorage.getItem('yg-stock-order')
      const oldActive = localStorage.getItem('yg-active')
      if (!oldCustom && !oldFavs && !oldHidden) return
      const patch: Partial<GridPrefs> = {}
      if (Array.isArray(oldCustom) && oldCustom.length) {
        patch.custom = oldCustom.map((c: Custom) => {
          if (c.isHK && !c.name.endsWith('(HK)')) return { ...c, name: c.name + '(HK)' }
          if (!c.isHK && /^[29]00/.test(String(c.code)) && !c.name.includes('(B)')) return { ...c, name: c.name + '(B)' }
          return c
        })
      }
      if (Array.isArray(oldFavs) && oldFavs.length) patch.favs = oldFavs
      if (Array.isArray(oldHidden) && oldHidden.length) patch.hidden = oldHidden
      if (oldOrder) { try { const o = JSON.parse(oldOrder); if (Array.isArray(o)) patch.sectorOrder = o } catch { /* */ } }
      if (oldCfg) { try { const c = JSON.parse(oldCfg); if (c && typeof c === 'object') patch.cfg = c } catch { /* */ } }
      if (oldSort) { try { const s = JSON.parse(oldSort); if (s && s.key) patch.sort = s } catch { /* */ } }
      if (oldStockOrder) { try { const o = JSON.parse(oldStockOrder); if (Array.isArray(o)) patch.stockOrder = o } catch { /* */ } }
      if (oldActive) patch.active = oldActive
      useStore.getState().setGridPrefs(patch)
    } catch { /* ignore */ }
  }, [])

  const [rows, setRows] = useState<Row[] | null>(null)
  const [consecutiveDividendYears, setConsecutiveDividendYears] = useState<Record<string, number | null>>({})
  const [dividendPayouts, setDividendPayouts] = useState<Record<string, DividendPayoutRecord[]>>({})
  const [forecastDividends, setForecastDividends] = useState<Record<string, number | null>>(() => loadForecastCache())
  const [forecastEditor, setForecastEditor] = useState<{ code: string; name: string; input: string } | null>(null)
  const [forecastDetail, setForecastDetail] = useState<ForecastResult | null>(null)
  const [forecastDetailLoading, setForecastDetailLoading] = useState(false)
  const [forecastDetailError, setForecastDetailError] = useState('')
  const [profitRatioChoice, setProfitRatioChoice] = useState<ProfitRatioChoice>('median')
  const [annualProfitInput, setAnnualProfitInput] = useState('')
  const [editorPayoutChoice, setEditorPayoutChoice] = useState<PayoutMethod>('average')
  const [infoModal, setInfoModal] = useState<'forecast' | 'boll' | 'data' | null>(null)
  const [date, setDate] = useState('')
  const [fetchedAt, setFetchedAt] = useState(0)
  const [error, setError] = useState('')
  const [priceRefreshKey, setPriceRefreshKey] = useState(0)
  const [upcomingDividendRecords, setUpcomingDividendRecords] = useState<{ code: string; exDate: string; perShare: number }[]>([])
  const [upcomingDividendLoading, setUpcomingDividendLoading] = useState(false)
  // 网格偏好全部从 store 读取（而非 useState 初始化），云同步后自动刷新
  const storedActive = useStore(s => s.gridPrefs.active || ALL)
  const storedForecastOverrides = useStore(s => s.gridPrefs.forecastOverrides)
  const forecastOverrides = storedForecastOverrides ?? EMPTY_FORECAST_OVERRIDES
  const active = LEGACY_SIGNAL_TABS.has(storedActive) ? ALL : storedActive
  const switchActive = (v: string) => saveActive(v)
  useEffect(() => {
    if (LEGACY_SIGNAL_TABS.has(storedActive)) saveActive(ALL)
  }, [storedActive])
  // 未登录用户继续使用本机数据；登录后 startAutoPush 会把这份旧缓存并入账号并清除。
  useEffect(() => {
    const localOverrides = loadForecastOverrides()
    if (Object.keys(localOverrides).length === 0) return
    saveGp({ forecastOverrides: { ...forecastOverrides, ...localOverrides } })
  }, [])
  const favsArr = useStore(s => s.gridPrefs.favs)
  const favs = useMemo(() => new Set(favsArr), [favsArr])
  const toggleFav = (code: string) => {
    const next = new Set(favsArr)
    next.has(code) ? next.delete(code) : next.add(code)
    saveFavs(next)
  }
  const orderRaw = useStore(s => s.gridPrefs.sectorOrder)
  const order = useMemo(() => {
    const valid = orderRaw.filter(sector => SECTORS.includes(sector))
    const missing = SECTORS.filter(sector => !valid.includes(sector))
    const otherIndex = valid.indexOf('其他')
    return otherIndex === -1
      ? [...valid, ...missing]
      : [...valid.slice(0, otherIndex), ...missing, ...valid.slice(otherIndex)]
  }, [orderRaw])
  const [editOrder, setEditOrder] = useState(false)
  const moveSector = (sector: string, dir: -1 | 1) => {
    const i = order.indexOf(sector); const j = i + dir
    if (i < 0 || j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[i], next[j]] = [next[j], next[i]]
    saveOrder(next)
  }

  // 自定义添加的标的，与静态列表合并（去重）；隐藏的默认标的过滤掉
  const custom = useStore(s => s.gridPrefs.custom)
  const setCustom = (list: Custom[]) => saveCustom(list)
  useEffect(() => {
    const migrated = custom.map(stock => (
      stock.sector === '其他' && NONFERROUS_CODES.has(stock.code)
        ? { ...stock, sector: '有色' }
        : stock
    ))
    if (migrated.some((stock, index) => stock !== custom[index])) setCustom(migrated)
  }, [custom])
  const hiddenArr = useStore(s => s.gridPrefs.hidden)
  const hidden = useMemo(() => new Set(hiddenArr), [hiddenArr])
  const setHidden = (s: Set<string>) => saveHidden(s)
  const allStocks = useMemo<Custom[]>(() => {
    const seen = new Set(STOCKS.map(s => s.code))
    return [...STOCKS, ...custom.filter(c => !seen.has(c.code))].filter(s => !hidden.has(s.code))
  }, [custom, hidden])
  const [bollPeriod, setBollPeriod] = useState<BollPeriod>('week')
  const [bollByPeriod, setBollByPeriod] = useState<Record<BollPeriod, Record<string, PeriodBoll>>>(() => ({ day: {}, week: {}, month: {} }))
  const [bollLoading, setBollLoading] = useState<Partial<Record<BollPeriod, boolean>>>({})
  const loadedBollKeys = useRef<Partial<Record<BollPeriod, string>>>({})
  const requestedBollKeys = useRef<Partial<Record<BollPeriod, string>>>({})
  const bollInputs = useMemo(() => allStocks.map(stock => ({ code: stock.code, isHK: stock.isHK })), [allStocks])
  const bollRequestKey = useMemo(() => allStocks.map(stock => `${stock.code}:${stock.isHK ? 1 : 0}`).join(','), [allStocks])
  const loadBollPeriod = useCallback((period: BollPeriod): Promise<void> => {
    if (loadedBollKeys.current[period] === bollRequestKey || requestedBollKeys.current[period] === bollRequestKey) return Promise.resolve()
    requestedBollKeys.current[period] = bollRequestKey
    setBollLoading(current => ({ ...current, [period]: true }))
    return fetchPeriodBoll(period, bollInputs)
      .then(data => {
        if (requestedBollKeys.current[period] !== bollRequestKey) return
        setBollByPeriod(current => ({ ...current, [period]: data }))
        loadedBollKeys.current[period] = bollRequestKey
      })
      .catch(() => {
        if (requestedBollKeys.current[period] === bollRequestKey) setBollByPeriod(current => ({ ...current, [period]: {} }))
      })
      .finally(() => {
        if (requestedBollKeys.current[period] !== bollRequestKey) return
        requestedBollKeys.current[period] = undefined
        setBollLoading(current => ({ ...current, [period]: false }))
      })
  }, [bollInputs, bollRequestKey])
  useEffect(() => {
    void loadBollPeriod(bollPeriod)
  }, [bollPeriod, loadBollPeriod])
  useEffect(() => {
    if (loadedBollKeys.current.week !== bollRequestKey) return
    const timer = window.setTimeout(() => {
      void loadBollPeriod('day').finally(() => loadBollPeriod('month'))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [bollByPeriod.week, bollRequestKey, loadBollPeriod])
  const bollByCode = bollByPeriod[bollPeriod]
  // 被隐藏的默认标的（用于「恢复」列表）
  const hiddenStocks = useMemo(() => STOCKS.filter(s => hidden.has(s.code)), [hidden])

  // 标的排序：指标 + 手动置顶
  const sortRaw = useStore(s => s.gridPrefs.sort)
  // 兼容老用户曾保存的已下线排序键（如「名称」）→ 回落默认
  const sort: SortState = useMemo(() => sortRaw?.key && SORT_KEYS.has(sortRaw.key) ? sortRaw as SortState : DEFAULT_SORT, [sortRaw])
  const chooseSort = (key: SortKey) => {
    const next: SortState = sort.key === key
      ? { key, dir: sort.dir === 'desc' ? 'asc' : 'desc' }
      : { key, dir: key === 'bollPosition' ? 'asc' : 'desc' }
    saveSort(next)
  }
  const stockOrder = useStore(s => s.gridPrefs.stockOrder)
  const setStockOrder = (a: string[]) => saveStockOrder(a)
  // 板块折叠（遮挡）：按 tab（active 筛选）分桶持久化，互不影响；默认不折叠
  const collapsedMap = useStore(s => s.gridPrefs.collapsed)
  const collapsed = useMemo(() => new Set(collapsedMap?.[active] ?? []), [collapsedMap, active])
  const [groupBySector, setGroupBySector] = useState(() => localStorage.getItem('yg-group-by-sector') !== '0')
  const toggleGroupBySector = () => {
    setGroupBySector(current => {
      const next = !current
      localStorage.setItem('yg-group-by-sector', next ? '1' : '0')
      return next
    })
  }
  const toggleCollapse = (sector: string) => {
    const next = new Set(collapsed)
    next.has(sector) ? next.delete(sector) : next.add(sector)
    const map = { ...(gp().collapsed ?? {}) }
    map[active] = [...next]
    saveGp({ collapsed: map })
  }
  // 手动上/下移：把该板块当前显示顺序（含本次交换）整体固定为手排
  const moveStock = (sectorItems: Row[], code: string, dir: -1 | 1) => {
    const codes = sectorItems.map(r => r.code)
    const i = codes.indexOf(code), j = i + dir
    if (i < 0 || j < 0 || j >= codes.length) return
    ;[codes[i], codes[j]] = [codes[j], codes[i]]
    const inSector = new Set(codes)
    const next = [...stockOrder.filter(c => !inSector.has(c)), ...codes]
    setStockOrder(next)
  }
  const clearStockOrder = () => { saveStockOrder([]) }

  // 登录状态
  const [authUser, setAuthUser] = useState<{ email?: string; user_metadata?: { nickName?: string } } | null>(null)
  useEffect(() => {
    cbAuth.getSession().then(({ data }) => {
      const session = data?.session
      setAuthUser(session && !session.user?.is_anonymous ? session.user : null)
    }).catch(() => {})
  }, [])

  // 登录用户的最近买入记录查找表（code → latest buy tx）
  const watchlist = useStore(s => s.watchlist)
  const lastBuyMap = useMemo(() => {
    if (!authUser) return new Map<string, { price: number; qty: number; ts: number; isFirst: boolean }>()
    const map = new Map<string, { price: number; qty: number; ts: number; isFirst: boolean }>()
    for (const s of watchlist) {
      const buys = (s.transactions || []).filter(t => t.type === 'buy')
      if (!buys.length) continue
      const latest = buys.reduce((a, b) => (b.ts > a.ts ? b : a))
      map.set(s.code, { price: latest.price, qty: latest.qty, ts: latest.ts, isFirst: buys.length === 1 })
    }
    return map
  }, [watchlist, authUser])

  // 全局点赞（CloudBase 累加计数，localStorage 一人一次）
  const [likes, setLikes] = useState<number | null>(null)
  const [liked, setLiked] = useState(hasLiked)
  const [liking, setLiking] = useState(false)
  useEffect(() => { getLikes().then(setLikes).catch(() => {}) }, [])
  const onLike = () => {
    if (liked || liking) return
    setLiking(true)
    setLiked(true)
    setLikes(n => (n ?? 0) + 1) // 乐观 +1
    addLike()
      .then(n => setLikes(n))
      .catch(() => { setLiked(false); setLikes(n => (n != null ? n - 1 : n)); showToast('点赞失败，请稍后再试') })
      .finally(() => setLiking(false))
  }

  // 添加标的弹窗
  const [showAdd, setShowAdd] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [addForm, setAddForm] = useState<{ name: string; code: string; sector: string; dive: string; isHK: boolean }>({ name: '', code: '', sector: '', dive: '', isHK: false })

  // 网格设置
  const storedCfg = useStore(s => s.gridPrefs.cfg)
  const cfg: GridCfg = { ...DEFAULT_CFG, ...storedCfg }
  const storedYieldStarts = useStore(s => s.gridPrefs.yieldStarts)
  const yieldStarts = storedYieldStarts ?? DEFAULT_YIELD_STARTS
  const showBoll = useStore(s => s.gridPrefs.showBoll !== false)
  const dividendBasis: DividendBasis = useStore(s => s.gridPrefs.dividendBasis === '2026' ? '2026' : '2025')
  const yieldStartMap = useMemo(() => new Map(yieldStarts.map(item => [item.code, item])), [yieldStarts])
  const [showCfg, setShowCfg] = useState(false)
  const updateCfg = (partial: Partial<GridCfg>) => { saveCfg({ ...cfg, ...partial }) }
  const updateShowBoll = (next: boolean) => saveGp({ showBoll: next })
  const updateDividendBasis = (next: DividendBasis) => saveGp({ dividendBasis: next })
  const updateYieldStarts = (next: YieldStart[]) => saveGp({ yieldStarts: next })
  const [yieldFilter, setYieldFilter] = useState<YieldStatusFilter>('all')
  const [bollFilters, setBollFilters] = useState<BollFilters>({ ...EMPTY_BOLL_FILTERS })
  const [filterPanel, setFilterPanel] = useState<'yield' | 'boll' | null>(null)
  const singleActiveBollPeriod = getSingleActiveBollPeriod(bollFilters)
  useEffect(() => {
    if (singleActiveBollPeriod) setBollPeriod(singleActiveBollPeriod)
  }, [singleActiveBollPeriod])
  const yieldFilterLabel = YIELD_FILTER_OPTIONS.find(option => option.value === yieldFilter)?.label ?? '不限'
  const bollFilterSummary = BOLL_PERIODS.flatMap(period => {
    const summaries = bollFilters[period].flatMap(value => {
      const option = BOLL_FILTER_OPTIONS.find(item => item.value === value)
      return option ? [option.summary] : []
    })
    return summaries.length > 0 ? [`${BOLL_PERIOD_LABELS[period]}${summaries.join('/')}`] : []
  }).join(' · ') || '不限'
  const hasActiveFilters = yieldFilter !== 'all' || BOLL_PERIODS.some(period => bollFilters[period].length > 0)
  const clearFilters = () => {
    setYieldFilter('all')
    setBollFilters({ ...EMPTY_BOLL_FILTERS })
  }
  const resetFilterThresholds = () => updateCfg({
    lowerTolerance: DEFAULT_CFG.lowerTolerance,
    middleTolerance: DEFAULT_CFG.middleTolerance,
    upperTolerance: DEFAULT_CFG.upperTolerance,
    yieldTolerance: DEFAULT_CFG.yieldTolerance,
  })

  const setYieldStart = (code: string, partial: Partial<YieldStart>) => {
    updateYieldStarts(yieldStarts.map(item => item.code === code ? { ...item, ...partial } : item))
  }
  const [yieldStartCode, setYieldStartCode] = useState('')
  const configuredYieldStarts = yieldStarts.flatMap(item => {
    const stock = allStocks.find(candidate => candidate.code === item.code)
    return stock ? [{ ...item, name: stock.name }] : []
  })
  const availableYieldStartStocks = allStocks.filter(stock => !yieldStartMap.has(stock.code))
  const addYieldStart = () => {
    if (yieldStarts.length >= MAX_YIELD_STARTS) return
    const stock = availableYieldStartStocks.find(item => item.code === yieldStartCode)
    if (!stock) return
    updateYieldStarts([...yieldStarts, { code: stock.code, buy: DEFAULT_BUY_START, sell: DEFAULT_SELL_START }])
    setYieldStartCode('')
  }

  const [searching, setSearching] = useState(false)
  useEffect(() => {
    if (q.trim().length < 1) { setResults([]); setSearching(false); return }
    let alive = true
    setSearching(true)
    const t = setTimeout(() => {
      // forceCloud=true：强制走云端，否则本地命中即返回，搜不全（与发现页一致）
      searchStocks(q.trim(), true).then(rs => {
        if (!alive) return
        setResults(rs.filter(r => !r.isUS).slice(0, 8))  // 网格支持 A 股 / 港股（不含美股）
        setSearching(false)
      }).catch(() => { if (alive) { setResults([]); setSearching(false) } })
    }, 500)
    return () => { alive = false; clearTimeout(t) }
  }, [q])

  const selectResult = (r: SearchResult) => {
    const mkt = r.isHK ? 'HK' : 'A'
    const predicted = predictSector(r.name, r.code, mkt)
    const bTag = !r.isHK && /^[29]00/.test(String(r.code)) ? '(B)' : ''
    setAddForm({ name: r.isHK ? r.name + '(HK)' : r.name + bTag, code: r.code, sector: SECTORS.includes(predicted) ? predicted : '其他', dive: '', isHK: !!r.isHK })
    setQ(''); setResults([])
    fetchDividendHistory(r.code, !!r.isHK, false).then(h => {
      if (!h?.records?.length) return
      const guess = pickDividendForFill(h.records, mkt)
      if (guess > 0) setAddForm(f => f.code === r.code && !f.dive ? { ...f, dive: String(Number(guess.toFixed(4))) } : f)
    }).catch(() => {})
  }

  const confirmAdd = () => {
    const dive = parseFloat(addForm.dive)
    if (!addForm.code || !addForm.name || !(dive > 0)) { showToast('请先搜索选择标的并填写每股股息'); return }
    if (allStocks.some(s => s.code === addForm.code)) {
      const exist = allStocks.find(s => s.code === addForm.code)
      showToast(`${exist?.name || addForm.name} 已在「${exist?.sector || ''}」中`)
      return
    }
    if (custom.length >= MAX_CUSTOM) { showToast(`最多添加 ${MAX_CUSTOM} 个自定义标的，删除后再加`); return }
    const next = [...custom, { sector: addForm.sector, name: addForm.name, code: addForm.code, dive, isHK: addForm.isHK }]
    saveCustom(next)
    setAddForm({ name: '', code: '', sector: '', dive: '', isHK: false })
    // 新标的需要拉行情（不直接 setRows(null)，靠 useEffect 自动触发）
  }

  const deleteCustom = (code: string) => {
    const next = custom.filter(c => c.code !== code)
    saveCustom(next)
    setRows(prev => prev?.filter(r => r.code !== code) ?? null)
  }

  // 删除标的：自定义的直接移除，内置默认的记入隐藏（可恢复）；一并清掉手排记录
  const removeStock = (code: string) => {
    if (stockOrder.includes(code)) { saveStockOrder(stockOrder.filter(c => c !== code)) }
    if (custom.some(c => c.code === code)) { deleteCustom(code); return }
    const next = new Set(hidden); next.add(code); saveHidden(next)
    setRows(prev => prev?.filter(r => r.code !== code) ?? null)
  }
  const restoreStock = (code: string) => {
    const next = new Set(hidden); next.delete(code); saveHidden(next)
    // 恢复后需要重新拉取行情（标的之前被隐藏，rows 里没有它的数据）
    setRows(null)
  }

  useEffect(() => {
    const codes = allStocks.map(s => s.code)
    const build = (data: Record<string, PriceSnap>, ts: number, seedDate: string) => {
      const out: Row[] = []
      let latest = seedDate || ''
      let latestTime = ''
      for (const s of allStocks) {
        const q = data[s.code]
        if (!q || !q.price) continue
        if (q.tradeDate && q.tradeDate > latest) latest = q.tradeDate
        if (q.tradeTime && q.tradeTime > latestTime) latestTime = q.tradeTime
        out.push({ sector: s.sector, name: s.name, code: s.code, dive: s.dive, gridDividend: s.dive, dividendFallback: false, price: q.price, cy: s.dive / q.price, pctChg: q.pctChg ?? 0, isHK: !!s.isHK })
      }
      if (!out.length) { setError('行情获取失败，请稍后刷新。'); return }
      setRows(out)
      setDate(latest ? `${latest.slice(0, 4)}-${latest.slice(4, 6)}-${latest.slice(6, 8)}` : '')
      // 显示行情时间（股价对应的时刻）；接口未给时分时退回抓取时刻
      const quoteTs = latestTime.length >= 12
        ? new Date(`${latestTime.slice(0, 4)}-${latestTime.slice(4, 6)}-${latestTime.slice(6, 8)}T${latestTime.slice(8, 10)}:${latestTime.slice(10, 12)}:00`).getTime()
        : ts
      setFetchedAt(quoteTs)
    }

    const cache = loadPriceCache()
    const cacheCoversAll = !!cache && codes.every(c => cache.data[c])
    const now = new Date()
    const closeSettled = isCloseSettled(now)
    const staleCloseCodes = closeSettled
      ? codes.filter(code => {
          const quote = cache?.data[code]
          return !quote || !hasSettledCloseQuote(quote.tradeDate, quote.tradeTime, now)
        })
      : []
    let alive = true
    const finalRefreshDelay = closeFinalizationDelayMs(now)
    const finalRefreshTimer = finalRefreshDelay === null ? undefined : window.setTimeout(() => {
      setPriceRefreshKey(value => value + 1)
    }, finalRefreshDelay)
    const cleanup = () => {
      alive = false
      if (finalRefreshTimer !== undefined) window.clearTimeout(finalRefreshTimer)
    }
    const useCache = shouldUsePriceCache(cache?.fetchedAt ?? 0, cacheCoversAll, now, closeSettled && staleCloseCodes.length === 0)
    if (useCache) {
      build(cache!.data, cache!.fetchedAt, cache!.latestDate)
      return cleanup
    }
    const stocksToFetch = closeSettled && cache
      ? allStocks.filter(stock => staleCloseCodes.includes(stock.code))
      : allStocks
    fetchStockPrices(stocksToFetch.map(s => ({ code: s.code, isHK: s.isHK })), closeSettled)
      .then(prices => {
        if (!alive) return
        const data: Record<string, PriceSnap> = closeSettled && cache ? { ...cache.data } : {}
        for (const c of stocksToFetch.map(stock => stock.code)) {
          const q = prices[c]
          if (q && q.price) data[c] = { price: q.price, pctChg: q.pctChg ?? 0, tradeDate: q.tradeDate || '', tradeTime: q.tradeTime || '' }
        }
        let latest = ''
        for (const c of codes) if (data[c]?.tradeDate && data[c].tradeDate > latest) latest = data[c].tradeDate
        const now = Date.now()
        if (Object.keys(data).length) savePriceCache({ fetchedAt: now, latestDate: latest, data })
        build(data, now, latest)
      })
      .catch(() => {
        if (!alive) return
        // 拉取失败退回缓存（若有）
        if (cacheCoversAll) build(cache!.data, cache!.fetchedAt, cache!.latestDate)
        else setError('行情获取失败，请稍后刷新。')
      })
    return cleanup
  }, [custom, hidden, priceRefreshKey])

  // 历史分红按 4 只一批加载；fetchDividendHistory 自带本地缓存，命中时不发网络请求。
  useEffect(() => {
    if (!rows?.length) return
    let cancelled = false

    const load = async () => {
      for (let i = 0; i < rows.length; i += 4) {
        const batch = await Promise.all(rows.slice(i, i + 4).map(async row => ({
          code: row.code,
          years: (await fetchDividendHistory(row.code, row.isHK))?.consecutiveYears ?? null,
        })))
        if (cancelled) return
        setConsecutiveDividendYears(previous => ({
          ...previous,
          ...Object.fromEntries(batch.map(item => [item.code, item.years])),
        }))
      }
    }
    load().catch(() => {})

    return () => { cancelled = true }
  }, [rows])

  const forecastCodeKey = useMemo(() => rows?.filter(row => !row.isHK).map(row => row.code).join(',') || '', [rows])
  useEffect(() => {
    const codes = forecastCodeKey ? forecastCodeKey.split(',') : []
    const missingCodes = codes.filter(code => !(code in forecastDividends))
    if (!missingCodes.length) return
    let cancelled = false
    fetchDividendForecasts(missingCodes)
      .then(({ modelVersion, results }) => {
        if (cancelled) return
        setForecastDividends(previous => {
          const next = { ...previous }
          for (const code of missingCodes) {
            const value = results[code]?.annualDps
            next[code] = Number.isFinite(value) ? value : null
          }
          if (modelVersion === DIVIDEND_FORECAST_MODEL_VERSION) {
            saveForecastCache(next)
          }
          return next
        })
      })
      .catch(() => {
        if (cancelled) return
        setForecastDividends(previous => ({ ...previous, ...Object.fromEntries(missingCodes.map(code => [code, null])) }))
      })
    return () => { cancelled = true }
  }, [forecastCodeKey])

  useEffect(() => {
    const code = forecastEditor?.code
    if (!code) {
      setForecastDetail(null)
      setForecastDetailError('')
      return
    }
    const applyDetail = (detail: ForecastResult) => {
      setForecastDetail(detail)
      setProfitRatioChoice('median')
      setAnnualProfitInput(compactNumber(toBillion(detail.annualProfit)))
      setEditorPayoutChoice(detail.payoutMethod)
    }
    const cachedDetail = loadForecastDetail(code)
    if (cachedDetail) {
      applyDetail(cachedDetail)
      setForecastDetailError('')
      setForecastDetailLoading(false)
      return
    }
    let cancelled = false
    setForecastDetail(null)
    setForecastDetailError('')
    setForecastDetailLoading(true)
    fetchDividendForecast(code)
      .then(detail => {
        if (cancelled) return
        saveForecastDetail(detail)
        applyDetail(detail)
      })
      .catch(reason => {
        if (!cancelled) setForecastDetailError(reason instanceof Error ? reason.message : '预测明细加载失败')
      })
      .finally(() => { if (!cancelled) setForecastDetailLoading(false) })
    return () => { cancelled = true }
  }, [forecastEditor?.code])

  const editorAnnualProfit = Number(annualProfitInput) * 1e8
  const editorProfitRatio = forecastDetail
    ? profitRatioChoice === 'manual' && Number.isFinite(editorAnnualProfit) && editorAnnualProfit > 0
      ? forecastDetail.h1Profit / editorAnnualProfit
      : profitRatioFor(forecastDetail, profitRatioChoice)
    : null
  const editorPayout = forecastDetail ? payoutFor(forecastDetail, editorPayoutChoice) : null
  const editorCalculatedDps = forecastDetail && editorPayout !== null && Number.isFinite(editorAnnualProfit) && editorAnnualProfit > 0
    ? editorAnnualProfit * editorPayout / forecastDetail.shares
    : null
  const editorAdjustments = forecastDetail ? (() => {
    const changes: string[] = []
    if (profitRatioChoice === 'manual') {
      changes.push(`预计全年利润从 ${compactNumber(toBillion(forecastDetail.annualProfit))} 亿元手动调整为 ${compactNumber(Number(annualProfitInput))} 亿元，对应上半年占比 ${compactNumber((editorProfitRatio ?? 0) * 100)}%`)
    } else if (profitRatioChoice !== 'median') {
      changes.push(`上半年占比从三年中位数 ${compactNumber(forecastDetail.medianProfitRatio * 100)}% 调整为${profitRatioChoiceLabel(profitRatioChoice)} ${compactNumber((editorProfitRatio ?? 0) * 100)}%，预计全年利润相应调整为 ${compactNumber(Number(annualProfitInput))} 亿元`)
    }
    if (editorPayoutChoice !== forecastDetail.payoutMethod) {
      changes.push(`股息支付率从${PAYOUT_METHOD_LABELS[forecastDetail.payoutMethod]} ${compactNumber(forecastDetail.payout * 100)}% 调整为${PAYOUT_METHOD_LABELS[editorPayoutChoice]} ${compactNumber((editorPayout ?? 0) * 100)}%`)
    }
    return changes
  })() : []
  const editorPolicyRatioDps = forecastDetail?.commitment?.minPayoutRatio !== undefined
    && Number.isFinite(editorAnnualProfit) && editorAnnualProfit > 0
    ? editorAnnualProfit * forecastDetail.commitment.minPayoutRatio / forecastDetail.shares
    : null
  const originalPolicyCashDps = forecastDetail?.commitment?.minCashAmount !== undefined
    ? forecastDetail.commitment.minCashAmount / forecastDetail.shares
    : null
  const editorPolicyDpsFloor = forecastDetail?.commitment
    ? Math.max(forecastDetail.commitment.minDps ?? 0, originalPolicyCashDps ?? 0, editorPolicyRatioDps ?? 0)
    : null

  const applyEditorCalculation = (annualProfit: number, payout: number) => {
    if (!forecastDetail || !Number.isFinite(annualProfit) || annualProfit <= 0) return
    const calculated = annualProfit * payout / forecastDetail.shares
    setForecastEditor(current => current ? { ...current, input: compactNumber(calculated, 4) } : null)
  }

  const selectProfitRatio = (choice: ProfitRatioChoice) => {
    if (!forecastDetail) return
    const ratio = profitRatioFor(forecastDetail, choice)
    const annualProfit = forecastDetail.h1Profit / ratio
    setProfitRatioChoice(choice)
    setAnnualProfitInput(compactNumber(toBillion(annualProfit)))
    applyEditorCalculation(annualProfit, payoutFor(forecastDetail, editorPayoutChoice))
  }

  const changeAnnualProfit = (input: string) => {
    setAnnualProfitInput(input)
    setProfitRatioChoice('manual')
    const annualProfit = Number(input) * 1e8
    if (forecastDetail) applyEditorCalculation(annualProfit, payoutFor(forecastDetail, editorPayoutChoice))
  }

  const selectEditorPayout = (choice: PayoutMethod) => {
    setEditorPayoutChoice(choice)
    if (forecastDetail) applyEditorCalculation(Number(annualProfitInput) * 1e8, payoutFor(forecastDetail, choice))
  }

  const openForecastEditor = (row: Row) => {
    const value = forecastOverrides[row.code] ?? forecastDividends[row.code]
    setForecastEditor({ code: row.code, name: row.name, input: typeof value === 'number' ? String(+value.toFixed(4)) : '' })
  }
  const persistForecastOverrides = (next: Record<string, number>) => {
    saveGp({ forecastOverrides: next })
    cbAuth.getSession().then(({ data }) => {
      const session = data?.session
      if (!session || session.user?.is_anonymous) saveForecastOverrides(next)
    }).catch(() => saveForecastOverrides(next))
  }
  const saveForecastOverride = () => {
    if (!forecastEditor) return
    const value = Number(forecastEditor.input)
    if (!Number.isFinite(value) || value <= 0) { showToast('请输入大于 0 的每股股息'); return }
    const next = { ...forecastOverrides, [forecastEditor.code]: value }
    persistForecastOverrides(next)
    setForecastEditor(null)
    showToast(`${forecastEditor.name} 26年股息已保存`)
  }
  const restoreForecastValue = () => {
    if (!forecastEditor) return
    const next = { ...forecastOverrides }
    delete next[forecastEditor.code]
    persistForecastOverrides(next)
    setForecastEditor(null)
    showToast(`${forecastEditor.name} 已恢复算法预测`)
  }

  useEffect(() => {
    if (!rows?.length) return
    let cancelled = false
    setUpcomingDividendLoading(true)
    fetchUpcomingDividends(rows.filter(row => !row.isHK).map(row => row.code))
      .then(records => { if (!cancelled) setUpcomingDividendRecords(records) })
      .catch(() => { if (!cancelled) setUpcomingDividendRecords([]) })
      .finally(() => { if (!cancelled) setUpcomingDividendLoading(false) })
    return () => { cancelled = true }
  }, [rows])

  const upcomingDividendItems = useMemo(() => upcomingDividendRecords.flatMap(record => {
    const row = rows?.find(candidate => candidate.code === record.code)
    const exPrice = row ? row.price - record.perShare : 0
    if (!row || exPrice <= 0) return []
    const dividend2026 = forecastOverrides[row.code] ?? forecastDividends[row.code]
    const selectedDividend = resolveGridDividend(dividendBasis, row.dive, dividend2026).dividend
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const days = Math.round((new Date(`${record.exDate}T00:00:00`).getTime() - today.getTime()) / 86400000)
    if (days < 0) return []
    return [{
      ...record,
      name: row.name,
      price: row.price,
      currentYield: selectedDividend / row.price,
      exYield: selectedDividend / exPrice,
      urgency: (days <= 1 ? 'today' : days <= 3 ? 'soon' : 'normal') as 'today' | 'soon' | 'normal',
    }]
  }), [rows, upcomingDividendRecords, dividendBasis, forecastDividends, forecastOverrides])

  useEffect(() => {
    if (!rows?.length) return
    let cancelled = false
    const aShareCodes = rows.filter(row => !row.isHK).map(row => row.code)
    fetchDividendPayoutsForCodes(aShareCodes)
      .then(payouts => { if (!cancelled) setDividendPayouts(previous => ({ ...previous, ...payouts })) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [rows])

  const calculatedRows = useMemo(() => rows?.map(row => {
    const dividend2026 = forecastOverrides[row.code] ?? forecastDividends[row.code]
    const resolved = resolveGridDividend(dividendBasis, row.dive, dividend2026)
    return {
      ...row,
      gridDividend: resolved.dividend,
      dividendFallback: resolved.fallbackTo2025,
      cy: resolved.dividend / row.price,
    }
  }) ?? null, [rows, dividendBasis, forecastDividends, forecastOverrides])

  // 按板块分组（保持配置中板块出现顺序）
  const sectors: { sector: string; items: Row[] }[] = []
  for (const r of calculatedRows || []) {
    let g = sectors.find(x => x.sector === r.sector)
    if (!g) { g = { sector: r.sector, items: [] }; sectors.push(g) }
    g.items.push(r)
  }
  // 组内排序：手排过的固定在前（按手排顺序），其余按所选指标
  const pinPos = new Map(stockOrder.map((c, i) => [c, i]))
  const cmpBy = (a: Row, b: Row) => {
    const m = sort.dir === 'desc' ? -1 : 1
    if (sort.key === 'bollPosition') {
      const bollPosition = (r: Row) => {
        const boll = bollByCode[r.code]
        return boll && boll.upper > boll.lower ? (r.price - boll.lower) / (boll.upper - boll.lower) : null
      }
      const va = bollPosition(a)
      const vb = bollPosition(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      return (va - vb) * m
    }
    if (sort.key === 'consecutiveYears') {
      const va = consecutiveDividendYears[a.code]
      const vb = consecutiveDividendYears[b.code]
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      return (va - vb) * m
    }
    const va = sort.key === 'cy' ? a.cy : sort.key === 'chg' ? a.pctChg : a.price
    const vb = sort.key === 'cy' ? b.cy : sort.key === 'chg' ? b.pctChg : b.price
    return (va - vb) * m
  }
  for (const g of sectors) {
    const pinned = g.items.filter(r => pinPos.has(r.code)).sort((a, b) => pinPos.get(a.code)! - pinPos.get(b.code)!)
    const rest = g.items.filter(r => !pinPos.has(r.code)).sort(cmpBy)
    g.items = [...pinned, ...rest]
  }
  sectors.sort((a, b) => order.indexOf(a.sector) - order.indexOf(b.sector))
  const sectorTrendByName = new Map(sectors.map(group => [
    group.sector,
    getSectorTrend(group.items.map(item => item.pctChg)),
  ]))

  // 盘中（行情日期=今天 且 处于 A 股交易时段 9:30–15:00）显示「盘中价」，否则「收盘价」
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const mins = now.getHours() * 60 + now.getMinutes()
  const priceLabel = date === todayStr && mins >= 570 && mins < 900 ? '盘中价' : '收盘价'

  // 板块 Tab 决定范围；同周期 BOLL 位置为“或”，多个周期之间为“且”。
  const matchesFilters = (r: Row) => {
    if (!matchesYieldStatus(
      r.cy,
      yieldFilter,
      yieldStartMap.get(r.code)?.buy ?? DEFAULT_BUY_START,
      yieldStartMap.get(r.code)?.sell ?? DEFAULT_SELL_START,
      cfg.yieldTolerance,
      !SELL_MUTED.has(r.name),
    )) return false
    const tolerances = { lower: cfg.lowerTolerance, middle: cfg.middleTolerance, upper: cfg.upperTolerance }
    return BOLL_PERIODS.every(period => matchesBollPosition(
      r.price,
      bollByPeriod[period][r.code],
      bollFilters[period],
      tolerances,
    ))
  }
  const visible = sectors
    .map(g => active === FAV
      ? { sector: g.sector, items: g.items.filter(r => favs.has(r.code)).filter(matchesFilters) }
      : { sector: g.sector, items: g.items.filter(matchesFilters) })
    .filter(g => (active === ALL || active === FAV || g.sector === active) && g.items.length > 0)

  // 不分类时合并当前可见板块，并按当前规则对全部标的统一排序。
  const ungroupedItems = visible.flatMap(g => g.items)
  const ungroupedPinned = ungroupedItems.filter(r => pinPos.has(r.code)).sort((a, b) => pinPos.get(a.code)! - pinPos.get(b.code)!)
  const ungroupedRest = ungroupedItems.filter(r => !pinPos.has(r.code)).sort(cmpBy)
  const displayGroups = groupBySector
    ? visible
    : ungroupedItems.length > 0 ? [{ sector: '', items: [...ungroupedPinned, ...ungroupedRest] }] : []

  // 一键折叠/展开当前 tab 下所有可见板块（沿用 collapsed 的按 tab 持久化）
  const visibleSectors = visible.map(g => g.sector)
  const allCollapsed = visibleSectors.length > 0 && visibleSectors.every(s => collapsed.has(s))
  const toggleAllCollapse = () => {
    const map = { ...(gp().collapsed ?? {}) }
    map[active] = allCollapsed ? [] : [...visibleSectors]
    saveGp({ collapsed: map })
  }

  return (
    <div className={`yg-page${isMobile ? ' mobile' : ''}`}>
      <style>{CSS}</style>
      <div className="wrap">
        <div className="yg-topbar">
          <button
            className="yg-back"
            onClick={() => { try { const ref = document.referrer; if (ref && new URL(ref).origin === window.location.origin) { navigate(-1); return } } catch {} navigate('/discovery') }}
            aria-label="返回"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>返回</span>
          </button>
          <div className="yg-tools">
            <button className="yg-reportbtn" onClick={() => navigate('/reports/2026-interim')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                <path d="M6.5 3.5h8l3 3v14h-11z" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M14.5 3.5v3h3M9 15.5v-3M12 15.5v-6M15 15.5v-4" strokeLinecap="round" />
              </svg>
              <span className="yg-reportbtn-full">中报数据</span>
              <span className="yg-reportbtn-short">中报</span>
              <span className="yg-reportbtn-new">NEW</span>
            </button>
            <a className="yg-reportbtn yg-forecastbtn" href="https://www.manmanbianfu.top/dividend-forecast">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                <path d="M4 18.5h16M6.5 16V10m5 6V5m5 11V8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="m15.5 5 2-2 2 2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="yg-forecastbtn-full">分红预测</span>
              <span className="yg-forecastbtn-short">预测</span>
              <span className="yg-forecastbtn-new">NEW</span>
            </a>
            <button className="yg-cfgbtn" onClick={() => setShowCfg(true)}>⚙ 网格设置</button>
          </div>
        </div>
        <h1>股息率网格买卖价位表</h1>
        <div className="sub">{error ? '现价获取失败' : date ? `现价为 ${date} ${priceLabel}${fetchedAt ? ` · 行情时间 ${fmtTs(fetchedAt)}` : ''}` : '正在获取最新行情…'}</div>
        <div className="legend legend-compact">
          <div className="legend-main">
            <span>买卖价 = {dividendBasis === '2026' ? '26年预测股息（无值沿用25年）' : '25年股息'} ÷ 目标股息率</span>
            <span><b className="o">橙色买入网格</b>｜<b className="g2">绿色卖出网格</b></span>
            <span>颜色越深，信号越强</span>
          </div>
          <div className="legend-actions">
            <button type="button" onClick={() => setInfoModal('forecast')}>26年股息说明</button>
            <button type="button" onClick={() => setInfoModal('boll')}>BOLL说明</button>
            <button type="button" onClick={() => setInfoModal('data')}>数据说明</button>
            <span className="legend-disclaimer"><b aria-hidden="true">!</b>预测及行情数据仅供参考，不构成投资建议</span>
          </div>
        </div>
        <UpcomingDividendReminder items={upcomingDividendItems} loading={upcomingDividendLoading} />
        <button className="yg-addbar" onClick={() => setShowAdd(true)}>
          <span className="plus">＋</span> 添加标的{custom.length > 0 ? ` ${custom.length}/${MAX_CUSTOM}` : ''}{custom.length >= MAX_CUSTOM ? '（已满，删除后可再加）' : ''}
        </button>
        <div className="toolbar">
          <div className="filter">
            <div className="tabs-row">
              <div className="main-tabs">
                <button className={`chip${active === ALL ? ' active' : ''}`} onClick={() => switchActive(ALL)}>{ALL}</button>
                <button className={`chip${active === FAV ? ' active' : ''}`} onClick={() => switchActive(FAV)}>★ {FAV}{favs.size ? ` ${favs.size}` : ''}</button>
                {order.map(s => {
                  const trend = sectorTrendByName.get(s)
                  const trendClass = trend && trend.level !== 'neutral' ? ` sector-trend-${trend.level}` : ''
                  const trendLabel = trend?.median == null
                    ? `${s}：暂无有效行情`
                    : `${s}：中位涨跌 ${chgText(trend.median)} · ${trend.sampleSize} 只`
                  return (
                    <button
                      key={s}
                      className={`chip${trendClass}${active === s ? ' active' : ''}`}
                      onClick={() => switchActive(s)}
                      title={trendLabel}
                      aria-label={trendLabel}
                    >
                      {s}
                    </button>
                  )
                })}
              </div>
              {!error && rows && (
                <button
                  className={`orderbtn${editOrder ? ' on' : ''}`}
                  onClick={() => { setEditOrder(e => !e); if (!editOrder) { switchActive(ALL); clearFilters() } }}
                  aria-label={editOrder ? '完成编辑' : '编辑（排序/删除）'}
                >
                  {editOrder ? (isMobile ? '✓' : '✓ 完成') : (isMobile ? '✎' : '✎ 编辑')}
                </button>
              )}
            </div>
            <div className="filter-controls" aria-label="标的筛选">
              <button
                type="button"
                className={`filter-select yield${yieldFilter !== 'all' ? ' selected' : ''}`}
                onClick={() => setFilterPanel('yield')}
              >
                <span className="filter-select-label">股息率状态</span>
                <strong>{yieldFilterLabel}</strong>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                className={`filter-select boll${BOLL_PERIODS.some(period => bollFilters[period].length > 0) ? ' selected' : ''}`}
                onClick={() => setFilterPanel('boll')}
              >
                <span className="filter-select-label">BOLL 位置</span>
                <strong>{bollFilterSummary}</strong>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {!error && rows && (
                <span className="filter-result-count" aria-live="polite">
                  共 <strong>{ungroupedItems.length}</strong> 条
                </span>
              )}
            </div>
          </div>
        </div>
        {!error && rows && (
          <div className="sortbar">
            <div className="sortopts">
              <span className="lbl">排序</span>
              {SORT_OPTS.map(o => {
                const active = sort.key === o.key
                const bollLabel = active && o.key === 'bollPosition' ? `轨道${sort.dir === 'asc' ? '下→上' : '上→下'}` : o.label
                return (
                  <button key={o.key} className={`chip${active ? ' active' : ''}`} onClick={() => chooseSort(o.key)}>
                    {bollLabel}{active && o.key !== 'bollPosition' ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                  </button>
                )
              })}
              {hasActiveFilters && <button className="chip clear" onClick={clearFilters}>清除筛选</button>}
              {stockOrder.length > 0 && <button className="chip clear" onClick={clearStockOrder}>清除手排</button>}
            </div>
            {groupBySector && visible.length >= 2 && (
              <button className="chip foldall" onClick={toggleAllCollapse}>
                {allCollapsed ? '全部展开' : '全部折叠'}
              </button>
            )}
            <button
              type="button"
              className={`groupmode${groupBySector ? ' on' : ''}`}
              onClick={toggleGroupBySector}
              aria-label={groupBySector ? '关闭分类' : '打开分类'}
              aria-pressed={groupBySector}
              title={groupBySector ? '关闭分类' : '打开分类'}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                <path d="M5 6h14M5 12h14M5 18h14" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
        {editOrder && <div className="state edit-tip">编辑模式：板块 ↑↓ 调顺序；标的 ↑↓ 手动置顶（手排后该板块按你排的固定，其余按上方排序）；✕ 删除（默认标的可在「添加标的」里恢复）</div>}
        {error && <div className="state">{error}</div>}
        {!error && !rows && <div className="state">加载中…</div>}
        {!error && rows && active === FAV && visible.length === 0 && (
          <div className="state">{hasActiveFilters ? '当前自选中暂无符合筛选条件的标的' : '暂无自选，点击股票右上角的 ★ 添加'}</div>
        )}
        {!error && rows && active !== FAV && hasActiveFilters && visible.length === 0 && (
          <div className="state filter-empty">暂无符合当前条件的标的 <button type="button" onClick={clearFilters}>清除筛选</button></div>
        )}
        {!error && rows && active !== FAV && !hasActiveFilters && active !== ALL && visible.length === 0 && (
          <div className="state">该板块暂无标的</div>
        )}
        {displayGroups.map(({ sector, items }) => {
          const sellOrdinalCount = Math.max(...items.map(r => sellGridFor(r, cfg, yieldStartMap).length))
          const buyOrdinalCount = Math.max(...items.map(r => buyGridFor(r, cfg, yieldStartMap).length))
          const isDenseGrid = sellOrdinalCount === 8 && buyOrdinalCount === 8
          // 窄屏或浏览器放大时保持列宽，以横向滚动代替文字重叠。
          const tableMinWidth = isNarrowDesktop || isDenseGrid
            ? 120 + 384 + (showBoll ? (isMobile ? 264 : 268) : 0) + (sellOrdinalCount + buyOrdinalCount) * (isDenseGrid ? 64 : 56)
            : undefined
          const isCollapsed = groupBySector && collapsed.has(sector)
          // 折叠简介：均息率 / 最高息率个股 / 达买点只数（现息率 ≥ 该股买点门槛）
          const avgCy = items.reduce((s, r) => s + r.cy, 0) / items.length
          const top = items.reduce((a, b) => (b.cy > a.cy ? b : a), items[0])
          const buyCount = items.filter(r => r.cy >= (yieldStartMap.get(r.code)?.buy ?? DEFAULT_BUY_START)).length
          return (
            <section key={sector || 'ungrouped'}>
              {groupBySector && <h2 className="sec-h2" onClick={() => { if (!editOrder) toggleCollapse(sector) }}>
                <span className={`sec-caret${isCollapsed ? ' off' : ''}`} aria-hidden>▾</span>
                {sector} <em>{items.length}</em>
                {editOrder && (
                  <span className="moves" onClick={e => e.stopPropagation()}>
                    <button disabled={order.indexOf(sector) === 0} onClick={() => moveSector(sector, -1)} aria-label="上移">↑</button>
                    <button disabled={order.indexOf(sector) === order.length - 1} onClick={() => moveSector(sector, 1)} aria-label="下移">↓</button>
                  </span>
                )}
              </h2>}
              {isCollapsed && (
                <div className="sec-brief">
                  均息 {(avgCy * 100).toFixed(2)}% · 最高 {top.name} {(top.cy * 100).toFixed(2)}%
                  {buyCount > 0 && <b className="o"> · {buyCount} 只达买点</b>}
                </div>
              )}
              {isCollapsed ? null : isMobile ? (
                <div className="cards">
                  {items.map(r => (
                    <div className="card" key={r.name}>
                      <div className="chead">
                        {editOrder && (
                          <span className="rowops">
                            <button type="button" className="yg-mv" disabled={items[0].code === r.code} onClick={() => moveStock(items, r.code, -1)} aria-label="上移">↑</button>
                            <button type="button" className="yg-mv" disabled={items[items.length - 1].code === r.code} onClick={() => moveStock(items, r.code, 1)} aria-label="下移">↓</button>
                            <button type="button" className="yg-del" onClick={() => removeStock(r.code)} aria-label="删除标的">✕</button>
                          </span>
                        )}
                        <span className="cnm">{r.name}</span>
                        <Star on={favs.has(r.code)} onClick={() => toggleFav(r.code)} />
                      </div>
                      <div className="quote-summary quote-summary-mobile" data-testid={`yield-grid-quote-${r.code}`}>
                        <div className="quote-metric">
                          <small>现价</small>
                          <span className="value-line"><b>{symOf(r.isHK, r.code)}{r.price.toFixed(2)}</b><i className={chgClass(r.pctChg)}>{chgText(r.pctChg)}</i></span>
                        </div>
                        <div className="quote-metric">
                          <small>25年股息</small>
                          <span className="value-line"><b>{+r.dive.toFixed(4)}</b></span>
                        </div>
                        <div className="quote-metric forecast-dividend">
                          <small>26年股息</small>
                          <span className="value-line"><ForecastDividendValue forecast={forecastDividends[r.code]} manual={forecastOverrides[r.code]} isHK={r.isHK} onEdit={() => openForecastEditor(r)} /></span>
                        </div>
                        <div className="quote-metric">
                          <small>{dividendBasis === '2026' ? '26年股息率' : '25年股息率'}</small>
                          <span className={`value-line yield-reading ${cyClass(r.cy)}`}><b>{(r.cy * 100).toFixed(2)}%</b>{r.dividendFallback && <em className="dividend-fallback-mark">沿用25年</em>}</span>
                        </div>
                        <div className="quote-metric">
                          <small>连续分红</small>
                          <span className="value-line"><b>{consecutiveDividendYears[r.code] === undefined || consecutiveDividendYears[r.code] === null ? '--' : `${consecutiveDividendYears[r.code]}年`}</b></span>
                        </div>
                        <div className="quote-metric">
                          <small>25年支付率</small>
                          <span className="value-line"><PayoutValue records={dividendPayouts[r.code]} /></span>
                        </div>
                      </div>
                      {(() => { const lb = lastBuyMap.get(r.code); return lb ? <div className="cmeta">{fmtDate(lb.ts)} {lb.isFirst ? '建仓' : '加仓'} {symOf(r.isHK, r.code)}{lb.price.toFixed(2)} × {lb.qty} 股</div> : null })()}
                      {showBoll && <div className="boll-strip" data-testid={`yield-grid-boll-${r.code}`}>
                        <div className="boll-mobile-head">
                          <span>{BOLL_PERIOD_LABELS[bollPeriod]} BOLL 位置</span>
                          <BollPeriodSwitch value={bollPeriod} onChange={setBollPeriod} />
                        </div>
                        <BollPeriodOverview values={{ day: bollByPeriod.day[r.code], week: bollByPeriod.week[r.code], month: bollByPeriod.month[r.code] }} currentPrice={r.price} loading={bollLoading} unsupported={r.isHK} />
                        {bollPeriod === 'month' && !r.isHK && <div className="boll-month-note">{bollByCode[r.code]?.periodDate ? `截至 ${bollByCode[r.code].periodDate.slice(5)} · ` : ''}本月未完</div>}
                        <WeeklyBollPosition boll={bollByCode[r.code]} symbol={symOf(r.isHK, r.code)} currentPrice={r.price} dividend={r.gridDividend} loading={Boolean(bollLoading[bollPeriod]) && !r.isHK} compact period={bollPeriod} unavailableText={r.isHK ? '港股暂不支持 BOLL' : undefined} />
                      </div>}
                      {sellOrdinalCount > 0 && <>
                        <div className="glabel sell">卖出网格</div>
                        <div className="tiers">
                          {sellGridFor(r, cfg, yieldStartMap).map(y => <Chip key={'s' + y} r={r} y={y} kind="sell" cfg={cfg} starts={yieldStartMap} />)}
                        </div>
                      </>}
                      {buyOrdinalCount > 0 && <>
                        <div className="glabel buy">买入网格</div>
                        <div className="tiers">
                          {buyGridFor(r, cfg, yieldStartMap).map(y => <Chip key={'b' + y} r={r} y={y} kind="buy" cfg={cfg} starts={yieldStartMap} />)}
                        </div>
                      </>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="tablewrap">
                  <table className={`${editOrder ? 'editing ' : ''}${isDenseGrid ? 'dense-grid' : ''}`} style={tableMinWidth ? { minWidth: tableMinWidth } : undefined}>
                    <thead>
                      <>
                        <tr>
                          <th rowSpan={2}>股票</th>
                          <th rowSpan={2} className="quote-summary-head">
                            <span className="quote-summary-title">价格与股息</span>
                            <span className="quote-summary-labels"><i>现价</i><i>25年股息</i><i>26年股息 <button type="button" className="forecast-help-icon" aria-label="查看26年股息预测算法" onClick={() => setInfoModal('forecast')}>?</button></i><i>{dividendBasis === '2026' ? '26年股息率' : '25年股息率'}</i></span>
                          </th>
                          <th rowSpan={2} className="dividend-quality-head">
                            <span className="quote-summary-title">分红质量</span>
                            <span className="dividend-quality-labels"><i>连续分红</i><i>25年支付率</i></span>
                          </th>
                          {showBoll && <th rowSpan={2} className="th-boll-position">
                            <span>{BOLL_PERIOD_LABELS[bollPeriod]} BOLL 位置</span>
                            <BollPeriodSwitch value={bollPeriod} onChange={setBollPeriod} compact />
                          </th>}
                          {sellOrdinalCount > 0 && <th colSpan={sellOrdinalCount} className="ordinal-group sell">卖出网格</th>}
                          {buyOrdinalCount > 0 && <th colSpan={buyOrdinalCount} className="ordinal-group buy sep">买入网格</th>}
                        </tr>
                        <tr>
                          {Array.from({ length: sellOrdinalCount }, (_, i) => <th key={'os' + i} className="ordinal-slot sell">卖出{ORDINAL_MARKS[i]}</th>)}
                          {Array.from({ length: buyOrdinalCount }, (_, i) => <th key={'ob' + i} className={`ordinal-slot buy${i === 0 ? ' sep' : ''}`}>买入{ORDINAL_MARKS[i]}</th>)}
                        </tr>
                      </>
                    </thead>
                    <tbody>
                      {items.map(r => (
                        <tr key={r.name}>
                          <td className="nm" title={r.name}>{editOrder && (
                            <span className="rowops">
                              <button type="button" className="yg-mv" disabled={items[0].code === r.code} onClick={() => moveStock(items, r.code, -1)} aria-label="上移">↑</button>
                              <button type="button" className="yg-mv" disabled={items[items.length - 1].code === r.code} onClick={() => moveStock(items, r.code, 1)} aria-label="下移">↓</button>
                              <button type="button" className="yg-del" onClick={() => removeStock(r.code)} aria-label="删除标的">✕</button>
                            </span>
                          )}<span className="stock-name-line" data-stock-name={r.name}><Star on={favs.has(r.code)} onClick={() => toggleFav(r.code)} /><span className="stock-name-text">{r.name}</span></span>{(() => { const lb = lastBuyMap.get(r.code); return lb ? <><br /><span className="dv" style={{ fontSize: '11px', fontWeight: 400 }}>{fmtDate(lb.ts)} {lb.isFirst ? '建仓' : '加仓'} <br />{symOf(r.isHK, r.code)}{lb.price.toFixed(2)} × {lb.qty} 股</span></> : null })()}</td>
                          <td className="quote-summary-cell" data-testid={`yield-grid-quote-${r.code}`}>
                            <div className="quote-summary">
                              <div className="quote-metric">
                                <span className="value-line"><b>{symOf(r.isHK, r.code)}{r.price.toFixed(2)}</b><i className={chgClass(r.pctChg)}>{chgText(r.pctChg)}</i></span>
                              </div>
                              <div className="quote-metric"><span className="value-line"><b>{+r.dive.toFixed(4)}</b></span></div>
                              <div className="quote-metric forecast-dividend"><span className="value-line"><ForecastDividendValue forecast={forecastDividends[r.code]} manual={forecastOverrides[r.code]} isHK={r.isHK} onEdit={() => openForecastEditor(r)} /></span></div>
                              <div className="quote-metric"><span className={`value-line yield-reading ${cyClass(r.cy)}`}><b>{(r.cy * 100).toFixed(2)}%</b>{r.dividendFallback && <em className="dividend-fallback-mark">沿用25年</em>}</span></div>
                            </div>
                          </td>
                          <td className="dividend-quality-cell">
                            <div className="dividend-quality">
                              <div className="quote-metric"><span className="value-line"><b>{consecutiveDividendYears[r.code] === undefined || consecutiveDividendYears[r.code] === null ? '--' : `${consecutiveDividendYears[r.code]}年`}</b></span></div>
                              <div className="quote-metric"><span className="value-line"><PayoutValue records={dividendPayouts[r.code]} /></span></div>
                            </div>
                          </td>
                          {showBoll && <td className="boll-position-cell" data-testid={`yield-grid-boll-${r.code}`}>
                            <BollPeriodOverview values={{ day: bollByPeriod.day[r.code], week: bollByPeriod.week[r.code], month: bollByPeriod.month[r.code] }} currentPrice={r.price} loading={bollLoading} unsupported={r.isHK} compact />
                            {bollPeriod === 'month' && !r.isHK && <div className="boll-month-note">{bollByCode[r.code]?.periodDate ? `截至 ${bollByCode[r.code].periodDate.slice(5)} · ` : ''}本月未完</div>}
                            <WeeklyBollPosition boll={bollByCode[r.code]} symbol={symOf(r.isHK, r.code)} currentPrice={r.price} dividend={r.gridDividend} loading={Boolean(bollLoading[bollPeriod]) && !r.isHK} compact period={bollPeriod} unavailableText={r.isHK ? '港股暂不支持 BOLL' : undefined} />
                          </td>}
                          {Array.from({ length: sellOrdinalCount }, (_, i) => <OrdinalCell key={'os' + i} r={r} y={sellGridFor(r, cfg, yieldStartMap)[i]} kind="sell" cfg={cfg} starts={yieldStartMap} />)}
                          {Array.from({ length: buyOrdinalCount }, (_, i) => <OrdinalCell key={'ob' + i} r={r} y={buyGridFor(r, cfg, yieldStartMap)[i]} kind="buy" sep={i === 0} cfg={cfg} starts={yieldStartMap} />)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )
        })}

        {!error && rows && (
          <div className="yg-footer">
            <div className="ft-left">
              <button type="button" className={`like-btn${liked ? ' liked' : ''}`} onClick={onLike} disabled={liked || liking} aria-label="点赞">
                <span className="ic">👍</span>
                <span className="n">{likes == null ? '…' : likes}</span>
              </button>
              <div className="lt">{liked ? '感谢点赞 ❤' : '觉得有用？点个赞'}</div>
            </div>
            <div className="ft-div" />
            <button onClick={() => navigate('/support')} className="ft-right">
              <span className="text-base">☕</span>
              <span className="text-sm text-gray-500">支持与联系</span>
              <svg className="w-4 h-4 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        )}

        <Modal open={forecastEditor !== null} onClose={() => setForecastEditor(null)} title="修改 26 年股息">
          {forecastEditor && (
            <div className="forecast-editor pb-2">
              <div className="forecast-editor-head">
                <div className="text-base font-semibold text-gray-800">{forecastEditor.name}</div>
                <div className="mt-1 text-xs text-gray-400">
                  原算法预测：{typeof forecastDividends[forecastEditor.code] === 'number' ? +forecastDividends[forecastEditor.code]!.toFixed(4) : '暂无'} 元/股 · 版本 {DIVIDEND_FORECAST_MODEL_VERSION}
                </div>
              </div>

              {forecastDetailLoading && <div className="forecast-editor-loading">正在加载近三年预测明细…</div>}
              {forecastDetailError && <div className="forecast-editor-error">{forecastDetailError}，仍可在下方直接修改最终股息。</div>}

              {forecastDetail && <div className="forecast-assumptions">
                <section className="forecast-assumption-card">
                  <div className="forecast-assumption-title"><b>1</b><span>预计全年利润</span></div>
                  <div className="forecast-data-table profit-table">
                    <div className="forecast-data-head"><span>年度</span><span>上半年</span><span>全年</span><span>上半年占比</span></div>
                    {[...forecastDetail.seasonality].sort((a, b) => a.year - b.year).map(item => (
                      <div className="forecast-data-row" key={item.year}>
                        <b>{item.year}</b>
                        <span>{compactNumber(toBillion(item.h1Profit))}亿</span>
                        <span>{compactNumber(toBillion(item.annualProfit))}亿</span>
                        <strong>{compactNumber(item.ratio * 100)}%</strong>
                      </div>
                    ))}
                    <div className="forecast-data-row forecast-data-estimate">
                      <b>2026E</b>
                      <span>{compactNumber(toBillion(forecastDetail.h1Profit))}亿</span>
                      <span>{compactNumber(Number(annualProfitInput))}亿</span>
                      <strong>{compactNumber((editorProfitRatio ?? 0) * 100)}%</strong>
                    </div>
                  </div>
                  <div className="forecast-control-row">
                    <label>比例取值
                      <select value={profitRatioChoice} onChange={event => selectProfitRatio(event.target.value as ProfitRatioChoice)}>
                        {profitRatioChoice === 'manual' && <option value="manual">手动反推（{compactNumber((editorProfitRatio ?? 0) * 100)}%）</option>}
                        <option value="median">中位数（{compactNumber(medianOf(forecastDetail.seasonality.map(item => item.ratio)) * 100)}%，推荐）</option>
                        <option value="average">平均值（{compactNumber(averageOf(forecastDetail.seasonality.map(item => item.ratio)) * 100)}%）</option>
                        {[...forecastDetail.seasonality].sort((a, b) => b.year - a.year).map(item => (
                          <option value={String(item.year)} key={item.year}>{item.year} 年（{compactNumber(item.ratio * 100)}%）</option>
                        ))}
                      </select>
                    </label>
                    <label>预计全年利润
                      <div className="forecast-number-input"><input type="number" inputMode="decimal" min="0.01" step="0.01" value={annualProfitInput} onChange={event => changeAnnualProfit(event.target.value)} /><i>亿元</i></div>
                    </label>
                  </div>
                  <div className="forecast-inline-formula">
                    <span>2026 上半年利润 {compactNumber(toBillion(forecastDetail.h1Profit))} 亿元</span>
                    <i>÷</i><span>{compactNumber((editorProfitRatio ?? 0) * 100)}%</span>
                    <i>=</i><strong>{compactNumber(Number(annualProfitInput))} 亿元</strong>
                  </div>
                </section>

                <section className="forecast-assumption-card">
                  <div className="forecast-assumption-title"><b>2</b><span>预计股息支付率</span></div>
                  <div className="forecast-payout-years">
                    {[...forecastDetail.payouts].sort((a, b) => a.year - b.year).map(item => (
                      <div key={item.year}>
                        <span>{item.year}</span>
                        <p><i>实际股息</i><b>{typeof item.dividendPerShare === 'number' ? item.dividendPerShare.toFixed(3) : '--'}<small>元/股</small></b></p>
                        <p><i>派息率</i><strong>{compactNumber(item.payoutRatio)}%</strong></p>
                        <div className="forecast-payout-track" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, item.payoutRatio))}%` }} /></div>
                      </div>
                    ))}
                  </div>
                  <div className="forecast-choice-grid">
                    {([
                      ['average', '平均值', forecastDetail.payoutAverage],
                      ['median', '中位数', forecastDetail.payoutMedian],
                      ['latest', '最近一年', forecastDetail.payoutLatest],
                    ] as [PayoutMethod, string, number][]).map(([key, label, value]) => (
                      <button type="button" key={key} className={editorPayoutChoice === key ? 'active' : ''} onClick={() => selectEditorPayout(key)}>
                        <span>{label}{forecastDetail.systemPayoutMethod === key ? <em>推荐</em> : null}</span>
                        <b>{compactNumber(value * 100)}%</b>
                      </button>
                    ))}
                  </div>
                </section>

                <div className="forecast-result-summary">
                  {forecastDetail.forecastMethod === 'policy' && forecastDetail.commitment && (
                    <div className="forecast-announcement">
                      <div className="forecast-announcement-head">
                        <span>承诺重点</span>
                        <b>{forecastDetail.commitment.sourceName}</b>
                        <a href={forecastDetail.commitment.eastmoneySourceUrl || forecastDetail.commitment.sourceUrl} target="_blank" rel="noreferrer">查看公告全文</a>
                      </div>
                      <div className="forecast-announcement-highlights">
                        {commitmentHighlights(forecastDetail.commitment).map(item => <strong key={item}>{item}</strong>)}
                      </div>
                      <small>{forecastDetail.commitment.startYear}–{forecastDetail.commitment.endYear} 年有效{forecastDetail.commitment.conditions.length ? ` · 适用条件：${forecastDetail.commitment.conditions.join('；')}` : ''}</small>
                    </div>
                  )}

                  <div className="forecast-calculation-lines">
                    <div className="forecast-calculation-line profit">
                      <b className="forecast-calculation-label">利润模型</b>
                      <span>26H1 利润 {compactNumber(toBillion(forecastDetail.h1Profit))} 亿</span><i>÷</i>
                      <span>{profitRatioChoiceLabel(profitRatioChoice)} {compactNumber((editorProfitRatio ?? 0) * 100)}%</span><i>×</i>
                      <span>{PAYOUT_METHOD_LABELS[editorPayoutChoice]} {compactNumber((editorPayout ?? 0) * 100)}%</span><i>÷</i>
                      <span>权益股本 {compactNumber(toBillion(forecastDetail.shares), 3)} 亿股</span><em>=</em>
                      <strong>{editorCalculatedDps === null ? '--' : compactNumber(editorCalculatedDps, 4)} 元/股</strong>
                      <small>{editorAdjustments.length ? '当前联动' : forecastDetail.forecastMethod === 'profit' ? '原算法采用' : '参考'}</small>
                    </div>

                    {forecastDetail.forecastMethod === 'policy' && forecastDetail.commitment && (
                      <div className="forecast-calculation-line policy">
                        <b className="forecast-calculation-label">政策下限</b>
                        {editorPolicyRatioDps !== null && <span>比例下限 {compactNumber(forecastDetail.commitment.minPayoutRatio! * 100)}% × {compactNumber(toBillion(editorAnnualProfit))} 亿 ÷ {compactNumber(toBillion(forecastDetail.shares), 3)} 亿股 = {compactNumber(editorPolicyRatioDps, 4)} 元/股</span>}
                        {forecastDetail.commitment.minDps !== undefined && <span>每股下限 {compactNumber(forecastDetail.commitment.minDps, 4)} 元/股</span>}
                        {originalPolicyCashDps !== null && <span>现金下限 {compactNumber(toBillion(forecastDetail.commitment.minCashAmount!))} 亿 ÷ {compactNumber(toBillion(forecastDetail.shares), 3)} 亿股 = {compactNumber(originalPolicyCashDps, 4)} 元/股</span>}
                        <em>→ 取较高值</em><strong>{compactNumber(editorPolicyDpsFloor ?? 0, 4)} 元/股</strong><small>{editorAdjustments.length ? '同步测算' : '原算法采用'}</small>
                      </div>
                    )}

                    {forecastDetail.forecastMethod === 'interim' && (
                      <div className="forecast-calculation-line interim">
                        <b className="forecast-calculation-label">中期息锚定</b>
                        <span>按中期分红相对上年同期的变化折算全年</span><em>=</em><strong>{compactNumber(forecastDetail.interimAnchor ?? 0, 4)} 元/股</strong><small>原算法采用</small>
                      </div>
                    )}
                  </div>

                  {forecastDetail.forecastMethod !== 'profit' && (
                    <p className="forecast-adjustment-note"><b>当前参数调整：</b>{editorAdjustments.length
                      ? `${editorAdjustments.join('；')}。最终值已按利润法联动重算为 ${editorCalculatedDps === null ? '--' : compactNumber(editorCalculatedDps, 4)} 元/股，本次联动不继续套用原政策下限或中期息锚定。`
                      : `尚未调整上方参数。修改上半年占比、预计全年利润或股息支付率后，最终值才会按利润法联动重算。`}</p>
                  )}
                </div>
              </div>}

              <section className="forecast-final-card">
                <div><strong>最终采用的 26 年每股股息</strong><span>可直接修改绝对值</span></div>
                <div className="forecast-final-input">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.0001"
                    step="0.0001"
                    value={forecastEditor.input}
                    onChange={event => setForecastEditor(current => current ? { ...current, input: event.target.value } : null)}
                    onKeyDown={event => { if (event.key === 'Enter') saveForecastOverride() }}
                  />
                  <i>元/股</i>
                </div>
              </section>

              <div className="forecast-editor-actions">
                {forecastOverrides[forecastEditor.code] !== undefined && (
                  <button type="button" className="restore" onClick={restoreForecastValue}>恢复算法预测</button>
                )}
                <button type="button" className="save" onClick={saveForecastOverride}>保存最终值</button>
              </div>
              <div className="forecast-editor-note">手动值优先于算法预测；登录后会同步到账号，未登录时保存在当前浏览器。<button type="button" className="forecast-help-link ml-1" onClick={() => { setForecastEditor(null); setInfoModal('forecast') }}>查看算法说明</button></div>
            </div>
          )}
        </Modal>

        <Modal
          open={infoModal !== null}
          onClose={() => setInfoModal(null)}
          title={infoModal === 'forecast' ? '26 年股息如何预测' : infoModal === 'boll' ? 'BOLL 如何计算' : '数据与信号说明'}
        >
          {infoModal === 'forecast' && <div className="forecast-method-info">
            <section>
              <strong>1. 估算全年利润</strong>
              <p>使用 2026 年中报归母净利润，并参考 2023—2025 年“上半年利润 ÷ 全年利润”的中位数，推算 2026 年全年利润。</p>
            </section>
            <section>
              <strong>2. 选择派息率</strong>
              <p>读取最近三年的常规现金派息率。通常采用平均值；历史波动较大时采用中位数；利润明显增长且最新派息率偏低时采用最近一年值。</p>
            </section>
            <section>
              <strong>3. 比较三种预测</strong>
              <p><b>利润法：</b>预计全年利润 × 派息率 ÷ 最新股本。</p>
              <p><b>中期息法：</b>按中期股息同比变化推算全年股息；当结果比利润法低 10% 以上时，自动采用这一较保守结果。</p>
              <p><b>政策法：</b>公司存在可量化且适用的分红承诺时，计算承诺下限；若高于前述预测，则采用政策下限。</p>
            </section>
            <div className="forecast-method-meta">
              <span>当前算法版本：{DIVIDEND_FORECAST_MODEL_VERSION}</span>
              <span>金额口径：人民币税前元/股</span>
            </div>
            <p className="forecast-method-caution">通用算法预测不一定准确，个人务必仔细分析、审核和校准，确认后再使用。</p>
            <p className="forecast-method-risk">预测依赖已披露数据和历史规律，可能因下半年业绩、股本变化、特别分红及分红政策调整而与实际派息存在差异。仅供参考，不构成投资建议。</p>
          </div>}
          {infoModal === 'boll' && <div className="forecast-method-info">
            <section>
              <strong>计算口径</strong>
              <p>采用前复权日线、周线和月线，参数为 BOLL(20,2)，标准差使用样本标准差。</p>
            </section>
            <section>
              <strong>周期说明</strong>
              <p>可切换日、周、月周期查看价格所处位置。月线包含本月尚未完成的月 K 线，因此盘中位置可能继续变化。</p>
            </section>
            <section>
              <strong>位置含义</strong>
              <p>页面展示现价相对上轨、中轨和下轨的位置及距离，用于辅助观察价格区间，不代表趋势一定延续或反转。</p>
            </section>
          </div>}
          {infoModal === 'data' && <div className="forecast-method-info">
            <section>
              <strong>行情与缓存</strong>
              <p>行情、BOLL 和股息数据分别更新并使用本地缓存。盘中显示可能短暂落后于最新成交数据。</p>
            </section>
            <section>
              <strong>网格信号</strong>
              <p>“已达”表示现价已触及对应档位；未触及时显示到达该档位仍需上涨或下跌的幅度。颜色越深，表示触及的档位越深。</p>
            </section>
            <section>
              <strong>个性化设置</strong>
              <p>每只股票的起始股息率可在“网格设置”中单独调整；登录后相关设置和 26 年股息修改值会同步到账号。</p>
            </section>
            <p className="forecast-method-risk">页面数据和信号仅供参考，不构成任何投资建议。</p>
          </div>}
        </Modal>

        <Modal
          open={showAdd}
          onClose={() => { setShowAdd(false); setQ(''); setResults([]); setAddForm({ name: '', code: '', sector: '', dive: '', isHK: false }) }}
          title="添加标的（A股 / 港股）"
        >
          <div className="space-y-3 pb-2">
            <div className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">最多添加 {MAX_CUSTOM} 个自定义标的（当前 {custom.length}/{MAX_CUSTOM}），不需要的可在下方删除后再加。</div>
            <div>
              <input className="input-field" placeholder="输入名称或代码搜索 A 股 / 港股" value={q} onChange={e => setQ(e.target.value)} />
              {searching && (
                <div className="mt-2 flex items-center gap-2 text-xs text-gray-400 px-1">
                  <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-red-500 rounded-full animate-spin" />
                  搜索中…
                </div>
              )}
              {!searching && results.length > 0 && (
                <div className="mt-1 border border-gray-100 rounded-lg overflow-hidden">
                  {results.map(r => (
                    <button key={r.code} className="w-full text-left px-3 py-2 text-sm flex justify-between active:bg-gray-50" onClick={() => selectResult(r)}>
                      <span className="text-gray-800">{r.name}{r.isHK ? <span className="text-gray-400 ml-1">HK</span> : /^[29]00/.test(String(r.code)) ? <span className="text-gray-400 ml-1">B</span> : null}</span><span className="text-gray-400">{r.code}</span>
                    </button>
                  ))}
                </div>
              )}
              {!searching && q.trim().length >= 1 && results.length === 0 && (
                <div className="mt-2 text-xs text-gray-400 px-1">未找到匹配的 A 股 / 港股</div>
              )}
            </div>

            {addForm.code && (
              <div className="space-y-3 bg-gray-50 rounded-xl p-3">
                <div className="text-sm font-semibold text-gray-800">{addForm.name} <span className="text-gray-400 font-normal">{addForm.code}</span></div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 block mb-1">板块</label>
                    <select className="input-field text-sm" value={addForm.sector} onChange={e => setAddForm(f => ({ ...f, sector: e.target.value }))}>
                      {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 block mb-1">每股股息(25年)</label>
                    <input className="input-field text-sm" type="text" inputMode="decimal" placeholder="自动预填，可改" value={addForm.dive} onChange={e => setAddForm(f => ({ ...f, dive: e.target.value }))} />
                  </div>
                </div>
                <button className="w-full py-2.5 bg-red-600 text-white rounded-lg text-sm font-semibold disabled:opacity-40" disabled={!(parseFloat(addForm.dive) > 0)} onClick={confirmAdd}>确认添加</button>
              </div>
            )}

            {custom.length > 0 && (
              <div>
                <div className="text-xs text-gray-400 mb-1">已添加（{custom.length}）</div>
                <div className="space-y-1">
                  {custom.map(c => (
                    <div key={c.code} className="flex items-center justify-between text-sm px-2 py-1.5 bg-gray-50 rounded-lg">
                      <span className="text-gray-700">{c.name} <span className="text-gray-400 text-xs">{c.code} · {c.sector} · {symOf(c.isHK, c.code)}{c.dive}</span></span>
                      <button className="text-red-500 text-xs px-2" onClick={() => deleteCustom(c.code)}>删除</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hiddenStocks.length > 0 && (
              <div>
                <div className="text-xs text-gray-400 mb-1">已删除的默认标的（{hiddenStocks.length}）</div>
                <div className="space-y-1">
                  {hiddenStocks.map(s => (
                    <div key={s.code} className="flex items-center justify-between text-sm px-2 py-1.5 bg-gray-50 rounded-lg">
                      <span className="text-gray-700">{s.name} <span className="text-gray-400 text-xs">{s.code} · {s.sector} · ¥{s.dive}</span></span>
                      <button className="text-blue-500 text-xs px-2" onClick={() => restoreStock(s.code)}>恢复</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>

        <Modal
          open={filterPanel === 'yield'}
          onClose={() => setFilterPanel(null)}
          title="股息率状态"
          headerRight={yieldFilter !== 'all' ? <button type="button" className="filter-clear" onClick={() => setYieldFilter('all')}>清除</button> : undefined}
        >
          <div className="yield-filter-list">
            {YIELD_FILTER_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                className={`yield-filter-option${yieldFilter === option.value ? ' selected' : ''}`}
                onClick={() => { setYieldFilter(option.value); setFilterPanel(null) }}
              >
                <span className="filter-radio" aria-hidden="true" />
                <span><strong>{option.label}</strong><small>{option.description}</small></span>
              </button>
            ))}
          </div>
        </Modal>

        <Modal
          open={filterPanel === 'boll'}
          onClose={() => setFilterPanel(null)}
          title="多周期 BOLL 位置"
          headerRight={BOLL_PERIODS.some(period => bollFilters[period].length > 0) ? <button type="button" className="filter-clear" onClick={() => setBollFilters({ ...EMPTY_BOLL_FILTERS })}>清除</button> : undefined}
        >
          <div className="boll-filter-panel">
            <p>每个周期可多选，同周期满足任一位置即可；多个周期之间同时满足。中附近按设置的中轨上下偏差判断。</p>
            {BOLL_PERIODS.map(period => (
              <div className="boll-filter-period" key={period}>
                <div className="boll-filter-period-head">
                  <strong>{BOLL_PERIOD_LABELS[period]}线</strong>
                  {period === 'month' && <span>本月未完</span>}
                </div>
                <div className="boll-filter-grid" role="group" aria-label={`${BOLL_PERIOD_LABELS[period]}线 BOLL 位置`}>
                  <button
                    type="button"
                    className={bollFilters[period].length === 0 ? 'selected' : ''}
                    onClick={() => setBollFilters(current => ({ ...current, [period]: [] }))}
                  >不限</button>
                  {BOLL_FILTER_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      className={bollFilters[period].includes(option.value) ? 'selected' : ''}
                      title={option.label}
                      onClick={() => {
                        setBollFilters(current => {
                          const selected = current[period]
                          return {
                            ...current,
                            [period]: selected.includes(option.value)
                              ? selected.filter(value => value !== option.value)
                              : [...selected, option.value],
                          }
                        })
                        void loadBollPeriod(period)
                      }}
                    >{option.short}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Modal>

        <Modal open={showCfg} onClose={() => setShowCfg(false)} title="网格设置">
          <div className="space-y-4 pb-2">
            <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3">
              <div className="text-sm font-semibold text-violet-800">股息计算基准</div>
              <div className="mt-1 text-xs leading-relaxed text-violet-600/80">同步用于股息率、排序筛选、买卖网格价格及“已达”判定。</div>
              <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-white p-1">
                {(['2025', '2026'] as DividendBasis[]).map(year => (
                  <button
                    key={year}
                    type="button"
                    aria-pressed={dividendBasis === year}
                    onClick={() => updateDividendBasis(year)}
                    className={`rounded-md px-2 py-2 text-sm font-semibold transition-colors ${dividendBasis === year ? 'bg-violet-600 text-white shadow-sm' : 'text-gray-500'}`}
                  >
                    {year === '2025' ? '25年股息' : '26年预测股息'}
                  </button>
                ))}
              </div>
              {dividendBasis === '2026' && <div className="mt-2 text-[11px] leading-relaxed text-amber-700">没有 26 年预测值的股票会自动沿用 25 年股息，并在股息率下方标记。</div>}
            </div>
            <div className="space-y-3 bg-orange-50/60 rounded-xl p-3">
              <div className="text-sm font-semibold text-orange-700">买入网格</div>
              <div>
                <div className="text-xs text-gray-400 mb-1.5">步长</div>
                <div className="flex gap-2">
                  {STEP_OPTIONS.map(s => (
                    <button key={s} onClick={() => updateCfg({ buyStep: s })}
                      className={`flex-1 py-2 rounded-lg text-sm border ${cfg.buyStep === s ? 'bg-red-600 text-white border-red-600' : 'border-gray-200 text-gray-600'}`}>
                      {+(s * 100).toFixed(2)}%
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1.5">档数</div>
                <div className="flex gap-2">
                  {COUNT_OPTIONS.map(c => (
                    <button key={c} onClick={() => updateCfg({ buyCount: c })}
                      className={`flex-1 py-2 rounded-lg text-sm border ${cfg.buyCount === c ? 'bg-red-600 text-white border-red-600' : 'border-gray-200 text-gray-600'}`}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-3 bg-green-50/60 rounded-xl p-3">
              <div className="text-sm font-semibold text-green-700">卖出网格</div>
              <div>
                <div className="text-xs text-gray-400 mb-1.5">步长</div>
                <div className="flex gap-2">
                  {STEP_OPTIONS.map(s => (
                    <button key={s} onClick={() => updateCfg({ sellStep: s })}
                      className={`flex-1 py-2 rounded-lg text-sm border ${cfg.sellStep === s ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 text-gray-600'}`}>
                      {+(s * 100).toFixed(2)}%
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1.5">档数</div>
                <div className="flex gap-2">
                  {COUNT_OPTIONS.map(c => (
                    <button key={c} onClick={() => updateCfg({ sellCount: c })}
                      className={`flex-1 py-2 rounded-lg text-sm border ${cfg.sellCount === c ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 text-gray-600'}`}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50/70 p-3">
              <div>
                <div className="text-sm font-semibold text-gray-800">显示 BOLL 列</div>
                <div className="mt-0.5 text-xs text-gray-400">关闭后隐藏 BOLL 指标，网格表更紧凑。</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showBoll}
                onClick={() => updateShowBoll(!showBoll)}
                className={`relative h-6 w-11 rounded-full transition-colors ${showBoll ? 'bg-red-600' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${showBoll ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50/70 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-gray-800">筛选判定设置</div>
                <button type="button" className="text-xs text-gray-500 underline underline-offset-2" onClick={resetFilterThresholds}>恢复默认</button>
              </div>
              <div className="space-y-2">
                <div>
                  <div className="text-xs font-medium text-gray-600">BOLL 轨道区域范围</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-gray-400">下轨仅向上计算，跌破后不限；中轨上下计算；上轨仅向下计算，突破后不限。</div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ['下轨上方', 'lowerTolerance'],
                    ['中轨上下', 'middleTolerance'],
                    ['上轨下方', 'upperTolerance'],
                  ] as const).map(([label, key]) => (
                    <label key={key} className="text-xs text-gray-500">
                      {label}（%）
                      <input className="input-field mt-1 text-sm" type="number" inputMode="decimal" min="0.25" max="3" step="0.25"
                        value={+(cfg[key] * 100).toFixed(2)}
                        onChange={e => updateCfg({ [key]: Math.max(0.25, Math.min(3, Number(e.target.value))) / 100 })} />
                    </label>
                  ))}
                </div>
              </div>
              <div className="border-t border-gray-200 pt-3">
                <label className="block text-xs text-gray-500">
                  <span className="font-medium text-gray-600">股息率买卖点区域范围（百分点）</span>
                  <input className="input-field mt-1 text-sm" type="number" inputMode="decimal" min="0.05" max="0.5" step="0.05"
                    value={+(cfg.yieldTolerance * 100).toFixed(2)}
                    onChange={e => updateCfg({ yieldTolerance: Math.max(0.05, Math.min(0.5, Number(e.target.value))) / 100 })} />
                </label>
                <div className="mt-2 text-xs leading-relaxed text-gray-400">买点区向买点下方扩展，达到买点后不限；卖点区向卖点上方扩展，达到卖点后不限。默认 0.25。</div>
              </div>
            </div>
            <div className="text-xs text-gray-400 leading-relaxed">
              未单独设置的标的，买入从 5% 起每档 +{+(cfg.buyStep * 100).toFixed(2)}% 共 {cfg.buyCount} 档；卖出从 4% 起每档 −{+(cfg.sellStep * 100).toFixed(2)}% 共 {cfg.sellCount} 档（收益率 ≤0 的档位自动省略）。
            </div>
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <div>
                <div className="text-sm font-semibold text-slate-800">标的股息率起始点</div>
                <div className="mt-1 text-xs leading-relaxed text-slate-500">单独设置后，该标的的买入、卖出网格及股息率状态筛选都会按此起始点计算。</div>
              </div>
              <div className="space-y-2">
                {configuredYieldStarts.map(item => (
                  <div key={item.code} className="rounded-lg border border-slate-200 bg-white p-2.5">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-slate-700">{item.name}</span>
                      <button type="button" className="text-xs text-slate-400 underline underline-offset-2" onClick={() => updateYieldStarts(yieldStarts.filter(entry => entry.code !== item.code))}>移除</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs text-orange-700">买入起始点（%）
                        <input className="input-field mt-1 text-sm" type="number" inputMode="decimal" min="0.1" max="30" step="0.1"
                          value={+(item.buy * 100).toFixed(2)}
                          onChange={e => setYieldStart(item.code, { buy: Math.max(0.1, Math.min(30, Number(e.target.value) || 0.1)) / 100 })} />
                      </label>
                      <label className="text-xs text-green-700">卖出起始点（%）
                        <input className="input-field mt-1 text-sm" type="number" inputMode="decimal" min="0.1" max="30" step="0.1"
                          value={+(item.sell * 100).toFixed(2)}
                          onChange={e => setYieldStart(item.code, { sell: Math.max(0.1, Math.min(30, Number(e.target.value) || 0.1)) / 100 })} />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              {yieldStarts.length >= MAX_YIELD_STARTS ? (
                <div className="text-xs text-slate-400">最多设置 {MAX_YIELD_STARTS} 个标的，移除后可继续新增。</div>
              ) : availableYieldStartStocks.length > 0 && <div className="space-y-2">
                <div className="flex gap-2">
                  <select className="input-field min-w-0 flex-1 text-sm" value={yieldStartCode} onChange={e => setYieldStartCode(e.target.value)}>
                    <option value="">选择网格标的</option>
                    {availableYieldStartStocks.map(stock => <option key={stock.code} value={stock.code}>{stock.name}（{stock.code}）</option>)}
                  </select>
                  <button type="button" disabled={!yieldStartCode} onClick={addYieldStart}
                    className="shrink-0 rounded-lg bg-slate-700 px-3 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40">新增</button>
                </div>
              </div>}
            </div>
          </div>
        </Modal>
        <Toast message={message} />
      </div>
    </div>
  )
}

// 自选星标
function Star({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`fav${on ? ' on' : ''}`} onClick={onClick} aria-label={on ? '取消自选' : '加入自选'}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round">
        <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
      </svg>
    </button>
  )
}

// 桌面表格按第几档对齐，百分比放回每只股票自己的单元格内。
function OrdinalCell({ r, y, kind, sep, cfg, starts }: { r: Row; y?: number; kind: 'buy' | 'sell'; sep?: boolean; cfg: GridCfg; starts: Map<string, YieldStart> }) {
  if (y === undefined) return <td className={`g ordinal blank${sep ? ' sep' : ''}`} />
  const t = tier(r, y, kind)
  const kindClass = kind === 'sell' ? ' sell' : ' buy'
  if (kind === 'sell' && SELL_MUTED.has(r.name)) {
    return (
      <td className={`g ordinal muted${kindClass}${sep ? ' sep' : ''}`}>
        <i>{fmtPct(y)}</i><b>{symOf(r.isHK, r.code)}{t.target.toFixed(2)}</b>
      </td>
    )
  }
  const grid = kind === 'buy' ? buyGridFor(r, cfg, starts) : sellGridFor(r, cfg, starts)
  const cls = `g ordinal${kindClass}${t.reached ? ' hit' : ''}${sep ? ' sep' : ''}`
  return (
    <td className={cls} style={t.reached ? { background: hitBg(kind, y, grid) } : undefined}>
      <i>{fmtPct(y)}</i><b>{symOf(r.isHK, r.code)}{t.target.toFixed(2)}</b><span>{t.label}</span>
    </td>
  )
}

// 卡片档位 chip
function Chip({ r, y, kind, cfg, starts }: { r: Row; y: number; kind: 'buy' | 'sell'; cfg: GridCfg; starts: Map<string, YieldStart> }) {
  const t = tier(r, y, kind)
  // 广核/核电卖出：仅显示价格，不着色、不判已达
  if (kind === 'sell' && SELL_MUTED.has(r.name)) {
    return (
      <div className="tier sell muted">
        <i>{fmtPct(y)}</i>
        <b>{symOf(r.isHK, r.code)}{t.target.toFixed(2)}</b>
      </div>
    )
  }
  const grid = kind === 'buy' ? buyGridFor(r, cfg, starts) : sellGridFor(r, cfg, starts)
  const cls = `tier${kind === 'sell' ? ' sell' : ''}${t.reached ? ' hit' : ''}`
  const bg = hitBg(kind, y, grid)
  return (
    <div className={cls} style={t.reached ? { background: bg, borderColor: bg } : undefined}>
      <i>{fmtPct(y)}</i>
      <b>{symOf(r.isHK, r.code)}{t.target.toFixed(2)}</b>
      <span>{t.label}</span>
    </div>
  )
}

const CSS = `
.yg-page { min-height: 100vh; padding: 28px 20px 48px; background: #f5f6f8;
  font-family: "PingFang SC","Microsoft YaHei",sans-serif; color: #1f2328; }
.yg-page * { box-sizing: border-box; }
.yg-page .wrap { max-width: 1440px; margin: 0 auto; }
.yg-page .yg-topbar { display: flex; align-items: center; justify-content: space-between; margin: 0 0 10px; }
.yg-page .yg-tools { display: flex; align-items: center; justify-content: flex-end; gap: 8px; min-width: 0; }
.yg-page .yg-back { display: inline-flex; align-items: center; gap: 2px; margin: 0 0 0 -6px;
  padding: 4px 6px; background: none; border: 0; cursor: pointer; color: #6b7280; font-size: 14px;
  font-family: inherit; }
.yg-page .yg-back svg { width: 18px; height: 18px; }
.yg-page .yg-back:active { color: #1f2328; }
.yg-page .yg-cfgbtn { flex: 0 0 auto; padding: 5px 12px; border: 1px solid #e5e7eb; border-radius: 999px;
  background: #fff; color: #6b7280; font-size: 13px; font-family: inherit; cursor: pointer; white-space: nowrap; }
.yg-page .yg-cfgbtn:active { background: #f0f1f4; }
.yg-page .yg-auth { flex: 0 0 auto; padding: 5px 16px; border: 1px solid #e5e7eb; border-radius: 999px;
  background: #fff; color: #6b7280; font-size: 13px; font-family: inherit; cursor: pointer; white-space: nowrap; }
.yg-page .yg-auth.on { border-color: #fecaca; color: #dc2626; background: #fef2f2; cursor: default; }
.yg-page .yg-reportbtn { position: relative; display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; padding: 5px 11px;
  border: 1px solid #fed7aa; border-radius: 999px; background: #fffaf5; color: #c2410c; font-size: 13px;
  font-family: inherit; cursor: pointer; white-space: nowrap; }
.yg-page .yg-reportbtn svg { width: 14px; height: 14px; }
.yg-page .yg-reportbtn:active { background: #ffedd5; }
.yg-page .yg-reportbtn-short { display: none; }
.yg-page .yg-forecastbtn { border-color: #f2c6bb; background: #fff8f6; color: #d8563b; text-decoration: none; }
.yg-page .yg-forecastbtn:active { background: #ffede8; }
.yg-page .yg-forecastbtn-short { display: none; }
.yg-page .yg-forecastbtn-new { position: absolute; top: -7px; right: -11px; padding: 1px 4px; border: 1px solid #fff;
  border-radius: 999px; background: #dc2626; color: #fff; font-size: 8px; font-weight: 700; line-height: 1.15; letter-spacing: .2px; }
.yg-page .yg-reportbtn-new { position: absolute; top: -7px; right: -11px; padding: 1px 4px; border: 1px solid #fff;
  border-radius: 999px; background: #dc2626; color: #fff; font-size: 8px; font-weight: 700; line-height: 1.15; letter-spacing: .2px; }
.yg-page h1 { font-size: 26px; margin: 0 0 6px; }
.yg-page .sub { color: #6b7280; font-size: 13px; margin-bottom: 4px; }
.yg-page .legend { color: #6b7280; font-size: 12.5px; margin-bottom: 22px; }
.yg-page .legend b { font-weight: 700; }
.yg-page .legend .o { color: #ea580c; }
.yg-page .legend .g2 { color: #16a34a; }
.yg-page .legend-compact { display: grid; gap: 7px; margin-bottom: 18px; }
.yg-page .legend-main, .yg-page .legend-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; }
.yg-page .legend-main span + span { padding-left: 10px; border-left: 1px solid #d1d5db; }
.yg-page .legend-actions button { padding: 3px 9px; border: 1px solid #ddd6fe; border-radius: 999px; background: #faf5ff;
  color: #6d28d9; font-family: inherit; font-size: 11px; line-height: 1.4; cursor: pointer; }
.yg-page .legend-actions button:hover { border-color: #c4b5fd; background: #f5f3ff; }
.yg-page .legend-actions .legend-disclaimer { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; padding: 4px 9px;
  border: 1px solid #fde68a; border-radius: 999px; background: #fffbeb; color: #92400e; font-size: 11px; font-weight: 600; }
.yg-page .legend-disclaimer b { display: inline-grid; width: 14px; height: 14px; place-items: center; border-radius: 50%;
  background: #f59e0b; color: #fff; font-size: 9px; line-height: 1; }
.yg-page .upcoming-dividend { margin: 0 0 10px; border: 1px solid #e5e7eb; border-left: 4px solid #e03025; border-radius: 12px; background: #fff; overflow: hidden; box-shadow: 0 1px 2px rgba(15,23,42,.03); }
.yg-page .upcoming-dividend-head { min-height: 38px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 14px; border-bottom: 1px solid #f0f1f4; }
.yg-page .upcoming-dividend-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
.yg-page .upcoming-dividend-title strong { color: #1f2328; font-size: 15px; }
.yg-page .upcoming-dividend-title span:not(.upcoming-dividend-kicker) { color: #9ca3af; font-size: 12px; }
.yg-page .upcoming-dividend-title b { padding: 2px 7px; border-radius: 999px; background: #fff0ef; color: #e03025; font-size: 11px; font-weight: 700; white-space: nowrap; }
.yg-page .upcoming-dividend-head button { flex: 0 0 auto; border: 0; background: none; color: #e03025; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.yg-page .upcoming-dividend-head button span { margin-left: 2px; }
.yg-page .upcoming-dividend-list { padding: 0 14px; }
.yg-page .upcoming-dividend-empty { padding: 16px 0; color: #9ca3af; font-size: 12px; text-align: center; }
.yg-page .upcoming-dividend-row { min-height: 40px; display: grid; grid-template-columns: 64px 118px 52px 100px minmax(210px, 1fr); align-items: center; gap: 8px; border-bottom: 1px solid #f0f1f4; font-variant-numeric: tabular-nums; }
.yg-page .upcoming-dividend-row:last-child { border-bottom: 0; }
.yg-page .upcoming-date { color: #6b7280; font-size: 12px; font-weight: 700; }
.yg-page .upcoming-date i { margin-right: 4px; color: #f3a09a; font-size: 11px; font-style: normal; }
.yg-page .upcoming-date.today, .yg-page .upcoming-relative.today { color: #dc2626; }
.yg-page .upcoming-date.soon, .yg-page .upcoming-relative.soon { color: #d97706; }
.yg-page .upcoming-stock { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.yg-page .upcoming-stock strong { overflow: hidden; color: #1f2328; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.yg-page .upcoming-stock span { color: #6b7280; font-size: 12px; font-weight: 600; white-space: nowrap; }
.yg-page .upcoming-relative { font-size: 12px; white-space: nowrap; }
.yg-page .upcoming-per-share { color: #6b7280; font-size: 12px; white-space: nowrap; }
.yg-page .upcoming-per-share b { color: #ea580c; }
.yg-page .upcoming-yield { color: #6b7280; font-size: 12px; text-align: right; white-space: nowrap; }
.yg-page .upcoming-yield b { color: #374151; }.yg-page .upcoming-yield i { margin: 0 5px; color: #ef8c82; font-style: normal; }.yg-page .upcoming-yield em { color: #ea580c; font-style: normal; font-weight: 700; }
@media (max-width: 719px) {
  .yg-page .legend-compact { gap: 8px; margin-bottom: 16px; }
  .yg-page .legend-main { gap: 4px 8px; line-height: 1.5; }
  .yg-page .legend-main span + span { padding-left: 8px; }
  .yg-page .legend-actions { gap: 6px; }
  .yg-page .legend-actions .legend-disclaimer { flex-basis: 100%; justify-content: center; margin-left: 0; border-radius: 8px; }
  .yg-page .upcoming-dividend-head { padding-inline: 12px; }
  .yg-page .upcoming-dividend-title { gap: 6px; }
  .yg-page .upcoming-dividend-title strong { font-size: 14px; }
  .yg-page .upcoming-dividend-list { padding: 0 12px; }
  .yg-page .upcoming-dividend-row { grid-template-columns: 62px minmax(0, 1fr) 48px; grid-template-areas: 'date stock relative' 'per-share yield yield'; gap: 2px 6px; min-height: 57px; padding: 7px 0; }
  .yg-page .upcoming-date { grid-area: date; }.yg-page .upcoming-stock { grid-area: stock; }.yg-page .upcoming-relative { grid-area: relative; text-align: right; }
  .yg-page .upcoming-per-share { grid-area: per-share; }.yg-page .upcoming-yield { grid-area: yield; font-size: 11px; }
  .yg-page .upcoming-dividend-note { padding-inline: 12px; }
}
.yg-page .yg-addbar { width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;
  margin: 0 0 14px; padding: 12px; border: 1px dashed #f0b4b0; border-radius: 12px; background: #fff;
  color: #e03025; font-size: 14px; font-weight: 600; font-family: inherit; cursor: pointer; }
.yg-page .yg-addbar .plus { font-size: 16px; line-height: 1; }
.yg-page .yg-addbar:active { background: #fff5f5; }
.yg-page .state { color: #9ca3af; font-size: 13px; padding: 8px 2px; }
.yg-page .edit-tip { color: #6b7280; background: #f3f4f6; border-radius: 8px; padding: 7px 10px; margin: -4px 0 10px; }
.yg-page .yg-del { flex: 0 0 auto; width: 20px; height: 20px; border: 0; border-radius: 50%;
  background: #fee2e2; color: #dc2626; font-size: 12px; line-height: 1; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; }
.yg-page .rowops { display: inline-flex; align-items: center; gap: 4px; margin-right: 6px; vertical-align: middle; }
.yg-page td.nm .rowops { vertical-align: middle; }
.yg-page .yg-mv { flex: 0 0 auto; width: 20px; height: 20px; border: 1px solid #e5e7eb; border-radius: 6px;
  background: #fff; color: #374151; font-size: 12px; line-height: 1; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; }
.yg-page .yg-mv:disabled { color: #d1d5db; cursor: default; }
.yg-page .yg-mv:active:not(:disabled) { background: #f0f1f4; }
.yg-page .sortbar { display: flex; align-items: center; flex-wrap: nowrap; gap: 6px; margin: 2px 0 12px; }
.yg-page .sortbar .sortopts { display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 0; overflow-x: auto; flex-wrap: nowrap; scrollbar-width: none; }
.yg-page .sortbar .sortopts::-webkit-scrollbar { display: none; }
.yg-page .sortbar .lbl { font-size: 12.5px; color: #9ca3af; margin-right: 2px; flex-shrink: 0; }
.yg-page .sortbar .chip { padding: 4px 11px; font-size: 12.5px; flex-shrink: 0; }
.yg-page .sortbar .chip.clear { color: #dc2626; border-color: #fecaca; }
.yg-page .sortbar .chip.foldall { margin-left: auto; color: #374151; flex-shrink: 0; }
.yg-page .groupmode { flex: 0 0 auto; width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center;
  padding: 0; border: 0; border-radius: 9px; background: transparent; color: #9ca3af; cursor: pointer; }
.yg-page .groupmode svg { width: 25px; height: 25px; }
.yg-page .groupmode.on { color: #e03025; }
.yg-page .groupmode:active { background: #fee2e2; }
.yg-page .yg-footer { display: flex; align-items: center; margin: 10px 0 28px;
  background: #fff; border-radius: 14px; padding: 14px 18px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
.yg-page .ft-left { display: flex; align-items: center; gap: 10px; }
.yg-page .like-btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 16px; border-radius: 999px;
  border: 1px solid #fecaca; background: #fff; color: #dc2626; font-size: 14px; font-family: inherit; cursor: pointer;
  box-shadow: 0 1px 3px rgba(220,38,38,.08); transition: transform .08s ease, background .15s ease; }
.yg-page .like-btn .ic { font-size: 16px; line-height: 1; }
.yg-page .like-btn .n { font-weight: 700; font-variant-numeric: tabular-nums; }
.yg-page .like-btn:active:not(:disabled) { transform: scale(.95); }
.yg-page .like-btn.liked { background: #fef2f2; border-color: #fca5a5; cursor: default; }
.yg-page .ft-left .lt { font-size: 12.5px; color: #9ca3af; }
.yg-page .ft-div { flex: 1 1 0; min-width: 16px; }
.yg-page .ft-right { display: flex; align-items: center; gap: 8px; flex: 0 0 auto;
  border: 0; background: none; font-family: inherit; cursor: pointer; color: inherit; text-align: left; }
.yg-page .toolbar { position: sticky; top: 0; z-index: 5; display: block;
  padding: 10px 0; margin: -2px 0 14px; background: #f5f6f8; box-shadow: 0 6px 8px -6px rgba(0,0,0,.06); }
.yg-page .filter { min-width: 0; display: grid; gap: 8px; }
.yg-page .tabs-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
.yg-page .main-tabs { flex: 1 1 auto; display: flex; align-items: center; gap: 8px; min-width: 0; height: 32px;
  overflow-x: auto; overflow-y: hidden; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.yg-page .main-tabs::-webkit-scrollbar { display: none; }
.yg-page .main-tabs .chip { height: 32px; display: inline-flex; align-items: center; }
.yg-page .filter-controls { width: min(100%, 500px); display: grid; grid-template-columns: minmax(0, 38fr) minmax(0, 62fr) auto; align-items: center; gap: 8px; }
.yg-page .filter-select { position: relative; min-width: 0; height: 44px; padding: 5px 32px 5px 11px; border: 1px solid #e5e7eb;
  border-radius: 10px; background: #fff; color: #1f2328; font-family: inherit; text-align: left; cursor: pointer; }
.yg-page .filter-select-label { display: block; margin-bottom: 1px; color: #9ca3af; font-size: 10px; line-height: 1; }
.yg-page .filter-select strong { display: block; overflow: hidden; color: #374151; font-size: 13px; font-weight: 600;
  line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
.yg-page .filter-select svg { position: absolute; top: 50%; right: 10px; width: 18px; height: 18px; color: #9ca3af; transform: translateY(-50%); }
.yg-page .filter-select.selected { border-color: #1f2328; box-shadow: 0 0 0 1px rgba(31,35,40,.04); }
.yg-page .filter-select.selected .filter-select-label { color: #6b7280; }
.yg-page .filter-select.selected strong { color: #1f2328; }
.yg-page .filter-result-count { color: #9ca3af; font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.yg-page .filter-result-count strong { color: #374151; font-size: 13px; font-weight: 650; }
.yg-page .chip { flex: 0 0 auto; padding: 5px 14px; border: 1px solid #e5e7eb; border-radius: 999px;
  background: #fff; color: #374151; font-size: 13px; font-family: inherit; cursor: pointer; white-space: nowrap; }
.yg-page .chip.active { background: #1f2328; color: #fff; border-color: #1f2328; }
.yg-page .main-tabs .chip.sector-trend-slight-up { background: #fff7f6; color: #a43a30; border-color: #f4b8b2; }
.yg-page .main-tabs .chip.sector-trend-up { background: #ffd9d5; color: #a5241b; border-color: #ef8177; }
.yg-page .main-tabs .chip.sector-trend-strong-up { background: #c9342c; color: #fff; border-color: #c9342c; }
.yg-page .main-tabs .chip.sector-trend-slight-down { background: #f7fcf8; color: #287a45; border-color: #bbe6c8; }
.yg-page .main-tabs .chip.sector-trend-down { background: #cff3da; color: #116b32; border-color: #69c785; }
.yg-page .main-tabs .chip.sector-trend-strong-down { background: #16803c; color: #fff; border-color: #16803c; }
.yg-page .main-tabs .chip.sector-trend-slight-up.active { background: #a43a30; color: #fff; border-color: #a43a30; }
.yg-page .main-tabs .chip.sector-trend-up.active { background: #8f2119; color: #fff; border-color: #8f2119; }
.yg-page .main-tabs .chip.sector-trend-strong-up.active { background: #6f1712; color: #fff; border-color: #6f1712; }
.yg-page .main-tabs .chip.sector-trend-slight-down.active { background: #287a45; color: #fff; border-color: #287a45; }
.yg-page .main-tabs .chip.sector-trend-down.active { background: #0b5c2a; color: #fff; border-color: #0b5c2a; }
.yg-page .main-tabs .chip.sector-trend-strong-down.active { background: #064e2a; color: #fff; border-color: #064e2a; }
.yg-page .filter-empty button { margin-left: 5px; border: 0; background: none; color: #dc2626; font-family: inherit; font-size: inherit; cursor: pointer; }
.yg-page section { background: #fff; border-radius: 14px; padding: 14px 16px 18px;
  margin-bottom: 18px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
.yg-page h2 { font-size: 17px; margin: 4px 2px 12px; display: flex; align-items: center; gap: 8px; }
.yg-page h2.sec-h2 { cursor: pointer; user-select: none; }
.yg-page .sec-caret { font-size: 11px; color: #9ca3af; display: inline-block; transition: transform .15s; }
.yg-page .sec-caret.off { transform: rotate(-90deg); }
.yg-page .sec-brief { font-size: 12.5px; color: #6b7280; margin: -6px 2px 2px; padding-left: 22px; }
.yg-page .sec-brief b.o { font-weight: 600; color: #ea580c; }
.yg-page h2 em { font-style: normal; font-size: 12px; color: #6b7280; background: #eef0f3;
  padding: 1px 8px; border-radius: 10px; }
.yg-page .orderbtn { position: relative; flex: 0 0 auto; white-space: nowrap; padding: 5px 12px;
  border: 1px solid #e5e7eb; border-radius: 999px; background: #fff; color: #6b7280; font-size: 12.5px;
  font-family: inherit; cursor: pointer; }
.yg-page .orderbtn::before { content: ''; position: absolute; left: -20px; top: 0; bottom: 0; width: 20px;
  background: linear-gradient(to right, rgba(245,246,248,0), #f5f6f8); pointer-events: none; }
.yg-page .orderbtn.on { background: #1f2328; color: #fff; border-color: #1f2328; }
.yg-page.mobile .filter-controls { gap: 6px; }
.yg-page.mobile .filter-select { height: 38px; padding: 3px 28px 3px 9px; border-radius: 8px; }
.yg-page.mobile .filter-select-label { margin-bottom: 0; font-size: 9px; line-height: 1; }
.yg-page.mobile .filter-select strong { font-size: 12px; line-height: 1.15; }
.yg-page.mobile .filter-select svg { right: 8px; width: 16px; height: 16px; }
.yg-page.mobile .orderbtn { width: 32px; height: 32px; padding: 0; border-radius: 50%; font-size: 15px;
  display: inline-flex; align-items: center; justify-content: center; }
.yg-page h2 .moves { margin-left: auto; display: inline-flex; gap: 6px; }
.yg-page h2 .moves button { width: 30px; height: 28px; border: 1px solid #e5e7eb; border-radius: 8px;
  background: #fff; color: #374151; font-size: 14px; line-height: 1; cursor: pointer; }
.yg-page h2 .moves button:disabled { color: #d1d5db; cursor: default; }
.yg-page h2 .moves button:active:not(:disabled) { background: #f0f1f4; }
.yg-page .tablewrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.yg-page table { width: 100%; border-collapse: collapse; font-size: 13.5px; table-layout: fixed; }
.yg-page th, .yg-page td { padding: 7px 6px; text-align: center; border-bottom: 1px solid #eef0f3; }
.yg-page thead th { color: #6b7280; font-weight: 600; font-size: 12.5px; border-bottom: 1.5px solid #e5e7eb; white-space: nowrap; }
.yg-page thead th.th-s { color: #16a34a; }
.yg-page thead th.th-b { color: #7c3aed; }
.yg-page thead th.ordinal-group { padding: 9px 6px; font-size: 13px; font-weight: 700; letter-spacing: .04em; }
.yg-page thead th.ordinal-group.sell { color: #16a34a; background: #f7fcf8; }
.yg-page thead th.ordinal-group.buy { color: #ea580c; background: #fffaf5; }
.yg-page thead th.ordinal-slot { padding: 8px 5px; font-size: 11.5px; }
.yg-page thead th.ordinal-slot.sell { color: #16a34a; background: #fbfefb; }
.yg-page thead th.ordinal-slot.buy { color: #ea580c; background: #fffcf8; }
.yg-page thead th.quote-summary-head { width: 256px; min-width: 256px; padding: 6px 8px 7px; background: #f8fafc;
  border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; border-radius: 8px 0 0 0; }
.yg-page .quote-summary-title { display: block; margin-bottom: 4px; color: #374151; font-size: 11px; font-weight: 700; letter-spacing: .06em; }
.yg-page .quote-summary-labels { display: grid; grid-template-columns: 1.3fr .8fr .8fr .9fr; align-items: center; }
.yg-page .quote-summary-labels i { font-style: normal; font-size: 10px; font-weight: 500; color: #94a3b8; }
.yg-page .forecast-help-icon { display: inline-grid; width: 14px; height: 14px; margin-left: 2px; padding: 0; place-items: center;
  border: 1px solid #c4b5fd; border-radius: 50%; background: #faf5ff; color: #7c3aed; font-family: inherit; font-size: 9px;
  font-weight: 700; line-height: 1; cursor: pointer; vertical-align: 1px; }
.yg-page thead th.dividend-quality-head { width: 128px; min-width: 128px; padding: 6px 8px 7px; background: #f8fafc;
  border-right: 1px solid #e2e8f0; border-radius: 0 8px 0 0; }
.yg-page .dividend-quality-labels { display: grid; grid-template-columns: .85fr 1.15fr; align-items: center; }
.yg-page .dividend-quality-labels i { font-style: normal; font-size: 10px; font-weight: 500; color: #94a3b8; }
.yg-page thead th.th-boll-position { position: relative; width: 264px; min-width: 264px; padding-top: 14px; padding-bottom: 10px;
  background: #f8fafc; color: #64748b; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; border-radius: 8px 8px 0 0; }
.yg-page thead th.th-boll-position::before { content: ''; position: absolute; top: 0; left: 38%; right: 38%; height: 2px;
  border-radius: 0 0 2px 2px; background: #e03025; opacity: .72; }
.yg-page thead th.th-boll-position > span { display: inline-block; margin-right: 8px; font-size: 12px; font-weight: 650; letter-spacing: .04em; vertical-align: middle; }
.yg-page thead th.th-boll-position [data-testid="boll-period-switch"] { vertical-align: middle; }
.yg-page .sep { border-left: 1.5px solid #e5e7eb; }
.yg-page td.nm { width: 120px; min-width: 120px; text-align: left; font-weight: 600; white-space: nowrap; }
.yg-page thead th:first-child { width: 120px; min-width: 120px; }
.yg-page table.editing td.nm { white-space: normal; }
.yg-page table.editing td.nm .rowops { display: flex; width: max-content; margin: 0 0 6px; }
.yg-page .fav { background: none; border: 0; padding: 0; cursor: pointer; line-height: 0; color: #b6bcc6; vertical-align: middle; }
.yg-page td.nm .fav { margin-right: 5px; }
.yg-page .fav svg { width: 18px; height: 18px; }
.yg-page .stock-name-line { position: relative; display: flex; min-width: 0; align-items: center; }
.yg-page .stock-name-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yg-page .stock-name-line:hover { z-index: 2; }
.yg-page .stock-name-line:hover::after { content: attr(data-stock-name); position: absolute; top: calc(100% + 6px); left: 0;
  z-index: 10; width: max-content; max-width: 240px; padding: 6px 8px; border-radius: 6px; background: #1f2937; color: #fff;
  font-size: 12px; font-weight: 500; line-height: 1.35; white-space: normal; box-shadow: 0 4px 12px rgb(15 23 42 / 18%); }
.yg-page .fav.on { color: #f59e0b; }
.yg-page .fav.on svg { fill: #f59e0b; }
.yg-page .chead .fav { margin-left: auto; align-self: center; }
.yg-page .chg-up { color: #dc2626; }
.yg-page .chg-dn { color: #16a34a; }
.yg-page .chg-flat { color: #9ca3af; }
.yg-page td.dv { color: #6b7280; font-variant-numeric: tabular-nums; }
.yg-page td.quote-summary-cell { min-width: 256px; padding: 8px; background: #fbfcfd;
  border-left: 1px solid #e2e8f0; vertical-align: middle; }
.yg-page .quote-summary { display: grid; grid-template-columns: 1.3fr .8fr .8fr .9fr; align-items: stretch; overflow: visible;
  border: 1px solid #e8edf3; border-radius: 8px; background: #fff; font-variant-numeric: tabular-nums; }
.yg-page td.dividend-quality-cell { min-width: 128px; padding: 8px; background: #fbfcfd;
  border-right: 1px solid #e2e8f0; vertical-align: middle; }
.yg-page .dividend-quality { display: grid; grid-template-columns: .85fr 1.15fr; align-items: stretch; overflow: visible;
  border: 1px solid #e8edf3; border-radius: 8px; background: #fff; font-variant-numeric: tabular-nums; }
.yg-page .quote-metric { display: flex; min-width: 0; min-height: 48px; flex-direction: column; align-items: center;
  justify-content: center; padding: 5px 4px; }
.yg-page .quote-metric + .quote-metric { border-left: 1px solid #edf0f4; }
.yg-page .quote-metric small { margin-bottom: 3px; color: #9ca3af; font-size: 9px; line-height: 1; }
.yg-page .quote-metric .value-line { display: flex; min-width: 0; align-items: baseline; justify-content: center;
  gap: 3px; white-space: nowrap; color: #374151; }
.yg-page .quote-metric:first-child .value-line { flex-direction: column; align-items: center; gap: 1px; line-height: 1.1; }
.yg-page .quote-metric .value-line b { font-size: 12.5px; font-weight: 700; }
.yg-page .quote-metric .yield-reading { flex-direction: column; align-items: center; gap: 2px; }
.yg-page .dividend-fallback-mark { padding: 1px 4px; border-radius: 999px; background: #fff7ed; color: #c2410c;
  font-size: 8px; font-style: normal; font-weight: 650; line-height: 1.25; }
.yg-page .forecast-dividend .value-line { color: #7c3aed; }
.yg-page .forecast-edit-value { display: inline-flex; min-width: 0; flex-direction: column; align-items: center; border: 0; padding: 0;
  background: transparent; color: inherit; font: inherit; line-height: 1.05; cursor: pointer; }
.yg-page .forecast-edit-value i { margin-top: 3px; color: #a78bfa; font-size: 8px; font-style: normal; font-weight: 600; }
.yg-page .forecast-edit-value.manual i { color: #ea580c; }
.yg-page .quote-metric .value-line i { font-size: 9px; font-style: normal; font-weight: 500; }
.yg-page .payout-popover { position: relative; display: inline-flex; }
.yg-page .payout-trigger { display: inline-flex; flex-direction: column; align-items: center; border: 0; padding: 0; background: transparent;
  color: inherit; font: inherit; line-height: inherit; cursor: pointer; }
.yg-page .payout-trigger::after { content: '查看3年明细'; margin-top: 2px; padding-bottom: 1px; border-bottom: 1px dashed #cbd5e1;
  color: #94a3b8; font-size: 8px; font-weight: 500; line-height: 1; }
.yg-page .payout-trigger:hover::after, .yg-page .payout-trigger:focus-visible::after { border-color: #64748b; color: #64748b; }
.yg-page .payout-trigger:focus-visible { outline: 1px solid #94a3b8; outline-offset: 3px; border-radius: 3px; }
.yg-page .payout-tooltip { position: absolute; bottom: calc(100% + 8px); left: 50%; z-index: 20; width: 112px; padding: 7px 8px;
  border: 1px solid #334155; border-radius: 6px; background: #1f2937; color: #f8fafc; box-shadow: 0 5px 14px rgb(15 23 42 / 20%);
  transform: translateX(-50%); font-size: 10px; font-weight: 600; line-height: 1.65; text-align: left; white-space: nowrap; }
.yg-page .payout-tooltip::after { content: ''; position: absolute; bottom: -4px; left: 50%; width: 7px; height: 7px; border-right: 1px solid #334155;
  border-bottom: 1px solid #334155; background: #1f2937; transform: translateX(-50%) rotate(45deg); }
.yg-page .payout-tooltip > span { display: flex; justify-content: space-between; gap: 12px; }
.yg-page .payout-tooltip i { color: #94a3b8; font-style: normal; font-weight: 500; }
.yg-page td.boll-position-cell { min-width: 264px; padding: 7px 12px 8px; background: #fbfcfd;
  border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; vertical-align: middle; }
.yg-page:not(.mobile) thead th.th-boll-position { width: 268px; min-width: 268px; }
.yg-page:not(.mobile) td.boll-position-cell { min-width: 268px; }
.yg-page .cy-hi { color: #15803d; font-weight: 700; }
.yg-page .cy-mid { color: #d97706; font-weight: 600; }
.yg-page .cy-lo { color: #9ca3af; }
.yg-page td.g { font-variant-numeric: tabular-nums; line-height: 1.25; }
.yg-page td.g b { font-weight: 600; color: #1f2328; }
.yg-page td.g span { display: block; font-size: 10.5px; color: #9ca3af; margin-top: 1px; }
.yg-page td.g.ordinal { padding: 10px 5px; }
.yg-page table.dense-grid th.ordinal-slot { padding-left: 2px; padding-right: 2px; }
.yg-page table.dense-grid td.g.ordinal { padding-left: 2px; padding-right: 2px; }
.yg-page td.g.ordinal i { display: block; margin-bottom: 3px; font-size: 10.5px; font-style: normal; font-weight: 600; }
.yg-page td.g.ordinal.sell i { color: #16a34a; }
.yg-page td.g.ordinal.buy i { color: #ea580c; }
.yg-page td.g.blank { color: #d1d5db; }
.yg-page td.g.muted b { color: #9ca3af; font-weight: 500; }
.yg-page .tier.muted b { color: #9ca3af; font-weight: 500; }
.yg-page .tier.muted i { color: #9ca3af; }
.yg-page td.g.hit { border-radius: 6px; }
.yg-page td.g.hit b { color: #9a3412; }
.yg-page td.g.hit span { color: #c2410c; font-weight: 600; }
.yg-page td.g.sell.hit b { color: #14532d; }
.yg-page td.g.sell.hit span { color: #166534; }

/* ===== 手机端卡片布局 ===== */
.yg-page.mobile { padding: 16px 12px 32px; }
.yg-page.mobile h1 { font-size: 21px; }
.yg-page.mobile section { padding: 12px 12px 14px; border-radius: 12px; }
.yg-page .cards { display: flex; flex-direction: column; gap: 10px; }
.yg-page .card { border: 1px solid #f0f1f4; border-radius: 10px; padding: 10px 11px 11px; }
.yg-page .chead { display: flex; align-items: baseline; gap: 8px; }
.yg-page .chead .yg-del { align-self: center; }
.yg-page .chead .cnm { font-weight: 700; font-size: 15px; }
.yg-page .quote-summary-mobile { margin-top: 7px; background: #f8fafc; }
.yg-page .quote-summary-mobile { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.yg-page .quote-summary-mobile .quote-metric:nth-child(-n+3) { grid-column: span 2; }
.yg-page .quote-summary-mobile .quote-metric:nth-child(n+4) { grid-column: span 2; }
.yg-page .quote-summary-mobile .quote-metric:nth-child(4) { border-left: 0; }
.yg-page .quote-summary-mobile .quote-metric { min-height: 52px; padding: 6px 3px; }
.yg-page .quote-summary-mobile .quote-metric .value-line b { font-size: 12px; }
.yg-page .cmeta { font-size: 11.5px; color: #9ca3af; margin-top: 5px; }
.yg-page .boll-strip { margin-top: 7px; padding: 7px 7px 6px; border: 1px solid #eef0f3; border-radius: 8px;
  background: #fbfcfd; font-variant-numeric: tabular-nums; }
.yg-page .boll-mobile-head { display: flex; min-height: 38px; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 2px; }
.yg-page .boll-mobile-head > span { color: #64748b; font-size: 11px; font-weight: 650; letter-spacing: .04em; }
.yg-page .boll-month-note { margin: 0 2px -2px; color: #d97706; font-size: 9px; text-align: right; }
.yg-page .glabel { font-size: 11px; font-weight: 600; margin: 9px 0 5px; }
.yg-page .glabel.sell { color: #16a34a; }
.yg-page .glabel.buy { color: #ea580c; }
.yg-page .tiers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.yg-page .tier { border: 1px solid #eef0f3; border-radius: 8px; padding: 5px 2px 6px; text-align: center;
  font-variant-numeric: tabular-nums; }
.yg-page .tier i { display: block; font-style: normal; font-size: 10.5px; color: #9ca3af; }
.yg-page .tier.sell i { color: #16a34a; }
.yg-page .tier:not(.sell) i { color: #7c3aed; }
.yg-page .tier b { display: block; font-size: 13.5px; margin-top: 1px; }
.yg-page .tier span { display: block; font-size: 10px; color: #9ca3af; margin-top: 1px; }
.yg-page .tier.hit b { color: #9a3412; }
.yg-page .tier.hit span { color: #c2410c; font-weight: 600; }
.yg-page .tier.hit i { color: #9a3412; }
.yg-page .tier.sell.hit b { color: #14532d; }
.yg-page .tier.sell.hit span { color: #166534; }
.yg-page .tier.sell.hit i { color: #14532d; }

/* 筛选面板通过 portal 挂载到 body，样式不使用 .yg-page 前缀。 */
.forecast-editor { display: grid; gap: 14px; color: #374151; }
.forecast-editor-head { padding-bottom: 2px; }
.forecast-editor-loading, .forecast-editor-error { padding: 18px; border-radius: 12px; background: #f8fafc; color: #64748b;
  font-size: 13px; text-align: center; }
.forecast-editor-error { border: 1px solid #fed7aa; background: #fff7ed; color: #c2410c; }
.forecast-assumptions { display: grid; gap: 12px; }
.forecast-assumption-card { padding: 14px; border: 1px solid #e5e7eb; border-radius: 14px; background: #fff; }
.forecast-assumption-title { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; color: #111827; font-size: 14px; font-weight: 700; }
.forecast-assumption-title b { display: inline-grid; width: 21px; height: 21px; place-items: center; border-radius: 7px; background: #f3e8ff;
  color: #7e22ce; font-size: 11px; }
.forecast-data-table { overflow: hidden; border: 1px solid #eef0f3; border-radius: 10px; font-variant-numeric: tabular-nums; }
.forecast-data-head, .forecast-data-row { display: grid; grid-template-columns: .65fr 1fr 1fr 1.15fr; align-items: center; min-height: 34px; }
.forecast-data-head { background: #f8fafc; color: #94a3b8; font-size: 10px; }
.forecast-data-row { border-top: 1px solid #f1f5f9; color: #64748b; font-size: 12px; }
.forecast-data-head > *, .forecast-data-row > * { padding: 0 8px; text-align: right; }
.forecast-data-head > :first-child, .forecast-data-row > :first-child { text-align: left; }
.forecast-data-row b { color: #475569; font-weight: 650; }
.forecast-data-row strong { color: #6d28d9; font-weight: 700; }
.forecast-data-estimate { background: #faf5ff; }
.forecast-data-estimate b, .forecast-data-estimate span, .forecast-data-estimate strong { color: #7e22ce; font-weight: 700; }
.forecast-control-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
.forecast-control-row label { display: grid; gap: 5px; color: #64748b; font-size: 11px; }
.forecast-control-row select, .forecast-number-input { height: 40px; border: 1px solid #dbe1e8; border-radius: 9px; background: #fff; }
.forecast-control-row select { width: 100%; padding: 0 10px; color: #1f2937; font: inherit; font-size: 13px; }
.forecast-number-input { display: flex; align-items: center; overflow: hidden; }
.forecast-number-input input { width: 100%; min-width: 0; height: 100%; border: 0; padding: 0 8px 0 10px; outline: none; color: #111827; font: inherit; font-size: 13px; }
.forecast-number-input i { padding-right: 10px; color: #94a3b8; font-size: 11px; font-style: normal; white-space: nowrap; }
.forecast-inline-formula { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; margin-top: 10px; padding: 9px 10px; border-radius: 9px;
  background: #faf5ff; color: #7e22ce; font-size: 11px; font-variant-numeric: tabular-nums; }
.forecast-inline-formula i { color: #c084fc; font-style: normal; }.forecast-inline-formula strong { color: #581c87; }
.forecast-payout-years { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
.forecast-payout-years > div { display: grid; gap: 5px; padding: 8px 9px; border-radius: 9px; background: #f8fafc; }
.forecast-payout-years > div > span { color: #64748b; font-size: 11px; font-weight: 700; }
.forecast-payout-years p { display: flex; align-items: baseline; justify-content: space-between; gap: 4px; margin: 0; }
.forecast-payout-years p > i { color: #94a3b8; font-size: 9px; font-style: normal; white-space: nowrap; }
.forecast-payout-years p > b { color: #475569; font-size: 12px; white-space: nowrap; }.forecast-payout-years p > b small { margin-left: 2px; color: #94a3b8; font-size: 8px; font-weight: 400; }
.forecast-payout-years p > strong { color: #6d28d9; font-size: 12px; white-space: nowrap; }
.forecast-payout-track { height: 4px; overflow: hidden; border-radius: 999px; background: #e9e7ef; }
.forecast-payout-track span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #c4b5fd, #7c3aed); }
.forecast-choice-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin-top: 10px; }
.forecast-choice-grid button { min-width: 0; padding: 8px 5px; border: 1px solid #e5e7eb; border-radius: 9px; background: #fff; color: #64748b;
  font-family: inherit; cursor: pointer; }
.forecast-choice-grid button.active { border-color: #a78bfa; background: #faf5ff; color: #6d28d9; box-shadow: 0 0 0 1px #ddd6fe; }
.forecast-choice-grid button span, .forecast-choice-grid button b { display: block; }.forecast-choice-grid button span { font-size: 10px; }
.forecast-choice-grid button b { margin-top: 2px; font-size: 13px; }.forecast-choice-grid button em { margin-left: 3px; color: #ea580c; font-size: 8px; font-style: normal; }
.forecast-result-summary { overflow: hidden; border: 1px solid #e2e8f0; border-radius: 14px; background: #fff; font-variant-numeric: tabular-nums; }
.forecast-announcement { padding: 12px 14px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
.forecast-announcement-head { display: flex; align-items: center; gap: 7px; color: #475569; font-size: 10px; }
.forecast-announcement-head > span { padding: 3px 6px; border-radius: 5px; background: #e2e8f0; font-weight: 700; }
.forecast-announcement-head > b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.forecast-announcement-head > a { margin-left: auto; color: #dc2626; white-space: nowrap; }
.forecast-announcement-highlights { display: flex; flex-wrap: wrap; gap: 6px; margin: 9px 0 7px; }
.forecast-announcement-highlights strong { padding: 5px 8px; border-radius: 6px; background: #fff; color: #c24132; font-size: 11px; line-height: 1.4; }
.forecast-announcement > small { color: #94a3b8; font-size: 9px; line-height: 1.5; }
.forecast-calculation-lines { display: grid; }
.forecast-calculation-line { display: flex; min-height: 48px; align-items: center; flex-wrap: wrap; gap: 6px; padding: 10px 14px; color: #64748b; font-size: 11px; line-height: 1.45; }
.forecast-calculation-line + .forecast-calculation-line { border-top: 1px solid #fee2e2; }.forecast-calculation-line.policy { background: #fff7f5; }
.forecast-calculation-label { padding: 4px 7px; border-radius: 5px; background: #eef2f7; color: #475569; font-size: 10px; white-space: nowrap; }
.forecast-calculation-line.policy .forecast-calculation-label { background: #ffe4df; color: #dc3c2d; }.forecast-calculation-line.interim .forecast-calculation-label { background: #fff7ed; color: #c2410c; }
.forecast-calculation-line i, .forecast-calculation-line em { color: #94a3b8; font-style: normal; }.forecast-calculation-line > strong { margin-left: 2px; color: #ef4e3a; font-size: 15px; white-space: nowrap; }
.forecast-calculation-line > small { margin-left: auto; padding: 3px 6px; border-radius: 5px; background: #f1f5f9; color: #94a3b8; font-size: 9px; white-space: nowrap; }
.forecast-calculation-line.policy > small, .forecast-calculation-line.interim > small { background: #ffe9e4; color: #dc3c2d; }
.forecast-adjustment-note { margin: 0; padding: 9px 14px; border-top: 1px solid #e2e8f0; background: #f8fafc; color: #64748b; font-size: 10px; line-height: 1.55; }
.forecast-final-card { display: grid; grid-template-columns: minmax(0, 1fr) minmax(150px, .8fr); align-items: center; gap: 12px; padding: 14px;
  border: 1px solid #fecaca; border-radius: 14px; background: #fffafa; }
.forecast-final-card > div:first-child strong, .forecast-final-card > div:first-child span { display: block; }
.forecast-final-card > div:first-child strong { color: #991b1b; font-size: 13px; }.forecast-final-card > div:first-child span { margin-top: 3px; color: #9ca3af; font-size: 10px; }
.forecast-final-input { display: flex; height: 42px; align-items: center; overflow: hidden; border: 1.5px solid #ef4444; border-radius: 10px; background: #fff; }
.forecast-final-input input { width: 100%; min-width: 0; height: 100%; border: 0; padding: 0 8px 0 11px; outline: none; color: #111827; font: inherit; font-size: 16px; font-weight: 700; }
.forecast-final-input i { padding-right: 10px; color: #ef4444; font-size: 10px; font-style: normal; white-space: nowrap; }
.forecast-editor-actions { display: flex; gap: 8px; }.forecast-editor-actions button { flex: 1; min-height: 42px; border-radius: 10px; font-family: inherit; font-size: 13px; font-weight: 650; }
.forecast-editor-actions .restore { border: 1px solid #e5e7eb; background: #fff; color: #64748b; }.forecast-editor-actions .save { border: 0; background: #dc2626; color: #fff; }
.forecast-editor-note { color: #9ca3af; font-size: 10px; line-height: 1.6; }
@media (max-width: 560px) {
  .forecast-assumption-card { padding: 12px; }.forecast-control-row { grid-template-columns: 1fr; }
  .forecast-data-head > *, .forecast-data-row > * { padding-inline: 5px; }.forecast-data-row { font-size: 11px; }
  .forecast-final-card { grid-template-columns: 1fr; }.forecast-choice-grid { gap: 5px; }
  .forecast-calculation-line { align-items: flex-start; }.forecast-calculation-line > small { margin-left: 0; }
}
.forecast-help-link { border: 0; border-bottom: 1px dashed #a78bfa; padding: 0; background: transparent; color: #7c3aed;
  font: inherit; cursor: pointer; }
.forecast-help-link:hover { color: #6d28d9; border-bottom-color: #6d28d9; }
.forecast-method-info { display: grid; gap: 14px; color: #4b5563; font-size: 13px; line-height: 1.65; }
.forecast-method-info section { padding: 12px 14px; border: 1px solid #ede9fe; border-radius: 10px; background: #fafaff; }
.forecast-method-info section strong { display: block; margin-bottom: 4px; color: #312e81; font-size: 13px; }
.forecast-method-info section p { margin: 3px 0 0; }
.forecast-method-info section p b { color: #5b21b6; font-weight: 650; }
.forecast-method-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; color: #6b7280; font-size: 11px; }
.forecast-method-meta span { padding: 4px 8px; border-radius: 999px; background: #f3f4f6; }
.forecast-method-caution { margin: 0; padding: 12px 14px; border: 1px solid #fecaca; border-radius: 9px;
  background: #fef2f2; color: #b91c1c; font-size: 13px; font-weight: 700; line-height: 1.65; }
.forecast-method-risk { margin: 0; padding: 10px 12px; border-left: 3px solid #f59e0b; border-radius: 4px 8px 8px 4px;
  background: #fffbeb; color: #92400e; font-size: 11px; line-height: 1.6; }
.filter-clear { border: 0; background: none; color: #6b7280; font-size: 12px; font-family: inherit; cursor: pointer; }
.yield-filter-list { display: grid; gap: 4px; }
.yield-filter-option { width: 100%; display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: center; gap: 10px;
  padding: 10px 8px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: #1f2328;
  font-family: inherit; text-align: left; cursor: pointer; }
.yield-filter-option:hover { background: #f9fafb; }
.yield-filter-option.selected { border-color: #d1d5db; background: #f9fafb; }
.filter-radio { width: 16px; height: 16px; border: 1.5px solid #c4c9d0; border-radius: 50%; }
.yield-filter-option.selected .filter-radio { border: 5px solid #1f2328; }
.yield-filter-option strong { display: block; font-size: 14px; font-weight: 650; }
.yield-filter-option small { display: block; margin-top: 2px; color: #9ca3af; font-size: 11px; line-height: 1.4; }
.boll-filter-panel > p { margin: 0 0 14px; color: #9ca3af; font-size: 11px; line-height: 1.55; }
.boll-filter-period + .boll-filter-period { margin-top: 16px; padding-top: 14px; border-top: 1px solid #eef0f3; }
.boll-filter-period-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.boll-filter-period-head strong { color: #374151; font-size: 13px; }
.boll-filter-period-head span { color: #d97706; font-size: 10px; }
.boll-filter-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 5px; }
.boll-filter-grid button { min-width: 0; height: 36px; padding: 0 2px; border: 1px solid #e5e7eb; border-radius: 8px;
  background: #fff; color: #6b7280; font-family: inherit; font-size: 12px; cursor: pointer; }
.boll-filter-grid button.selected { border-color: #1f2328; background: #1f2328; color: #fff; font-weight: 600; }
@media (max-width: 359px) {
  .yg-page .yg-tools { gap: 4px; }
  .yg-page .yg-auth { padding-inline: 8px; }
  .yg-page .yg-cfgbtn { padding-inline: 8px; }
  .yg-page .yg-reportbtn { padding-inline: 8px; }
  .yg-page .yg-reportbtn-full { display: none; }
  .yg-page .yg-reportbtn-short { display: inline; }
  .yg-page .yg-forecastbtn-full { display: none; }
  .yg-page .yg-forecastbtn-short { display: inline; }
  .boll-filter-grid { gap: 3px; }
  .boll-filter-grid button { font-size: 11px; }
}
`
