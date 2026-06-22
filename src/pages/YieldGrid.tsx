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
  ['电力', '长江电力', '600900', 1], ['电力', '国投电力', '600886', 0.5081],
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
const SECTOR_ORDER = ['电力', '银行', '保险', '能源', '通讯', '白色家电', '中药', '运输', '白酒', '消费', '其他']
// 「其他」始终可用，作为预判不到板块时的兜底归属
const SECTORS = SECTOR_ORDER.filter(s => s === '其他' || STOCKS.some(x => x.sector === s))
const ALL = '全部'

// 板块顺序（localStorage）：保留已保存且仍存在的板块，新板块追加到末尾
const ORDER_KEY = 'yg-sector-order'
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
const BUY_HYDRO = [0.04, 0.045, 0.05, 0.055, 0.06, 0.065, 0.07]
const BUY_DEFAULT = [0.05, 0.055, 0.06, 0.065, 0.07]
const SELL_HYDRO = [0.02, 0.025, 0.03]      // 升序：左低息=高价=强卖
const SELL_DEFAULT = [0.03, 0.035, 0.04]
// 中国广核、中国核电：低息成长属性，卖出档只展示价格，不着色、不判「已达」
const SELL_MUTED = new Set(['中国广核', '中国核电'])
const buyGridFor = (name: string) => (HYDRO.has(name) ? BUY_HYDRO : BUY_DEFAULT)
const sellGridFor = (name: string) => (HYDRO.has(name) ? SELL_HYDRO : SELL_DEFAULT)

// 已达档位的底色：买入越高息越深（橙），卖出越低息越深（绿）。键 = 股息率×1000
const BUY_BG: Record<number, string> = { 40: '#ffedd5', 45: '#fee3c4', 50: '#fed7aa', 55: '#fdc28a', 60: '#fdab6f', 65: '#fb9456', 70: '#f97c3c' }
const SELL_BG: Record<number, string> = { 20: '#22c55e', 25: '#4ade80', 30: '#86efac', 35: '#bbf7d0', 40: '#dcfce7' }
const hitBg = (kind: 'buy' | 'sell', y: number) => (kind === 'buy' ? BUY_BG : SELL_BG)[Math.round(y * 1000)]

const cyClass = (cy: number) => (cy >= 0.05 ? 'cy-hi' : cy >= 0.04 ? 'cy-mid' : 'cy-lo')

// 涨跌幅：A 股惯例涨红跌绿
const chgClass = (p: number) => (p > 0 ? 'chg-up' : p < 0 ? 'chg-dn' : 'chg-flat')
const chgText = (p: number) => `${p > 0 ? '+' : ''}${p.toFixed(2)}%`

