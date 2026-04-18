import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { fetchExchangeRate, fetchStockPrices } from '../utils/api'
import { cacheClear } from '../utils/cache'
import type { BackupData } from '../types'
import { Toast, useToast } from '../components/Toast'
import Modal from '../components/Modal'
import { afterTax } from '../utils/tax'

export default function Settings() {
  const store = useStore()
  const { watchlist, exchangeRate, setExchangeRate, setWatchlist, importBackup, updateWatchlistStock } = store
  const navigate = useNavigate()
  const [loadingRate, setLoadingRate] = useState(false)
  const [loadingPrices, setLoadingPrices] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
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
        watchlist: store.watchlist,
        discoveryManualStocks: store.manualStocks,
        discoveryStaticEdits: store.staticEdits,
        discoveryHiddenStocks: store.hiddenStocks,
        discoveryCustomSectors: store.customSectors,
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
      a.download = `dividend-backup-${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.json`
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

  const handleRefreshPrices = async () => {
    if (!watchlist.length) { showToast('自选列表为空'); return }
    setLoadingPrices(true)
    try {
      const priceMap = await fetchStockPrices(watchlist.map(s => ({ code: s.code, isHK: s.isHK })), true)
      watchlist.forEach(s => {
        const pd = priceMap[s.code]
        if (!pd) return
        const priceCny = s.isHK ? pd.price * exchangeRate : pd.price
        const divCny = s.isHK ? s.dividendPerShare * exchangeRate : s.dividendPerShare
        const rawYield = priceCny > 0 ? (divCny / priceCny) * 100 : 0
        updateWatchlistStock(s.code, {
          price: pd.price,
          priceCny,
          yieldRate: rawYield > 30 ? s.yieldRate : rawYield,
          pctChg: pd.pctChg,
        })
      })
      showToast(`已刷新 ${watchlist.length} 只股票价格`)
    } catch {
      showToast('刷新失败，请重试')
    }
    setLoadingPrices(false)
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
        <h1 className="text-xl font-bold text-gray-900">我的</h1>
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
            <div className="text-xl font-bold text-primary">¥{stats.totalAnnual.toFixed(0)}</div>
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
              className="text-xs text-primary border border-primary rounded-full px-3 py-1"
              disabled={loadingRate}
            >
              {loadingRate ? '更新中...' : '刷新'}
            </button>
          </div>
        </div>
      </div>

      {/* Stock prices */}
      <div className="mx-4 mb-3">
        <div className="section-header px-0">行情</div>
        <div className="card">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div className="text-gray-400 w-5">📈</div>
            <div className="flex-1">
              <span className="text-sm text-gray-800">刷新股价</span>
              <div className="text-xs text-gray-400 mt-0.5">强制更新自选股实时价格缓存</div>
            </div>
            <button
              onClick={handleRefreshPrices}
              className="text-xs text-primary border border-primary rounded-full px-3 py-1"
              disabled={loadingPrices}
            >
              {loadingPrices ? '刷新中...' : '刷新'}
            </button>
          </div>
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
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01" strokeLinecap="round"/></svg>}
            label="版本"
            value="v1.0.0"
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
