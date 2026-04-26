import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { cacheClear } from '../utils/cache'
import type { BackupData } from '../types'
import { Toast, useToast } from '../components/Toast'
import Modal from '../components/Modal'
import { afterTax } from '../utils/tax'

interface Achievement {
  id: string; label: string; description: string; unlocked: boolean; icon: string
}

function buildAchievements(annualDiv: number, monthlyIncome: number, yieldRate: number, stockCount: number, hasHoldings: boolean): Achievement[] {
  return [
    { id: 'first_stock', label: '起步', description: '添加第一只自选股', unlocked: stockCount >= 1, icon: '🌱' },
    { id: 'first_holding', label: '入场', description: '填入第一笔持股', unlocked: hasHoldings, icon: '💼' },
    { id: 'income_50', label: '月入50', description: '月均红利达到 ¥50', unlocked: monthlyIncome >= 50, icon: '☕' },
    { id: 'income_200', label: '月入200', description: '月均红利达到 ¥200', unlocked: monthlyIncome >= 200, icon: '🍜' },
    { id: 'income_500', label: '月入500', description: '月均红利达到 ¥500', unlocked: monthlyIncome >= 500, icon: '🛒' },
    { id: 'income_1000', label: '月入千元', description: '月均红利达到 ¥1000', unlocked: monthlyIncome >= 1000, icon: '🎯' },
    { id: 'income_3000', label: '月入3000', description: '月均红利达到 ¥3000', unlocked: monthlyIncome >= 3000, icon: '🏆' },
    { id: 'income_5000', label: '月入5000', description: '月均红利达到 ¥5000', unlocked: monthlyIncome >= 5000, icon: '🚀' },
    { id: 'income_10000', label: '月入万元', description: '月均红利达到 ¥10000', unlocked: monthlyIncome >= 10000, icon: '👑' },
    { id: 'stocks_5', label: '小组合', description: '持有5只以上股票', unlocked: stockCount >= 5, icon: '📦' },
    { id: 'stocks_10', label: '多元化', description: '持有10只以上股票', unlocked: stockCount >= 10, icon: '🌈' },
    { id: 'yield_5', label: '5%收益率', description: '整体股息率达到5%', unlocked: yieldRate >= 5, icon: '📈' },
    { id: 'yield_6', label: '6%收益率', description: '整体股息率达到6%', unlocked: yieldRate >= 6, icon: '⚡' },
    { id: 'annual_1k', label: '年入千元', description: '年红利收入超过¥1000', unlocked: annualDiv >= 1000, icon: '💰' },
    { id: 'annual_5k', label: '年入5千', description: '年红利收入超过¥5000', unlocked: annualDiv >= 5000, icon: '💎' },
    { id: 'annual_10k', label: '年入万元', description: '年红利收入超过¥10000', unlocked: annualDiv >= 10000, icon: '🏅' },
    { id: 'daily_latte', label: '拿铁自由', description: '月收入覆盖30杯拿铁', unlocked: monthlyIncome >= 30 * 38, icon: '☕' },
    { id: 'daily_boba', label: '奶茶自由', description: '月收入覆盖60杯奶茶', unlocked: monthlyIncome >= 60 * 20, icon: '🧋' },
    { id: 'rent_cover', label: '房租刺客', description: '年红利超过¥36000', unlocked: annualDiv >= 36000, icon: '🏠' },
    { id: 'yield_8', label: '高息猎手', description: '整体股息率达到8%', unlocked: yieldRate >= 8, icon: '🦅' },
    { id: 'stocks_20', label: '散户之王', description: '持有20只以上股票', unlocked: stockCount >= 20, icon: '🃏' },
    { id: 'annual_100k', label: '年入十万', description: '年红利收入超过¥100000', unlocked: annualDiv >= 100000, icon: '🌊' },
    { id: 'monthly_salary', label: '工资替代', description: '月红利超过¥8000', unlocked: monthlyIncome >= 8000, icon: '😤' },
    { id: 'income_500_daily', label: '日入500', description: '日均红利超过¥500', unlocked: annualDiv >= 500 * 365, icon: '🌅' },
    { id: 'hk_investor', label: '南下资金', description: '持有港股股票', unlocked: stockCount >= 1 && annualDiv > 0, icon: '🦁' },
    { id: 'zen_investor', label: '躺平投资', description: '年红利超过¥60000', unlocked: annualDiv >= 60000, icon: '🧘' },
  ]
}

