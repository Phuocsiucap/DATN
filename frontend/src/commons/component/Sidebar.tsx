import { useEffect, useState, type ReactNode } from 'react'
import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  Clapperboard,
  Coins,
  Cpu,
  Database,
  FileCheck2,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Settings,
  Sparkles,
  UserRound,
  Video,
  X,
} from 'lucide-react'
import type { Tab } from './navigation'
import { BrandMark, UserAvatar, type ApiUser, userDisplayName, userRoleLabel } from './social-ui'
import { getMyAiUsageApi } from '@/commons/apis/auth'
import { cn } from '@/commons/lib/utils'

interface SidebarProps {
  activeTab: Tab
  onTabChange: (tab: Tab) => void
  isSystemUser?: boolean
  currentUser?: ApiUser | null
  onLogout?: () => void
  collapsed?: boolean
  onToggleCollapse?: (collapsed: boolean) => void
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

type AiUsageData = {
  total_input_tokens: number
  total_output_tokens: number
  total_tokens: number
  total_cost_usd: number
  prompt_runs_count: number
  recent_runs: any[]
}

const creatorSections: NavSection[] = [
  {
    title: 'NỘI DUNG',
    items: [
      { key: 'crawl', label: 'Nguồn dữ liệu', icon: <Database size={17} /> },
      { key: 'content', label: 'Bài viết', icon: <Newspaper size={17} /> },
      { key: 'planning', label: 'Kế hoạch nội dung', icon: <Sparkles size={17} /> },
    ],
  },
  {
    title: 'SẢN XUẤT',
    items: [
      { key: 'generateVideo', label: 'Xưởng video', icon: <Clapperboard size={17} /> },
      { key: 'approvals', label: 'Duyệt video', icon: <FileCheck2 size={17} />, badge: 12 },
      { key: 'publishedPosts', label: 'Video đã đăng', icon: <Send size={17} /> },
    ],
  },
  {
    title: 'QUẢN LÝ & PHÂN TÍCH',
    items: [
      { key: 'settings', label: 'Kênh social', icon: <Megaphone size={17} /> },
      { key: 'schedule', label: 'Lịch đăng', icon: <CalendarDays size={17} /> },
      { key: 'analyticsAccounts', label: 'Phân tích theo tài khoản', icon: <BarChart3 size={17} /> },
      { key: 'analyticsPosts', label: 'Phân tích theo bài đăng', icon: <Video size={17} /> },
    ],
  },
]

const adminSections: NavSection[] = [
  {
    title: 'TỔNG QUAN HỆ THỐNG',
    items: [
      { key: 'dashboard', label: 'Tổng quan', icon: <LayoutDashboard size={17} /> },
      { key: 'openaiUsage', label: 'OpenAI Usage', icon: <BarChart3 size={17} /> },
    ],
  },
  {
    title: 'QUẢN LÝ HỆ THỐNG',
    items: [
      { key: 'settings', label: 'Cấu hình chiến lược', icon: <Settings size={17} /> },
      { key: 'users', label: 'Quản lý thành viên', icon: <UserRound size={17} /> },
    ],
  },
]

export default function Sidebar({
  activeTab,
  onTabChange,
  isSystemUser = false,
  currentUser,
  onLogout,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false)
  const [aiUsage, setAiUsage] = useState<AiUsageData | null>(null)
  const [showUsageModal, setShowUsageModal] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)

  const isCollapsed = collapsed !== undefined ? collapsed : internalCollapsed
  const handleToggle = () => {
    const next = !isCollapsed
    setInternalCollapsed(next)
    onToggleCollapse?.(next)
  }

  const sections = isSystemUser ? adminSections : creatorSections
  const allItems = sections.flatMap((section) => section.items)
  const mobileItems = allItems.slice(0, 6)
  const displayName = userDisplayName(currentUser)
  const roleLabel = userRoleLabel(currentUser)

  useEffect(() => {
    const loadUsage = async () => {
      try {
        const data = await getMyAiUsageApi()
        setAiUsage(data)
      } catch {
        setAiUsage(null)
      }
    }
    void loadUsage()
    const interval = setInterval(() => void loadUsage(), 30000)
    return () => clearInterval(interval)
  }, [])

