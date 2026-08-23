import type { ReactNode } from 'react'
import {
  LayoutDashboard,
  Newspaper,
  Settings,
  HelpCircle,
  Workflow,
  Sparkles,
  FileCheck2,
  Clapperboard,
  CalendarDays,
  UsersRound,
} from 'lucide-react'

export type Tab =
  | 'dashboard'
  | 'crawl'
  | 'content'
  | 'planning'
  | 'generateVideo'
  | 'approvals'
  | 'schedule'
  | 'users'
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
  generateVideo: '/generate-video',
  approvals: '/approvals',
  schedule: '/schedule',
  users: '/users',
  settings: '/settings',
}

interface NavSection {
  title: string
  items: { key: Tab; label: string; icon: ReactNode; badge?: string }[]
}

type NavItem = NavSection['items'][number]

const getAdminSections = (): NavSection[] => [
  {
    title: 'QUẢN TRỊ & TỔNG QUAN',
    items: [
      { key: 'dashboard', label: 'System Dashboard', icon: <LayoutDashboard size={15} /> },
      { key: 'users', label: 'Quản lý Người dùng', icon: <UsersRound size={15} />, badge: 'Admin' },
    ],
  },
  {
    title: 'DỮ LIỆU HỆ THỐNG (GLOBAL)',
    items: [
      { key: 'crawl', label: 'Global Crawl Jobs', icon: <Workflow size={15} /> },
      { key: 'content', label: 'Kho Dữ liệu Global', icon: <Newspaper size={15} /> },
    ],
  },
  {
    title: 'VẬN HÀNH & GIÁM SÁT',
    items: [
      { key: 'settings', label: 'Logs & System Config', icon: <Settings size={15} /> },
    ],
  },
  {
    title: 'CÔNG CỤ CREATOR (XEM TRƯỚC)',
    items: [
      { key: 'planning', label: 'Chiến dịch AI', icon: <Sparkles size={15} /> },
      { key: 'generateVideo', label: 'Xưởng Sản xuất Video', icon: <Clapperboard size={15} /> },
      { key: 'approvals', label: 'Duyệt Đăng bài', icon: <FileCheck2 size={15} /> },
      { key: 'schedule', label: 'Lịch Xuất bản', icon: <CalendarDays size={15} /> },
    ],
  },
]

const getCreatorSections = (): NavSection[] => [
  {
    title: 'TỔNG QUAN SÁNG TẠO',
    items: [
      { key: 'dashboard', label: 'Creator Dashboard', icon: <LayoutDashboard size={15} /> },
    ],
  },
  {
    title: 'DỮ LIỆU CÁ NHÂN (PRIVATE)',
    items: [
      { key: 'crawl', label: 'Thu thập Dữ liệu Riêng', icon: <Workflow size={15} /> },
      { key: 'content', label: 'Kho Dữ liệu Riêng', icon: <Newspaper size={15} /> },
    ],
  },
  {
    title: 'AI & SẢN XUẤT VIDEO',
    items: [
      { key: 'planning', label: 'Chiến dịch AI', icon: <Sparkles size={15} /> },
      { key: 'generateVideo', label: 'Xưởng Sản xuất Video', icon: <Clapperboard size={15} /> },
    ],
  },
  {
    title: 'QA & XUẤT BẢN',
    items: [
      { key: 'approvals', label: 'Duyệt Đăng bài', icon: <FileCheck2 size={15} /> },
      { key: 'schedule', label: 'Lịch Xuất bản', icon: <CalendarDays size={15} /> },
    ],
  },
]

export default function Sidebar({
  activeTab,
  onTabChange,
  isSystemUser = false,
}: SidebarProps) {
  const sections = isSystemUser ? getAdminSections() : getCreatorSections()
  const settingsItem: NavItem = { key: 'settings', label: isSystemUser ? 'Cài đặt System' : 'Kênh & Strategy', icon: <Settings size={15} /> }
  
  const mobileItems: NavItem[] = [
    ...sections.flatMap((section) => section.items),
    settingsItem,
  ]

  return (
    <>
      <aside
        className="w-[var(--app-sidebar-width)] h-screen sticky left-0 top-0 flex-col py-3 hidden md:flex z-50 border-r select-none"
        style={{ backgroundColor: 'var(--primary)', borderColor: 'rgba(255,255,255,0.08)' }}
      >
        {/* Workspace Brand Header */}
        <div className="px-3 pb-3 mb-2 flex flex-col gap-2 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="SocialContent Hub" className="w-8 h-8 object-contain rounded-md" />
            <div>
              <h1 className="text-xs font-bold leading-tight text-white">
                SOCIALCONTENT
              </h1>
              <p className="text-[9px] font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>
                STUDIO PLATFORM
              </p>
            </div>
          </div>

          {/* Role Status Tag */}
          <div className={`px-2.5 py-1 rounded text-[10px] font-bold tracking-wider uppercase text-center border ${
            isSystemUser 
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' 
              : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
          }`}>
            {isSystemUser ? '⚡ System Admin Workspace' : '🎨 Content Creator Workspace'}
          </div>
        </div>

        {/* Navigation Sections */}
        <nav className="flex-1 space-y-4 overflow-y-auto px-2.5 custom-scrollbar">
          {sections.map((section, idx) => (
            <div key={idx} className="space-y-1">
              <div className="px-2.5 mb-1.5 text-[9px] font-bold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.45)' }}>
                {section.title}
              </div>

              {section.items.map((item) => {
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
                        ? isSystemUser ? '3px solid #f59e0b' : '3px solid #22c55e'
                        : '3px solid transparent',
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {item.icon}
                      <span className="truncate">{item.label}</span>
                    </div>

                    {item.badge && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-300 border border-amber-500/30">
                        {item.badge}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        {/* Footer Actions */}
        <div className="px-2.5 pt-2.5 border-t border-white/10 space-y-1">
          <button
            onClick={() => onTabChange('settings')}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-xs transition-colors"
            style={{
              color: activeTab === 'settings' ? '#ffffff' : 'rgba(255,255,255,0.7)',
              backgroundColor: activeTab === 'settings' ? 'rgba(255,255,255,0.12)' : 'transparent',
              borderLeft: activeTab === 'settings' ? (isSystemUser ? '3px solid #f59e0b' : '3px solid #22c55e') : '3px solid transparent',
            }}
          >
            <Settings size={15} />
            <span>{isSystemUser ? 'Cài đặt System & Logs' : 'Kênh & Strategy'}</span>
          </button>
          <button className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-xs transition-colors" style={{ color: 'rgba(255,255,255,0.7)', borderLeft: '3px solid transparent' }}>
            <HelpCircle size={15} />
            <span>Hướng dẫn Vận hành</span>
          </button>
        </div>
      </aside>

      {/* Mobile Bottom Bar */}
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
