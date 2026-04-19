import { useNavigate } from 'react-router-dom'

function Card({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4 mb-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{icon}</span>
        <span className="font-semibold text-gray-900">{title}</span>
      </div>
      {children}
    </div>
  )
}

function Formula({ children }: { children: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2 my-2 font-mono text-sm text-gray-700">
      {children}
    </div>
  )
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-2 text-xs text-amber-800 leading-relaxed">
      {children}
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-gray-400 mt-2 leading-relaxed">{children}</p>
}

export default function DataGuide() {
  const navigate = useNavigate()

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
          <h1 className="text-base font-bold text-gray-900">数据说明</h1>
          <p className="text-xs text-gray-400">各项数据的计算方式与来源</p>
        </div>
      </div>

      <div className="px-4 pb-8">

        <Card icon="📊" title="股息率">
          <p className="text-sm text-gray-600">股票每年派发的分红与当前股价的比值，衡量持股的年化分红回报。</p>
          <Formula>= 每股分红 ÷ 当前股价 × 100%</Formula>
          <Note>港股统一换算为人民币后再计算。股息率异常超过 30% 时停止自动计算，避免错误数据干扰决策。</Note>
        </Card>

        <Card icon="💰" title="每股分红">
          <p className="text-sm text-gray-600">基于上一年度（或最近一次）实际派息金额，由人工校对维护。</p>
          <Tip>港股以港元（HK$）计价，在计算股息率与预估收益时自动按实时汇率换算为人民币。</Tip>
        </Card>

        <Card icon="📈" title="股价来源">
          <p className="text-sm text-gray-600 mb-2">股价按以下优先级获取，有效期内使用缓存避免频繁请求：</p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="tag tag-green text-xs">优先</span>
              <span className="text-sm text-gray-600">实时/延时行情价（缓存 5 分钟，存于本地）</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="tag tag-gray text-xs">降级</span>
              <span className="text-sm text-gray-600">本地静态数据（标注昨收）</span>
            </div>
          </div>
          <Note>缓存保存在本地存储（localStorage），刷新页面后仍有效。手动点击「刷新股价」可强制绕过缓存，立即拉取最新价格。</Note>
        </Card>

        <Card icon="🗓️" title="年预计分红">
          <p className="text-sm text-gray-600">根据历史每股分红乘以持股数量估算，扣除红利税后为税后收入。</p>
          <Formula>毛收入 = 每股分红 × 持股数量</Formula>
          <Formula>税后收入 = 毛收入 × (1 − 税率)</Formula>
          <Note>所有金额以人民币（CNY）展示。港股分红在计算前先按当前汇率换算。</Note>
        </Card>

        <Card icon="☕" title="月均被动收入">
          <p className="text-sm text-gray-600">将全年税后预计分红平均摊分到每个月，作为被动收入参考。</p>
          <Formula>= 税后年分红总额 ÷ 12</Formula>
          <Note>实际分红按季/半年/年派发，月均值是平滑后的参考数字，并非每月固定到账。</Note>
        </Card>

        <Card icon="📝" title="持仓总成本">
          <p className="text-sm text-gray-600">各只股票持仓成本之和。成本价需在「自选」页手动录入，未录入时自动用当前股价代替。</p>
          <Formula>= Σ（持股数量 × 成本价）</Formula>
          <Tip>未录入成本时用现价代替，综合股息率与盈亏数据将不准确，建议尽量填写实际买入成本。</Tip>
        </Card>

        <Card icon="💹" title="综合股息率">
          <p className="text-sm text-gray-600">整个持仓组合相对于买入成本的年化分红回报率，反映实际资金效率。</p>
          <Formula>= 税后年分红总额 ÷ 持仓总成本 × 100%</Formula>
          <Note>与单只股票股息率不同，综合股息率基于买入成本，而非当前市价，更能反映真实收益。</Note>
        </Card>

        <Card icon="🏦" title="持仓市值与盈亏">
          <p className="text-sm text-gray-600">持仓市值为各持仓按当前股价计算的总价值，盈亏反映市值相对买入成本的变化。</p>
          <Formula>持仓市值 = Σ（持股数量 × 当前股价）</Formula>
          <Formula>盈亏额 = 持仓市值 − 持仓总成本</Formula>
          <Formula>盈亏比 = 盈亏额 ÷ 持仓总成本 × 100%</Formula>
          <Note>未录入成本时，盈亏数据显示「--」。</Note>
        </Card>

        <Card icon="🎯" title="决策矩阵（目标买入价）">
          <p className="text-sm text-gray-600">根据期望的目标股息率，反推出合理的买入价参考，覆盖 3.0%~7.0% 共 9 档。</p>
          <Formula>目标买入价 = 每股分红 ÷ 目标收益率</Formula>
          <Note>例：某股每股分红 1.00 元，目标收益率 5%，则参考买入价 = 1.00 ÷ 5% = ¥20.00。矩阵会高亮当前股价最接近的档位。</Note>
        </Card>

        <Card icon="🧾" title="红利税">
          <p className="text-sm text-gray-600 mb-3">不同类型股票的分红税率不同，应用根据「自选」页的股票类型自动扣税。</p>
          <div className="overflow-hidden rounded-lg border border-gray-100">
            <div className="grid grid-cols-3 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500">
              <span>股票类型</span><span className="text-center">税率</span><span className="text-right">说明</span>
            </div>
            {[
              { type: 'A 股', rate: '0%', rateColor: 'text-green-600', note: '持股满 1 年免税' },
              { type: '港通 H 股', rate: '20%', rateColor: 'text-gray-900', note: '大陆注册，公司代扣' },
              { type: '港通非 H 股', rate: '28%', rateColor: 'text-red-500', note: '港/海外注册，券商预扣' },
              { type: '港户', rate: '10%', rateColor: 'text-gray-900', note: '直接持有港股账户' },
            ].map((row, i, arr) => (
              <div key={row.type} className={`grid grid-cols-3 px-3 py-2.5 text-xs ${i < arr.length - 1 ? 'border-b border-gray-50' : ''}`}>
                <span className="text-gray-700">{row.type}</span>
                <span className={`text-center font-semibold ${row.rateColor}`}>{row.rate}</span>
                <span className="text-right text-gray-400">{row.note}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1.5 text-xs text-gray-500">
            <p><span className="font-medium text-gray-700">H 股（20%）：</span>大陆注册、港交所上市。如：工行 1398、建行 939、中行 3988、神华 1088</p>
            <p><span className="font-medium text-gray-700">非 H 股（28%）：</span>港/海外注册，红筹/P 股。如：中移动 941、腾讯 700、中海油 883、联通 762</p>
          </div>
        </Card>

        <Card icon="💱" title="港元汇率（HKD/CNY）">
          <p className="text-sm text-gray-600">用于港股分红和股价换算为人民币。每 6 小时自动更新，缓存存于本地，默认值 0.88。</p>
          <Tip>在「设置」页可手动点击「刷新」强制更新汇率。所有涉及港股的金额均按当前汇率实时换算。</Tip>
        </Card>

        <div className="text-center text-xs text-gray-400 mt-4 pb-2 leading-relaxed">
          数据基于历史公开信息，不构成投资建议。<br />请在充分了解风险的基础上进行投资决策。
        </div>

      </div>
    </div>
  )
}
