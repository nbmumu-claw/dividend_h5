import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchStockPrices, searchStocks, type SearchResult } from '../utils/api'
import { fetchDividendHistory } from '../utils/dividendHistory'
import { predictSector } from '../utils/sectorPredictor'
import { pickDividendForFill } from '../utils/dividendFill'
import Modal from '../components/Modal'
import { Toast, useToast } from '../components/Toast'

// 静态配置：板块 / 名称 / 代码 / 25年度股息预估。现价每次打开实时拉取。
const STOCKS: { sector: string; name: string; code: string; dive: number }[] = [
  ['电力', '中国广核', '003816', 0.086], ['电力', '中国核电', '601985', 0.18],
  ['水电', '长江电力', '600900', 1], ['水电', '国投电力', '600886', 0.5081],
  ['电力', '川投能源', '600674', 0.5], ['电力', '华能蒙电', '600863', 0.22],
  ['电力', '国电电力', '600795', 0.241], ['电力', '华能国际', '600011', 0.4],
  ['银行', '农业银行', '601288', 0.2492], ['银行', '工商银行', '601398', 0.3103],
  ['银行', '中国银行', '601988', 0.2263], ['银行', '建设银行', '601939', 0.3887],
  ['银行', '交通银行', '601328', 0.3247], ['银行', '邮储银行', '601658', 0.2183],
  ['银行', '招商银行', '600036', 2.016], ['银行', '华夏银行', '600015', 0.42],
  ['银行', '中信银行', '601998', 0.381], ['银行', '兴业银行', '601166', 1.066],
  ['银行', '平安银行', '000001', 0.596], ['银行', '成都银行', '601838', 0.921],
  ['银行', '宁波银行', '002142', 1.2], ['银行', '江苏银行', '600919', 0.564],
  ['银行', '北京银行', '601169', 0.278], ['银行', '民生银行', '600016', 0.189],
  ['保险', '中国平安', '601318', 2.7], ['保险', '中国太保', '601601', 1.15],
  ['保险', '新华保险', '601336', 2.73],
  ['白酒', '贵州茅台', '600519', 52], ['白酒', '五粮液', '000858', 5.16],
  ['白酒', '泸州老窖', '000568', 5.775],
  ['通讯', '中国移动', '600941', 4.704], ['通讯', '中国电信', '601728', 0.272],
  ['白色家电', '美的集团', '000333', 4.3], ['白色家电', '格力电器', '000651', 3],
  ['白色家电', '海尔智家', '600690', 1.1559],
  ['中药', '云南白药', '000538', 2.6], ['中药', '羚锐制药', '600285', 1.1],
  ['中药', '东阿阿胶', '000423', 2.7],
  ['运输', '中远海控', '601919', 1], ['运输', '大秦铁路', '601006', 0.22],
  ['运输', '招商公路', '001965', 0.373], ['运输', '粤高速A', '000429', 0.604],
  ['能源', '中国神华', '601088', 2.01], ['能源', '陕西煤业', '601225', 0.948],
  ['能源', '中煤能源', '601898', 0.383], ['能源', '中国海油', '600938', 1.152],
  ['能源', '中国石化', '600028', 0.2], ['能源', '中国石油', '601857', 0.47],
  ['消费', '分众传媒', '002027', 0.34], ['消费', '伊利股份', '600887', 1.38],
].map(([sector, name, code, dive]) => ({ sector: sector as string, name: name as string, code: code as string, dive: dive as number }))

// 板块默认展示顺序（能源与白酒对调）；用户可手动调整并持久化
const SECTOR_ORDER = ['电力', '水电', '银行', '保险', '能源', '通讯', '白色家电', '中药', '运输', '白酒', '消费', '其他']
// 「其他」始终可用，作为预判不到板块时的兜底归属
const SECTORS = SECTOR_ORDER.filter(s => s === '其他' || STOCKS.some(x => x.sector === s))
const ALL = '全部'

// 板块顺序（localStorage）：保留已保存且仍存在的板块，新板块追加到末尾
const ORDER_KEY = 'yg-sector-order'
const MAX_CUSTOM = 10
function loadOrder(): string[] {
  let saved: string[] = []
  try { saved = JSON.parse(localStorage.getItem(ORDER_KEY) || '[]') } catch { /* ignore */ }
  const valid = saved.filter(s => SECTORS.includes(s))
  return [...valid, ...SECTORS.filter(s => !valid.includes(s))]
}
function saveOrder(o: string[]) {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(o)) } catch { /* ignore */ }
}

