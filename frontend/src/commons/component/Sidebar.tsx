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
} from 'lucide-react'

export type Tab =
  | 'dashboard'
  | 'crawl'
  | 'content'
  | 'planning'
  | 'planningReview'
  | 'planningOutput'
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
  settings: '/settings',
}

interface NavSection {
  title: string
  items: { key: Tab; label: string; icon: ReactNode; systemOnly?: boolean; badge?: string }[]
}

const SECTIONS: NavSection[] = [
  {
    title: 'TỔNG QUAN',
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    ],
  },
  {
    title: 'DATA & NỘI DUNG',
    items: [
      { key: 'crawl', label: 'Thu Thập Dữ Liệu', icon: <Workflow size={18} /> },
      { key: 'content', label: 'Kho Nội Dung', icon: <Newspaper size={18} /> },
    ],
  },
  {
    title: 'AI & SẢN XUẤT',
    items: [
      { key: 'planning', label: 'Tiến Trình Job', icon: <Sparkles size={18} /> },
      { key: 'planningReview', label: 'Duyệt Thành Phẩm', icon: <FileCheck2 size={18} /> },
      { key: 'planningOutput', label: 'Xem Đầu Ra', icon: <MonitorPlay size={18} /> },
    ],
  },
]

export default function Sidebar({
  activeTab,
  onTabChange,
  isSystemUser = false,
}: SidebarProps) {
  return (
    <aside
      className="w-[270px] h-screen sticky left-0 top-0 flex flex-col py-5 hidden md:flex z-50 border-r select-none"
      style={{ backgroundColor: 'var(--primary)', borderColor: 'rgba(255,255,255,0.1)' }}
    >
      {/* Logo */}
      <div className="px-4 mb-8 flex items-center gap-3">
        <img src="/logo.png" alt="SocialContent Hub" className="w-10 h-10 object-contain" />
        <div>
          <h1 className="text-sm font-bold tracking-tight leading-tight text-white">
            SOCIALCONTENT
          </h1>
          <p className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>
            STUDIO WORKSPACE
          </p>
        </div>
      </div>

      {/* Navigation Sections */}
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 custom-scrollbar">
        {SECTIONS.map((section, idx) => {
          const visibleItems = section.items.filter((item) => !item.systemOnly || isSystemUser)
          if (visibleItems.length === 0) return null

          return (
            <div key={idx} className="space-y-1">
              <div className="px-3 mb-2 text-[10px] font-bold tracking-wider uppercase" style={{ color: 'rgba(255,255,255,0.5)' }}>
                {section.title}
              </div>

              {visibleItems.map((item) => {
                const isActive = activeTab === item.key
                return (
                  <button
                    key={item.key}
                    onClick={() => onTabChange(item.key)}
                    className="relative w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all"
                    style={{
                      color: isActive ? '#ffffff' : 'rgba(255,255,255,0.7)',
                      backgroundColor: isActive ? 'rgba(255,255,255,0.12)' : 'transparent',
                      borderLeft: isActive
                        ? '3px solid #6abf40'
                        : '3px solid transparent',
                    }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
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

      {/* Bottom Footer */}
      <div className="px-3 pt-3 border-t border-white/10 space-y-1">
        <button
          onClick={() => onTabChange('settings')}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
          style={{
            color: activeTab === 'settings' ? '#ffffff' : 'rgba(255,255,255,0.7)',
            backgroundColor: activeTab === 'settings' ? 'rgba(255,255,255,0.12)' : 'transparent',
            borderLeft: activeTab === 'settings' ? '3px solid #6abf40' : '3px solid transparent',
          }}
        >
          <Settings size={18} />
          <span>Cài Đặt & Tài Khoản</span>
        </button>
        <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors" style={{ color: 'rgba(255,255,255,0.7)', borderLeft: '3px solid transparent' }}>
          <HelpCircle size={18} />
          <span>Hướng dẫn sử dụng</span>
        </button>
      </div>
    </aside>
  )
}
