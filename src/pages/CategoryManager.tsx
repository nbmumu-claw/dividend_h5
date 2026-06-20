import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { isIncluded, resolveCategory, CATEGORY_LABEL, CATEGORY_COLORS, CATEGORIES, type Category } from '../utils/categories'

const CAT_OPTIONS: { value: Category; label: string; color: string }[] = CATEGORIES.map(c => ({
  value: c, label: CATEGORY_LABEL[c], color: CATEGORY_COLORS[c],
}))

const FILTERS: { key: Category | '' | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'weak', label: '弱周期' },
  { key: 'strong', label: '强周期' },
  { key: 'consume', label: '消费' },
  { key: '', label: '未分类' },
]

export default function CategoryManager() {
  const navigate = useNavigate()
  const watchlist = useStore(s => s.watchlist)
  const categoryOverrides = useStore(s => s.categoryOverrides)
  const setCategoryOverride = useStore(s => s.setCategoryOverride)
  const [filter, setFilter] = useState<Category | '' | 'all'>('all')

  const all = watchlist
    .filter(isIncluded)
    .map(s => ({
      code: String(s.code),
      name: s.name,
      sector: (s.sector || '').trim() || '其他',
      isHK: !!s.isHK,
      cat: resolveCategory(s, categoryOverrides),
      isManual: !!categoryOverrides[String(s.code)],
    }))

  const counts: Record<string, number> = { all: all.length, weak: 0, strong: 0, consume: 0, '': 0 }
  all.forEach(it => { counts[it.cat] = (counts[it.cat] || 0) + 1 })

  const list = filter === 'all' ? all : all.filter(it => it.cat === filter)

  const toggle = (code: string, val: Category) => {
    setCategoryOverride(code, categoryOverrides[code] === val ? null : val)
  }

  return (
    <div className="page-content">
      <div className="relative flex items-center px-4 pt-12 pb-4">
        <button onClick={() => navigate(-1)} className="p-1.5 text-gray-500">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="absolute inset-x-0 text-center pointer-events-none">
          <h1 className="text-base font-bold text-gray-900">类别设置</h1>
        </div>
      </div>

      <div className="px-4 pb-3">
        <p className="text-xs text-gray-400 leading-relaxed">
          为自选标的选择大类，用于收益页「三大类占比」。点击大类即可切换；再次点击已选项可恢复默认归类。仅 A 股 / 港股纳入，美股与 ETF 不参与统计。
        </p>
      </div>

      {all.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-gray-400">还没有可分类的标的，先到「自选」添加 A 股 / 港股。</div>
      ) : (
        <>
          {/* 筛选 */}
          <div className="sector-tabs">
            {FILTERS.map(f => (
              <button
                key={f.key}
                className={`sector-tab ${filter === f.key ? 'active' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label} {counts[f.key === 'all' ? 'all' : f.key] ?? 0}
              </button>
            ))}
          </div>

          <div className="px-4 pb-8">
            {list.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-400">该分类下暂无标的。</div>
            ) : (
              <div className="card divide-y divide-gray-50">
                {list.map(it => (
                  <div key={it.code} className="px-4 py-3.5">
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm font-semibold text-gray-800 truncate">{it.name}</span>
                        {it.isHK && <span className="tag tag-blue flex-shrink-0">港</span>}
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">{it.code} · {it.sector}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {CAT_OPTIONS.map(opt => {
                        const active = it.cat === opt.value
                        return (
                          <button
                            key={opt.value}
                            onClick={() => toggle(it.code, opt.value)}
                            className="text-xs px-3 py-1 rounded-full border transition-colors"
                            style={active
                              ? { background: opt.color, borderColor: opt.color, color: '#fff' }
                              : { borderColor: '#e5e7eb', color: '#6b7280' }}
                          >
                            {opt.label}
                          </button>
                        )
                      })}
                      {!it.cat && <span className="text-xs text-gray-300">未分类</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
