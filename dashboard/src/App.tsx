import { useState } from 'react'
import { Provider } from 'react-redux'
import { store } from './store'
import { useWebSocket } from './hooks/useWebSocket'
import Navbar from './components/Navbar'
import DashboardPage from './pages/DashboardPage'
import ArticlesPage from './pages/ArticlesPage'
import { LayoutDashboard, Newspaper } from 'lucide-react'
import './index.css'

type Tab = 'dashboard' | 'articles'

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard', label: 'Tổng quan', icon: <LayoutDashboard size={16} /> },
  { key: 'articles', label: 'Bài viết', icon: <Newspaper size={16} /> },
]

function AppContent() {
  const [tab, setTab] = useState<Tab>('dashboard')
  useWebSocket()

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--bg-base)' }}>
      <Navbar />
      {/* Tab bar */}
      <div style={{ backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}
        className="px-6 flex items-center gap-1">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all relative"
            style={{
              color: tab === t.key ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            {t.icon}
            {t.label}
            {tab === t.key && (
              <span
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t"
                style={{ backgroundColor: 'var(--accent)' }}
              />
            )}
          </button>
        ))}
      </div>

      <main className="flex-1 overflow-auto">
        {tab === 'dashboard' ? <DashboardPage /> : <ArticlesPage />}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <Provider store={store}>
      <AppContent />
    </Provider>
  )
}
