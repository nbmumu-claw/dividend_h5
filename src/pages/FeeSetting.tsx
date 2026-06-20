import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { Toast, useToast } from '../components/Toast'

// 示例：买入 1000 股 @ ¥10、佣金万2.5 —— 免5/全佣/含过户费、费用、摊薄成本
const EXAMPLES: [string, string, string, string, string][] = [
  ['否', '否', '—', '5.641', '10.0056'],
  ['是', '否', '—', '3.141', '10.0031'],
  ['否', '是', '否', '5.1', '10.0051'],
  ['是', '是', '否', '2.6', '10.0026'],
  ['否', '是', '是', '5', '10.0050'],
  ['是', '是', '是', '2.5', '10.0025'],
]

export default function FeeSetting() {
  const navigate = useNavigate()
  const feeConfig = useStore(s => s.feeConfig)
  const setFeeConfig = useStore(s => s.setFeeConfig)
  const { message, showToast } = useToast()
  // 佣金以「万分之 N」编辑
  const [rateInput, setRateInput] = useState(String(+(feeConfig.commissionRate * 10000).toFixed(4)))

  const apply = (patch: Partial<typeof feeConfig>, toast = true) => {
    setFeeConfig({ ...feeConfig, ...patch })
    if (toast) showToast(feeConfig.enabled || patch.enabled ? '已按新费率重算' : '已更新')
  }

  const commitRate = () => {
    const wan = parseFloat(rateInput)
    const rate = isFinite(wan) && wan >= 0 ? wan / 10000 : feeConfig.commissionRate
    setRateInput(String(+(rate * 10000).toFixed(4)))
    apply({ commissionRate: rate })
  }

  const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <button
      onClick={onClick}
      className={`w-11 h-6 rounded-full transition-colors flex items-center px-0.5 ${on ? 'bg-red-600 justify-end' : 'bg-gray-200 justify-start'}`}
    >
      <span className="w-5 h-5 bg-white rounded-full shadow" />
    </button>
  )

  return (
    <div className="page-content">
      <div className="relative flex items-center px-4 pt-12 pb-4">
        <button onClick={() => navigate(-1)} className="p-1.5 text-gray-500">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="absolute inset-x-0 text-center pointer-events-none">
          <h1 className="text-base font-bold text-gray-900">交易手续费</h1>
        </div>
      </div>

      <div className="px-4 pb-3">
        <p className="text-xs text-gray-400 leading-relaxed">
          开启后，记录买入 / 卖出时按下方费率把手续费计入摊薄成本，与券商 App 对齐。仅 A / B 股生效（港股、美股不计）。修改后会自动重算所有持仓成本。
        </p>
      </div>

      <div className="px-4 mb-3">
        <div className="card">
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-50">
            <span className="text-sm text-gray-800">启用手续费</span>
            <Toggle on={feeConfig.enabled} onClick={() => apply({ enabled: !feeConfig.enabled })} />
          </div>
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-50">
            <div>
              <div className="text-sm text-gray-800">券商佣金</div>
              <div className="text-xs text-gray-400">万分之，最低 5 元（可免）</div>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-400">万</span>
              <input
                className="input-field text-sm w-20 text-right"
                type="number"
                min="0"
                step="0.1"
                value={rateInput}
                onChange={e => setRateInput(e.target.value)}
                onBlur={commitRate}
              />
            </div>
          </div>
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-50">
            <div>
              <div className="text-sm text-gray-800">免 5 元最低佣金</div>
              <div className="text-xs text-gray-400">部分券商无 5 元门槛</div>
            </div>
            <Toggle on={feeConfig.min5Free} onClick={() => apply({ min5Free: !feeConfig.min5Free })} />
          </div>
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-50 last:border-0">
            <div>
              <div className="text-sm text-gray-800">全佣</div>
              <div className="text-xs text-gray-400">佣金已含交易所规费，不再单独计规费</div>
            </div>
            <Toggle on={feeConfig.allIn} onClick={() => apply({ allIn: !feeConfig.allIn })} />
          </div>
          {feeConfig.allIn && (
            <div className="flex items-center justify-between px-4 py-3.5">
              <div>
                <div className="text-sm text-gray-800">全佣含过户费</div>
                <div className="text-xs text-gray-400">佣金还含过户费，不再单独计过户费</div>
              </div>
              <Toggle on={feeConfig.allInTransfer} onClick={() => apply({ allInTransfer: !feeConfig.allInTransfer })} />
            </div>
          )}
        </div>
      </div>

      <div className="px-4">
        <div className="card p-4 text-xs text-gray-500 leading-relaxed space-y-1">
          <div className="font-semibold text-gray-700 mb-1">自动计入（按现行标准，固定）</div>
          <div>· 印花税：卖出 0.05%（ETF 免）</div>
          <div>· 过户费：买卖双向 0.001%</div>
          <div>· 交易所规费：买卖双向 0.00541%（经手费 + 证管费）</div>
          <div className="pt-1 text-gray-400">勾选「全佣」后规费不再单独计；再勾「含过户费」则过户费也不单独计（视券商佣金口径而定）。</div>
          <div className="pt-3 text-gray-400 mb-1.5">示例：买入 1000 股 @ ¥10，佣金万2.5，各组合摊薄成本：</div>
          <table className="w-full text-center border-collapse tabular-nums">
            <thead>
              <tr className="text-gray-400">
                <th className="font-normal py-1 border-b border-gray-100">免5</th>
                <th className="font-normal py-1 border-b border-gray-100">全佣</th>
                <th className="font-normal py-1 border-b border-gray-100">含过户费</th>
                <th className="font-normal py-1 border-b border-gray-100 text-right">费用</th>
                <th className="font-normal py-1 border-b border-gray-100 text-right">成本</th>
              </tr>
            </thead>
            <tbody className="text-gray-600">
              {EXAMPLES.map((r, i) => (
                <tr key={i}>
                  <td className="py-1 border-b border-gray-50">{r[0]}</td>
                  <td className="py-1 border-b border-gray-50">{r[1]}</td>
                  <td className="py-1 border-b border-gray-50">{r[2]}</td>
                  <td className="py-1 border-b border-gray-50 text-right">¥{r[3]}</td>
                  <td className="py-1 border-b border-gray-50 text-right font-medium text-gray-800">¥{r[4]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Toast message={message} />
    </div>
  )
}
