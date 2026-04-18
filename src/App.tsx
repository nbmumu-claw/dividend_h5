import { Routes, Route, Navigate } from 'react-router-dom'
import TabBar from './components/TabBar'
import Discovery from './pages/Discovery'
import Watchlist from './pages/Watchlist'
import Portfolio from './pages/Portfolio'
import Matrix from './pages/Matrix'
import Settings from './pages/Settings'

export default function App() {
  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<Navigate to="/discovery" replace />} />
        <Route path="/discovery" element={<Discovery />} />
        <Route path="/watchlist" element={<Watchlist />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/matrix" element={<Matrix />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
      <TabBar />
    </div>
  )
}
