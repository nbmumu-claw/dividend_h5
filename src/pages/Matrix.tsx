import { useSearchParams, useNavigate } from 'react-router-dom'
import { useMemo } from 'react'

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

  return (
    <div className="page-content">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-12 pb-4">
        <button onClick={() => navigate(-1)} className="p-1.5 text-gray-500">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div>
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
              <div className="text-lg font-bold text-primary">{currentYield.toFixed(2)}%</div>
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
                      {isCurrent && <span className="ml-1 text-xs text-primary">← 当前</span>}
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
      </div>
    </div>
  )
}
