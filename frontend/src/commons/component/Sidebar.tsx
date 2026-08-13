import type { ReactNode } from 'react'
import {
  LayoutDashboard,
  Newspaper,
  Settings,
  HelpCircle,
  Workflow,
  Sparkles,
  FileCheck2,
  MonitorPlay,
  Clapperboard,
} from 'lucide-react'

export type Tab =
  | 'dashboard'
  | 'crawl'
  | 'content'
  | 'planning'
  | 'planningReview'
  | 'planningOutput'
  | 'module3'
  | 'settings'

interface SidebarProps {
  activeTab: Tab
  onTabChange: (tab: Tab) => void
  isSystemUser?: boolean
}

export const TAB_PATHS: Record<Tab, string> = {
  dashboard: '/',
  crawl: '/crawl',
  content: '/content',
  planning: '/planning',
  planningReview: '/planning/review',
  planningOutput: '/planning/output',
  module3: '/module3',
  settings: '/settings',
}

interface NavSection {
  title: string
  items: { key: Tab; label: string; icon: ReactNode; systemOnly?: boolean; badge?: string }[]
}

type NavItem = NavSection['items'][number]

const SECTIONS: NavSection[] = [
  {
    title: 'TỔNG QUAN',
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={15} /> },
    ],
  },
  {
    title: 'DATA & NỘI DUNG',
    items: [
      { key: 'crawl', label: 'Crawl', icon: <Workflow size={15} /> },
      { key: 'content', label: 'Content Store', icon: <Newspaper size={15} /> },
    ],
  },
  {
    title: 'AI & SẢN XUẤT',
    items: [
      { key: 'planning', label: 'Module 2 Jobs', icon: <Sparkles size={15} /> },
      { key: 'planningReview', label: 'Duyệt Plans', icon: <FileCheck2 size={15} /> },
      { key: 'planningOutput', label: 'Output', icon: <MonitorPlay size={15} /> },
      { key: 'module3', label: 'Module 3', icon: <Clapperboard size={15} /> },
    ],
  },
]

export default function Sidebar({
  activeTab,
  onTabChange,
  isSystemUser = false,
}: SidebarProps) {
  const settingsItem: NavItem = { key: 'settings', label: 'Cài đặt', icon: <Settings size={15} /> }
  const mobileItems: NavItem[] = [
    ...SECTIONS.flatMap((section) => section.items),
    settingsItem,
  ].filter((item) => !item.systemOnly || isSystemUser)

  return (
    <>
      <aside
        className="w-[var(--app-sidebar-width)] h-screen sticky left-0 top-0 flex-col py-3 hidden md:flex z-50 border-r select-none"
        style={{ backgroundColor: 'var(--primary)', borderColor: 'rgba(255,255,255,0.08)' }}
      >
        <div className="px-3 pb-3 mb-2 flex items-center gap-2.5 border-b border-white/10">
          <img src="/logo.png" alt="SocialContent Hub" className="w-8 h-8 object-contain rounded-md" />
          <div>
            <h1 className="text-xs font-bold leading-tight text-white">
              SOCIALCONTENT
            </h1>
            <p className="text-[9px] font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>
              STUDIO
            </p>
          </div>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-2.5 custom-scrollbar">
          {SECTIONS.map((section, idx) => {
            const visibleItems = section.items.filter((item) => !item.systemOnly || isSystemUser)
            if (visibleItems.length === 0) return null

            return (
              <div key={idx} className="space-y-1">
                <div className="px-2.5 mb-1.5 text-[9px] font-bold uppercase" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  {section.title}
                </div>

                {visibleItems.map((item) => {
                  const isActive = activeTab === item.key
                  return (
                    <button
                      key={item.key}
                      onClick={() => onTabChange(item.key)}
                      className="relative w-full flex items-center justify-between px-2.5 py-2 rounded-md text-xs font-medium transition-colors hover:bg-white/10"
                      style={{
                        color: isActive ? '#ffffff' : 'rgba(255,255,255,0.7)',
                        backgroundColor: isActive ? 'rgba(255,255,255,0.1)' : 'transparent',
                        borderLeft: isActive
                          ? '3px solid #22c55e'
                          : '3px solid transparent',
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {item.icon}
                        <span className="truncate">{item.label}</span>
                      </div>

                      {item.badge && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-zinc-800 text-amber-400 border border-amber-500/20">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </nav>

        <div className="px-2.5 pt-2.5 border-t border-white/10 space-y-1">
          <button
            onClick={() => onTabChange('settings')}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-xs transition-colors"
            style={{
              color: activeTab === 'settings' ? '#ffffff' : 'rgba(255,255,255,0.7)',
              backgroundColor: activeTab === 'settings' ? 'rgba(255,255,255,0.12)' : 'transparent',
              borderLeft: activeTab === 'settings' ? '3px solid #22c55e' : '3px solid transparent',
            }}
          >
            <Settings size={15} />
            <span>Cài đặt</span>
          </button>
          <button className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-xs transition-colors" style={{ color: 'rgba(255,255,255,0.7)', borderLeft: '3px solid transparent' }}>
            <HelpCircle size={15} />
            <span>Hướng dẫn</span>
          </button>
        </div>
      </aside>

      <nav
        className="fixed inset-x-0 bottom-0 z-50 flex h-16 items-stretch gap-1 overflow-x-auto border-t px-2 py-1.5 md:hidden"
        style={{ backgroundColor: 'var(--surface-container-lowest)', borderColor: 'var(--outline-variant)' }}
      >
        {mobileItems.map((item) => {
          const isActive = activeTab === item.key
          return (
            <button
              key={item.key}
              onClick={() => onTabChange(item.key)}
              className="flex min-w-[70px] flex-1 flex-col items-center justify-center gap-1 rounded-md px-2 text-[10px] font-medium transition-colors"
              style={{
                backgroundColor: isActive ? 'var(--secondary-container)' : 'transparent',
                color: isActive ? 'var(--accent-strong)' : 'var(--on-surface-variant)',
              }}
            >
              {item.icon}
              <span className="max-w-full truncate">{item.label}</span>
            </button>
          )
        })}
      </nav>
    </>
  )
}
