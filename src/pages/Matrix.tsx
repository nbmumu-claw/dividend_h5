import { useSearchParams, useNavigate } from 'react-router-dom'
import { useCallback, useMemo, useState, useEffect, useRef } from 'react'
import Disclaimer from '../components/Disclaimer'
import { fetchDividendHistory } from '../utils/dividendHistory'
import type { DividendHistory } from '../utils/dividendHistory'
import { fetchFundDividend } from '../utils/api'
import { fetchListingYear } from '../utils/listingDate'
import { isBShare } from '../utils/market'
import { useStore } from '../store'
import { fetchPeriodBoll, type BollPeriod, type PeriodBoll } from '../utils/periodBoll'
import WeeklyBollPosition from '../components/WeeklyBollPosition'
import BollPeriodSwitch, { BOLL_PERIOD_LABELS } from '../components/BollPeriodSwitch'
import BollPeriodOverview from '../components/BollPeriodOverview'

const YIELD_RATES = [3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0]

// 基金（场内 ETF / 场外）分红事件 → 历史分红结构（按年份汇总倒序，算连续派息年数）
function fundEventsToHistory(events: { recordDate: string; perShare: number }[]): DividendHistory {
  const byYear: Record<number, number> = {}
  for (const e of events) {
    const y = parseInt(e.recordDate.slice(0, 4))
    if (!y) continue
    byYear[y] = parseFloat(((byYear[y] || 0) + e.perShare).toFixed(4))
  }
  const records = Object.entries(byYear)
    .map(([y, v]) => ({ year: parseInt(y), perShare: v }))
    .sort((a, b) => b.year - a.year)
    .slice(0, 10)
  let consecutiveYears = 0
  for (let i = 0; i < records.length; i++) {
    if (i === 0 || records[i].year === records[i - 1].year - 1) consecutiveYears++
    else break
  }
  return { records, consecutiveYears }
}
// 水电（低息、估值另算）起步门槛 4%，其余 5%（与网格页 YieldGrid 的 HYDRO 一致）
const HYDRO = new Set(['国投电力', '长江电力'])
const simBaseYield = (name: string) => (HYDRO.has(name) ? 4 : 5)
// 档位股数键：无点形式（CloudBase NoSQL 会把键里的 "." 当嵌套路径，"6.0" 会被存坏）；
// 去尾零保证 0.5 步长键与历史一致（6.0→6_0、5.5→5_5），0.25 步长则为 5_25
const simKey = (rate: number) => rate.toFixed(2).replace(/0$/, '').replace('.', '_')
// 金额简写：≥1万显示「X.X万」，否则千分位整数
const fmtAmt = (a: number) => (a >= 10000 ? (a / 10000).toFixed(1) + '万' : Math.round(a).toLocaleString('en-US'))

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className="w-4 h-4 text-gray-400 shrink-0" style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function Matrix() {
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const code = params.get('code') || ''
  const name = params.get('name') || ''
  const dividend = parseFloat(params.get('dividend') || '0')
  const currentPrice = parseFloat(params.get('price') || '0')
  const isHK = params.get('isHK') === 'true'
  const isUS = params.get('isUS') === 'true'
  const cs = isHK ? 'HK$' : isUS ? '$' : isBShare(code) ? (/^200/.test(code) ? 'HK$' : '$') : '¥'

  const rows = useMemo(() => {
    return YIELD_RATES.map(rate => {
      const targetPrice = dividend > 0 ? (dividend / (rate / 100)) : 0
      const diff = currentPrice > 0 ? ((currentPrice - targetPrice) / targetPrice) * 100 : 0
      return { rate, targetPrice, diff }
    })
  }, [dividend, currentPrice])

  const currentYield = currentPrice > 0 ? (dividend / currentPrice) * 100 : 0
  const [bollPeriod, setBollPeriod] = useState<BollPeriod>('week')
  const [bollByPeriod, setBollByPeriod] = useState<Record<BollPeriod, PeriodBoll | null>>(() => ({ day: null, week: null, month: null }))
  const [bollLoading, setBollLoading] = useState<Partial<Record<BollPeriod, boolean>>>({})
  const loadedBollPeriods = useRef<Partial<Record<BollPeriod, string>>>({})
  const requestedBollPeriods = useRef<Partial<Record<BollPeriod, string>>>({})
  const boll = bollByPeriod[bollPeriod]

  const loadBollPeriod = useCallback((period: BollPeriod): Promise<void> => {
    if (!code || isUS || isHK) return Promise.resolve()
    if (loadedBollPeriods.current[period] === code || requestedBollPeriods.current[period] === code) return Promise.resolve()
    requestedBollPeriods.current[period] = code
    setBollLoading(current => ({ ...current, [period]: true }))
    return fetchPeriodBoll(period, [{ code }])
      .then(data => {
        if (requestedBollPeriods.current[period] !== code) return
        setBollByPeriod(current => ({ ...current, [period]: data[code] || null }))
        loadedBollPeriods.current[period] = code
      })
      .catch(() => {
        if (requestedBollPeriods.current[period] === code) setBollByPeriod(current => ({ ...current, [period]: null }))
      })
      .finally(() => {
        if (requestedBollPeriods.current[period] !== code) return
        requestedBollPeriods.current[period] = undefined
        setBollLoading(current => ({ ...current, [period]: false }))
      })
  }, [code, isHK, isUS])
  useEffect(() => {
    if (!code || isUS || isHK) {
      setBollByPeriod({ day: null, week: null, month: null })
      setBollLoading({})
      return
    }
    void loadBollPeriod(bollPeriod)
  }, [bollPeriod, code, isHK, isUS, loadBollPeriod])
  useEffect(() => {
    if (loadedBollPeriods.current.week !== code) return
    const timer = window.setTimeout(() => {
      void loadBollPeriod('day').finally(() => loadBollPeriod('month'))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [bollByPeriod.week, code, loadBollPeriod])

  const scrollRef = useRef<HTMLDivElement>(null)
  const currentColRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = scrollRef.current
    const el = currentColRef.current
    if (container && el) {
      container.scrollLeft = el.offsetLeft - container.clientWidth / 2 + el.clientWidth / 2
    }
  }, [rows])

  const [divHistory, setDivHistory] = useState<DividendHistory | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [listingYear, setListingYear] = useState<number | null>(null)

  useEffect(() => {
    if (!code) return
    setHistoryLoading(true)
    Promise.all([
      fetchDividendHistory(code, isHK, isUS),
      (isHK || isUS) ? Promise.resolve(null) : fetchListingYear(code),
    ]).then(async ([h, y]) => {
      let hist = h
      // 股票分红源为空且为 A 股代码（场内 ETF / 场外基金）→ 退回基金分红源
      if ((!hist || !hist.records.length) && !isHK && !isUS) {
        const evs = await fetchFundDividend(code).catch(() => [])
        if (evs.length) hist = fundEventsToHistory(evs)
      }
      setDivHistory(hist)
      setListingYear(y)
      setHistoryLoading(false)
    })
  }, [code, isHK, isUS])

  // 近 5 年平均每股派息（不足 5 年取实际年数）
  const avgDps = useMemo(() => {
    const recs = divHistory?.records?.slice(0, 5) ?? []
    if (!recs.length) return { avg: 0, years: 0 }
    const sum = recs.reduce((s, r) => s + r.perShare, 0)
    return { avg: sum / recs.length, years: recs.length }
  }, [divHistory])

  // ── 模拟加仓策略 ──────────────────────────────────────────────
  const held = useStore(s => s.watchlist.find(w => w.code === code))
  const strat = useStore(s => s.simStrategy[code])
  const setSimStrategy = useStore(s => s.setSimStrategy)
  const [simOpen, setSimOpen] = useState(true)  // 默认展开
  const [histOpen, setHistOpen] = useState(true) // 默认展开

  const sim = useMemo(() => {
    const shares = Number(held?.shares) || 0
    const costStr = held?.costPrice
    const cost = costStr != null && costStr !== '' ? parseFloat(costStr) : NaN
    const hasHolding = shares > 0 && isFinite(cost)

    // 现价对应股息率（加仓只能从现价起，不可能在比现价更高的价位买）
    const curYield = currentPrice > 0 && dividend > 0 ? (dividend / currentPrice) * 100 : 0

    // 加仓档：首档 +「现价档之后 3 个默认整档」+「再 3 个可选整档（用户延长）」
    //  · 现价股息率 < 门槛：尚未到价，首档=门槛档（等跌到 4%/5%）
    //  · 现价股息率 ≥ 门槛：当下可买，首档=现价（按真实股息率/现价），之后取现价上方最近整档起每 +0.5%
    const base = simBaseYield(name) // 起步门槛：水电 4%，其余 5%
    const step = strat?.step === 0.25 ? 0.25 : 0.5 // 档间隔（步长），默认 0.5%
    const r2 = (x: number) => Math.round(x * 100) / 100 // 取两位小数，兼容 0.25 步长
    type Step = { key: string; rate: number; targetPrice: number; isCurrent: boolean; optional: boolean }
    const allSteps: Step[] = []
    if (curYield > 0) {
      let firstCheckpoint: number
      if (curYield < base) {
        allSteps.push({ key: simKey(base), rate: base, targetPrice: dividend / (base / 100), isCurrent: false, optional: false })
        firstCheckpoint = r2(base + step)
      } else {
        allSteps.push({ key: 'cur', rate: curYield, targetPrice: currentPrice, isCurrent: true, optional: false })
        firstCheckpoint = r2(Math.floor(curYield / step + 1e-9) * step + step) // 严格上方最近档
      }
      // 前 3 档默认显示，后 3 档可选（用户延长）
      for (let i = 0; i < 6; i++) {
        const rate = r2(firstCheckpoint + i * step)
        allSteps.push({ key: simKey(rate), rate, targetPrice: dividend / (rate / 100), isCurrent: false, optional: i >= 3 })
      }
    }
    // 可延长的 3 档股息率；延长终点存 simStrategy.end（≤该值的可选档才显示）
    const optionalRates = allSteps.filter(s => s.optional).map(s => s.rate)
    const extendTo = strat?.end && optionalRates.includes(strat.end) ? strat.end : 0
    const steps = allSteps.filter(s => !s.optional || s.rate <= extendTo)

    // 种子：有持仓用现有股数 + 除权后成本（绝不改真实数据，仅作推演起点）
    let cumShares = hasHolding ? shares : 0
    let cumAmount = hasHolding ? shares * cost : 0
    const ladder = steps.map((s, i) => {
      // 默认：首档（现价 / 5%）100 股，其余档 0 股，用户按需填
      const stepShares = strat?.shares?.[s.key] ?? (i === 0 ? 100 : 0)
      cumShares += stepShares
      cumAmount += stepShares * s.targetPrice
      return { ...s, stepShares, cumShares, avgCost: cumShares > 0 ? cumAmount / cumShares : 0 }
    })
    // 较现成本：有持仓比现成本；无持仓比首档摊薄成本；摊薄未变（如本档 0 股）记 —
    const baseline = hasHolding ? cost : (ladder[0]?.avgCost ?? 0)
    const rows = ladder.map(r => ({
      ...r,
      deltaPct: baseline > 0 && Math.abs(r.avgCost - baseline) > 1e-9 ? ((r.avgCost - baseline) / baseline) * 100 : null,
    }))

    return { shares, cost, hasHolding, curYield, base, step, rows, optionalRates, extendTo }
  }, [held, dividend, currentPrice, strat, name])

  const setStepShares = (key: string, val: string, snap = false) => {
    let n = Math.max(0, Math.floor(Number(val) || 0))
    if (snap) n = Math.round(n / 100) * 100 // 失焦时吸附到 100 的整数倍
    setSimStrategy(code, { shares: { ...(strat?.shares ?? {}), [key]: n } })
  }

  return (
    <div className="page-content page-narrow">
      {/* Header */}
      <div className="relative flex items-center px-4 pt-12 pb-4">
        <button onClick={() => navigate(-1)} className="p-1.5 text-gray-500">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div className="absolute inset-x-0 text-center pointer-events-none">
          <h1 className="text-base font-bold text-gray-900">{name} 决策矩阵</h1>
          <p className="text-xs text-gray-400">代码 {code} · 每股红利 {cs}{dividend}</p>
        </div>
      </div>

      <div className="px-4 mb-4">
        {/* Current status */}
        <div className="card p-4 mb-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-lg font-bold text-gray-900">{cs}{currentPrice.toFixed(2)}</div>
              <div className="text-xs text-gray-400">当前价格</div>
            </div>
            <div>
              <div className="text-lg font-bold text-red-600">{currentYield.toFixed(2)}%</div>
              <div className="text-xs text-gray-400">当前股息率</div>
            </div>
            <div>
              <div className="text-lg font-bold text-gray-900">{cs}{dividend}</div>
              <div className="text-xs text-gray-400">每股红利</div>
            </div>
          </div>
          {!isUS && (
            <div className="mt-4 pt-3 border-t border-gray-100" data-testid="weekly-boll-position">
              <div className="mb-2 flex items-start justify-between gap-3 px-0.5">
                <div className="min-w-0 pt-0.5">
                  <div className="text-[11px] font-semibold tracking-wide text-gray-500">{BOLL_PERIOD_LABELS[bollPeriod]} BOLL</div>
                  <div className="mt-0.5 text-[10px] text-gray-300">
                    {isHK ? '港股暂不支持' : `前复权 · ${boll?.periodDate || (bollLoading[bollPeriod] ? '加载中' : '暂无数据')}`}
                  </div>
                  {bollPeriod === 'month' && !isHK && <div className="mt-0.5 text-[10px] text-amber-600">{boll?.periodDate ? `截至 ${boll.periodDate.slice(5)} · ` : ''}本月未完</div>}
                </div>
                <BollPeriodSwitch value={bollPeriod} onChange={setBollPeriod} />
              </div>
              <BollPeriodOverview values={bollByPeriod} currentPrice={currentPrice} loading={bollLoading} unsupported={isHK} />
              <WeeklyBollPosition boll={boll} currentPrice={currentPrice} symbol={cs} dividend={dividend} loading={Boolean(bollLoading[bollPeriod])} period={bollPeriod} unavailableText={isHK ? '港股暂不支持 BOLL' : undefined} />
            </div>
          )}
        </div>

        {/* Matrix timeline */}
        <div className="card">
          <div ref={scrollRef} className="matrix-scroll">
            <div style={{ display: 'flex', width: 'max-content', alignItems: 'flex-end', padding: '16px 8px 0' }}>
              {rows.map(row => {
                const isCurrent = Math.abs(row.rate - currentYield) < 0.25
                const gapText = isCurrent
                  ? '← 此处'
                  : currentPrice > 0
                    ? `${row.diff > 0 ? '高' : '低'} ${Math.abs(row.diff).toFixed(1)}%`
                    : '—'
                return (
                  <div
                    key={row.rate}
                    ref={isCurrent ? currentColRef : undefined}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 64 }}
                  >
                    {/* card */}
                    <div style={{
                      width: 56, height: 72, borderRadius: 10,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      background: isCurrent ? 'var(--primary)' : '#fff',
                      boxShadow: isCurrent ? '0 4px 16px rgba(224,48,37,.3)' : '0 1px 3px rgba(0,0,0,.06)',
                      transform: isCurrent ? 'translateY(-6px)' : undefined,
                      flexShrink: 0,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: isCurrent ? '#fff' : '#333' }}>
                        {row.rate.toFixed(1)}%
                      </div>
                      <div style={{ fontSize: 10, color: isCurrent ? 'rgba(255,255,255,.75)' : '#999', margin: '3px 0 2px' }}>
                        {cs}{row.targetPrice.toFixed(2)}
                      </div>
                      <div style={{
                        fontSize: isCurrent ? 9 : 10, fontWeight: 700,
                        color: isCurrent ? '#fff' : row.diff > 0 ? '#e53935' : '#43a047',
                        background: isCurrent ? 'rgba(255,255,255,.2)' : undefined,
                        borderRadius: isCurrent ? 3 : undefined,
                        padding: isCurrent ? '1px 4px' : undefined,
                      }}>
                        {gapText}
                      </div>
                    </div>
                    {/* connector line */}
                    <div style={{ width: '100%', height: 2, background: isCurrent ? 'var(--primary)' : '#e8e8e8' }} />
                    {/* dot */}
                    <div
                      className={isCurrent ? 'matrix-dot-current' : undefined}
                      style={{
                        width: 8, height: 8, borderRadius: '50%', marginTop: 2,
                        background: isCurrent ? 'var(--primary)' : '#ddd',
                        border: '2px solid #f5f5f5',
                        flexShrink: 0,
                      }}
                    />
                    {/* bottom padding */}
                    <div style={{ height: 12 }} />
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-400 mt-3 px-1">
          左右滑动查看不同股息率目标下的买入价参考，当前价格对应的股息率已高亮标注。
        </p>

        {/* 模拟加仓（默认折叠） */}
        <div className="card mt-4">
          <button onClick={() => setSimOpen(o => !o)} className="w-full flex items-center justify-between p-4 text-left">
            <div>
              <div className="text-sm font-semibold text-gray-800">模拟加仓</div>
              <div className="text-xs text-gray-400 mt-0.5">
                {sim.hasHolding
                  ? '在现有持仓上，从现价起逐档加仓，推演摊薄成本'
                  : '当前无持仓，从现价起逐档建仓，推演摊薄成本'}
              </div>
            </div>
            <Chevron open={simOpen} />
          </button>
          {simOpen && (
            <div className="px-4 pb-4">
              {sim.rows.length === 0 ? (
                <div className="text-xs text-gray-400 text-center py-4">暂无现价或每股红利数据，无法推演</div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs text-gray-500">
                        <th className="text-left py-1.5 font-medium">股息率</th>
                        <th className="text-right py-1.5 font-medium">目标价</th>
                        <th className="text-right py-1.5 font-medium">本档股数</th>
                        <th className="text-right py-1.5 font-medium">累计</th>
                        <th className="text-right py-1.5 font-medium">摊薄成本</th>
                        <th className="text-right py-1.5 font-medium">较现成本</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sim.hasHolding && (
                        <tr className="border-b border-gray-100 bg-gray-50/60">
                          <td className="py-2 text-gray-700">
                            <div>{sim.cost > 0 ? `${((dividend / sim.cost) * 100).toFixed(2)}%` : '持仓'}</div>
                            <div className="text-[10px] text-gray-400 leading-none mt-0.5">成本</div>
                          </td>
                          <td className="py-2 text-right text-gray-700">{cs}{sim.cost.toFixed(2)}</td>
                          <td className="py-2 text-right text-gray-400">
                            <div>{sim.shares}</div>
                            {sim.cost > 0 && <div className="text-[10px] leading-none mt-0.5">{cs}{fmtAmt(sim.shares * sim.cost)}</div>}
                          </td>
                          <td className="py-2 text-right text-gray-700">
                            <div>{sim.shares}</div>
                            {sim.shares > 0 && dividend > 0 && <div className="text-[10px] text-gray-400 leading-none mt-0.5">{cs}{fmtAmt(sim.shares * dividend)}</div>}
                          </td>
                          <td className="py-2 text-right font-semibold text-gray-900">{cs}{sim.cost.toFixed(2)}</td>
                          <td className="py-2 text-right text-gray-300">—</td>
                        </tr>
                      )}
                      {sim.rows.map(r => (
                        <tr key={r.key} className={`border-b border-gray-50 last:border-0 ${r.isCurrent ? 'bg-red-50/60' : ''}`}>
                          <td className="py-2 text-gray-700">
                            <div>{r.isCurrent || sim.step === 0.25 ? r.rate.toFixed(2) : r.rate.toFixed(1)}%</div>
                            {r.isCurrent && <div className="text-[10px] text-gray-400 leading-none mt-0.5">现价</div>}
                          </td>
                          <td className="py-2 text-right text-gray-700">{cs}{r.targetPrice.toFixed(2)}</td>
                          <td className="py-1 text-right">
                            <input
                              type="number" inputMode="numeric" min={0} step={100} placeholder="0"
                              value={r.stepShares || ''}
                              onChange={e => setStepShares(r.key, e.target.value)}
                              onBlur={e => setStepShares(r.key, e.target.value, true)}
                              className="w-16 text-right border border-gray-200 rounded-md px-1.5 py-1 text-base focus:border-red-400 focus:outline-none"
                            />
                            {r.stepShares > 0 && <div className="text-[10px] text-gray-400 leading-none mt-1">{cs}{fmtAmt(r.stepShares * r.targetPrice)}</div>}
                          </td>
                          <td className="py-2 text-right text-gray-700">
                            <div>{r.cumShares}</div>
                            {r.cumShares > 0 && dividend > 0 && <div className="text-[10px] text-gray-400 leading-none mt-0.5">{cs}{fmtAmt(r.cumShares * dividend)}</div>}
                          </td>
                          <td className="py-2 text-right font-semibold text-gray-900">{cs}{r.avgCost.toFixed(2)}</td>
                          <td className="py-2 text-right text-xs">
                            {r.deltaPct == null ? (
                              <span className="text-gray-300">—</span>
                            ) : (
                              <span className={r.deltaPct <= 0 ? 'text-green-600' : 'text-red-500'}>
                                {r.deltaPct <= 0 ? '↓' : '↑'}{Math.abs(r.deltaPct).toFixed(1)}%
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>

                  {/* 步长 + 加档（同一行，过窄则横向滚动） */}
                  <div className="flex items-center gap-x-3 mt-3 overflow-x-auto">
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs text-gray-500 shrink-0">步长</span>
                      <div className="flex gap-1">
                        {[0.5, 0.25].map(st => (
                          <button
                            key={st}
                            onClick={() => setSimStrategy(code, { step: st })}
                            className={`px-2 py-1 rounded-lg text-xs border ${sim.step === st ? 'bg-red-600 text-white border-red-600' : 'border-gray-200 text-gray-600'}`}
                          >
                            {st}%
                          </button>
                        ))}
                      </div>
                    </div>
                    {sim.optionalRates.length > 0 && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-xs text-gray-500 shrink-0">加档</span>
                        <div className="flex gap-1">
                          {sim.optionalRates.map(o => (
                            <button
                              key={o}
                              onClick={() => setSimStrategy(code, { end: sim.extendTo === o ? 0 : o })}
                              className={`px-2 py-1 rounded-lg text-xs border ${sim.extendTo >= o && sim.extendTo > 0 ? 'bg-red-600 text-white border-red-600' : 'border-gray-200 text-gray-600'}`}
                            >
                              {sim.step === 0.25 ? o.toFixed(2) : o.toFixed(1)}%
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-gray-400 mt-3">
                    首档为现价（现价股息率 ≥ {sim.base}% 时可当下买入，否则等跌到 {sim.base}%），之后每 {sim.step}% 股息率为一档（目标价 = 每股红利 ÷ 股息率）；默认 3 档，可再加 3 档。每档股数可改，仅用于推演，不含手续费、不影响真实持仓。
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        {/* 历史分红（默认展开） */}
        {(
          <div className="card mt-4">
            <button onClick={() => setHistOpen(o => !o)} className="w-full flex items-center justify-between p-4 text-left">
              <div>
                <div className="text-sm font-semibold text-gray-800">历史分红</div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {isHK ? '近10年历史派息记录（HKD，税前）' : isUS ? '近10年历史派息记录（USD，税前）' : isBShare(code) ? '近10年历史派息记录（税前）' : '近10年已实施 / 已通过分配记录，每股派息为税前金额'}
                </div>
              </div>
              <Chevron open={histOpen} />
            </button>
            {histOpen && (
            <div className="px-4 pb-4">
            {historyLoading ? (
              <div className="text-xs text-gray-400 text-center py-4">加载中…</div>
            ) : !divHistory || divHistory.records.length === 0 ? (
              <div className="text-xs text-gray-400 text-center py-4">暂无历史分红数据</div>
            ) : (
              <>
                {/* 摘要指标 */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <div className="text-xl font-bold text-red-600">{divHistory.consecutiveYears}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      连续派息年数
                      {listingYear && (
                        <span className="ml-1 text-gray-300">/ {listingYear}年上市</span>
                      )}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <div className="text-xl font-bold text-gray-900">{cs}{avgDps.avg.toFixed(3)}</div>
                    <div className="text-xs text-gray-400 mt-0.5">近{avgDps.years}年均每股派息</div>
                  </div>
                </div>

                {/* 逐年明细 */}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-1.5 font-medium text-gray-500 text-xs">年份</th>
                      <th className="text-right py-1.5 font-medium text-gray-500 text-xs">每股派息</th>
                      <th className="text-right py-1.5 font-medium text-gray-500 text-xs">同比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {divHistory.records.map((r, i) => {
                      const prev = divHistory.records[i + 1]
                      const yoy = prev && prev.perShare > 0
                        ? ((r.perShare - prev.perShare) / prev.perShare) * 100
                        : null
                      return (
                        <tr key={r.year} className="border-b border-gray-50 last:border-0">
                          <td className="py-2 text-gray-700">{r.year}</td>
                          <td className="py-2 text-right font-semibold text-gray-900">{cs}{r.perShare.toFixed(3)}</td>
                          <td className="py-2 text-right text-xs">
                            {yoy === null ? (
                              <span className="text-gray-300">—</span>
                            ) : (
                              <span className={yoy >= 0 ? 'text-red-500' : 'text-green-600'}>
                                {yoy >= 0 ? '+' : ''}{yoy.toFixed(1)}%
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </>
            )}
            </div>
            )}
          </div>
        )}
      </div>
      <Disclaimer />
    </div>
  )
}
