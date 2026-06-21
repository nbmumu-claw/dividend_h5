import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import TabBar from './components/TabBar'
import { fetchExchangeRate, fetchUsdRate } from './utils/api'
import { useStore } from './store'
import Discovery from './pages/Discovery'
import Watchlist from './pages/Watchlist'
import Portfolio from './pages/Portfolio'
import Matrix from './pages/Matrix'
import YieldGrid from './pages/YieldGrid'
import Calendar from './pages/Calendar'
import Settings from './pages/Settings'
import DataGuide from './pages/DataGuide'
import CategoryManager from './pages/CategoryManager'
import HoldingDetail from './pages/HoldingDetail'
import FeeSetting from './pages/FeeSetting'
import AccountManager from './pages/AccountManager'
import Support from './pages/Support'
import Changelog from './pages/Changelog'

export default function App() {
  const setExchangeRate = useStore(s => s.setExchangeRate)
  const setUsdRate = useStore(s => s.setUsdRate)
  const hideTabBar = useLocation().pathname === '/yield-grid'

  useEffect(() => {
    fetchExchangeRate().then(rate => setExchangeRate(rate)).catch(() => {})
    fetchUsdRate().then(rate => setUsdRate(rate)).catch(() => {})
  }, [])

  return (
    <div className={`app-shell${hideTabBar ? ' app-shell--wide' : ''}`}>
      <Routes>
        <Route path="/" element={<Navigate to="/discovery" replace />} />
        <Route path="/discovery" element={<Discovery />} />
        <Route path="/watchlist" element={<Watchlist />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/matrix" element={<Matrix />} />
        <Route path="/yield-grid" element={<YieldGrid />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/data-guide" element={<DataGuide />} />
        <Route path="/category-manager" element={<CategoryManager />} />
        <Route path="/holding/:code" element={<HoldingDetail />} />
        <Route path="/fee-setting" element={<FeeSetting />} />
        <Route path="/account-manager" element={<AccountManager />} />
        <Route path="/support" element={<Support />} />
        <Route path="/changelog" element={<Changelog />} />
      </Routes>
      {!hideTabBar && <TabBar />}
      <Analytics />
    </div>
  )
}
