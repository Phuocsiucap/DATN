import type { ReactNode } from 'react'
import {
  BarChart3,
  Bot,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  Clapperboard,
  Database,
  FileCheck2,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Newspaper,
  Send,
  Settings,
  Sparkles,
  UserRound,
} from 'lucide-react'
import type { Tab } from './navigation'
import { BrandMark, UserAvatar, type ApiUser, userDisplayName, userRoleLabel } from './social-ui'
import { cn } from '@/commons/lib/utils'

interface SidebarProps {
  activeTab: Tab
  onTabChange: (tab: Tab) => void
  isSystemUser?: boolean
  currentUser?: ApiUser | null
}

type NavItem = {
  key: Tab
  label: string
  icon: ReactNode
  badge?: string | number
}

type NavSection = {
  title: string
  items: NavItem[]
}

const creatorSections: NavSection[] = [
  {
    title: 'TỔNG QUAN',
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={17} /> },
      { key: 'schedule', label: 'Lịch đăng', icon: <CalendarDays size={17} /> },
      { key: 'publishedPosts', label: 'Bài đã đăng', icon: <Send size={17} /> },
    ],
  },
  {
    title: 'NỘI DUNG',
    items: [
      { key: 'content', label: 'Bài viết', icon: <Newspaper size={17} /> },
      { key: 'planning', label: 'Kế hoạch nội dung', icon: <Sparkles size={17} /> },
      { key: 'crawl', label: 'Nguồn dữ liệu', icon: <Database size={17} /> },
      { key: 'approvals', label: 'Duyệt bài', icon: <FileCheck2 size={17} />, badge: 12 },
    ],
  },
  {
    title: 'SẢN XUẤT',
    items: [
      { key: 'generateVideo', label: 'Xưởng video', icon: <Clapperboard size={17} /> },
    ],
  },
  {
    title: 'QUẢN LÝ',
    items: [
      { key: 'settings', label: 'Kênh social', icon: <Megaphone size={17} /> },
    ],
  },
]

const adminSections: NavSection[] = [
  {
    title: 'QUẢN LÝ',
    items: [
      { key: 'dashboard', label: 'Tổng quan', icon: <LayoutDashboard size={17} /> },
      { key: 'schedule', label: 'Lịch đăng', icon: <CalendarDays size={17} /> },
      { key: 'publishedPosts', label: 'Bài đã đăng', icon: <Send size={17} /> },
      { key: 'approvals', label: 'Duyệt bài', icon: <FileCheck2 size={17} />, badge: 12 },
      { key: 'content', label: 'Bài viết', icon: <Newspaper size={17} /> },
      { key: 'crawl', label: 'Thu thập dữ liệu', icon: <Database size={17} /> },
    ],
  },
  {
    title: 'SẢN XUẤT',
    items: [
      { key: 'planning', label: 'AI đề xuất', icon: <Bot size={17} /> },
      { key: 'generateVideo', label: 'Xưởng video', icon: <Clapperboard size={17} /> },
    ],
  },
  {
    title: 'CÀI ĐẶT',
    items: [
      { key: 'settings', label: 'Cấu hình chiến lược', icon: <Settings size={17} /> },
      { key: 'users', label: 'Thành viên', icon: <UserRound size={17} /> },
    ],
  },
]

const quickLinks = [
  { label: 'Phân tích', icon: <BarChart3 size={16} /> },
]

