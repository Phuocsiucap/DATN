import type { ReactNode } from 'react'
import { LayoutDashboard, Newspaper, CalendarDays, Settings, HelpCircle, Plus, CircleUserRound, UsersRound, CheckSquare, Languages, Workflow, Sparkles } from 'lucide-react'

export type Tab = 'dashboard' | 'module1' | 'module2' | 'articles' | 'approvals' | 'schedule' | 'accounts' | 'video-localization' | 'users' | 'settings'

interface SidebarProps {
  activeTab: Tab
  onTabChange: (tab: Tab) => void
  isSystemUser?: boolean
}

export const TAB_PATHS: Record<Tab, string> = {
  dashboard: '/',
  module1: '/module-1',
  module2: '/module-2',
  articles: '/articles',
  approvals: '/approvals',
  schedule: '/schedule',
  accounts: '/accounts',
  'video-localization': '/video-localization',
  users: '/users',
  settings: '/settings',
}

const NAV_ITEMS: { key: Tab; label: string; icon: ReactNode; path: string; systemOnly?: boolean }[] = [
  { key: 'dashboard',  label: 'Dashboard',        icon: <LayoutDashboard size={20} />, path: TAB_PATHS.dashboard },
  { key: 'module1', label: 'Module 1', icon: <Workflow size={20} />, path: TAB_PATHS.module1 },
  { key: 'module2', label: 'Module 2', icon: <Sparkles size={20} />, path: TAB_PATHS.module2 },
  { key: 'articles',   label: 'Content Collection', icon: <Newspaper size={20} />, path: TAB_PATHS.articles },
  { key: 'approvals',  label: 'AI Approvals',     icon: <CheckSquare size={20} />, path: TAB_PATHS.approvals },
  { key: 'schedule',   label: 'Posting Schedule',  icon: <CalendarDays size={20} />, path: TAB_PATHS.schedule },
  { key: 'accounts',   label: 'Social Accounts',  icon: <CircleUserRound size={20} />, path: TAB_PATHS.accounts },
  { key: 'video-localization', label: 'Video Translate', icon: <Languages size={20} />, path: TAB_PATHS['video-localization'] },
  { key: 'users',      label: 'User Management',  icon: <UsersRound size={20} />, path: TAB_PATHS.users, systemOnly: true },
  { key: 'settings',   label: 'Admin Settings',   icon: <Settings size={20} />, path: TAB_PATHS.settings, systemOnly: true },
]

export default function Sidebar({ activeTab, onTabChange, isSystemUser = false }: SidebarProps) {
  const visibleItems = NAV_ITEMS.filter((item) => !item.systemOnly || isSystemUser)

  return (
    <aside
      className="w-[260px] h-screen sticky left-0 top-0 flex-col py-6 hidden md:flex z-50 border-r"
      style={{ backgroundColor: 'var(--primary)', borderColor: 'rgba(255,255,255,0.1)' }}
    >
      {/* Logo */}
      <div className="px-4 mb-8 flex items-center gap-3">
        <img src="/logo.png" alt="The SocialContent Hub" className="w-16 h-16 object-contain" />
        <div>
          <h1 className="text-sm font-bold tracking-tight leading-tight" style={{ color: '#6abf40' }}>
            THE SOCIALCONTENT HUB
          </h1>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-2">
        {visibleItems.map((item) => (
          <button
            key={item.key}
            onClick={() => onTabChange(item.key)}
            className="relative w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all"
            title={item.path}
            style={{
              color: activeTab === item.key ? 'var(--on-primary)' : 'rgba(255,255,255,0.7)',
              backgroundColor: activeTab === item.key ? 'rgba(255,255,255,0.1)' : 'transparent',
              borderLeft: activeTab === item.key ? '4px solid var(--secondary)' : '4px solid transparent',
            }}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Bottom */}
      <div className="px-2 pt-6 border-t space-y-1" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
        <button
          className="w-full mb-4 px-4 py-3 rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-all active:scale-95 shadow-lg"
          style={{ backgroundColor: 'var(--secondary)', color: 'var(--on-secondary)' }}
        >
          <Plus size={18} /> Tạo bài viết mới
        </button>
        <button className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors"
          onClick={() => onTabChange('settings')}
          style={{ color: 'rgba(255,255,255,0.7)' }}>
          <Settings size={18} /><span>Cài đặt</span>
        </button>
        <button className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors"
          style={{ color: 'rgba(255,255,255,0.7)' }}>
          <HelpCircle size={18} /><span>Hỗ trợ</span>
        </button>
      </div>
    </aside>
  )
}