// 水电（低息、估值另算）：买入档从 4% 起、卖出档从 3% 起；其余股票买入从 5% 起、卖出从 4% 起
const HYDRO = new Set(['国投电力', '长江电力'])
const buyBase = (name: string) => (HYDRO.has(name) ? 0.04 : 0.05)
const sellBase = (name: string) => (HYDRO.has(name) ? 0.03 : 0.04)
// 中国广核、中国核电：低息成长属性，卖出档只展示价格，不着色、不判「已达」
const SELL_MUTED = new Set(['中国广核', '中国核电'])

// 网格设置（localStorage）：买入 / 卖出各自步长 + 档数
type GridCfg = { buyStep: number; buyCount: number; sellStep: number; sellCount: number }
const DEFAULT_CFG: GridCfg = { buyStep: 0.005, buyCount: 4, sellStep: 0.005, sellCount: 4 }
const STEP_OPTIONS = [0.0025, 0.005]
const COUNT_OPTIONS = [2, 4, 6, 8]
const CFG_KEY = 'yg-grid-cfg'
function loadCfg(): GridCfg {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null')
    if (c && typeof c === 'object') {
      const okStep = (v: unknown) => (STEP_OPTIONS.includes(v as number) ? (v as number) : undefined)
      const okCnt = (v: unknown) => (COUNT_OPTIONS.includes(v as number) ? (v as number) : undefined)
      // 兼容旧版 {step,count} / {step,buyCount,sellCount}
      return {
        buyStep: okStep(c.buyStep) ?? okStep(c.step) ?? DEFAULT_CFG.buyStep,
        sellStep: okStep(c.sellStep) ?? okStep(c.step) ?? DEFAULT_CFG.sellStep,
        buyCount: okCnt(c.buyCount) ?? okCnt(c.count) ?? DEFAULT_CFG.buyCount,
        sellCount: okCnt(c.sellCount) ?? okCnt(c.count) ?? DEFAULT_CFG.sellCount,
      }
    }
  } catch { /* ignore */ }
  return DEFAULT_CFG
}
function saveCfg(c: GridCfg) { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)) } catch { /* ignore */ } }

const round4 = (n: number) => Math.round(n * 10000) / 10000
// 动态生成档位：买入从基准向上 buyCount 档（升序）；卖出从基准向下 sellCount 档、过滤 ≤0 后升序
const buyGridFor = (name: string, cfg: GridCfg) =>
  Array.from({ length: cfg.buyCount }, (_, i) => round4(buyBase(name) + i * cfg.buyStep))
const sellGridFor = (name: string, cfg: GridCfg) =>
  Array.from({ length: cfg.sellCount }, (_, i) => round4(sellBase(name) - i * cfg.sellStep)).filter(y => y > 0).sort((a, b) => a - b)

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

// 涨跌幅：A 股惯例涨红跌绿
const chgClass = (p: number) => (p > 0 ? 'chg-up' : p < 0 ? 'chg-dn' : 'chg-flat')
const chgText = (p: number) => `${p > 0 ? '+' : ''}${p.toFixed(2)}%`

type Row = { sector: string; name: string; code: string; dive: number; price: number; cy: number; pctChg: number; isHK: boolean }
// 币种符号：港股 HK$，A 股 ¥
const symOf = (isHK?: boolean) => (isHK ? 'HK$' : '¥')

// 网格页自选（localStorage，独立于主自选页）
const FAV = '自选'
const FAV_KEY = 'yg-favs'
function loadFavs(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')) } catch { return new Set() }
}
function saveFavs(s: Set<string>) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...s])) } catch { /* ignore */ }
}

// 网格页自定义添加的标的（localStorage，仅 A 股，板块限网格已有板块）
type Custom = { sector: string; name: string; code: string; dive: number; isHK?: boolean }
const CUSTOM_KEY = 'yg-custom'
function loadCustom(): Custom[] {
  try { const a = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); return Array.isArray(a) ? a : [] } catch { return [] }
}
function saveCustom(list: Custom[]) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)) } catch { /* ignore */ }
}

