import { useLocation, useNavigate } from 'react-router-dom'

const tabs = [
  {
    path: '/discovery',
    label: '发现',
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={active ? 0 : 1.8}>
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.35-4.35" strokeLinecap="round" />
        {active && <circle cx="11" cy="11" r="7" fill="currentColor" opacity={0.15} />}
      </svg>
    ),
  },
  {
    path: '/watchlist',
    label: '自选',
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={active ? 0 : 1.8}>
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        {active && <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor" opacity={0.9} />}
      </svg>
    ),
  },
  {
    path: '/portfolio',
    label: '收益',
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={active ? 0 : 1.8}>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M8 16l3-4 3 3 3-5" strokeLinecap="round" strokeLinejoin="round" stroke={active ? '#fff' : 'currentColor'} strokeWidth="1.8" fill="none" />
        {active && <rect x="3" y="3" width="18" height="18" rx="3" fill="currentColor" opacity={0.9} />}
        {active && <path d="M8 16l3-4 3 3 3-5" strokeLinecap="round" strokeLinejoin="round" stroke="#fff" strokeWidth="1.8" fill="none" />}
      </svg>
    ),
  },
  {
    path: '/settings',
    label: '我的',
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={active ? 0 : 1.8}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.58-7 8-7s8 3 8 7" strokeLinecap="round" />
        {active && <circle cx="12" cy="8" r="4" fill="currentColor" opacity={0.9} />}
        {active && <path d="M4 20c0-4 3.58-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />}
      </svg>
    ),
  },
]

export default function TabBar() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <div className="tab-bar">
      {tabs.map(tab => {
        const active = location.pathname.startsWith(tab.path)
        return (
          <div
            key={tab.path}
            className={`tab-item ${active ? 'active' : ''}`}
            onClick={() => navigate(tab.path)}
          >
            {tab.icon(active)}
            <span>{tab.label}</span>
          </div>
        )
      })}
    </div>
  )
}
