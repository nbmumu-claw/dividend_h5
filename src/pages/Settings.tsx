import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fetchExchangeRate } from '../utils/api'
import { cacheClear } from '../utils/cache'
import type { BackupData } from '../types'
import { Toast, useToast } from '../components/Toast'
import Modal from '../components/Modal'
import { afterTax } from '../utils/tax'

export default function Settings() {
  const watchlist = useStore(s => s.watchlist)
  const exchangeRate = useStore(s => s.exchangeRate)
  const setExchangeRate = useStore(s => s.setExchangeRate)
  const setWatchlist = useStore(s => s.setWatchlist)
  const importBackup = useStore(s => s.importBackup)
  const agreementAccepted = useStore(s => s.agreementAccepted)
  const setAgreementAccepted = useStore(s => s.setAgreementAccepted)
  const navigate = useNavigate()
  const [loadingRate, setLoadingRate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [showAgreement, setShowAgreement] = useState(false)
  const { message, showToast } = useToast()

  const stats = (() => {
    const withHoldings = watchlist.filter(s => s.shares && s.shares > 0)
    const totalAnnual = withHoldings.reduce((sum, s) => {
      const divCny = s.isHK ? s.dividendPerShare * exchangeRate : s.dividendPerShare
      return sum + afterTax(divCny * Number(s.shares), s)
    }, 0)
    return { watchlistCount: watchlist.length, holdingsCount: withHoldings.length, totalAnnual }
  })()

  const handleRefreshRate = async () => {
    setLoadingRate(true)
    try {
      const rate = await fetchExchangeRate(true)
      setExchangeRate(rate)
      showToast(`汇率已更新: 1 HKD = ${rate.toFixed(4)} CNY`)
    } catch {
      showToast('更新失败')
    }
    setLoadingRate(false)
  }

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

      {/* Exchange rate */}
      <div className="mx-4 mb-3">
        <div className="section-header px-0">汇率</div>
        <div className="card">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div className="text-gray-400 w-5">💱</div>
            <div className="flex-1">
              <span className="text-sm text-gray-800">HKD/CNY 汇率</span>
              <div className="text-xs text-gray-400 mt-0.5">1 HKD = {exchangeRate.toFixed(4)} CNY</div>
            </div>
            <button
              onClick={handleRefreshRate}
              className="text-xs text-red-600 border border-red-600 rounded-full px-3 py-1"
              disabled={loadingRate}
            >
              {loadingRate ? '更新中...' : '刷新'}
            </button>
          </div>
        </div>
      </div>

      {/* Privacy & Agreement */}
      <div className="mx-4 mb-3">
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
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            label="更新日志"
            value="v1.0"
            onClick={() => navigate('/changelog')}
          />
          <SettingRow
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10z"/><path d="M12 8h.01M11 12h1v4h1" strokeLinecap="round"/></svg>}
            label="数据说明"
            onClick={() => navigate('/data-guide')}
          />
          <SettingRow
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            label="支持与联系"
            onClick={() => navigate('/support')}
          />
          <div className="px-4 py-3 text-xs text-gray-400 leading-relaxed">
            本应用提供的数据仅供参考，不构成投资建议。股市有风险，投资需谨慎。股息数据可能存在延迟，请以实际公告为准。
          </div>
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