// 用户隐藏的默认标的（localStorage）：删除内置标的不改源数据，仅记隐藏 code，可恢复
const HIDDEN_KEY = 'yg-hidden'
function loadHidden(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')) } catch { return new Set() }
}
function saveHidden(s: Set<string>) {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...s])) } catch { /* ignore */ }
}

// 行情缓存（localStorage）：盘后/非交易时段直接读缓存不刷新
type PriceSnap = { price: number; pctChg: number; tradeDate: string; tradeTime: string }
type PriceCache = { fetchedAt: number; latestDate: string; data: Record<string, PriceSnap> }
const PRICE_CACHE_KEY = 'yg-price-cache'
function loadPriceCache(): PriceCache | null {
  try { const c = JSON.parse(localStorage.getItem(PRICE_CACHE_KEY) || 'null'); return c && c.data ? c : null } catch { return null }
}
function savePriceCache(c: PriceCache) { try { localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(c)) } catch { /* ignore */ } }
// 周一~五 9:30–15:00 视为交易时段（无节假日日历，近似）
function marketPhase(d: Date = new Date()): 'trading' | 'lunch' | 'closed' {
  const day = d.getDay(); const mins = d.getHours() * 60 + d.getMinutes()
  if (day < 1 || day > 5) return 'closed'
  if ((mins >= 570 && mins < 690) || (mins >= 780 && mins < 900)) return 'trading' // 09:30–11:30、13:00–15:00
  if (mins >= 690 && mins < 780) return 'lunch' // 11:30–13:00 午休
  return 'closed'
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
  const target = r.dive / y
  const reached = kind === 'buy' ? r.price <= target : r.price >= target
  const pct = Math.round((kind === 'buy' ? (r.price - target) : (target - r.price)) / r.price * 100)
  const label = reached ? '已达' : `${kind === 'buy' ? '↓' : '↑'}${pct}%`
  return { target, reached, label }
}

