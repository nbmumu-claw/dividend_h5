import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import TabBar from './components/TabBar'
import { fetchExchangeRate } from './utils/api'
import { useStore } from './store'
import Discovery from './pages/Discovery'
import Watchlist from './pages/Watchlist'
import Portfolio from './pages/Portfolio'
import Matrix from './pages/Matrix'
import Calendar from './pages/Calendar'
import Settings from './pages/Settings'
import DataGuide from './pages/DataGuide'
import Support from './pages/Support'
import Changelog from './pages/Changelog'

export default function App() {
  const setExchangeRate = useStore(s => s.setExchangeRate)

  useEffect(() => {
    fetchExchangeRate().then(rate => setExchangeRate(rate)).catch(() => {})
  }, [])

  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<Navigate to="/discovery" replace />} />
        <Route path="/discovery" element={<Discovery />} />
        <Route path="/watchlist" element={<Watchlist />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/matrix" element={<Matrix />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/data-guide" element={<DataGuide />} />
        <Route path="/support" element={<Support />} />
        <Route path="/changelog" element={<Changelog />} />
      </Routes>
      <TabBar />
      <Analytics />
    </div>
  )
}