export default function Sidebar({
  activeTab,
  onTabChange,
  isSystemUser = false,
  currentUser,
}: SidebarProps) {
  const sections = isSystemUser ? adminSections : creatorSections
  const mobileItems = sections.flatMap((section) => section.items).slice(0, 6)
  const displayName = userDisplayName(currentUser)
  const roleLabel = userRoleLabel(currentUser)

  return (
    <>
      <aside className="sticky left-0 top-0 z-50 hidden h-screen w-[var(--app-sidebar-width)] shrink-0 flex-col border-r border-[var(--outline-variant)] bg-white px-4 py-5 md:flex">
        <BrandMark />

        <button className="mt-6 flex w-full items-center gap-3 rounded-[8px] border border-[var(--outline-variant)] bg-white p-3 text-left shadow-sm">
          <UserAvatar src={null} name={displayName} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-extrabold text-[#111827]">{displayName}</div>
            <div className="mt-0.5 truncate text-[12px] font-medium text-[#64748b]">{roleLabel}</div>
          </div>
          <ChevronDown size={16} className="text-[#526179]" />
        </button>

        <nav className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
          {sections.map((section) => (
            <div key={section.title} className="mb-5">
              <div className="mb-2 px-1 text-[11px] font-extrabold text-[#526179]">{section.title}</div>
              <div className="space-y-1">
                {section.items.map((item) => (
                  <NavButton
                    key={item.key}
                    item={item}
                    active={activeTab === item.key}
                    onClick={() => onTabChange(item.key)}
                  />
                ))}
              </div>
            </div>
          ))}

          {!isSystemUser && (
            <div className="mb-5">
              <div className="mb-2 px-1 text-[11px] font-extrabold text-[#526179]">TIỆN ÍCH</div>
              <div className="space-y-1">
                {quickLinks.map((item) => (
                  <button key={item.label} className="flex h-10 w-full items-center gap-3 rounded-[8px] px-3 text-[13px] font-semibold text-[#34415a] hover:bg-[#f4f6ff]">
                    <span className="text-[#718096]">{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </nav>

        <div className="space-y-3">
          <div className="rounded-[8px] border border-[var(--outline-variant)] bg-[#fbfcff] p-3">
            <div className="flex items-center gap-2 text-[13px] font-extrabold text-[#111827]">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[#fff3d6] text-[#f59e0b]">♕</span>
              Gói Premium
            </div>
            <div className="mt-1 text-[12px] font-medium text-[#64748b]">Sử dụng: 72 / 200 video</div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e9edf5]">
              <div className="h-full w-[38%] rounded-full bg-[linear-gradient(135deg,#6d5dfc,#2556ea)]" />
            </div>
          </div>

          <button className="flex h-10 w-full items-center gap-3 rounded-[8px] px-3 text-[13px] font-semibold text-[#34415a] hover:bg-[#f4f6ff]">
            <CircleHelp size={17} />
            Trợ giúp
          </button>
          <button className="flex h-10 w-full items-center gap-3 rounded-[8px] px-3 text-[13px] font-semibold text-[#34415a] hover:bg-[#f4f6ff]">
            <LogOut size={17} />
            Đăng xuất
          </button>
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-50 flex h-16 items-stretch gap-1 overflow-x-auto border-t border-[var(--outline-variant)] bg-white px-2 py-1.5 md:hidden">
        {mobileItems.map((item) => (
          <button
            key={item.key}
            onClick={() => onTabChange(item.key)}
            className={cn('flex min-w-[70px] flex-1 flex-col items-center justify-center gap-1 rounded-[8px] px-2 text-[10px] font-bold transition-colors', activeTab === item.key ? 'bg-[#f2f0ff] text-[#4f46e5]' : 'text-[#64748b]')}
          >
            {item.icon}
            <span className="max-w-full truncate">{item.label}</span>
          </button>
        ))}
      </nav>
    </>
  )
}

function NavButton({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn('flex h-[42px] w-full items-center justify-between rounded-[8px] px-3 text-[13px] font-bold transition-colors', active ? 'bg-[#f2f0ff] text-[#2556ea]' : 'text-[#34415a] hover:bg-[#f8faff]')}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className={active ? 'text-[#2556ea]' : 'text-[#64748b]'}>{item.icon}</span>
        <span className="truncate">{item.label}</span>
      </span>
      {item.badge !== undefined && <span className={cn('grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[11px] font-extrabold', active ? 'bg-[#2556ea] text-white' : 'bg-[#eef1f7] text-[#64748b]')}>{item.badge}</span>}
    </button>
  )
}