// 监听设备宽度：手机出卡片，PC 出表格，同一网址自适应
function useIsMobile() {
  const q = '(max-width: 719px)'
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const h = (e: MediaQueryListEvent) => setM(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  return m
}

export default function YieldGrid() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const { message, showToast } = useToast()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [date, setDate] = useState('')
  const [fetchedAt, setFetchedAt] = useState(0)
  const [error, setError] = useState('')
  const [active, setActive] = useState<string>(ALL)
  const [favs, setFavs] = useState<Set<string>>(loadFavs)
  const toggleFav = (code: string) => setFavs(prev => {
    const next = new Set(prev)
    next.has(code) ? next.delete(code) : next.add(code)
    saveFavs(next)
    return next
  })
  const [order, setOrder] = useState<string[]>(loadOrder)
  const [editOrder, setEditOrder] = useState(false)
  const moveSector = (sector: string, dir: -1 | 1) => setOrder(prev => {
    const i = prev.indexOf(sector); const j = i + dir
    if (i < 0 || j < 0 || j >= prev.length) return prev
    const next = [...prev]
    ;[next[i], next[j]] = [next[j], next[i]]
    saveOrder(next)
    return next
  })

  // 自定义添加的标的，与静态列表合并（去重）；隐藏的默认标的过滤掉
  const [custom, setCustom] = useState<Custom[]>(loadCustom)
  const [hidden, setHidden] = useState<Set<string>>(loadHidden)
  const allStocks = useMemo<Custom[]>(() => {
    const seen = new Set(STOCKS.map(s => s.code))
    return [...STOCKS, ...custom.filter(c => !seen.has(c.code))].filter(s => !hidden.has(s.code))
  }, [custom, hidden])
  // 被隐藏的默认标的（用于「恢复」列表）
  const hiddenStocks = useMemo(() => STOCKS.filter(s => hidden.has(s.code)), [hidden])

  // 添加标的弹窗
  const [showAdd, setShowAdd] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [addForm, setAddForm] = useState<{ name: string; code: string; sector: string; dive: string; isHK: boolean }>({ name: '', code: '', sector: '', dive: '', isHK: false })

  // 网格设置
  const [cfg, setCfg] = useState<GridCfg>(loadCfg)
  const [showCfg, setShowCfg] = useState(false)
  const updateCfg = (partial: Partial<GridCfg>) => setCfg(prev => { const n = { ...prev, ...partial }; saveCfg(n); return n })

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
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [q])

  const selectResult = (r: SearchResult) => {
    const mkt = r.isHK ? 'HK' : 'A'
    const predicted = predictSector(r.name, r.code, mkt)
    setAddForm({ name: r.name, code: r.code, sector: SECTORS.includes(predicted) ? predicted : '其他', dive: '', isHK: !!r.isHK })
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
    if (Math.max(custom.length, loadCustom().length) >= MAX_CUSTOM) { showToast(`最多添加 ${MAX_CUSTOM} 个自定义标的，删除后再加`); return }
    const next = [...custom, { sector: addForm.sector, name: addForm.name, code: addForm.code, dive, isHK: addForm.isHK }]
    setCustom(next); saveCustom(next)
    setAddForm({ name: '', code: '', sector: '', dive: '', isHK: false })
    setRows(null); setError('')
  }

  const deleteCustom = (code: string) => {
    const next = custom.filter(c => c.code !== code)
    setCustom(next); saveCustom(next)
    setRows(null); setError('')
  }

  // 删除标的：自定义的直接移除，内置默认的记入隐藏（可恢复）
  const removeStock = (code: string) => {
    if (custom.some(c => c.code === code)) { deleteCustom(code); return }
    const next = new Set(hidden); next.add(code); setHidden(next); saveHidden(next)
    setRows(null); setError('')
  }
  const restoreStock = (code: string) => {
    const next = new Set(hidden); next.delete(code); setHidden(next); saveHidden(next)
    setRows(null); setError('')
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
        out.push({ sector: s.sector, name: s.name, code: s.code, dive: s.dive, price: q.price, cy: s.dive / q.price, pctChg: q.pctChg ?? 0, isHK: !!s.isHK })
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
    const phase = marketPhase()
    const now = new Date()
    const curMins = now.getHours() * 60 + now.getMinutes()
    // 缓存是否在“今天某时刻（分钟）之后”抓取的
    const cacheFetchedTodayAfter = (m: number) => !!cache && (() => {
      const f = new Date(cache.fetchedAt)
      return f.getFullYear() === now.getFullYear() && f.getMonth() === now.getMonth()
        && f.getDate() === now.getDate() && f.getHours() * 60 + f.getMinutes() >= m
    })()
    // 是否直接读缓存（不刷新）：
    //  · 午休：缓存须已是今天 11:30（午盘收盘）后抓取，否则补拉一次拿午盘收盘价
    //  · 当天收盘后(≥15:00)：缓存须已是今天 15:00 后抓取，否则补拉一次拿收盘价
    //  · 其余休市(盘前/周末/隔夜)：缓存若抓于盘中(非定格价)则补拉一次拿最近收盘价，否则直接读
    const afterCloseToday = phase === 'closed' && now.getDay() >= 1 && now.getDay() <= 5 && curMins >= 900
    let useCache = false
    if (cacheCoversAll) {
      if (phase === 'lunch') useCache = cacheFetchedTodayAfter(690)
      else if (afterCloseToday) useCache = cacheFetchedTodayAfter(900)
      else if (phase === 'closed') useCache = marketPhase(new Date(cache!.fetchedAt)) !== 'trading'
    }
    if (useCache) {
      build(cache!.data, cache!.fetchedAt, cache!.latestDate)
      return
    }
    let alive = true
    fetchStockPrices(allStocks.map(s => ({ code: s.code, isHK: s.isHK })))
      .then(prices => {
        if (!alive) return
        const data: Record<string, PriceSnap> = {}
        let latest = ''
        for (const c of codes) {
          const q = prices[c]
          if (q && q.price) { data[c] = { price: q.price, pctChg: q.pctChg ?? 0, tradeDate: q.tradeDate || '', tradeTime: q.tradeTime || '' }; if (q.tradeDate && q.tradeDate > latest) latest = q.tradeDate }
        }
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
    return () => { alive = false }
  }, [custom, hidden])

  // 按板块分组（保持配置中板块出现顺序），组内按现股息率倒序
  const sectors: { sector: string; items: Row[] }[] = []
  for (const r of rows || []) {
    let g = sectors.find(x => x.sector === r.sector)
    if (!g) { g = { sector: r.sector, items: [] }; sectors.push(g) }
    g.items.push(r)
  }
  for (const g of sectors) g.items.sort((a, b) => b.cy - a.cy)
  sectors.sort((a, b) => order.indexOf(a.sector) - order.indexOf(b.sector))

  // 盘中（行情日期=今天 且 处于 A 股交易时段 9:30–15:00）显示「盘中价」，否则「收盘价」
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const mins = now.getHours() * 60 + now.getMinutes()
  const priceLabel = date === todayStr && mins >= 570 && mins < 900 ? '盘中价' : '收盘价'

  // 应用板块 / 自选筛选；自选时只保留已收藏标的，去掉空板块
  const visible = sectors
    .map(g => (active === FAV ? { sector: g.sector, items: g.items.filter(r => favs.has(r.code)) } : g))
    .filter(g => (active === ALL || active === FAV || g.sector === active) && g.items.length > 0)

  return (
    <div className={`yg-page${isMobile ? ' mobile' : ''}`}>
      <style>{CSS}</style>
      <div className="wrap">
        <div className="yg-topbar">
          <button
            className="yg-back"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/discovery'))}
            aria-label="返回"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>返回</span>
          </button>
          <button className="yg-cfgbtn" onClick={() => setShowCfg(true)}>⚙ 网格设置</button>
        </div>
        <h1>股息率网格买卖价位表</h1>
        <div className="sub">{error ? '现价获取失败' : date ? `现价为 ${date} ${priceLabel}${fetchedAt ? ` · 行情时间 ${fmtTs(fetchedAt)}` : ''}` : '正在获取最新行情…'}</div>
        <div className="legend">买入/卖出价 = 25年股息 ÷ 目标股息率。<b className="o">橙色买入网格</b>（≥5%，水电≥4%）｜<b className="g2">绿色卖出网格</b>（≤4%，水电≤3%）。颜色越深信号越强，「已达」=现价已触及该档，否则显示需涨/跌幅度。仅供参考，非投资建议。</div>
        <button className="yg-addbar" onClick={() => setShowAdd(true)}>
          <span className="plus">＋</span> 添加标的{custom.length > 0 ? ` ${custom.length}/${MAX_CUSTOM}` : ''}{custom.length >= MAX_CUSTOM ? '（已满，删除后可再加）' : ''}
        </button>
        <div className="toolbar">
          <div className="filter">
            <button className={`chip${active === ALL ? ' active' : ''}`} onClick={() => setActive(ALL)}>{ALL}</button>
            <button className={`chip${active === FAV ? ' active' : ''}`} onClick={() => setActive(FAV)}>★ {FAV}{favs.size ? ` ${favs.size}` : ''}</button>
            {order.map(s => (
              <button key={s} className={`chip${active === s ? ' active' : ''}`} onClick={() => setActive(s)}>{s}</button>
            ))}
          </div>
          {!error && rows && (
            <button
              className={`orderbtn${editOrder ? ' on' : ''}`}
              onClick={() => { setEditOrder(e => !e); if (!editOrder) setActive(ALL) }}
              aria-label={editOrder ? '完成编辑' : '编辑（排序/删除）'}
            >
              {editOrder ? (isMobile ? '✓' : '✓ 完成') : (isMobile ? '✎' : '✎ 编辑')}
            </button>
          )}
        </div>
        {editOrder && <div className="state edit-tip">编辑模式：↑↓ 调整板块顺序，✕ 删除标的（默认标的删除后可在「添加标的」里恢复）</div>}
        {error && <div className="state">{error}</div>}
        {!error && !rows && <div className="state">加载中…</div>}
        {!error && rows && active === FAV && visible.length === 0 && (
          <div className="state">暂无自选，点击股票右上角的 ★ 添加</div>
        )}
        {!error && rows && active !== FAV && active !== ALL && visible.length === 0 && (
          <div className="state">该板块暂无标的</div>
        )}
        {visible.map(({ sector, items }) => {
          // 板块内各股票档位取并集，保证表头列对齐（仅电力含水电会出现空档）
          const sellCols = [...new Set(items.flatMap(r => sellGridFor(r.name, cfg)))].sort((a, b) => a - b)
          const buyCols = [...new Set(items.flatMap(r => buyGridFor(r.name, cfg)))].sort((a, b) => a - b)
          return (
            <section key={sector}>
              <h2>
                {sector} <em>{items.length}</em>
                {editOrder && (
                  <span className="moves">
                    <button disabled={order.indexOf(sector) === 0} onClick={() => moveSector(sector, -1)} aria-label="上移">↑</button>
                    <button disabled={order.indexOf(sector) === order.length - 1} onClick={() => moveSector(sector, 1)} aria-label="下移">↓</button>
                  </span>
                )}
              </h2>
              {isMobile ? (
                <div className="cards">
                  {items.map(r => (
                    <div className="card" key={r.name}>
                      <div className="chead">
                        {editOrder && <button type="button" className="yg-del" onClick={() => removeStock(r.code)} aria-label="删除标的">✕</button>}
                        <span className="cnm">{r.name}</span>
                        <span className="cpx">{symOf(r.isHK)}{r.price.toFixed(2)}<i className={chgClass(r.pctChg)}>{chgText(r.pctChg)}</i></span>
                        <span className={`ccy ${cyClass(r.cy)}`}>{(r.cy * 100).toFixed(2)}%</span>
                        <Star on={favs.has(r.code)} onClick={() => toggleFav(r.code)} />
                      </div>
                      <div className="cmeta">25年股息 {+r.dive.toFixed(4)}</div>
                      <div className="glabel sell">卖出网格</div>
                      <div className="tiers">
                        {sellGridFor(r.name, cfg).map(y => <Chip key={'s' + y} r={r} y={y} kind="sell" cfg={cfg} />)}
                      </div>
                      <div className="glabel buy">买入网格</div>
                      <div className="tiers">
                        {buyGridFor(r.name, cfg).map(y => <Chip key={'b' + y} r={r} y={y} kind="buy" cfg={cfg} />)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="tablewrap">
                  <table>
                    <thead>
                      <tr>
                        <th>股票</th><th>现价</th><th>现股息率</th><th>25年股息</th>
                        {sellCols.map((y, i) => <th key={'s' + i} className="th-s">{fmtPct(y)}</th>)}
                        {buyCols.map((y, i) => <th key={'b' + i} className={`th-b${i === 0 ? ' sep' : ''}`}>{fmtPct(y)}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(r => (
                        <tr key={r.name}>
                          <td className="nm">{editOrder && <button type="button" className="yg-del" onClick={() => removeStock(r.code)} aria-label="删除标的">✕</button>}<Star on={favs.has(r.code)} onClick={() => toggleFav(r.code)} />{r.name}</td>
                          <td className="px">{symOf(r.isHK)}{r.price.toFixed(2)}<i className={chgClass(r.pctChg)}>{chgText(r.pctChg)}</i></td>
                          <td className={cyClass(r.cy)}>{(r.cy * 100).toFixed(2)}%</td>
                          <td className="dv">{+r.dive.toFixed(4)}</td>
                          {sellCols.map((y, i) => <Cell key={'s' + i} r={r} y={y} kind="sell" cfg={cfg} />)}
                          {buyCols.map((y, i) => <Cell key={'b' + i} r={r} y={y} kind="buy" sep={i === 0} cfg={cfg} />)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )
        })}

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
                      <span className="text-gray-800">{r.name}</span><span className="text-gray-400">{r.code}</span>
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
                      <span className="text-gray-700">{c.name} <span className="text-gray-400 text-xs">{c.code} · {c.sector} · {symOf(c.isHK)}{c.dive}</span></span>
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

        <Modal open={showCfg} onClose={() => setShowCfg(false)} title="网格设置">
          <div className="space-y-4 pb-2">
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
            <div className="text-xs text-gray-400 leading-relaxed">
              买入从 5%（水电 4%）每档 +{+(cfg.buyStep * 100).toFixed(2)}% 共 {cfg.buyCount} 档；卖出从 4%（水电 3%）每档 −{+(cfg.sellStep * 100).toFixed(2)}% 共 {cfg.sellCount} 档（收益率 ≤0 的档位自动省略）。
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

// 表格单元格：该股票无此档位则留空
function Cell({ r, y, kind, sep, cfg }: { r: Row; y: number; kind: 'buy' | 'sell'; sep?: boolean; cfg: GridCfg }) {
  const grid = kind === 'buy' ? buyGridFor(r.name, cfg) : sellGridFor(r.name, cfg)
  if (!grid.includes(y)) return <td className={`g blank${sep ? ' sep' : ''}`}>·</td>
  const t = tier(r, y, kind)
  // 广核/核电卖出：仅显示价格，不着色、不判已达
  if (kind === 'sell' && SELL_MUTED.has(r.name)) {
    return <td className={`g sell muted${sep ? ' sep' : ''}`}><b>{symOf(r.isHK)}{t.target.toFixed(2)}</b></td>
  }
  const cls = `g${kind === 'sell' ? ' sell' : ''}${t.reached ? ' hit' : ''}${sep ? ' sep' : ''}`
  return (
    <td className={cls} style={t.reached ? { background: hitBg(kind, y, grid) } : undefined}>
      <b>{symOf(r.isHK)}{t.target.toFixed(2)}</b><span>{t.label}</span>
    </td>
  )
}

// 卡片档位 chip
function Chip({ r, y, kind, cfg }: { r: Row; y: number; kind: 'buy' | 'sell'; cfg: GridCfg }) {
  const t = tier(r, y, kind)
  // 广核/核电卖出：仅显示价格，不着色、不判已达
  if (kind === 'sell' && SELL_MUTED.has(r.name)) {
    return (
      <div className="tier sell muted">
        <i>{fmtPct(y)}</i>
        <b>{symOf(r.isHK)}{t.target.toFixed(2)}</b>
      </div>
    )
  }
  const grid = kind === 'buy' ? buyGridFor(r.name, cfg) : sellGridFor(r.name, cfg)
  const cls = `tier${kind === 'sell' ? ' sell' : ''}${t.reached ? ' hit' : ''}`
  const bg = hitBg(kind, y, grid)
  return (
    <div className={cls} style={t.reached ? { background: bg, borderColor: bg } : undefined}>
      <i>{fmtPct(y)}</i>
      <b>{symOf(r.isHK)}{t.target.toFixed(2)}</b>
      <span>{t.label}</span>
    </div>
  )
}

const CSS = `
.yg-page { min-height: 100vh; padding: 28px 20px 48px; background: #f5f6f8;
  font-family: "PingFang SC","Microsoft YaHei",sans-serif; color: #1f2328; }
.yg-page * { box-sizing: border-box; }
.yg-page .wrap { max-width: 1100px; margin: 0 auto; }
.yg-page .yg-topbar { display: flex; align-items: center; justify-content: space-between; margin: 0 0 10px; }
.yg-page .yg-back { display: inline-flex; align-items: center; gap: 2px; margin: 0 0 0 -6px;
  padding: 4px 6px; background: none; border: 0; cursor: pointer; color: #6b7280; font-size: 14px;
  font-family: inherit; }
.yg-page .yg-back svg { width: 18px; height: 18px; }
.yg-page .yg-back:active { color: #1f2328; }
.yg-page .yg-cfgbtn { flex: 0 0 auto; padding: 5px 12px; border: 1px solid #e5e7eb; border-radius: 999px;
  background: #fff; color: #6b7280; font-size: 13px; font-family: inherit; cursor: pointer; white-space: nowrap; }
.yg-page .yg-cfgbtn:active { background: #f0f1f4; }
.yg-page h1 { font-size: 26px; margin: 0 0 6px; }
.yg-page .sub { color: #6b7280; font-size: 13px; margin-bottom: 4px; }
.yg-page .legend { color: #6b7280; font-size: 12.5px; margin-bottom: 22px; }
.yg-page .legend b { font-weight: 700; }
.yg-page .legend .o { color: #ea580c; }
.yg-page .legend .g2 { color: #16a34a; }
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
.yg-page td.nm .yg-del { margin-right: 6px; vertical-align: middle; }
.yg-page .toolbar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 10px;
  padding: 10px 0; margin: -2px 0 14px; background: #f5f6f8; box-shadow: 0 6px 8px -6px rgba(0,0,0,.06); }
.yg-page .filter { flex: 1 1 auto; min-width: 0; display: flex; gap: 8px; flex-wrap: nowrap;
  overflow-x: auto; -webkit-overflow-scrolling: touch; }
.yg-page .filter::-webkit-scrollbar { display: none; }
.yg-page .chip { flex: 0 0 auto; padding: 5px 14px; border: 1px solid #e5e7eb; border-radius: 999px;
  background: #fff; color: #374151; font-size: 13px; font-family: inherit; cursor: pointer; white-space: nowrap; }
.yg-page .chip.active { background: #1f2328; color: #fff; border-color: #1f2328; }
.yg-page section { background: #fff; border-radius: 14px; padding: 14px 16px 18px;
  margin-bottom: 18px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
.yg-page h2 { font-size: 17px; margin: 4px 2px 12px; display: flex; align-items: center; gap: 8px; }
.yg-page h2 em { font-style: normal; font-size: 12px; color: #6b7280; background: #eef0f3;
  padding: 1px 8px; border-radius: 10px; }
.yg-page .orderbtn { position: relative; flex: 0 0 auto; white-space: nowrap; padding: 5px 12px;
  border: 1px solid #e5e7eb; border-radius: 999px; background: #fff; color: #6b7280; font-size: 12.5px;
  font-family: inherit; cursor: pointer; }
.yg-page .orderbtn::before { content: ''; position: absolute; left: -20px; top: 0; bottom: 0; width: 20px;
  background: linear-gradient(to right, rgba(245,246,248,0), #f5f6f8); pointer-events: none; }
.yg-page .orderbtn.on { background: #1f2328; color: #fff; border-color: #1f2328; }
.yg-page.mobile .orderbtn { width: 32px; height: 32px; padding: 0; border-radius: 50%; font-size: 15px;
  display: inline-flex; align-items: center; justify-content: center; }
.yg-page h2 .moves { margin-left: auto; display: inline-flex; gap: 6px; }
.yg-page h2 .moves button { width: 30px; height: 28px; border: 1px solid #e5e7eb; border-radius: 8px;
  background: #fff; color: #374151; font-size: 14px; line-height: 1; cursor: pointer; }
.yg-page h2 .moves button:disabled { color: #d1d5db; cursor: default; }
.yg-page h2 .moves button:active:not(:disabled) { background: #f0f1f4; }
.yg-page .tablewrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.yg-page table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.yg-page th, .yg-page td { padding: 7px 6px; text-align: center; border-bottom: 1px solid #eef0f3; }
.yg-page thead th { color: #6b7280; font-weight: 600; font-size: 12.5px; border-bottom: 1.5px solid #e5e7eb; white-space: nowrap; }
.yg-page thead th.th-s { color: #16a34a; }
.yg-page thead th.th-b { color: #7c3aed; }
.yg-page .sep { border-left: 1.5px solid #e5e7eb; }
.yg-page td.nm { text-align: left; font-weight: 600; white-space: nowrap; }
.yg-page .fav { background: none; border: 0; padding: 0; cursor: pointer; line-height: 0; color: #b6bcc6; vertical-align: middle; }
.yg-page td.nm .fav { margin-right: 5px; }
.yg-page .fav svg { width: 18px; height: 18px; }
.yg-page .fav.on { color: #f59e0b; }
.yg-page .fav.on svg { fill: #f59e0b; }
.yg-page .chead .fav { margin-left: 6px; align-self: center; }
.yg-page td.px { color: #374151; font-variant-numeric: tabular-nums; white-space: nowrap; }
.yg-page td.px i, .yg-page .chead .cpx i { font-style: normal; margin-left: 5px; font-size: 12px; font-variant-numeric: tabular-nums; }
.yg-page .chg-up { color: #dc2626; }
.yg-page .chg-dn { color: #16a34a; }
.yg-page .chg-flat { color: #9ca3af; }
.yg-page td.dv { color: #6b7280; font-variant-numeric: tabular-nums; }
.yg-page .cy-hi { color: #15803d; font-weight: 700; }
.yg-page .cy-mid { color: #d97706; font-weight: 600; }
.yg-page .cy-lo { color: #9ca3af; }
.yg-page td.g { font-variant-numeric: tabular-nums; line-height: 1.25; }
.yg-page td.g b { font-weight: 600; color: #1f2328; }
.yg-page td.g span { display: block; font-size: 10.5px; color: #9ca3af; margin-top: 1px; }
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
.yg-page .chead .cpx { font-size: 13px; color: #374151; font-variant-numeric: tabular-nums; }
.yg-page .chead .ccy { margin-left: auto; font-size: 14px; font-variant-numeric: tabular-nums; }
.yg-page .cmeta { font-size: 11.5px; color: #9ca3af; margin-top: 2px; }
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
`
