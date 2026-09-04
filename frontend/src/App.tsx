import { useCallback, useEffect, useState } from 'react'
import { Provider } from 'react-redux'
import { Toaster } from 'sonner'
import { store } from '@/commons/store'
import { useWebSocket } from '@/commons/hooks/useWebSocket'
import Sidebar from '@/commons/component/Sidebar'
import {
  ADMIN_DASHBOARD_PATH,
  CREATOR_DASHBOARD_PATH,
  TAB_PATHS,
  type Tab,
} from '@/commons/component/navigation'

// Features
import DashboardPage from '@/features/dashboard/DashboardPage'
import CreatorDashboardPage from '@/features/dashboard/CreatorDashboardPage'
import CrawlPage from '@/features/crawl/CrawlPage'
import ContentPage from '@/features/content/ContentPage'
import PlanningPage from '@/features/planning/PlanningPage'
import GenerateVideoProjectsPage from '@/features/generate-video/GenerateVideoProjectsPage'
import VideoProductionWorkspace from '@/features/generate-video/VideoProductionWorkspace'
import ApprovalsPage from '@/features/approvals/ApprovalsPage'
import SchedulePage from '@/features/schedule/SchedulePage'
import PublishedPostsPage from '@/features/published-posts/PublishedPostsPage'
import AccountAnalyticsPage from '@/features/analytics/AccountAnalyticsPage'
import PostAnalyticsPage from '@/features/analytics/PostAnalyticsPage'
import UsersPage from '@/features/users/UsersPage'
import ProfilePage from '@/features/users/ProfilePage'
import SettingsPage from '@/features/settings/SettingsPage'
import TermsPage from '@/features/legal/TermsPage'
import PrivacyPage from '@/features/legal/PrivacyPage'
import TikTokCallbackPage from '@/features/legal/TikTokCallbackPage'
import OpenAiUsagePage from '@/features/admin/OpenAiUsagePage'

import AuthPage from '@/features/auth/AuthPage'
import { getCurrentUserApi, logoutApi } from '@/commons/apis/api'
import './index.css'

type CurrentUser = {
  id: string | number
  email: string
  full_name?: string | null
  roles: string[]
  is_system_admin?: boolean
}

const PATH_TABS = Object.fromEntries(
  Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab]),
) as Record<string, Tab>
PATH_TABS[ADMIN_DASHBOARD_PATH] = 'dashboard'
PATH_TABS[CREATOR_DASHBOARD_PATH] = 'dashboard'

const LEGACY_PATHS: Record<string, string> = {
  '/planningRequest': TAB_PATHS.planning,
}

const ADMIN_TABS = new Set<Tab>(['dashboard', 'crawl', 'users', 'settings', 'profile', 'openaiUsage'])
const CREATOR_TABS = new Set<Tab>([
  'dashboard',
  'crawl',
  'content',
  'planning',
  'generateVideo',
  'approvals',
  'schedule',
  'publishedPosts',
  'analyticsAccounts',
  'analyticsPosts',
  'settings',
  'profile',
])

const getNormalizedPath = () => {
  const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/'
  return LEGACY_PATHS[normalizedPath] || normalizedPath
}

const getTabFromPath = (): Tab => {
  const normalizedPath = getNormalizedPath()
  if (normalizedPath.startsWith('/generate-video')) return 'generateVideo'
  return PATH_TABS[normalizedPath] ?? 'dashboard'
}

const isTabAllowed = (tab: Tab, isSystemUser: boolean) => (
  isSystemUser ? ADMIN_TABS.has(tab) : CREATOR_TABS.has(tab)
)

const dashboardPathForRole = (isSystemUser: boolean) => (
  isSystemUser ? ADMIN_DASHBOARD_PATH : CREATOR_DASHBOARD_PATH
)

