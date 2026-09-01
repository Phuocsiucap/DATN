import type { ReactNode } from 'react'
import { CheckCircle2, Loader2, UsersRound } from 'lucide-react'
import { cn } from '@/commons/lib/utils'
import { SocialProfileAvatar, platformLabel } from './social-ui'

export type SocialProfileFilterOption = {
  id: string
  profile_name: string
  platform: string
  username?: string | null
  avatar_url?: string | null
  status?: string | null
}

type SocialProfileFilterProps = {
  profiles: readonly SocialProfileFilterOption[]
  value: string
  onChange: (profileId: string) => void
  /** Only enable when the page can query multiple profiles. */
  allOption?: boolean
  loading?: boolean
  disabled?: boolean
  className?: string
  emptyLabel?: string
}

const isConnected = (profile: SocialProfileFilterOption) => profile.status?.trim().toLowerCase() === 'active'

function connectionStatus(profile: SocialProfileFilterOption) {
  const status = profile.status?.trim().toLowerCase()
  if (isConnected(profile)) return { label: 'Đã kết nối', tone: 'text-emerald-700', dot: 'bg-emerald-500' }
  if (status === 'expired' || status === 'token_expired') return { label: 'Hết hạn kết nối', tone: 'text-amber-700', dot: 'bg-amber-500' }
  if (status === 'error' || status === 'failed') return { label: 'Lỗi kết nối', tone: 'text-red-700', dot: 'bg-red-500' }
  return { label: status === 'inactive' || status === 'disconnected' ? 'Chưa kết nối' : profile.status || 'Chưa rõ trạng thái', tone: 'text-slate-500', dot: 'bg-slate-400' }
}

/** Controlled channel picker; data fetching and filter semantics stay in each page. */
export function SocialProfileFilter({
  profiles, value, onChange, allOption = false, loading = false, disabled = false,
  className, emptyLabel = 'Chưa có kênh social để lọc.',
}: SocialProfileFilterProps) {
  if (profiles.length === 0) return (
    <div role="status" className={cn('flex shrink-0 items-center gap-2 rounded-xl border border-dashed border-[var(--outline-variant)] px-3 py-2.5 text-xs text-[var(--on-surface-variant)]', className)}>
      {loading && <Loader2 size={14} className="animate-spin" />}
      {loading ? 'Đang tải kênh social...' : emptyLabel}
    </div>
  )

  const activeCount = profiles.filter(isConnected).length
  return (
    <div role="group" aria-label="Lọc theo kênh social" aria-busy={loading} className={cn('flex min-w-0 shrink-0 gap-2 overflow-x-auto py-1', className)}>
      {allOption && <ChannelCard
        active={value === 'all'} disabled={disabled || loading} onClick={() => onChange('all')}
        title="Tất cả kênh social" subtitle={`${profiles.length} kênh`}
        avatar={<span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-200 bg-slate-50 text-slate-600"><UsersRound size={18} /></span>}
        status={{ label: `${activeCount}/${profiles.length} đang hoạt động`, tone: activeCount ? 'text-emerald-700' : 'text-slate-500', dot: activeCount ? 'bg-emerald-500' : 'bg-slate-400' }}
      />}
      {profiles.map(profile => <ChannelCard
        key={profile.id} active={value === profile.id} disabled={disabled || loading} onClick={() => onChange(profile.id)}
        title={profile.profile_name}
        subtitle={profile.username ? `@${profile.username.replace(/^@/, '')}` : platformLabel(profile.platform)}
        avatar={<SocialProfileAvatar key={profile.avatar_url || profile.id} avatarUrl={profile.avatar_url} name={profile.profile_name} platform={profile.platform} size="md" />}
        status={connectionStatus(profile)}
      />)}
    </div>
  )
}

function ChannelCard({ active, disabled, onClick, title, subtitle, avatar, status }: {
  active: boolean; disabled: boolean; onClick: () => void; title: string; subtitle: string; avatar: ReactNode
  status: { label: string; tone: string; dot: string }
}) {
  return (
    <button type="button" aria-pressed={active} disabled={disabled} onClick={onClick}
      className={cn('relative flex min-h-[68px] w-[210px] shrink-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-left shadow-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60',
        active ? 'border-blue-500 bg-blue-50/70 ring-1 ring-blue-500' : 'border-[var(--outline-variant)] bg-white hover:border-blue-300 hover:bg-slate-50')}
    >
      {avatar}
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-xs font-bold text-[var(--on-surface)]', active && 'pr-3')} title={title}>{title}</span>
        <span className="block truncate text-[11px] text-[var(--on-surface-variant)]" title={subtitle}>{subtitle}</span>
        <span className={cn('mt-0.5 flex items-center gap-1.5 text-[11px] font-medium', status.tone)}>
          <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', status.dot)} />
          <span className="truncate">{status.label}</span>
        </span>
      </span>
      {active && <CheckCircle2 aria-hidden="true" size={14} className="absolute right-2 top-2 text-blue-600" />}
    </button>
  )
}
