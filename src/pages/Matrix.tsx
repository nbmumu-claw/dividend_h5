import { useSearchParams, useNavigate } from 'react-router-dom'
import { useMemo, useState, useEffect, useRef } from 'react'
import Disclaimer from '../components/Disclaimer'
import { fetchDividendHistory } from '../utils/dividendHistory'
import type { DividendHistory } from '../utils/dividendHistory'
import { fetchListingYear } from '../utils/listingDate'

const YIELD_RATES = [3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0]

export default function Matrix() {
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const code = params.get('code') || ''
  const name = params.get('name') || ''
  const dividend = parseFloat(params.get('dividend') || '0')
  const currentPrice = parseFloat(params.get('price') || '0')
  const isHK = params.get('isHK') === 'true'

  const rows = useMemo(() => {
    return YIELD_RATES.map(rate => {
      const targetPrice = dividend > 0 ? (dividend / (rate / 100)) : 0
      const diff = currentPrice > 0 ? ((currentPrice - targetPrice) / targetPrice) * 100 : 0
      return { rate, targetPrice, diff }
    })
  }, [dividend, currentPrice])

  const currentYield = currentPrice > 0 ? (dividend / currentPrice) * 100 : 0

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
      fetchDividendHistory(code, isHK),
      isHK ? Promise.resolve(null) : fetchListingYear(code),
    ]).then(([h, y]) => {
      setDivHistory(h)
      setListingYear(y)
      setHistoryLoading(false)
    })
  }, [code, isHK])

  const avgDps = useMemo(() => {
    if (!divHistory?.consecutiveYears) return 0
    const consecutive = divHistory.records.slice(0, divHistory.consecutiveYears)
    const sum = consecutive.reduce((s, r) => s + r.perShare, 0)
    return sum / consecutive.length
  }, [divHistory])

  return (
    <div className="page-content">
      {/* Header */}
      <div className="relative flex items-center px-4 pt-12 pb-4">
        <button onClick={() => navigate(-1)} className="p-1.5 text-gray-500">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div className="absolute inset-x-0 text-center pointer-events-none">
          <h1 className="text-base font-bold text-gray-900">{name} 决策矩阵</h1>
          <p className="text-xs text-gray-400">代码 {code} · 每股红利 ¥{dividend} {isHK ? '(HKD)' : ''}</p>
        </div>
      </div>

      <div className="px-4 mb-4">
        {/* Current status */}
        <div className="card p-4 mb-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-lg font-bold text-gray-900">¥{currentPrice.toFixed(2)}</div>
              <div className="text-xs text-gray-400">当前价格</div>
            </div>
            <div>
              <div className="text-lg font-bold text-red-600">{currentYield.toFixed(2)}%</div>
              <div className="text-xs text-gray-400">当前股息率</div>
            </div>
            <div>
              <div className="text-lg font-bold text-gray-900">¥{dividend}</div>
              <div className="text-xs text-gray-400">每股红利</div>
            </div>
          </div>
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
                        ¥{row.targetPrice.toFixed(2)}
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

        {/* 历史分红 */}
        {!isHK && (
          <div className="card p-4 mt-4">
            <div className="mb-3">
              <div className="text-sm font-semibold text-gray-800">历史分红</div>
              <div className="text-xs text-gray-400 mt-0.5">仅展示近10年已实施分配记录，每股派息为税前金额</div>
            </div>
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
                    <div className="text-xl font-bold text-gray-900">¥{avgDps.toFixed(3)}</div>
                    <div className="text-xs text-gray-400 mt-0.5">近{divHistory.consecutiveYears}年均每股派息</div>
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
                          <td className="py-2 text-right font-semibold text-gray-900">¥{r.perShare.toFixed(3)}</td>
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
      <Disclaimer />
    </div>
  )
}
