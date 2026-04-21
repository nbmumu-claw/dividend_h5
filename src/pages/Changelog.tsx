import { useNavigate } from 'react-router-dom'

const VERSIONS = [
  {
    version: 'v1.1',
    date: '2026-04',
    items: [
      '新增红利ETF板块，老用户自动迁移无需手动添加',
      '添加时切换至红利ETF板块自动勾选ETF标识',
      'ETF股票显示「每份红利」标签以区别普通股',
      '自选页股票卡片新增ETF蓝色标签',
      '修复代码搜索：纯数字搜索时过滤不相关结果，降级到东方财富接口',
      '修复搜索竞态：慢速输入时旧查询结果不再污染当前展示',
      '新增价格验证兜底：三个搜索API均无结果时直接验证代码有效性',
    ],
  },
  {
    version: 'v1.0',
    date: '2025-04',
    items: [
      '发现页：按板块浏览股票，支持添加、编辑、隐藏',
      '自选页：记录持股数量与成本，自动计算税后红利',
      '持仓页：汇总市值、盈亏与年度被动收入',
      '矩阵页：多档目标收益率反推买入参考价',
      '支持 A 股 / 港股，自动换算人民币',
      '红利税按账户类型（A股/港户/港通H股/港通非H股）自动扣除',
      '股价缓存至本地，切换页面无需重复请求',
      '数据备份与恢复（JSON 导入导出）',
    ],
  },
]

export default function Changelog() {
  const navigate = useNavigate()

  return (
    <div className="page-content">
      <div className="relative flex items-center px-4 pt-12 pb-4">
        <button onClick={() => navigate(-1)} className="p-1.5 text-gray-500">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div className="absolute inset-x-0 text-center pointer-events-none">
          <h1 className="text-base font-bold text-gray-900">更新日志</h1>
        </div>
      </div>

      <div className="px-4 pb-8 space-y-4">
        {VERSIONS.map(v => (
          <div key={v.version} className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-bold text-gray-900">{v.version}</span>
              <span className="text-xs text-gray-400">{v.date}</span>
              {v === VERSIONS[0] && (
                <span className="ml-auto text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">最新</span>
              )}
            </div>
            <ul className="space-y-1.5">
              {v.items.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-red-400 flex-shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