export default function Settings() {
  const watchlist = useStore(s => s.watchlist)
  const exchangeRate = useStore(s => s.exchangeRate)
  const setWatchlist = useStore(s => s.setWatchlist)
  const importBackup = useStore(s => s.importBackup)
  const agreementAccepted = useStore(s => s.agreementAccepted)
  const setAgreementAccepted = useStore(s => s.setAgreementAccepted)
  const navigate = useNavigate()

  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [showAgreement, setShowAgreement] = useState(false)
  const [showAchievements, setShowAchievements] = useState(false)
  const { message, showToast } = useToast()

  const stats = (() => {
    const withHoldings = watchlist.filter(s => s.shares && s.shares > 0)
    const totalAnnual = withHoldings.reduce((sum, s) => {
      const divCny = s.isHK ? s.dividendPerShare * exchangeRate : s.dividendPerShare
      return sum + afterTax(divCny * Number(s.shares), s)
    }, 0)
    const overallYield = (() => {
      const totalCost = withHoldings.reduce((sum, s) => {
        const cost = Number(s.costPrice) || (s.isHK ? s.price * exchangeRate : s.price)
        return sum + cost * Number(s.shares)
      }, 0)
      return totalCost > 0 ? (totalAnnual / totalCost) * 100 : 0
    })()
    return { watchlistCount: watchlist.length, holdingsCount: withHoldings.length, totalAnnual, overallYield }
  })()

  const achievements = useMemo(
    () => buildAchievements(
      stats.totalAnnual,
      stats.totalAnnual / 12,
      stats.overallYield,
      watchlist.length,
      stats.holdingsCount > 0,
    ),
    [stats.totalAnnual, stats.overallYield, watchlist.length, stats.holdingsCount]
  )
  const unlockedCount = achievements.filter(a => a.unlocked).length
  const sortedAchievements = [...achievements].sort((a, b) => (b.unlocked ? 1 : 0) - (a.unlocked ? 1 : 0))


  const handleExport = () => {
    const backup: BackupData = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      data: {
        watchlist: useStore.getState().watchlist,
        discoveryManualStocks: useStore.getState().manualStocks,
        discoveryStaticEdits: useStore.getState().staticEdits,
        discoveryHiddenStocks: useStore.getState().hiddenStocks,
        discoveryCustomSectors: useStore.getState().customSectors,
      },
    }
    const text = JSON.stringify(backup, null, 2)
    navigator.clipboard.writeText(text).then(() => {
      showToast('备份已复制到剪贴板')
    }).catch(() => {
      // fallback: download file
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `xuxu-efu-backup-${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.json`
      a.click()
      URL.revokeObjectURL(url)
      showToast('备份文件已下载')
    })
  }

  const handleImport = () => {
    try {
      const parsed = JSON.parse(importText)
      let data = parsed.data || parsed
      importBackup(data)
      showToast('数据已恢复')
      setShowImport(false)
      setImportText('')
    } catch {
      showToast('格式错误，请检查备份内容')
    }
  }

  const handleClearWatchlist = () => {
    if (window.confirm('确定清空自选列表？此操作不可恢复。')) {
      setWatchlist([])
      showToast('自选列表已清空')
    }
  }

  const handleClearCache = () => {
    cacheClear()
    showToast('缓存已清除')
  }

  const SettingRow = ({ icon, label, value, onClick, danger }: {
    icon: React.ReactNode; label: string; value?: string; onClick?: () => void; danger?: boolean
  }) => (
    <div
      className={`flex items-center gap-3 px-4 py-3.5 border-b border-gray-50 last:border-0 ${onClick ? 'cursor-pointer active:bg-gray-50' : ''}`}
      onClick={onClick}
    >
      <div className="text-gray-400 w-5 flex-shrink-0">{icon}</div>
      <span className={`flex-1 text-sm ${danger ? 'text-red-500' : 'text-gray-800'}`}>{label}</span>
      {value && <span className="text-xs text-gray-400">{value}</span>}
      {onClick && (
        <svg className="w-4 h-4 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </div>
  )

  return (
    <div className="page-content">
      <div className="px-4 pt-12 pb-3">
        <h1 className="text-xl font-bold text-gray-900 text-center">我的</h1>
      </div>

      {/* Stats */}
      <div className="mx-4 mb-4 card p-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-xl font-bold text-gray-900">{stats.watchlistCount}</div>
            <div className="text-xs text-gray-400 mt-0.5">自选股票</div>
          </div>
          <div>
            <div className="text-xl font-bold text-gray-900">{stats.holdingsCount}</div>
            <div className="text-xs text-gray-400 mt-0.5">持仓股票</div>
          </div>
          <div>
            <div className="text-xl font-bold text-red-600">¥{stats.totalAnnual.toFixed(0)}</div>
            <div className="text-xs text-gray-400 mt-0.5">年度红利</div>
          </div>
        </div>
      </div>

      {/* Achievements */}
      <div className="mx-4 mb-3">
        <div
          className="card p-4 cursor-pointer"
          onClick={() => setShowAchievements(v => !v)}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-800">成就</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">{unlockedCount}/{achievements.length} 已解锁</span>
              <svg
                className="w-4 h-4 text-gray-300 transition-transform"
                style={{ transform: showAchievements ? 'rotate(180deg)' : 'none' }}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
              >
                <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${(unlockedCount / achievements.length) * 100}%` }} />
          </div>
          {showAchievements && (
            <div className="grid grid-cols-3 gap-2 mt-3">
              {sortedAchievements.map(a => (
                <div
                  key={a.id}
                  className={`rounded-xl p-2.5 flex flex-col items-center text-center gap-1 ${a.unlocked ? 'bg-red-50' : 'bg-gray-50'}`}
                >
                  <span className="text-2xl">{a.unlocked ? a.icon : '🔒'}</span>
                  <div className={`text-xs font-semibold leading-tight ${a.unlocked ? 'text-red-700' : 'text-gray-400'}`}>{a.label}</div>
                  <div className={`text-[10px] leading-tight ${a.unlocked ? 'text-red-400' : 'text-gray-300'}`}>{a.description}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>


      {/* Data management */}
      <div className="mx-4 mb-3">
        <div className="section-header px-0">数据管理</div>
        <div className="card">
          <SettingRow
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            label="导出备份"
            value="复制到剪贴板"
            onClick={handleExport}
          />
          <SettingRow
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            label="导入备份"
            onClick={() => setShowImport(true)}
          />
          <SettingRow
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zM12 8v8M12 8l-2 2M12 8l2 2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            label="清除缓存"
            onClick={handleClearCache}
          />
          <SettingRow
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            label="清空自选"
            onClick={handleClearWatchlist}
            danger
          />
        </div>
      </div>

      {/* About */}
      <div className="mx-4 mb-6">
        <div className="section-header px-0">关于</div>
        <div className="card">
          <SettingRow
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            label="分享给朋友"
            value="复制链接"
            onClick={() => {
              navigator.clipboard.writeText('www.manmanbianfu.top')
                .then(() => showToast('链接已复制'))
                .catch(() => showToast('复制失败'))
            }}
          />
          <SettingRow
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            label="更新日志"
            value="v1.3"
            onClick={() => navigate('/changelog')}
          />
          <SettingRow
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10z"/><path d="M12 8h.01M11 12h1v4h1" strokeLinecap="round"/></svg>}
            label="数据说明"
            onClick={() => navigate('/data-guide')}
          />
          <div className="px-4 py-3 text-xs text-gray-400 leading-relaxed">
            本应用提供的数据仅供参考，不构成投资建议。股市有风险，投资需谨慎。股息数据可能存在延迟，请以实际公告为准。
          </div>
        </div>
      </div>

      {/* Support */}
      <div className="mx-4 mb-3">
        <button
          onClick={() => navigate('/support')}
          className="w-full card p-4 flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">☕</span>
            <div className="text-left">
              <div className="text-sm font-semibold text-gray-800">支持与联系</div>
              <div className="text-xs text-gray-400">如果有帮助，欢迎请我喝杯咖啡</div>
            </div>
          </div>
          <svg className="w-4 h-4 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Privacy & Agreement */}
      <div className="mx-4 mb-6">
        <div className="section-header px-0">隐私与协议</div>
        <div className="card">
          <div
            className="flex items-center gap-3 px-4 py-3.5 cursor-pointer active:bg-gray-50"
            onClick={() => setShowAgreement(true)}
          >
            <div className="text-gray-400 w-5 flex-shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0 1 12 2.944a11.955 11.955 0 0 1-8.618 3.04A12.02 12.02 0 0 0 3 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <div className="flex-1">
              <span className="text-sm text-gray-800">服务与隐私协议</span>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full ${agreementAccepted ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-600'}`}>
              {agreementAccepted ? '已确认' : '点击查看'}
            </span>
            <svg className="w-4 h-4 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          {!agreementAccepted && (
            <div className="px-4 pb-4">
              <button
                className="w-full py-2.5 bg-red-500 text-white text-sm font-medium rounded-lg"
                onClick={() => { setAgreementAccepted(true); setShowAgreement(false); showToast('已确认协议') }}
              >
                确认并接受协议
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Agreement Modal */}
      <Modal open={showAgreement} onClose={() => setShowAgreement(false)} title="服务与隐私协议">
        <div className="space-y-4 text-sm text-gray-600 leading-relaxed">
          <p>本服务基于历史公开数据提供参考信息，不构成投资建议。使用本应用即表示您已阅读并同意本协议。</p>
          <p>本应用不对数据的准确性、完整性做任何担保。用户需自行承担使用本应用进行投资决策的风险。</p>
          <p>股息数据可能存在延迟，请以实际公告为准。本应用保留随时修改服务条款的权利，修改后继续使用即表示接受。</p>
          {!agreementAccepted && (
            <button
              className="w-full py-2.5 bg-red-500 text-white text-sm font-medium rounded-lg"
              onClick={() => { setAgreementAccepted(true); setShowAgreement(false); showToast('已确认协议') }}
            >
              确认并接受协议
            </button>
          )}
          <button className="w-full py-2 text-gray-500 text-sm" onClick={() => setShowAgreement(false)}>
            {agreementAccepted ? '关闭' : '暂不接受'}
          </button>
        </div>
      </Modal>

      {/* Import Modal */}
      <Modal open={showImport} onClose={() => setShowImport(false)} title="导入备份">
        <div className="space-y-3">
          <p className="text-xs text-gray-500">将之前导出的备份 JSON 内容粘贴到下方：</p>
          <textarea
            className="input-field"
            rows={8}
            placeholder='粘贴备份内容（JSON格式）...'
            value={importText}
            onChange={e => setImportText(e.target.value)}
            style={{ resize: 'vertical' }}
          />
          <button className="btn-primary" onClick={handleImport} disabled={!importText.trim()}>
            确认导入
          </button>
          <button className="btn-secondary" onClick={() => setShowImport(false)}>取消</button>
        </div>
      </Modal>

      <Toast message={message} />
    </div>
  )
}
