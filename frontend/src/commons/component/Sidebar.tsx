import { useEffect, useState, type ReactNode } from 'react'
import {
  BarChart3,
  BrainCircuit,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  Clapperboard,
  Coins,
  Cpu,
  Database,
  FileCheck2,
  LayoutDashboard,
  ListChecks,
  LibraryBig,
  LogOut,
  Megaphone,
  MoreHorizontal,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  ShoppingBag,
  Sparkles,
  UserRound,
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
  recent_runs: unknown[]
}

const creatorSections: NavSection[] = [
  {
    title: 'TỔNG QUAN',
    items: [
      { key: 'dashboard', label: 'Không gian sáng tạo', icon: <LayoutDashboard size={17} /> },
    ],
  },
  {
    title: 'NỘI DUNG',
    items: [
      { key: 'crawl', label: 'Thu thập dữ liệu', icon: <Database size={17} /> },
      { key: 'content', label: 'Bài viết', icon: <Newspaper size={17} /> },
      { key: 'storyStatus', label: 'Trạng thái series', icon: <ListChecks size={17} /> },
      { key: 'planning', label: 'Kế hoạch nội dung', icon: <Sparkles size={17} /> },
    ],
  },
  {
    title: 'SẢN XUẤT',
    items: [
      { key: 'generateVideo', label: 'Xưởng video', icon: <Clapperboard size={17} /> },
      { key: 'tiktokStudio', label: 'TikTok Video AI', icon: <Sparkles size={17} /> },
      { key: 'approvals', label: 'Duyệt video', icon: <FileCheck2 size={17} /> },
    ],
  },
  {
    title: 'QUẢN LÝ & PHÂN TÍCH',
    items: [
      { key: 'settings', label: 'Social account', icon: <Megaphone size={17} /> },
      { key: 'schedule', label: 'Lịch đăng', icon: <CalendarDays size={17} /> },
      { key: 'publishedPosts', label: 'Bài đã đăng', icon: <Megaphone size={17} /> },
      { key: 'aiManagement', label: 'AI Management', icon: <BrainCircuit size={17} /> },
      { key: 'tiktokShop', label: 'TikTok Shop', icon: <ShoppingBag size={17} /> },
      { key: 'profile', label: 'Hồ sơ cá nhân', icon: <UserRound size={17} /> },
    ],
  },
]

