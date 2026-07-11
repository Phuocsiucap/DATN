import { useState } from 'react'
import { Provider } from 'react-redux'
import { store } from './store'
import { useWebSocket } from './hooks/useWebSocket'
import Navbar from './components/Navbar'
import DashboardPage from './pages/DashboardPage'
import ArticlesPage from './pages/ArticlesPage'
import './index.css'

type Tab = 'dashboard' | 'articles'

function AppContent() {
  const [tab, setTab] = useState<Tab>('dashboard')
  useWebSocket()

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Navbar />
      <div className="flex gap-4 px-6 pt-4 border-b border-gray-700">
        {(['dashboard', 'articles'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`pb-3 text-sm font-medium capitalize border-b-2 transition-colors ${
              tab === t ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}>
            {t === 'dashboard' ? 'Tổng quan' : 'Bài viết'}
          </button>
        ))}
      </div>
      {tab === 'dashboard' ? <DashboardPage /> : <ArticlesPage />}
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
