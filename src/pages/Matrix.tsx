import { useSearchParams, useNavigate } from 'react-router-dom'
import { useMemo, useState, useEffect } from 'react'
import Disclaimer from '../components/Disclaimer'
import { fetchDividendHistory } from '../utils/dividendHistory'
import type { DividendHistory } from '../utils/dividendHistory'

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

  const [divHistory, setDivHistory] = useState<DividendHistory | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    if (!code || isHK) return
    setHistoryLoading(true)
    fetchDividendHistory(code).then(h => {
      setDivHistory(h)
      setHistoryLoading(false)
    })
  }, [code, isHK])

  const avgDps = useMemo(() => {
    if (!divHistory?.records.length) return 0
    const sum = divHistory.records.reduce((s, r) => s + r.perShare, 0)
    return sum / divHistory.records.length
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

        {/* Matrix table */}
        <div className="card overflow-hidden">
          <table className="matrix-table">
            <thead>
              <tr>
                <th>目标股息率</th>
                <th>目标价格</th>
                <th>与现价差距</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const isCurrent = Math.abs(row.rate - currentYield) < 0.25
                return (
                  <tr key={row.rate} className={isCurrent ? 'current-row' : ''}>
                    <td className="font-medium">{row.rate.toFixed(1)}%</td>
                    <td className="font-semibold">
                      ¥{row.targetPrice.toFixed(2)}
                      {isCurrent && <span className="ml-1 text-xs text-red-600">← 当前</span>}
                    </td>
                    <td className={row.diff > 0 ? 'text-red-500' : 'text-green-600'}>
                      {currentPrice > 0 ? (
                        <>
                          {row.diff > 0 ? '高' : '低'} {Math.abs(row.diff).toFixed(1)}%
                        </>
                      ) : '-'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-400 mt-3 px-1">
          表格展示不同股息率目标下的对应买入价。若目标股息率为5%，应在目标价格附近买入。
        </p>

        {/* 历史分红 */}
        {!isHK && (
          <div className="card p-4 mt-4">
            <div className="text-sm font-semibold text-gray-800 mb-3">历史分红</div>
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
                    <div className="text-xs text-gray-400 mt-0.5">连续派息年数</div>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <div className="text-xl font-bold text-gray-900">¥{avgDps.toFixed(3)}</div>
                    <div className="text-xs text-gray-400 mt-0.5">近{divHistory.records.length}年均每股派息</div>
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
