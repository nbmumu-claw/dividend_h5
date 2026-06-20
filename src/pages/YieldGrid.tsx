import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchStockPrices } from '../utils/api'

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
  ['保险', '中国平安', '601318', 2.7], ['保险', '中国太保', '601601', 1.15],
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

const SECTORS = [...new Set(STOCKS.map(s => s.sector))]
const ALL = '全部'

const GRID_DEFAULT = [0.05, 0.055, 0.06, 0.065, 0.07]
const GRID_POWER = [0.04, 0.045, 0.05, 0.055, 0.06, 0.065, 0.07]
const SECTOR_GRID: Record<string, number[]> = { 电力: GRID_POWER }
const gridFor = (s: string) => SECTOR_GRID[s] || GRID_DEFAULT
const cyClass = (cy: number) => (cy >= 0.05 ? 'cy-hi' : cy >= 0.04 ? 'cy-mid' : 'cy-lo')

type Row = { sector: string; name: string; dive: number; price: number; cy: number }

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

function tierData(price: number, dive: number, y: number) {
  const buy = dive / y
  const hit = price <= buy
  return { buy, hit, drop: hit ? 0 : Math.round(((price - buy) / price) * 100) }
}

export default function YieldGrid() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [date, setDate] = useState('')
  const [error, setError] = useState('')
  const [active, setActive] = useState<string>(ALL)

  useEffect(() => {
    fetchStockPrices(STOCKS.map(s => ({ code: s.code })))
      .then(prices => {
        const out: Row[] = []
        let latest = ''
        for (const s of STOCKS) {
          const q = prices[s.code]
          if (!q || !q.price) continue
          if (q.tradeDate && q.tradeDate > latest) latest = q.tradeDate
          out.push({ sector: s.sector, name: s.name, dive: s.dive, price: q.price, cy: s.dive / q.price })
        }
        if (!out.length) { setError('行情获取失败，请稍后刷新。'); return }
        setRows(out)
        setDate(latest ? `${latest.slice(0, 4)}-${latest.slice(4, 6)}-${latest.slice(6, 8)}` : '')
      })
      .catch(() => setError('行情获取失败，请稍后刷新。'))
  }, [])

  // 按板块分组（保持配置中板块出现顺序），组内按现股息率倒序
  const sectors: { sector: string; items: Row[] }[] = []
  for (const r of rows || []) {
    let g = sectors.find(x => x.sector === r.sector)
    if (!g) { g = { sector: r.sector, items: [] }; sectors.push(g) }
    g.items.push(r)
  }
  for (const g of sectors) g.items.sort((a, b) => b.cy - a.cy)

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
        <h1>股息率网格买入价位表</h1>
        <div className="sub">{error ? '现价获取失败' : date ? `现价为 ${date} 收盘价` : '正在获取最新行情…'}</div>
        <div className="legend">买入价 = 25年股息 ÷ 目标股息率；档位 5%~7%（电力板块从 4% 起）；<b>橘色=现价已达到该档股息率</b>，否则显示现价还需下跌幅度。仅供参考，非投资建议。</div>
        <div className="filter">
          <button className={`chip${active === ALL ? ' active' : ''}`} onClick={() => setActive(ALL)}>{ALL}</button>
          {SECTORS.map(s => (
            <button key={s} className={`chip${active === s ? ' active' : ''}`} onClick={() => setActive(s)}>{s}</button>
          ))}
        </div>
        {error && <div className="state">{error}</div>}
        {!error && !rows && <div className="state">加载中…</div>}
        {sectors.filter(({ sector }) => active === ALL || sector === active).map(({ sector, items }) => {
          const grid = gridFor(sector)
          return (
            <section key={sector}>
              <h2>{sector} <em>{items.length}</em></h2>
              {isMobile ? (
                <div className="cards">
                  {items.map(r => (
                    <div className="card" key={r.name}>
                      <div className="chead">
                        <span className="cnm">{r.name}</span>
                        <span className="cpx">¥{r.price.toFixed(2)}</span>
                        <span className={`ccy ${cyClass(r.cy)}`}>{(r.cy * 100).toFixed(2)}%</span>
                      </div>
                      <div className="cmeta">25年股息 {+r.dive.toFixed(4)}</div>
                      <div className="tiers">
                        {grid.map((y, i) => {
                          const t = tierData(r.price, r.dive, y)
                          return (
                            <div key={i} className={`tier${t.hit ? ' hit' : ''}`}>
                              <i>{(y * 100).toFixed(1)}%</i>
                              <b>¥{t.buy.toFixed(2)}</b>
                              <span>{t.hit ? '已达' : `↓${t.drop}%`}</span>
                            </div>
                          )
                        })}
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
                        {grid.map((y, i) => <th key={i}>{(y * 100).toFixed(1)}%</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(r => (
                        <tr key={r.name}>
                          <td className="nm">{r.name}</td>
                          <td className="px">¥{r.price.toFixed(2)}</td>
                          <td className={cyClass(r.cy)}>{(r.cy * 100).toFixed(2)}%</td>
                          <td className="dv">{+r.dive.toFixed(4)}</td>
                          {grid.map((y, i) => {
                            const t = tierData(r.price, r.dive, y)
                            return (
                              <td key={i} className={`g${t.hit ? ' hit' : ''}`}>
                                <b>¥{t.buy.toFixed(2)}</b><span>{t.hit ? '已达' : `↓${t.drop}%`}</span>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )
        })}
      </div>
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
.yg-page .legend b { color: #ea580c; }
.yg-page .state { color: #9ca3af; font-size: 13px; padding: 8px 2px; }
.yg-page .filter { position: sticky; top: 0; z-index: 5; display: flex; gap: 8px; flex-wrap: nowrap;
  overflow-x: auto; -webkit-overflow-scrolling: touch; padding: 10px 0; margin: -2px 0 14px;
  background: #f5f6f8; box-shadow: 0 6px 8px -6px rgba(0,0,0,.06); }
.yg-page .filter::-webkit-scrollbar { display: none; }
.yg-page .chip { flex: 0 0 auto; padding: 5px 14px; border: 1px solid #e5e7eb; border-radius: 999px;
  background: #fff; color: #374151; font-size: 13px; font-family: inherit; cursor: pointer; white-space: nowrap; }
.yg-page .chip.active { background: #1f2328; color: #fff; border-color: #1f2328; }
.yg-page section { background: #fff; border-radius: 14px; padding: 14px 16px 18px;
  margin-bottom: 18px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
.yg-page h2 { font-size: 17px; margin: 4px 2px 12px; display: flex; align-items: center; gap: 8px; }
.yg-page h2 em { font-style: normal; font-size: 12px; color: #6b7280; background: #eef0f3;
  padding: 1px 8px; border-radius: 10px; }
.yg-page .tablewrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.yg-page table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.yg-page th, .yg-page td { padding: 7px 6px; text-align: center; border-bottom: 1px solid #eef0f3; }
.yg-page thead th { color: #6b7280; font-weight: 600; font-size: 12.5px; border-bottom: 1.5px solid #e5e7eb; }
.yg-page thead th:nth-child(n+5) { color: #7c3aed; }
.yg-page td.nm { text-align: left; font-weight: 600; white-space: nowrap; }
.yg-page td.px { color: #374151; font-variant-numeric: tabular-nums; }
.yg-page td.dv { color: #6b7280; font-variant-numeric: tabular-nums; }
.yg-page .cy-hi { color: #15803d; font-weight: 700; }
.yg-page .cy-mid { color: #d97706; font-weight: 600; }
.yg-page .cy-lo { color: #9ca3af; }
.yg-page td.g { font-variant-numeric: tabular-nums; line-height: 1.25; }
.yg-page td.g b { font-weight: 600; color: #1f2328; }
.yg-page td.g span { display: block; font-size: 10.5px; color: #9ca3af; margin-top: 1px; }
.yg-page td.g.hit { background: #fed7aa; border-radius: 6px; }
.yg-page td.g.hit b { color: #9a3412; }
.yg-page td.g.hit span { color: #ea580c; font-weight: 600; }

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
.yg-page .tiers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 9px; }
.yg-page .tier { border: 1px solid #eef0f3; border-radius: 8px; padding: 5px 2px 6px; text-align: center;
  font-variant-numeric: tabular-nums; }
.yg-page .tier i { display: block; font-style: normal; font-size: 10.5px; color: #7c3aed; }
.yg-page .tier b { display: block; font-size: 13.5px; margin-top: 1px; }
.yg-page .tier span { display: block; font-size: 10px; color: #9ca3af; margin-top: 1px; }
.yg-page .tier.hit { background: #fed7aa; border-color: #fed7aa; }
.yg-page .tier.hit b { color: #9a3412; }
.yg-page .tier.hit span { color: #ea580c; font-weight: 600; }
`
