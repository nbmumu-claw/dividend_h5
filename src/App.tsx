import { useEffect, lazy, Suspense, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import TabBar from './components/TabBar'
import ErrorBoundary from './components/ErrorBoundary'
import DividendArrivalModal from './components/DividendArrivalModal'
import { fetchExchangeRate, fetchUsdRate } from './utils/api'
import { useStore } from './store'
import { getSession, syncOnLogin, startAutoPush } from './utils/cloudSync'
// 落地页保持同步加载，避免首屏多一次分包等待
import Discovery from './pages/Discovery'
// 其余页面懒加载（按路由分包，首屏不再下载图表库等重依赖）
const Watchlist = lazy(() => import('./pages/Watchlist'))
const Portfolio = lazy(() => import('./pages/Portfolio'))
const Matrix = lazy(() => import('./pages/Matrix'))
const YieldGrid = lazy(() => import('./pages/YieldGrid'))
const InterimReport = lazy(() => import('./pages/InterimReport'))
const Calendar = lazy(() => import('./pages/Calendar'))
const Settings = lazy(() => import('./pages/Settings'))
const DataGuide = lazy(() => import('./pages/DataGuide'))
const CategoryManager = lazy(() => import('./pages/CategoryManager'))
const HoldingDetail = lazy(() => import('./pages/HoldingDetail'))
const FeeSetting = lazy(() => import('./pages/FeeSetting'))
const AccountManager = lazy(() => import('./pages/AccountManager'))
const TradeSummary = lazy(() => import('./pages/TradeSummary'))
const Support = lazy(() => import('./pages/Support'))
const Changelog = lazy(() => import('./pages/Changelog'))

function PageLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <span className="inline-block w-6 h-6 border-2 border-gray-200 border-t-red-500 rounded-full animate-spin" />
    </div>
  )
}

export default function App() {
  const [startupReady, setStartupReady] = useState(false)
  const setExchangeRate = useStore(s => s.setExchangeRate)
  const setUsdRate = useStore(s => s.setUsdRate)
  const syncWatchlistDividends = useStore(s => s.syncWatchlistDividends)
  const pathname = useLocation().pathname
  const hideTabBar = ['/yield-grid', '/reports/2026-interim'].includes(pathname)
  // PC 端这几页用更宽的容器以容纳多列布局
  const roomy = ['/discovery', '/watchlist'].includes(pathname)

  useEffect(() => {
    fetchExchangeRate().then(rate => setExchangeRate(rate)).catch(() => {})
    fetchUsdRate().then(rate => setUsdRate(rate)).catch(() => {})
    // 启动时把未手动改过的自选股每股红利同步为发现页权威值
    syncWatchlistDividends()
    // 已登录则恢复云同步（启动恢复不会触发首登冲突，conflict 仅在 Settings 登录时处理）
    ;(async () => {
      try {
        const session = await getSession()
        if (session && !session.user?.is_anonymous) {
          await syncOnLogin()
          startAutoPush()
        }
      } catch { /* 离线/未登录忽略 */ }
      finally { setStartupReady(true) }
    })()
  }, [])


  return (
    <div className={`app-shell${hideTabBar ? ' app-shell--wide' : ''}${roomy ? ' app-shell--roomy' : ''}`}>
      <ErrorBoundary>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/" element={<Navigate to="/discovery" replace />} />
            <Route path="/discovery" element={<Discovery />} />
            <Route path="/watchlist" element={<Watchlist />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/matrix" element={<Matrix />} />
            <Route path="/yield-grid" element={<YieldGrid />} />
            <Route path="/reports/2026-interim" element={<InterimReport />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/data-guide" element={<DataGuide />} />
            <Route path="/category-manager" element={<CategoryManager />} />
            <Route path="/holding/:code" element={<HoldingDetail />} />
            <Route path="/fee-setting" element={<FeeSetting />} />
            <Route path="/account-manager" element={<AccountManager />} />
            <Route path="/trade-summary" element={<TradeSummary />} />
            <Route path="/support" element={<Support />} />
            <Route path="/changelog" element={<Changelog />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
      {!hideTabBar && <TabBar />}
      <DividendArrivalModal enabled={startupReady} />
      <Analytics
        beforeSend={(event) => {
          // 每次访问只统计首屏（SPA 切换不再计数），且首屏再按 10% 概率抽样上报
          if (event.type === 'pageview') {
            if (sessionStorage.getItem('va-pv-sent')) return null
            sessionStorage.setItem('va-pv-sent', '1')
            if (Math.random() >= 0.1) return null
          }
          return event
        }}
      />
    </div>
  )
}