const adminSections: NavSection[] = [
  {
    title: 'TỔNG QUAN HỆ THỐNG',
    items: [
      { key: 'dashboard', label: 'Vận hành hệ thống', icon: <LayoutDashboard size={17} /> },
      { key: 'openaiUsage', label: 'OpenAI Usage', icon: <BarChart3 size={17} /> },
      { key: 'deepseekUsage', label: 'DeepSeek Usage', icon: <BarChart3 size={17} /> },
    ],
  },
  {
    title: 'QUẢN LÝ HỆ THỐNG',
    items: [
      { key: 'crawl', label: 'Nguồn dữ liệu', icon: <Database size={17} /> },
      { key: 'contentItems', label: 'Kho nội dung', icon: <LibraryBig size={17} /> },
      { key: 'users', label: 'Quản lý thành viên', icon: <UserRound size={17} /> },
      { key: 'auditLogs', label: 'Nhật ký hệ thống', icon: <ScrollText size={17} /> },
      { key: 'profile', label: 'Hồ sơ cá nhân', icon: <UserRound size={17} /> },
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
  const [showMobileMenu, setShowMobileMenu] = useState(false)

  const isCollapsed = collapsed !== undefined ? collapsed : internalCollapsed
  const handleToggle = () => {
    const next = !isCollapsed
    setInternalCollapsed(next)
    onToggleCollapse?.(next)
  }

  const sections = isSystemUser ? adminSections : creatorSections
  const allItems = sections.flatMap((section) => section.items)
  const mobilePrimaryKeys: Tab[] = isSystemUser
    ? ['dashboard', 'crawl', 'contentItems', 'users', 'openaiUsage']
    : ['dashboard', 'crawl', 'content', 'planning', 'generateVideo']
  const mobileItems = mobilePrimaryKeys
    .map((key) => allItems.find((item) => item.key === key))
    .filter((item): item is NavItem => Boolean(item))
  const mobileMoreItems = allItems.filter((item) => !mobilePrimaryKeys.includes(item.key))
  const activeMobileMoreItem = mobileMoreItems.find((item) => item.key === activeTab)
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
        'sticky left-0 top-0 z-50 hidden h-screen shrink-0 flex-col border-r border-[var(--outline-variant)] bg-white pt-5 pb-0 transition-all duration-300 md:flex',
        isCollapsed ? 'w-[68px] px-2' : 'w-[var(--app-sidebar-width)] px-4'
      )}>
        <div className="flex items-center justify-between">
          <BrandMark compact={isCollapsed} />
          <button
            type="button"
            onClick={handleToggle}
            className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--outline-variant)] text-[var(--on-surface-variant)] hover:bg-[#f4f6ff] transition-colors cursor-pointer"
            title={isCollapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
          >
            {isCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        <nav className="mt-3 min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-0.5">
            {sections.map((section) => (
              <div key={section.title} className="mb-1">
                {!isCollapsed && (
                  <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--on-surface-variant)]">
                    {section.title}
                  </div>
                )}
                <div className="flex flex-col gap-0.5">
                  {section.items.map((item) => (
                    <NavButton
                      key={item.key}
                      item={item}
                      active={activeTab === item.key}
                      onClick={() => onTabChange(item.key)}
                      isCollapsed={isCollapsed}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </nav>

        <div className="space-y-3 pt-3 border-t border-[var(--outline-variant)]">
          {!isCollapsed ? (
            <div className="relative rounded-[10px] border border-[var(--outline-variant)] bg-white p-3 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-extrabold text-[#111827]">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--accent-light)] text-[var(--accent)]">
                    <Coins size={15} />
                  </span>
                  Mức sử dụng AI
                </div>
                <button
                  type="button"
                  onClick={() => setShowUsageModal(!showUsageModal)}
                  className="inline-flex items-center gap-1 rounded-[6px] bg-[var(--accent-light)] px-2 py-0.5 text-xs font-extrabold text-[var(--accent)] transition hover:bg-[var(--secondary-container)]"
                  title="Xem mức sử dụng AI và chi phí"
                >
                  <Cpu size={12} />
                  {aiUsage ? `${formatTokens(aiUsage.total_tokens)} Token` : 'Chi tiết'}
                </button>
              </div>

              <div className="mt-2 text-xs font-medium text-[var(--on-surface-variant)]">
                {aiUsage ? (
                  <>Tổng token: <span className="font-semibold text-[#111827]">{formatTokens(aiUsage.total_tokens)}</span></>
                ) : 'Đang tải số liệu sử dụng'}
              </div>

              {showUsageModal && aiUsage && (
                <div className="app-card absolute bottom-full left-0 mb-2 w-full p-3.5 shadow-xl border border-[#dfe4f3] bg-white z-50 rounded-[10px]">
                  <div className="flex items-center justify-between border-b border-[#e5e7eb] pb-2">
                    <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#111827]">
                      <Coins size={14} className="text-amber-500" />
                      Mức sử dụng AI
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowUsageModal(false)}
                      className="grid h-6 w-6 place-items-center rounded-md text-[var(--on-surface-variant)] hover:bg-[#f4f6ff]"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
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
                className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--outline-variant)] bg-[var(--accent-light)] text-[var(--accent)] hover:scale-105 transition-transform"
                title={aiUsage ? `Sử dụng ${formatTokens(aiUsage.total_tokens)} token` : 'Đang tải số liệu sử dụng AI'}
              >
                <Coins size={17} />
              </button>
              {showUsageModal && aiUsage && (
                <div className="app-card absolute bottom-full left-12 mb-2 w-60 p-3.5 shadow-xl border border-[#dfe4f3] bg-white z-50 rounded-[10px]">
                  <div className="flex items-center justify-between border-b border-[#e5e7eb] pb-2">
                    <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#111827]">
                      <Coins size={14} className="text-amber-500" />
                      Mức sử dụng AI
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowUsageModal(false)}
                      className="grid h-6 w-6 place-items-center rounded-md text-[var(--on-surface-variant)] hover:bg-[#f4f6ff]"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
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
                className="flex w-full items-center gap-2.5 rounded-[10px] border border-[var(--outline-variant)] bg-[#f8fafc] p-2.5 shadow-xs text-left hover:bg-[var(--surface-container)] transition-colors cursor-pointer"
              >
                <UserAvatar src={currentUser?.avatar_url ?? null} name={displayName} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-extrabold text-[#111827]">{displayName}</div>
                  <div className="truncate text-xs font-medium text-[var(--on-surface-variant)]">{roleLabel}</div>
                </div>
                <ChevronDown size={15} className={cn("text-[var(--on-surface-variant)] transition-transform duration-200", showUserMenu && "rotate-180")} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex w-full justify-center rounded-[10px] border border-[var(--outline-variant)] bg-[#f8fafc] p-2 shadow-xs hover:bg-[var(--surface-container)] transition-colors cursor-pointer"
                title={displayName}
              >
                <UserAvatar src={currentUser?.avatar_url ?? null} name={displayName} size="md" />
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
                    onTabChange('profile')
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[6px] px-3 py-2 text-xs font-bold text-[#1e293b] hover:bg-[var(--surface-container)] transition-colors"
                >
                  <UserRound size={15} className="text-[var(--accent)]" />
                  Xem profile
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowUserMenu(false)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[6px] px-3 py-2 text-xs font-bold text-[#1e293b] hover:bg-[var(--surface-container)] transition-colors"
                >
                  <CircleHelp size={15} className="text-[var(--on-surface-variant)]" />
                  Trợ giúp
                </button>
                {onLogout && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowUserMenu(false)
                      onLogout()
                    }}
                    className="flex w-full items-center gap-2.5 rounded-[6px] px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 transition-colors"
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

      <nav aria-label="Điều hướng chính" className="mobile-primary-nav fixed inset-x-0 bottom-0 z-50 flex items-stretch gap-1 border-t border-[var(--outline-variant)] bg-white px-2 py-1.5 md:hidden">
        {mobileItems.map((item) => (
          <button
            key={item.key}
            onClick={() => onTabChange(item.key)}
            aria-current={activeTab === item.key ? 'page' : undefined}
            className={cn('flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[8px] px-1 text-[11px] font-semibold transition-colors', activeTab === item.key ? 'bg-[var(--accent-light)] text-[var(--accent)]' : 'text-[var(--on-surface-variant)]')}
          >
            {item.icon}
            <span className="max-w-full truncate">{item.label}</span>
          </button>
        ))}
        <div className="relative min-w-0 flex-1">
          {showMobileMenu && (
            <div className="absolute right-0 bottom-full mb-2 max-h-[min(65vh,420px)] w-64 overflow-y-auto rounded-xl border border-[var(--outline-variant)] bg-white p-1.5 shadow-lg">
              <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--on-surface-variant)]">
                {isSystemUser ? 'Quản trị hệ thống' : 'Không gian sáng tạo'}
              </div>
              {sections.map((section) => (
                <div key={section.title}>
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--on-surface-variant)]">
                    {section.title}
                  </div>
                  {section.items.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setShowMobileMenu(false)
                        onTabChange(item.key)
                      }}
                      aria-current={activeTab === item.key ? 'page' : undefined}
                      className={cn(
                        'flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors',
                        activeTab === item.key ? 'bg-[var(--accent-light)] font-semibold text-[var(--accent)]' : 'text-[var(--on-surface)] hover:bg-[var(--surface-container-low)]'
                      )}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              ))}
              {onLogout && (
                <button
                  type="button"
                  onClick={() => {
                    setShowMobileMenu(false)
                    onLogout()
                  }}
                  className="mt-1 flex min-h-10 w-full items-center gap-3 rounded-lg border-t border-[var(--outline-variant)] px-3 pt-2 text-left text-sm text-rose-600"
                >
                  <LogOut size={17} />
                  Đăng xuất
                </button>
              )}
            </div>
          )}
          <button
            type="button"
            aria-expanded={showMobileMenu}
            aria-label={showMobileMenu ? 'Đóng menu điều hướng' : 'Mở tất cả mục điều hướng'}
            onClick={() => setShowMobileMenu((open) => !open)}
            className={cn('flex h-full w-full flex-col items-center justify-center gap-1 rounded-[8px] px-1 text-[11px] font-semibold transition-colors', activeMobileMoreItem || showMobileMenu ? 'bg-[var(--accent-light)] text-[var(--accent)]' : 'text-[var(--on-surface-variant)]')}
          >
            {activeMobileMoreItem ? activeMobileMoreItem.icon : <MoreHorizontal size={18} />}
            <span className="max-w-full truncate">{activeMobileMoreItem?.label ?? 'Thêm'}</span>
          </button>
        </div>
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
        'group relative m-0 flex h-[36px] w-full items-center rounded-lg transition-colors cursor-pointer select-none',
        isCollapsed ? 'justify-center px-0' : 'justify-between px-2.5',
        active
          ? 'bg-[var(--accent-light)] text-[var(--accent)] font-extrabold'
          : 'text-[var(--on-surface-variant)] font-medium hover:bg-[var(--surface-container-low)] hover:text-[var(--on-surface)]'
      )}
    >
      {active && !isCollapsed && (
        <span className="absolute left-1 top-1/2 -translate-y-1/2 h-3.5 w-[3px] rounded-full bg-[var(--accent)]" />
      )}
      <span className={cn('flex items-center gap-2.5', isCollapsed && 'justify-center')}>
        <span
          className={cn(
            'transition-colors duration-150',
            active ? 'text-[var(--accent)]' : 'text-[var(--on-surface-variant)] group-hover:text-[var(--accent)]'
          )}
        >
          {item.icon}
        </span>
        {!isCollapsed && <span className="truncate text-sm">{item.label}</span>}
      </span>
      {!isCollapsed && item.badge !== undefined && (
        <span
          className={cn(
            'grid h-5 min-w-[20px] place-items-center rounded-full px-1.5 text-xs font-extrabold transition-colors',
            active ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface-container)] text-[var(--on-surface-variant)] group-hover:bg-[var(--surface-variant)]'
          )}
        >
          {item.badge}
        </span>
      )}
      {isCollapsed && item.badge !== undefined && (
        <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-[var(--accent)] ring-2 ring-white" />
      )}
    </button>
  )
}

function UsageBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-[var(--outline-variant)] bg-[#fbfcff] p-2">
      <div className="text-xs font-bold uppercase text-[#718096]">{label}</div>
      <div className="mt-0.5 truncate text-xs font-extrabold text-[#111827]">{value}</div>
    </div>
  )
}
