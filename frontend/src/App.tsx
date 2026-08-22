import { useCallback, useEffect, useState } from 'react'
import { Provider } from 'react-redux'
import { store } from '@/commons/store'
import { useWebSocket } from '@/commons/hooks/useWebSocket'
import Sidebar from '@/commons/component/Sidebar'
import { TAB_PATHS, type Tab } from '@/commons/component/Sidebar'
import TopNavBar from '@/commons/component/TopNavBar'

// Features
import DashboardPage from '@/features/dashboard/DashboardPage'
import CrawlPage from '@/features/crawl/CrawlPage'
import ContentPage from '@/features/content/ContentPage'
import PlanningPage from '@/features/planning/PlanningPage'
import GenerateVideoProjectsPage from '@/features/generate-video/GenerateVideoProjectsPage'
import VideoProductionWorkspace from '@/features/generate-video/VideoProductionWorkspace'
import ApprovalsPage from '@/features/approvals/ApprovalsPage'
import SchedulePage from '@/features/schedule/SchedulePage'
import UsersPage from '@/features/users/UsersPage'
import SettingsPage from '@/features/settings/SettingsPage'

import AuthPage from '@/features/auth/AuthPage'
import { getCurrentUserApi, logoutApi } from '@/commons/apis/api'
import './index.css'

type CurrentUser = {
  id: string | number
  email: string
  roles: string[]
  is_system_admin?: boolean
}

const PATH_TABS = Object.fromEntries(
  Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab]),
) as Record<string, Tab>

const getTabFromPath = (): Tab => {
  const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/'
  if (normalizedPath.startsWith('/generate-video')) return 'generateVideo'
  return PATH_TABS[normalizedPath] ?? 'dashboard'
}

const getGenerateVideoProjectIdFromPath = () => {
  const normalizedPath = window.location.pathname.replace(/\/+$/, '')
  const match = normalizedPath.match(/^\/generate-video\/([^/?#]+)/)
  if (match?.[1]) return decodeURIComponent(match[1])
  return ''
}

function AppContent() {
  const [tab, setTab] = useState<Tab>(getTabFromPath)
  const [generateVideoProjectId, setGenerateVideoProjectId] = useState(getGenerateVideoProjectIdFromPath)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  const isSystemUser = Boolean(
    currentUser?.is_system_admin ||
    currentUser?.roles?.some((r) => {
      const lower = r.toLowerCase()
      return lower === 'system' || lower === 'system_admin' || lower === 'admin'
    })
  )

  const handleTabChange = useCallback((nextTab: Tab, replace = false) => {
    setTab(nextTab)
    setGenerateVideoProjectId('')
    const nextPath = TAB_PATHS[nextTab]
    if (window.location.pathname === nextPath) return
    const method = replace ? 'replaceState' : 'pushState'
    window.history[method](null, '', nextPath)
  }, [])

  const handleOpenProfileSettings = useCallback((profileId: string) => {
    setTab('settings')
    window.history.pushState({ openProfileId: profileId, openTab: 'strategy' }, '', TAB_PATHS.settings)
  }, [])

  const handleOpenGenerateVideo = useCallback((workflowId?: string) => {
    setTab('generateVideo')
    setGenerateVideoProjectId(workflowId || '')
    const suffix = workflowId ? `/${encodeURIComponent(workflowId)}` : ''
    window.history.pushState({ workflowId }, '', `${TAB_PATHS.generateVideo}${suffix}`)
  }, [])

  const handleOpenModule2 = useCallback((jobId?: string) => {
    setTab('planning')
    const suffix = jobId ? `?job_id=${encodeURIComponent(jobId)}` : ''
    window.history.pushState({ jobId }, '', `${TAB_PATHS.planning}${suffix}`)
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
    const handlePopState = () => {
      setTab(getTabFromPath())
      setGenerateVideoProjectId(getGenerateVideoProjectIdFromPath())
    }
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
      <div className="compact-ui min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="bento-card px-4 py-3 text-xs" style={{ color: 'var(--on-surface-variant)' }}>
          Loading session...
        </div>
      </div>
    )
  }

  if (!currentUser) {
    return <AuthPage onAuthenticated={handleAuthenticated} />
  }

  return (
    <div className="compact-ui flex min-h-screen" style={{ backgroundColor: 'var(--surface)' }}>
      <Sidebar
        activeTab={tab}
        onTabChange={handleTabChange}
        isSystemUser={isSystemUser}
      />

      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
        <TopNavBar
          email={currentUser.email}
          onLogout={() => void handleLogout()}
          isSystemUser={isSystemUser}
        />
        <div className="w-full max-w-[1680px] mx-auto px-4 py-4 pb-20 md:px-5 md:pb-4">
          {tab === 'dashboard' && <DashboardPage currentUser={currentUser} />}
          {tab === 'crawl' && <CrawlPage isSystemUser={isSystemUser} onOpenModule2={handleOpenModule2} />}
          {tab === 'content' && <ContentPage isSystemUser={isSystemUser} onOpenModule2={handleOpenModule2} />}
          {tab === 'planning' && <PlanningPage initialStep="jobs" isSystemUser={isSystemUser} onOpenProfileSettings={handleOpenProfileSettings} onOpenGenerateVideo={handleOpenGenerateVideo} />}
          {tab === 'planningReview' && <PlanningPage initialStep="plans" isSystemUser={isSystemUser} onOpenProfileSettings={handleOpenProfileSettings} onOpenGenerateVideo={handleOpenGenerateVideo} />}
          {tab === 'planningOutput' && <PlanningPage initialStep="output" isSystemUser={isSystemUser} onOpenProfileSettings={handleOpenProfileSettings} onOpenGenerateVideo={handleOpenGenerateVideo} />}
          {tab === 'generateVideo' && (generateVideoProjectId ? (
            <VideoProductionWorkspace workflowId={generateVideoProjectId} onBackToList={() => handleOpenGenerateVideo()} />
          ) : (
            <GenerateVideoProjectsPage onOpenProject={(workflowId) => handleOpenGenerateVideo(workflowId)} />
          ))}
          {tab === 'approvals' && <ApprovalsPage />}
          {tab === 'schedule' && <SchedulePage />}
          {tab === 'users' && (isSystemUser ? <UsersPage currentUser={currentUser} /> : <DashboardPage currentUser={currentUser} />)}
          {tab === 'settings' && <SettingsPage currentUser={currentUser} />}
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