type Row = { sector: string; name: string; code: string; dive: number; price: number; cy: number; pctChg: number }

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
type Custom = { sector: string; name: string; code: string; dive: number }
const CUSTOM_KEY = 'yg-custom'
function loadCustom(): Custom[] {
  try { const a = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); return Array.isArray(a) ? a : [] } catch { return [] }
}
function saveCustom(list: Custom[]) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)) } catch { /* ignore */ }
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

  // 自定义添加的标的，与静态列表合并（去重）
  const [custom, setCustom] = useState<Custom[]>(loadCustom)
  const allStocks = useMemo(() => {
    const seen = new Set(STOCKS.map(s => s.code))
    return [...STOCKS, ...custom.filter(c => !seen.has(c.code))]
  }, [custom])

  // 添加标的弹窗
  const [showAdd, setShowAdd] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [addForm, setAddForm] = useState<{ name: string; code: string; sector: string; dive: string }>({ name: '', code: '', sector: '', dive: '' })

  useEffect(() => {
    let alive = true
    if (q.trim().length < 1) { setResults([]); return }
    searchStocks(q.trim()).then(rs => {
      if (alive) setResults(rs.filter(r => !r.isHK && !r.isUS).slice(0, 8))  // 网格仅支持 A 股
    }).catch(() => { if (alive) setResults([]) })
    return () => { alive = false }
  }, [q])

  const selectResult = (r: SearchResult) => {
    const predicted = predictSector(r.name, r.code, 'A')
    setAddForm({ name: r.name, code: r.code, sector: SECTORS.includes(predicted) ? predicted : '其他', dive: '' })
    setQ(''); setResults([])
    fetchDividendHistory(r.code, false, false).then(h => {
      if (!h?.records?.length) return
      const guess = pickDividendForFill(h.records, 'A')
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
    const next = [...custom, { sector: addForm.sector, name: addForm.name, code: addForm.code, dive }]
    setCustom(next); saveCustom(next)
    setAddForm({ name: '', code: '', sector: '', dive: '' })
    setRows(null); setError('')
  }

  const deleteCustom = (code: string) => {
    const next = custom.filter(c => c.code !== code)
    setCustom(next); saveCustom(next)
    setRows(null); setError('')
  }

  useEffect(() => {
    fetchStockPrices(allStocks.map(s => ({ code: s.code })))
      .then(prices => {
        const out: Row[] = []
        let latest = ''
        for (const s of allStocks) {
          const q = prices[s.code]
          if (!q || !q.price) continue
          if (q.tradeDate && q.tradeDate > latest) latest = q.tradeDate
          out.push({ sector: s.sector, name: s.name, code: s.code, dive: s.dive, price: q.price, cy: s.dive / q.price, pctChg: q.pctChg ?? 0 })
        }
        if (!out.length) { setError('行情获取失败，请稍后刷新。'); return }
        setRows(out)
        setDate(latest ? `${latest.slice(0, 4)}-${latest.slice(4, 6)}-${latest.slice(6, 8)}` : '')
      })
      .catch(() => setError('行情获取失败，请稍后刷新。'))
  }, [custom])

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
        <h1>股息率网格买卖价位表</h1>
        <div className="sub">{error ? '现价获取失败' : date ? `现价为 ${date} ${priceLabel}` : '正在获取最新行情…'}</div>
        <div className="legend">买入/卖出价 = 25年股息 ÷ 目标股息率。<b className="o">橙色买入网格</b>（≥5%，水电≥4%）｜<b className="g2">绿色卖出网格</b>（≤4%，水电≤3%）。颜色越深信号越强，「已达」=现价已触及该档，否则显示需涨/跌幅度。仅供参考，非投资建议。</div>
        <button className="yg-addbar" onClick={() => setShowAdd(true)}>
          <span className="plus">＋</span> 添加标的
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
              aria-label={editOrder ? '完成排序' : '调整板块顺序'}
            >
              {editOrder ? (isMobile ? '✓' : '✓ 完成') : (isMobile ? '⇅' : '⇅ 调整板块顺序')}
            </button>
          )}
        </div>
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
          const sellCols = [...new Set(items.flatMap(r => sellGridFor(r.name)))].sort((a, b) => a - b)
          const buyCols = [...new Set(items.flatMap(r => buyGridFor(r.name)))].sort((a, b) => a - b)
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
                        <span className="cnm">{r.name}</span>
                        <span className="cpx">¥{r.price.toFixed(2)}<i className={chgClass(r.pctChg)}>{chgText(r.pctChg)}</i></span>
                        <span className={`ccy ${cyClass(r.cy)}`}>{(r.cy * 100).toFixed(2)}%</span>
                        <Star on={favs.has(r.code)} onClick={() => toggleFav(r.code)} />
                      </div>
                      <div className="cmeta">25年股息 {+r.dive.toFixed(4)}</div>
                      <div className="glabel sell">卖出网格</div>
                      <div className="tiers">
                        {sellGridFor(r.name).map(y => <Chip key={'s' + y} r={r} y={y} kind="sell" />)}
                      </div>
                      <div className="glabel buy">买入网格</div>
                      <div className="tiers">
                        {buyGridFor(r.name).map(y => <Chip key={'b' + y} r={r} y={y} kind="buy" />)}
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
                        {sellCols.map((y, i) => <th key={'s' + i} className="th-s">{(y * 100).toFixed(1)}%</th>)}
                        {buyCols.map((y, i) => <th key={'b' + i} className={`th-b${i === 0 ? ' sep' : ''}`}>{(y * 100).toFixed(1)}%</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(r => (
                        <tr key={r.name}>
                          <td className="nm"><Star on={favs.has(r.code)} onClick={() => toggleFav(r.code)} />{r.name}</td>
                          <td className="px">¥{r.price.toFixed(2)}<i className={chgClass(r.pctChg)}>{chgText(r.pctChg)}</i></td>
                          <td className={cyClass(r.cy)}>{(r.cy * 100).toFixed(2)}%</td>
                          <td className="dv">{+r.dive.toFixed(4)}</td>
                          {sellCols.map((y, i) => <Cell key={'s' + i} r={r} y={y} kind="sell" />)}
                          {buyCols.map((y, i) => <Cell key={'b' + i} r={r} y={y} kind="buy" sep={i === 0} />)}
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
          onClose={() => { setShowAdd(false); setQ(''); setResults([]); setAddForm({ name: '', code: '', sector: '', dive: '' }) }}
          title="添加标的（A股）"
        >
          <div className="space-y-3 pb-2">
            <div>
              <input className="input-field" placeholder="输入名称或代码搜索 A 股" value={q} onChange={e => setQ(e.target.value)} />
              {results.length > 0 && (
                <div className="mt-1 border border-gray-100 rounded-lg overflow-hidden">
                  {results.map(r => (
                    <button key={r.code} className="w-full text-left px-3 py-2 text-sm flex justify-between active:bg-gray-50" onClick={() => selectResult(r)}>
                      <span className="text-gray-800">{r.name}</span><span className="text-gray-400">{r.code}</span>
                    </button>
                  ))}
                </div>
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
                      <span className="text-gray-700">{c.name} <span className="text-gray-400 text-xs">{c.code} · {c.sector} · ¥{c.dive}</span></span>
                      <button className="text-red-500 text-xs px-2" onClick={() => deleteCustom(c.code)}>删除</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
function Cell({ r, y, kind, sep }: { r: Row; y: number; kind: 'buy' | 'sell'; sep?: boolean }) {
  const grid = kind === 'buy' ? buyGridFor(r.name) : sellGridFor(r.name)
  if (!grid.includes(y)) return <td className={`g blank${sep ? ' sep' : ''}`}>·</td>
  const t = tier(r, y, kind)
  // 广核/核电卖出：仅显示价格，不着色、不判已达
  if (kind === 'sell' && SELL_MUTED.has(r.name)) {
    return <td className={`g sell muted${sep ? ' sep' : ''}`}><b>¥{t.target.toFixed(2)}</b></td>
  }
  const cls = `g${kind === 'sell' ? ' sell' : ''}${t.reached ? ' hit' : ''}${sep ? ' sep' : ''}`
  return (
    <td className={cls} style={t.reached ? { background: hitBg(kind, y) } : undefined}>
      <b>¥{t.target.toFixed(2)}</b><span>{t.label}</span>
    </td>
  )
}

// 卡片档位 chip
function Chip({ r, y, kind }: { r: Row; y: number; kind: 'buy' | 'sell' }) {
  const t = tier(r, y, kind)
  // 广核/核电卖出：仅显示价格，不着色、不判已达
  if (kind === 'sell' && SELL_MUTED.has(r.name)) {
    return (
      <div className="tier sell muted">
        <i>{(y * 100).toFixed(1)}%</i>
        <b>¥{t.target.toFixed(2)}</b>
      </div>
    )
  }
  const cls = `tier${kind === 'sell' ? ' sell' : ''}${t.reached ? ' hit' : ''}`
  const bg = hitBg(kind, y)
  return (
    <div className={cls} style={t.reached ? { background: bg, borderColor: bg } : undefined}>
      <i>{(y * 100).toFixed(1)}%</i>
      <b>¥{t.target.toFixed(2)}</b>
      <span>{t.label}</span>
    </div>
  )
}

const CSS = `
.yg-page { min-height: 100vh; padding: 28px 20px 48px; background: #f5f6f8;
  font-family: "PingFang SC","Microsoft YaHei",sans-serif; color: #1f2328; }
.yg-page * { box-sizing: border-box; }
.yg-page .wrap { max-width: 1100px; margin: 0 auto; }
.yg-page .yg-back { display: inline-flex; align-items: center; gap: 2px; margin: 0 0 10px -6px;
  padding: 4px 6px; background: none; border: 0; cursor: pointer; color: #6b7280; font-size: 14px;
  font-family: inherit; }
.yg-page .yg-back svg { width: 18px; height: 18px; }
.yg-page .yg-back:active { color: #1f2328; }
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