const getGenerateVideoProjectIdFromPath = () => {
  const normalizedPath = getNormalizedPath()
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
  const activeTab = isTabAllowed(tab, isSystemUser) ? tab : 'dashboard'

  const handleTabChange = useCallback((nextTab: Tab, replace = false) => {
    const nextPath = nextTab === 'dashboard' ? dashboardPathForRole(isSystemUser) : TAB_PATHS[nextTab]
    if (window.location.pathname === nextPath) {
      setTab(nextTab)
      setGenerateVideoProjectId('')
      return
    }
    const method = replace ? 'replaceState' : 'pushState'
    window.history[method](null, '', nextPath)
    window.dispatchEvent(new Event('popstate'))
  }, [isSystemUser])

  const handleOpenProfileSettings = useCallback((profileId: string) => {
    if (window.location.pathname !== TAB_PATHS.settings) {
      window.history.pushState({ openProfileId: profileId, openTab: 'strategy' }, '', TAB_PATHS.settings)
      window.dispatchEvent(new Event('popstate'))
    } else {
      setTab('settings')
    }
  }, [])

  const handleOpenGenerateVideo = useCallback((workflowId?: string) => {
    const nextPath = workflowId ? `${TAB_PATHS.generateVideo}/${encodeURIComponent(workflowId)}` : TAB_PATHS.generateVideo
    if (window.location.pathname !== nextPath) {
      window.history.pushState({ workflowId }, '', nextPath)
      window.dispatchEvent(new Event('popstate'))
    } else {
      setTab('generateVideo')
      setGenerateVideoProjectId(workflowId || '')
    }
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
    let cancelled = false

    void getCurrentUserApi()
      .then((data) => {
        if (!cancelled) setCurrentUser(data)
      })
      .catch(() => {
        if (!cancelled) setCurrentUser(null)
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/'
    const nextPath = LEGACY_PATHS[normalizedPath]
    if (!nextPath) return
    window.history.replaceState(window.history.state, '', `${nextPath}${window.location.search}${window.location.hash}`)
  }, [])

  useEffect(() => {
    const handleAuthExpired = () => {
      setCurrentUser(null)
      window.history.replaceState(window.history.state, '', '/')
      setTab('dashboard')
      setAuthLoading(false)
    }

    window.addEventListener('auth:expired', handleAuthExpired)
    return () => window.removeEventListener('auth:expired', handleAuthExpired)
  }, [])

  useEffect(() => {
    const handlePopState = () => {
      setTab(getTabFromPath())
      setGenerateVideoProjectId(getGenerateVideoProjectIdFromPath())
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (!currentUser || isTabAllowed(tab, isSystemUser)) return
    window.history.replaceState(window.history.state, '', dashboardPathForRole(isSystemUser))
  }, [currentUser, isSystemUser, tab])

  useEffect(() => {
    if (!currentUser || activeTab !== 'dashboard') return
    const expectedPath = dashboardPathForRole(isSystemUser)
    if (getNormalizedPath() !== expectedPath) {
      window.history.replaceState(window.history.state, '', expectedPath)
    }
  }, [activeTab, currentUser, isSystemUser])

  useWebSocket(Boolean(currentUser))
  const effectiveGenerateVideoProjectId = activeTab === 'generateVideo'
    ? generateVideoProjectId || getGenerateVideoProjectIdFromPath()
    : ''

  const handleAuthenticated = async () => {
    setAuthLoading(true)
    await loadCurrentUser()
  }

  const handleLogout = async () => {
    await logoutApi()
    setCurrentUser(null)
    window.history.replaceState(window.history.state, '', '/')
    setTab('dashboard')
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
    <div className="compact-ui app-shell flex h-screen w-screen overflow-hidden bg-[var(--surface)]">
      <Sidebar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        isSystemUser={isSystemUser}
        currentUser={currentUser}
        onLogout={() => void handleLogout()}
      />

      <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <div className="app-content-frame flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
          {activeTab === 'dashboard' && (isSystemUser
            ? <DashboardPage />
            : <CreatorDashboardPage onNavigate={handleTabChange} onOpenProject={handleOpenGenerateVideo} />)}
          {activeTab === 'crawl' && <CrawlPage isSystemUser={isSystemUser} onOpenModule2={handleOpenGenerateVideo} />}
          {activeTab === 'content' && <ContentPage isSystemUser={isSystemUser} onOpenModule2={handleOpenGenerateVideo} />}
          {activeTab === 'planning' && <PlanningPage initialStep="jobs" isSystemUser={isSystemUser} onOpenProfileSettings={handleOpenProfileSettings} onOpenGenerateVideo={handleOpenGenerateVideo} />}
          {activeTab === 'generateVideo' && (effectiveGenerateVideoProjectId ? (
            <VideoProductionWorkspace workflowId={effectiveGenerateVideoProjectId} onBackToList={() => handleOpenGenerateVideo()} />
          ) : (
            <GenerateVideoProjectsPage onOpenProject={(workflowId) => handleOpenGenerateVideo(workflowId)} />
          ))}
          {activeTab === 'approvals' && <ApprovalsPage />}
          {activeTab === 'schedule' && <SchedulePage />}
          {activeTab === 'publishedPosts' && <PublishedPostsPage />}
          {activeTab === 'analyticsAccounts' && <AccountAnalyticsPage />}
          {activeTab === 'analyticsPosts' && <PostAnalyticsPage />}
          {activeTab === 'users' && <UsersPage currentUser={currentUser} />}
          {activeTab === 'profile' && <ProfilePage currentUser={currentUser} onProfileUpdated={() => void loadCurrentUser()} />}
          {activeTab === 'openaiUsage' && <OpenAiUsagePage />}
          {activeTab === 'settings' && <SettingsPage currentUser={currentUser} />}
        </div>
      </main>
    </div>
  )
}

export default function App() {
  const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/'
  if (normalizedPath === '/terms') return <TermsPage />
  if (normalizedPath === '/privacy') return <PrivacyPage />
  if (normalizedPath === '/auth/tiktok/callback') return <TikTokCallbackPage />

  return (
    <Provider store={store}>
      <Toaster position="top-right" richColors closeButton duration={3500} />
      <AppContent />
    </Provider>
  )
}