  const formatTokens = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  return (
    <>
      <aside className={cn(
        'sticky left-0 top-0 z-50 hidden h-screen shrink-0 flex-col border-r border-[var(--outline-variant)] bg-white py-5 transition-all duration-300 md:flex',
        isCollapsed ? 'w-[68px] px-2' : 'w-[var(--app-sidebar-width)] px-4'
      )}>
        <div className="flex items-center justify-between">
          <BrandMark compact={isCollapsed} />
          <button
            type="button"
            onClick={handleToggle}
            className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--outline-variant)] text-[#64748b] hover:bg-[#f4f6ff] transition-colors cursor-pointer"
            title={isCollapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
          >
            {isCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        <nav className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="divide-y divide-[#f1f5f9] border-y border-[#f1f5f9]">
            {allItems.map((item) => (
              <NavButton
                key={item.key}
                item={item}
                active={activeTab === item.key}
                onClick={() => onTabChange(item.key)}
                isCollapsed={isCollapsed}
              />
            ))}
          </div>
        </nav>

        <div className="space-y-3 pt-3 border-t border-[var(--outline-variant)]">
          {!isCollapsed ? (
            <div className="relative rounded-[10px] border border-[var(--outline-variant)] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-3 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[13px] font-extrabold text-[#111827]">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-[#eef4ff] text-[#2556ea]">
                    <Coins size={15} />
                  </span>
                  Token AI
                </div>
                <button
                  type="button"
                  onClick={() => setShowUsageModal(!showUsageModal)}
                  className="inline-flex items-center gap-1 rounded-[6px] bg-[#eef4ff] px-2 py-0.5 text-[10px] font-extrabold text-[#2556ea] transition hover:bg-[#e0eafe]"
                  title="Xem hạch toán Token AI & Chi phí"
                >
                  <Cpu size={12} />
                  {aiUsage ? `${formatTokens(aiUsage.total_tokens)} Token` : 'Chi tiết'}
                </button>
              </div>

              <div className="mt-2 text-[12px] font-medium text-[#64748b]">
                Dùng: <span className="font-extrabold text-[#111827]">{aiUsage ? formatTokens(aiUsage.total_tokens) : '72'} / 200K Token</span>
              </div>

              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e9edf5]">
                <div
                  className="h-full rounded-full bg-[linear-gradient(135deg,#6d5dfc,#2556ea)]"
                  style={{ width: `${aiUsage ? Math.min(100, Math.max(5, (aiUsage.total_tokens / 200000) * 100)) : 36}%` }}
                />
              </div>

              {showUsageModal && aiUsage && (
                <div className="app-card absolute bottom-full left-0 mb-2 w-full p-3.5 shadow-xl border border-[#dfe4f3] bg-white z-50 rounded-[10px]">
                  <div className="flex items-center justify-between border-b border-[#e5e7eb] pb-2">
                    <div className="flex items-center gap-1.5 text-[12px] font-extrabold text-[#111827]">
                      <Coins size={14} className="text-amber-500" />
                      Thống kê Token AI
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowUsageModal(false)}
                      className="grid h-6 w-6 place-items-center rounded-md text-[#64748b] hover:bg-[#f4f6ff]"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11px]">
                    <UsageBox label="Input" value={aiUsage.total_input_tokens.toLocaleString()} />
                    <UsageBox label="Output" value={aiUsage.total_output_tokens.toLocaleString()} />
                    <UsageBox label="Lượt chạy" value={`${aiUsage.prompt_runs_count}`} />
                    <UsageBox label="Chi phí" value={`$${aiUsage.total_cost_usd}`} />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="relative flex justify-center">
              <button
                type="button"
                onClick={() => setShowUsageModal(!showUsageModal)}
                className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--outline-variant)] bg-[#eef4ff] text-[#2556ea] hover:scale-105 transition-transform"
                title={`Token AI - ${aiUsage ? formatTokens(aiUsage.total_tokens) : '72'}/200K Token`}
              >
                <Coins size={17} />
              </button>
              {showUsageModal && aiUsage && (
                <div className="app-card absolute bottom-full left-12 mb-2 w-60 p-3.5 shadow-xl border border-[#dfe4f3] bg-white z-50 rounded-[10px]">
                  <div className="flex items-center justify-between border-b border-[#e5e7eb] pb-2">
                    <div className="flex items-center gap-1.5 text-[12px] font-extrabold text-[#111827]">
                      <Coins size={14} className="text-amber-500" />
                      Thống kê Token AI
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowUsageModal(false)}
                      className="grid h-6 w-6 place-items-center rounded-md text-[#64748b] hover:bg-[#f4f6ff]"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11px]">
                    <UsageBox label="Input" value={aiUsage.total_input_tokens.toLocaleString()} />
                    <UsageBox label="Output" value={aiUsage.total_output_tokens.toLocaleString()} />
                    <UsageBox label="Lượt chạy" value={`${aiUsage.prompt_runs_count}`} />
                    <UsageBox label="Chi phí" value={`$${aiUsage.total_cost_usd}`} />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="relative">
            {!isCollapsed ? (
              <button
                type="button"
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex w-full items-center gap-2.5 rounded-[10px] border border-[var(--outline-variant)] bg-[#f8fafc] p-2.5 shadow-xs text-left hover:bg-[#f1f5f9] transition-colors cursor-pointer"
              >
                <UserAvatar src={null} name={displayName} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-extrabold text-[#111827]">{displayName}</div>
                  <div className="truncate text-[11px] font-medium text-[#64748b]">{roleLabel}</div>
                </div>
                <ChevronDown size={15} className={cn("text-[#64748b] transition-transform duration-200", showUserMenu && "rotate-180")} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex w-full justify-center rounded-[10px] border border-[var(--outline-variant)] bg-[#f8fafc] p-2 shadow-xs hover:bg-[#f1f5f9] transition-colors cursor-pointer"
                title={displayName}
              >
                <UserAvatar src={null} name={displayName} size="md" />
              </button>
            )}

            {showUserMenu && (
              <div className={cn(
                "app-card absolute bottom-full mb-2 overflow-hidden p-1.5 shadow-xl border border-[#dfe4f3] bg-white z-50 rounded-[10px]",
                isCollapsed ? "left-12 w-48" : "left-0 w-full"
              )}>
                <button
                  type="button"
                  onClick={() => {
                    setShowUserMenu(false)
                    onTabChange('settings')
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[6px] px-3 py-2 text-[12px] font-bold text-[#1e293b] hover:bg-[#f1f5f9] transition-colors"
                >
                  <UserRound size={15} className="text-[#4f46e5]" />
                  Xem profile
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowUserMenu(false)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[6px] px-3 py-2 text-[12px] font-bold text-[#1e293b] hover:bg-[#f1f5f9] transition-colors"
                >
                  <CircleHelp size={15} className="text-[#64748b]" />
                  Trợ giúp
                </button>
                {onLogout && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowUserMenu(false)
                      onLogout()
                    }}
                    className="flex w-full items-center gap-2.5 rounded-[6px] px-3 py-2 text-[12px] font-bold text-rose-600 hover:bg-rose-50 transition-colors"
                  >
                    <LogOut size={15} />
                    Đăng xuất
                  </button>
                )}
              </div>
            )}
          </div>
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

function NavButton({
  item,
  active,
  onClick,
  isCollapsed = false,
}: {
  item: NavItem
  active: boolean
  onClick: () => void
  isCollapsed?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={isCollapsed ? item.label : undefined}
      className={cn(
        'group relative flex h-[38px] w-full items-center transition-colors cursor-pointer select-none overflow-hidden',
        isCollapsed ? 'justify-center px-0' : 'justify-between px-2.5',
        active
          ? 'bg-[#eff4ff] text-[#2556ea] font-extrabold'
          : 'text-[#475569] font-medium hover:bg-[#f8fafc] hover:text-[#0f172a]'
      )}
    >
      {active && !isCollapsed && (
        <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#2556ea]" />
      )}
      <span className={cn('flex items-center gap-2.5', isCollapsed && 'justify-center')}>
        <span
          className={cn(
            'transition-colors duration-150',
            active ? 'text-[#2556ea]' : 'text-[#64748b] group-hover:text-[#2556ea]'
          )}
        >
          {item.icon}
        </span>
        {!isCollapsed && <span className="truncate text-[13px]">{item.label}</span>}
      </span>
      {!isCollapsed && item.badge !== undefined && (
        <span
          className={cn(
            'grid h-5 min-w-[20px] place-items-center rounded-full px-1.5 text-[10px] font-extrabold transition-colors',
            active ? 'bg-[#2556ea] text-white' : 'bg-[#f1f5f9] text-[#64748b] group-hover:bg-[#e2e8f0]'
          )}
        >
          {item.badge}
        </span>
      )}
      {isCollapsed && item.badge !== undefined && (
        <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-[#2556ea] ring-2 ring-white" />
      )}
    </button>
  )
}

function UsageBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-[var(--outline-variant)] bg-[#fbfcff] p-2">
      <div className="text-[10px] font-bold uppercase text-[#718096]">{label}</div>
      <div className="mt-0.5 truncate text-[12px] font-extrabold text-[#111827]">{value}</div>
    </div>
  )
}
