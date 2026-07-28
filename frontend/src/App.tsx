import { useCallback, useEffect, useState } from 'react'
import { Provider } from 'react-redux'
import { store } from '@/commons/store'
import { useWebSocket } from '@/commons/hooks/useWebSocket'
import Sidebar from '@/commons/component/Sidebar'
import { TAB_PATHS, type Tab } from '@/commons/component/Sidebar'
import TopNavBar from '@/commons/component/TopNavBar'
import DashboardPage from '@/features/dashboard/DashboardPage'
import ArticlesPage from '@/features/articles/ArticlesPage'
import ApprovalsPage from '@/features/approvals/ApprovalsPage'
import SchedulePage from '@/features/schedule/SchedulePage'
import AccountsPage from '@/features/accounts/AccountsPage'
import VideoLocalizationPage from '@/features/video-localization/VideoLocalizationPage'
import AuthPage from '@/features/auth/AuthPage'
import UsersPage from '@/features/users/UsersPage'
import SettingsPage from '@/features/settings/SettingsPage'
import { getCurrentUserApi, logoutApi } from '@/commons/apis/api'
import './index.css'

type CurrentUser = {
  id: number
  email: string
  roles: string[]
}

const PATH_TABS = Object.fromEntries(
  Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab]),
) as Record<string, Tab>

const getTabFromPath = (): Tab => {
  const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/'
  if (normalizedPath.startsWith('/video-localization/')) return 'video-localization'
  return PATH_TABS[normalizedPath] ?? 'dashboard'
}

function AppContent() {
  const [tab, setTab] = useState<Tab>(getTabFromPath)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const isSystemUser = currentUser?.roles.includes('system') ?? false

  const handleTabChange = useCallback((nextTab: Tab, replace = false) => {
    setTab(nextTab)
    const nextPath = TAB_PATHS[nextTab]
    if (window.location.pathname === nextPath) return
    const method = replace ? 'replaceState' : 'pushState'
    window.history[method](null, '', nextPath)
  }, [])

  const loadCurrentUser = async () => {
    try {
      const data = await getCurrentUserApi()
      setCurrentUser(data)
    } catch {
      setCurrentUser(null)
    } finally {
      setAuthLoading(false)
    }
  }

  useEffect(() => {
    void loadCurrentUser()
  }, [])

  useEffect(() => {
    const handleAuthExpired = () => {
      setCurrentUser(null)
      handleTabChange('dashboard', true)
      setAuthLoading(false)
    }

    window.addEventListener('auth:expired', handleAuthExpired)
    return () => window.removeEventListener('auth:expired', handleAuthExpired)
  }, [handleTabChange])

  useEffect(() => {
    if ((tab === 'users' || tab === 'settings') && !isSystemUser) {
      handleTabChange('dashboard', true)
    }
  }, [handleTabChange, isSystemUser, tab])

  useEffect(() => {
    const handlePopState = () => setTab(getTabFromPath())
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useWebSocket(Boolean(currentUser))

  const handleAuthenticated = async () => {
    setAuthLoading(true)
    await loadCurrentUser()
  }

  const handleLogout = async () => {
    await logoutApi()
    setCurrentUser(null)
    handleTabChange('dashboard', true)
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="bento-card rounded-2xl px-6 py-4 text-sm" style={{ color: 'var(--on-surface-variant)' }}>
          Loading session...
        </div>
      </div>
    )
  }

  if (!currentUser) {
    return <AuthPage onAuthenticated={handleAuthenticated} />
  }

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: 'var(--surface)' }}>
      <Sidebar activeTab={tab} onTabChange={handleTabChange} isSystemUser={isSystemUser} />

      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
        <TopNavBar email={currentUser.email} onLogout={() => void handleLogout()} />
        <div className={tab === 'video-localization' ? 'flex-1 min-h-0 w-full overflow-hidden' : 'p-6 max-w-[1440px] mx-auto w-full'}>
          {tab === 'dashboard' && <DashboardPage currentUser={currentUser} />}
          {tab === 'articles' && <ArticlesPage />}
          {tab === 'approvals' && <ApprovalsPage />}
          {tab === 'schedule' && <SchedulePage />}
          {tab === 'accounts' && <AccountsPage currentUser={currentUser} />}
          {tab === 'video-localization' && <VideoLocalizationPage />}
          {tab === 'users' && isSystemUser && <UsersPage currentUser={currentUser} />}
          {tab === 'settings' && isSystemUser && <SettingsPage currentUser={currentUser} />}
        </div>
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
