import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import {
  BarChart3,
  Bell,
  CalendarDays,
  ChevronDown,
  Clapperboard,
  ExternalLink,
  Eye,
  HelpCircle,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { cn } from '@/commons/lib/utils'

export const appUser = {
  name: 'User',
  fullName: 'User',
  role: 'Member',
  team: '',
  avatar: null,
}

export type ApiUser = {
  id: string | number
  email: string
  full_name?: string | null
  roles?: string[]
  is_system_admin?: boolean
}

export function userDisplayName(user?: ApiUser | null) {
  const fullName = user?.full_name?.trim()
  if (fullName) return fullName
  return user?.email?.trim() || appUser.fullName
}

export function userRoleLabel(user?: ApiUser | null) {
  if (!user) return appUser.role
  if (user.is_system_admin) return 'Owner'
  const roles = user.roles?.map((role) => role.trim().toUpperCase()).filter(Boolean) || []
  if (roles.some((role) => ['SYSTEM', 'SYSTEM_ADMIN', 'ADMIN'].includes(role))) return 'Owner'
  if (roles.includes('CREATOR')) return 'Creator'
  if (roles.includes('USER')) return 'User'
  return roles[0] || 'Member'
}

export const demoImages: string[] = []

export type PlatformName = 'facebook' | 'instagram' | 'tiktok' | 'youtube' | 'linkedin' | 'vnexpress' | 'web' | string

export function platformKey(value?: string | null) {
  return String(value || 'web').toLowerCase()
}

export function platformLabel(value?: string | null) {
  const key = platformKey(value)
  const labels: Record<string, string> = {
    facebook: 'Facebook',
    instagram: 'Instagram',
    tiktok: 'TikTok',
    youtube: 'YouTube',
    linkedin: 'LinkedIn',
    vnexpress: 'VnExpress',
    bilibili: 'Bilibili',
    web: 'Web',
  }
  return labels[key] || value || 'Social'
}

export function PlatformIcon({
  platform,
  size = 'md',
  className,
}: {
  platform?: PlatformName | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const key = platformKey(platform)
  const sizes = {
    sm: 'h-4 w-4 text-[9px]',
    md: 'h-6 w-6 text-[11px]',
    lg: 'h-8 w-8 text-xs',
  }
  const base = cn('inline-flex shrink-0 items-center justify-center rounded-full font-black text-white shadow-sm', sizes[size], className)
  if (key === 'facebook') return <span className={cn(base, 'bg-[#1877f2]')}>f</span>
  if (key === 'instagram') return <span className={cn(base, 'bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#515bd4]')}>◎</span>
  if (key === 'youtube') return <span className={cn(base, 'bg-[#ff0000]')}>▶</span>
  if (key === 'linkedin') return <span className={cn(base, 'bg-[#0a66c2]')}>in</span>
  if (key === 'tiktok') return <span className={cn(base, 'bg-[#050505]')}>♪</span>
  if (key === 'vnexpress') return <span className={cn(base, 'rounded-[4px] bg-[#b00032]')}>E</span>
  return <span className={cn(base, 'bg-[#5b5cf6]')}>S</span>
}

export function SocialProfileAvatar({
  avatarUrl,
  name,
  platform,
  size = 'md',
  className,
  showPlatformBadge = true,
}: {
  avatarUrl?: string | null
  name?: string | null
  platform?: string | null
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  showPlatformBadge?: boolean
}) {
  const [imgError, setImgError] = useState(false)
  const sizes = {
    sm: { box: 'h-7 w-7 text-[10px]', badgeSize: 'sm' as const, badgePos: '-bottom-0.5 -right-0.5' },
    md: { box: 'h-9 w-9 text-xs', badgeSize: 'sm' as const, badgePos: '-bottom-0.5 -right-0.5' },
    lg: { box: 'h-11 w-11 text-sm', badgeSize: 'md' as const, badgePos: '-bottom-0.5 -right-0.5' },
    xl: { box: 'h-14 w-14 text-base', badgeSize: 'md' as const, badgePos: '-bottom-0.5 -right-0.5' },
  }
  const current = sizes[size] || sizes.md
  const initials = (name || 'Social')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'S'

  const hasAvatar = Boolean(avatarUrl && !imgError)

  return (
    <div className={cn('relative inline-flex shrink-0 items-center justify-center', className)}>
      <div className={cn('overflow-hidden rounded-full border border-[var(--outline-variant)] bg-slate-100 shadow-xs', current.box)}>
        {hasAvatar ? (
          <img
            src={avatarUrl!}
            alt={name || 'Avatar'}
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-black text-slate-600 bg-slate-200">
            {initials}
          </div>
        )}
      </div>
      {showPlatformBadge && (
        <span className={cn('absolute z-10', current.badgePos)}>
          <PlatformIcon platform={platform} size={current.badgeSize} className="ring-2 ring-white shadow-xs" />
        </span>
      )}
    </div>
  )
}


export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid h-8 w-8 place-items-center rounded-[8px] bg-[linear-gradient(135deg,#6d5dfc,#2556ea)] text-white shadow-[0_8px_22px_rgba(79,70,229,0.24)]">
        <ShieldCheck size={18} fill="currentColor" strokeWidth={1.8} />
      </div>
      {!compact && <div className="text-[18px] font-extrabold leading-none text-[#111827]">Social<span className="text-[#2556ea]">Hub</span></div>}
    </div>
  )
}

export function AppCard({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('app-card', className)}>{children}</div>
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string
  description?: string
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between', className)}>
      <div className="min-w-0">
        <h1 className="app-title">{title}</h1>
        {description && <p className="mt-1 text-[13px] font-medium text-[var(--on-surface-variant)]">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function PageLayout({
  title,
  description,
  actions,
  header,
  children,
  className,
  contentClassName,
}: {
  title?: string
  description?: string
  actions?: ReactNode
  header?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <div className={cn('app-page flex-1 min-h-0 h-full flex flex-col gap-4', className)}>
      {header ? (
        header
      ) : title ? (
        <PageHeader title={title} description={description} actions={actions} />
      ) : null}
      <div className={cn('flex-1 min-h-0 w-full flex flex-col gap-4', contentClassName)}>
        {children}
      </div>
    </div>
  )
}

export const Layout = PageLayout

export function SearchField({
  value,
  onChange,
  placeholder = 'Tìm kiếm (Ctrl + K)',
  className,
}: {
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <label className={cn('relative block', className)}>
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#718096]" />
      <input
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-[8px] border border-[var(--outline-variant)] bg-white pl-9 pr-3 text-[13px] font-medium text-[#172033] outline-none transition focus:border-[#6d5dfc] focus:ring-2 focus:ring-[#6d5dfc]/15"
      />
    </label>
  )
}

export function SelectControl({
  value,
  onChange,
  children,
  className,
  icon,
}: {
  value?: string
  onChange?: (value: string) => void
  children: ReactNode
  className?: string
  icon?: ReactNode
}) {
  return (
    <label className={cn('relative block', className)}>
      {icon && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#718096]">{icon}</span>}
      <select
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        className={cn('h-10 w-full appearance-none rounded-[8px] border border-[var(--outline-variant)] bg-white pr-8 text-[13px] font-semibold text-[#172033] outline-none transition focus:border-[#6d5dfc] focus:ring-2 focus:ring-[#6d5dfc]/15', icon ? 'pl-9' : 'pl-3')}
      >
        {children}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#718096]" />
    </label>
  )
}

export function DateInput({
  value,
  onChange,
  label,
  placeholder,
  className,
  min,
  max,
  disabled,
}: {
  value?: string
  onChange?: (value: string) => void
  label?: string
  placeholder?: string
  className?: string
  min?: string
  max?: string
  disabled?: boolean
}) {
  return (
    <label
      className={cn(
        'relative flex h-10 min-w-[160px] items-center gap-2 rounded-[8px] border border-[var(--outline-variant)] bg-white px-3 transition focus-within:border-[#6d5dfc] focus-within:ring-2 focus-within:ring-[#6d5dfc]/15 hover:border-[#b8c2d4]',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <CalendarDays size={15} className="pointer-events-none shrink-0 text-[#718096]" />
      {label && <span className="shrink-0 text-xs font-bold text-[#64748b]">{label}</span>}
      <input
        type="date"
        value={value || ''}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        className="h-full min-w-0 flex-1 cursor-pointer bg-transparent p-0 text-[13px] font-semibold text-[#172033] outline-none"
      />
    </label>
  )
}

export function AppButton({
  children,
  variant = 'primary',
  icon,
  className,
  disabled,
  onClick,
  title,
}: {
  children?: ReactNode
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  icon?: ReactNode
  className?: string
  disabled?: boolean
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>['onClick']
  title?: string
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-10 items-center justify-center gap-2 rounded-[8px] px-4 text-[13px] font-bold transition disabled:pointer-events-none disabled:opacity-50',
        variant === 'primary' && 'bg-[linear-gradient(135deg,#6d5dfc,#2556ea)] text-white shadow-[0_8px_18px_rgba(37,86,234,0.18)] hover:brightness-105',
        variant === 'secondary' && 'border border-[var(--outline-variant)] bg-white text-[#172033] hover:border-[#b9c3d5] hover:bg-[#f8faff]',
        variant === 'danger' && 'border border-[#ffb9bd] bg-white text-[#ef233c] hover:bg-[#fff4f5]',
        variant === 'ghost' && 'text-[#526179] hover:bg-[#f4f6ff]',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export function IconButton({
  children,
  className,
  active,
  badge,
  onClick,
  title,
}: {
  children: ReactNode
  className?: string
  active?: boolean
  badge?: string | number
  onClick?: () => void
  title?: string
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn('relative grid h-9 w-9 place-items-center rounded-[8px] border border-transparent text-[#34415a] transition hover:border-[var(--outline-variant)] hover:bg-white', active && 'border-[#c8d0ff] bg-[#f1f0ff] text-[#4f46e5]', className)}
    >
      {children}
      {badge !== undefined && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#ef233c] px-1 text-[10px] font-extrabold text-white">{badge}</span>}
    </button>
  )
}

export function TabStrip<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: Array<{ value: T; label: string; count?: number | string }>
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 items-center gap-6 overflow-x-auto border-b border-[var(--outline-variant)]', className)}>
      {tabs.map((tab) => {
        const active = value === tab.value
        return (
          <button
            key={tab.value}
            onClick={() => onChange(tab.value)}
            className={cn('relative h-12 whitespace-nowrap text-[13px] font-bold text-[#718096] transition hover:text-[#2556ea]', active && 'text-[#2556ea]')}
          >
            {tab.label}
            {tab.count !== undefined && <span className={cn('ml-1.5 rounded-full bg-[#eef1f7] px-2 py-0.5 text-[11px] text-[#718096]', active && 'bg-[#2556ea] text-white')}>{tab.count}</span>}
            {active && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-[#2556ea]" />}
          </button>
        )
      })}
    </div>
  )
}

export function FilterChip({
  active,
  label,
  count,
  icon,
  onClick,
}: {
  active?: boolean
  label: string
  count?: number | string
  icon?: ReactNode
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn('inline-flex h-10 shrink-0 items-center gap-2 rounded-[8px] border px-4 text-[13px] font-bold transition', active ? 'border-[#7c6cff] bg-[#f2f0ff] text-[#4f46e5] shadow-[0_0_0_2px_rgba(109,93,252,0.08)]' : 'border-[var(--outline-variant)] bg-white text-[#526179] hover:border-[#b9c3d5]')}
    >
      {icon}
      {label}
      {count !== undefined && <span className={cn('rounded-full px-1.5 py-0.5 text-[11px]', active ? 'bg-white text-[#4f46e5]' : 'bg-[#eef1f7] text-[#718096]')}>{count}</span>}
    </button>
  )
}

export function MetricCard({
  label,
  value,
  trend,
  icon,
  tint = '#6d5dfc',
}: {
  label: string
  value: ReactNode
  trend?: ReactNode
  icon?: ReactNode
  tint?: string
}) {
  return (
    <AppCard className="flex min-h-[78px] items-center gap-3 p-4">
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[8px]" style={{ color: tint, background: `${tint}14` }}>
        {icon || <BarChart3 size={20} />}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[12px] font-semibold text-[#64748b]">{label}</div>
        <div className="mt-0.5 text-[24px] font-extrabold leading-none text-[#111827]">{value}</div>
        {trend && <div className="mt-1 text-[11px] font-bold text-[#16a34a]">{trend}</div>}
      </div>
    </AppCard>
  )
}

export function StatusPill({ value, tone }: { value: string; tone?: 'green' | 'blue' | 'amber' | 'red' | 'purple' | 'gray' }) {
  const normalized = value.toLowerCase()
  const picked = tone
    || (/(ready|hoàn|active|duyệt|approved|published|succeeded|connected)/i.test(value) ? 'green'
      : /(pending|chờ|queue|running|processing|đang)/i.test(value) ? 'amber'
      : /(failed|lỗi|từ chối|reject)/i.test(value) ? 'red'
      : /(ai|filled|draft)/i.test(value) ? 'purple'
      : 'gray')
  const classes: Record<string, string> = {
    green: 'bg-[#eaf8ef] text-[#16813b]',
    blue: 'bg-[#eef4ff] text-[#2556ea]',
    amber: 'bg-[#fff3d6] text-[#b76b00]',
    red: 'bg-[#fff0f1] text-[#ef233c]',
    purple: 'bg-[#f2f0ff] text-[#6d5dfc]',
    gray: 'bg-[#eef1f7] text-[#526179]',
  }
  return <span className={cn('inline-flex h-6 items-center rounded-[6px] px-2 text-[11px] font-extrabold uppercase', classes[picked], normalized === 'ready' && 'tracking-normal')}>{value}</span>
}

export function Thumbnail({
  src,
  title,
  className,
  duration,
}: {
  src?: string | null
  title?: string
  className?: string
  index?: number
  duration?: string
  fallback?: boolean
}) {
  const [imgError, setImgError] = useState(false)
  const imageSrc = !imgError && src ? src : ''

  return (
    <div className={cn('relative overflow-hidden rounded-[8px] bg-slate-900', className)}>
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={title || ''}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-slate-800 via-slate-900 to-indigo-950 p-3 text-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white/80 backdrop-blur-xs">
            <Clapperboard size={18} />
          </div>
          {title && (
            <span className="mt-2 line-clamp-1 text-[10px] font-extrabold text-slate-300 px-2">
              {title}
            </span>
          )}
        </div>
      )}
      {duration && <span className="absolute bottom-1.5 right-1.5 rounded-[5px] bg-black/80 px-1.5 py-0.5 text-[10px] font-bold text-white">{duration}</span>}
    </div>
  )
}

export function UserAvatar({ src = appUser.avatar, name = appUser.name, size = 'md' }: { src?: string | null; name?: string; size?: 'sm' | 'md' | 'lg' }) {
  const classes = { sm: 'h-7 w-7', md: 'h-9 w-9', lg: 'h-11 w-11' }
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
    || 'U'
  return (
    <div className={cn('overflow-hidden rounded-full border border-[var(--outline-variant)] bg-[#eef1f7]', classes[size])}>
      {src ? <img src={src} alt={name} className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center text-xs font-bold text-[#526179]">{initials}</div>}
    </div>
  )
}

export function MiniActionRow() {
  return (
    <div className="flex items-center gap-1">
      <IconButton title="Xem"><Eye size={15} /></IconButton>
      <IconButton title="Mở"><ExternalLink size={15} /></IconButton>
      <IconButton title="Thêm"><Plus size={15} /></IconButton>
      <IconButton title="Khác"><MoreHorizontal size={15} /></IconButton>
    </div>
  )
}

export function TopBarIconGroup() {
  return (
    <div className="flex items-center gap-2">
      <IconButton badge={3} title="Thông báo"><Bell size={18} /></IconButton>
      <IconButton title="Trợ giúp"><HelpCircle size={18} /></IconButton>
      <span className="mx-1 h-7 w-px bg-[var(--outline-variant)]" />
    </div>
  )
}

export function LoadingBlock({ label = 'Đang tải dữ liệu...' }: { label?: string }) {
  return (
    <div className="flex min-h-[220px] items-center justify-center gap-2 rounded-[8px] border border-[var(--outline-variant)] bg-white text-[13px] font-semibold text-[#64748b]">
      <Loader2 size={18} className="animate-spin text-[#6d5dfc]" />
      {label}
    </div>
  )
}

export function EmptyBlock({ label }: { label: string }) {
  return (
    <div className="grid min-h-[180px] place-items-center rounded-[8px] border border-dashed border-[var(--outline-variant)] bg-white px-6 text-center text-[13px] font-semibold text-[#718096]">
      {label}
    </div>
  )
}

export function connectedStatus(status?: string | null) {
  return String(status || '').toLowerCase() === 'active' ? 'Đã kết nối' : (status || 'Đang hoạt động')
}
