import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { 
  X, 
  User as UserIcon, 
  Mail, 
  Calendar, 
  Activity, 
  DollarSign, 
  Zap,
  FileText,
  Share2,
  TrendingUp,
  Edit,
  Trash2,
  Power,
  PowerOff,
  Shield,
  Link2,
  Users,
  Heart,
  Video,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
} from 'lucide-react'
import { fetchUserDetailsApi, toggleUserActiveApi, deleteAdminUserApi, fetchUserSocialProfilesApi, type AdminUserSocialProfile } from '@/commons/apis/adminUsers'
import { AppButton, UserAvatar } from '@/commons/component/social-ui'
import { cn } from '@/commons/lib/utils'

type UserDetails = {
  user: {
    id: string
    email: string
    full_name: string | null
    avatar_url: string | null
    is_active: boolean
    is_system_admin: boolean
    created_at: string
    roles: string[]
  }
  statistics: {
    ai_usage: {
      total_input_tokens: number
      total_output_tokens: number
      total_tokens: number
      total_cost_usd: number
      prompt_runs_count: number
      breakdown_by_run_type: Array<{
        key: string
        runs: number
        input_tokens: number
        output_tokens: number
        total_tokens: number
        cost_usd: number
      }>
      breakdown_by_model: Array<{
        key: string
        runs: number
        input_tokens: number
        output_tokens: number
        total_tokens: number
        cost_usd: number
      }>
    }
    resources: {
      social_profiles_count: number
      crawl_jobs_count: number
    }
  }
}

type UserDetailsDialogProps = {
  userId: string
  isOpen: boolean
  onClose: () => void
  onEdit: (userId: string) => void
  onDataChanged: () => void
  currentUserId?: string
}

type ActiveTab = 'overview' | 'accounts'

const PLATFORM_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  tiktok: { bg: 'bg-black', text: 'text-white', border: 'border-black' },
  youtube: { bg: 'bg-red-600', text: 'text-white', border: 'border-red-600' },
  instagram: { bg: 'bg-gradient-to-br from-purple-500 to-pink-500', text: 'text-white', border: 'border-purple-500' },
  facebook: { bg: 'bg-blue-600', text: 'text-white', border: 'border-blue-600' },
}

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: 'TikTok',
  youtube: 'YouTube',
  instagram: 'Instagram',
  facebook: 'Facebook',
}

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  active:     { icon: CheckCircle2, color: 'text-emerald-600', label: 'Đã kết nối' },
  connected:  { icon: CheckCircle2, color: 'text-emerald-600', label: 'Đã kết nối' },
  expired:    { icon: AlertCircle,  color: 'text-orange-500',  label: 'Token hết hạn' },
  pending:    { icon: Clock,        color: 'text-amber-500',   label: 'Chờ kết nối' },
  error:      { icon: AlertCircle,  color: 'text-red-500',     label: 'Lỗi kết nối' },
}

function formatMetric(value: number | null | undefined) {
  if (value === null || value === undefined) return '—'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toLocaleString('vi-VN')
}

function PlatformBadge({ platform }: { platform: string }) {
  const cfg = PLATFORM_COLORS[platform.toLowerCase()] ?? { bg: 'bg-slate-600', text: 'text-white', border: 'border-slate-600' }
  const label = PLATFORM_LABELS[platform.toLowerCase()] ?? platform
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide', cfg.bg, cfg.text)}>
      {label}
    </span>
  )
}

function SocialProfileCard({ profile }: { profile: AdminUserSocialProfile }) {
  const status = profile.status?.toLowerCase() ?? 'unknown'
  const statusCfg = STATUS_CONFIG[status] ?? { icon: AlertCircle, color: 'text-slate-400', label: profile.status }
  const StatusIcon = statusCfg.icon

  return (
    <div className="group relative rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-slate-300 hover:shadow-md">
      <div className="flex items-start gap-3">
        {/* Avatar / Initials */}
        <div className="relative shrink-0">
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={profile.profile_name}
              className="h-12 w-12 rounded-full object-cover ring-2 ring-slate-100"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-slate-100 to-slate-200 text-lg font-bold text-slate-600 ring-2 ring-slate-100">
              {profile.profile_name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="absolute -bottom-1 -right-1 rounded-full bg-white p-0.5 ring-1 ring-slate-200">
            <StatusIcon size={12} className={statusCfg.color} />
          </div>
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-slate-900 truncate">{profile.profile_name}</span>
            <PlatformBadge platform={profile.platform} />
          </div>
          {profile.username && (
            <p className="mt-0.5 text-xs text-slate-500 font-medium">@{profile.username}</p>
          )}
          <p className={cn('mt-0.5 text-xs font-semibold', statusCfg.color)}>{statusCfg.label}</p>
        </div>
      </div>

      {/* Metrics */}
      <div className="mt-3 grid grid-cols-4 gap-2 border-t border-slate-100 pt-3">
        <div className="text-center">
          <div className="flex items-center justify-center gap-0.5 text-slate-400">
            <Users size={11} />
          </div>
          <p className="mt-0.5 text-sm font-bold text-slate-800">{formatMetric(profile.follower_count)}</p>
          <p className="text-[10px] text-slate-400 font-medium">Theo dõi</p>
        </div>
        <div className="text-center">
          <div className="flex items-center justify-center gap-0.5 text-slate-400">
            <Share2 size={11} />
          </div>
          <p className="mt-0.5 text-sm font-bold text-slate-800">{formatMetric(profile.following_count)}</p>
          <p className="text-[10px] text-slate-400 font-medium">Đang theo</p>
        </div>
        <div className="text-center">
          <div className="flex items-center justify-center gap-0.5 text-slate-400">
            <Heart size={11} />
          </div>
          <p className="mt-0.5 text-sm font-bold text-slate-800">{formatMetric(profile.likes_count)}</p>
          <p className="text-[10px] text-slate-400 font-medium">Lượt thích</p>
        </div>
        <div className="text-center">
          <div className="flex items-center justify-center gap-0.5 text-slate-400">
            <Video size={11} />
          </div>
          <p className="mt-0.5 text-sm font-bold text-slate-800">{formatMetric(profile.video_count)}</p>
          <p className="text-[10px] text-slate-400 font-medium">Video</p>
        </div>
      </div>

      {/* Created date */}
      <p className="mt-2 text-[11px] text-slate-400">
        Liên kết: {profile.created_at ? new Date(profile.created_at).toLocaleDateString('vi-VN') : '—'}
      </p>
    </div>
  )
}

export default function UserDetailsDialog({
  userId,
  isOpen,
  onClose,
  onEdit,
  onDataChanged,
  currentUserId,
}: UserDetailsDialogProps) {
  const [details, setDetails] = useState<UserDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview')
  const [socialProfiles, setSocialProfiles] = useState<AdminUserSocialProfile[]>([])
  const [socialLoading, setSocialLoading] = useState(false)

  useEffect(() => {
    if (isOpen && userId) {
      setActiveTab('overview')
      loadUserDetails()
    }
  }, [isOpen, userId])

  useEffect(() => {
    if (activeTab === 'accounts' && userId && isOpen) {
      loadSocialProfiles()
    }
  }, [activeTab, userId, isOpen])

  const loadUserDetails = async () => {
    setLoading(true)
    try {
      const data = await fetchUserDetailsApi(userId)
      setDetails(data)
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể tải thông tin người dùng')
    } finally {
      setLoading(false)
    }
  }

  const loadSocialProfiles = async () => {
    setSocialLoading(true)
    try {
      const data = await fetchUserSocialProfilesApi(userId)
      setSocialProfiles(data.items || [])
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể tải danh sách tài khoản liên kết')
    } finally {
      setSocialLoading(false)
    }
  }

  const handleToggleActive = async () => {
    if (!details) return
    
    const confirmMsg = details.user.is_active 
      ? 'Bạn có chắc muốn vô hiệu hóa tài khoản này?' 
      : 'Bạn có chắc muốn kích hoạt lại tài khoản này?'
    
    if (!confirm(confirmMsg)) return

    setActionLoading(true)
    try {
      await toggleUserActiveApi(userId)
      toast.success(details.user.is_active ? 'Đã vô hiệu hóa tài khoản' : 'Đã kích hoạt tài khoản')
      await loadUserDetails()
      onDataChanged()
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể thay đổi trạng thái tài khoản')
    } finally {
      setActionLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!details) return
    
    const confirmMsg = `Bạn có chắc muốn XÓA vĩnh viễn tài khoản "${details.user.email}"?\n\nHành động này KHÔNG thể hoàn tác!`
    if (!confirm(confirmMsg)) return

    setActionLoading(true)
    try {
      await deleteAdminUserApi(userId)
      toast.success('Đã xóa tài khoản')
      onDataChanged()
      onClose()
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể xóa tài khoản')
    } finally {
      setActionLoading(false)
    }
  }

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('vi-VN').format(num)
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(amount)
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('vi-VN')
  }

  if (!isOpen) return null

  const isCurrentUser = currentUserId && details?.user.id === currentUserId

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex items-center gap-3">
            <UserAvatar
              src={details?.user.avatar_url ?? null}
              name={details?.user.full_name || details?.user.email || 'User'}
              size="lg"
            />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-slate-900">
                  {details?.user.full_name || details?.user.email || 'Người dùng'}
                </h2>
                {details?.user.is_system_admin && (
                  <span className="flex items-center gap-1 rounded bg-purple-100 px-2 py-0.5 text-xs font-bold text-purple-700">
                    <Shield size={12} />
                    SYSTEM ADMIN
                  </span>
                )}
                {details?.user.is_active ? (
                  <span className="flex items-center gap-1 rounded bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700">
                    <Power size={12} />
                    Hoạt động
                  </span>
                ) : (
                  <span className="flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
                    <PowerOff size={12} />
                    Vô hiệu hóa
                  </span>
                )}
              </div>
              {details?.user.full_name && (
                <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
                  <Mail size={14} />
                  {details.user.email}
                </p>
              )}
              <div className="mt-1 flex items-center gap-2">
                <p className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Calendar size={12} />
                  {formatDate(details?.user.created_at || '')}
                </p>
                <div className="flex flex-wrap gap-1">
                  {details?.user.roles.map(role => (
                    <span key={role} className="rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                      {role}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 bg-slate-50/50 px-6">
          <button
            onClick={() => setActiveTab('overview')}
            className={cn(
              'flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors',
              activeTab === 'overview'
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            <Activity size={15} />
            Thống kê AI
          </button>
          <button
            onClick={() => setActiveTab('accounts')}
            className={cn(
              'flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors',
              activeTab === 'accounts'
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            <Link2 size={15} />
            Tài khoản liên kết
            {details && (
              <span className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                activeTab === 'accounts' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-600',
              )}>
                {details.statistics.resources.social_profiles_count}
              </span>
            )}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600"></div>
          </div>
        ) : details ? (
          <>
            {/* ── Overview Tab ── */}
            {activeTab === 'overview' && (
              <div className="p-6 space-y-6">
                {/* Action Buttons */}
                <div className="flex items-center justify-end gap-2 pb-4 border-b border-slate-100">
                  <button
                    onClick={() => onEdit(userId)}
                    disabled={actionLoading}
                    className="inline-flex items-center gap-2 rounded-lg border-2 border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-bold text-indigo-700 transition-all hover:border-indigo-300 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Edit size={16} />
                    Sửa
                  </button>
                  {!isCurrentUser && (
                    <>
                      <button
                        onClick={() => void handleToggleActive()}
                        disabled={actionLoading}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-lg border-2 px-4 py-2 text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed",
                          details.user.is_active
                            ? "border-orange-200 bg-orange-50 text-orange-700 hover:border-orange-300 hover:bg-orange-100"
                            : "border-green-200 bg-green-50 text-green-700 hover:border-green-300 hover:bg-green-100"
                        )}
                      >
                        {details.user.is_active ? (
                          <>
                            <PowerOff size={16} />
                            Vô hiệu hóa
                          </>
                        ) : (
                          <>
                            <Power size={16} />
                            Kích hoạt
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => void handleDelete()}
                        disabled={actionLoading}
                        className="inline-flex items-center gap-2 rounded-lg border-2 border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 transition-all hover:border-red-300 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Trash2 size={16} />
                        Xóa
                      </button>
                    </>
                  )}
                </div>

                {/* Statistics Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                      <Activity size={16} className="text-indigo-500" />
                      Tổng API Calls
                    </div>
                    <p className="mt-2 text-2xl font-bold text-slate-900">
                      {formatNumber(details.statistics.ai_usage.prompt_runs_count)}
                    </p>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                      <Zap size={16} className="text-amber-500" />
                      Tổng Tokens
                    </div>
                    <p className="mt-2 text-2xl font-bold text-slate-900">
                      {formatNumber(details.statistics.ai_usage.total_tokens)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatNumber(details.statistics.ai_usage.total_input_tokens)} in / {formatNumber(details.statistics.ai_usage.total_output_tokens)} out
                    </p>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                      <DollarSign size={16} className="text-green-500" />
                      Tổng Chi phí
                    </div>
                    <p className="mt-2 text-2xl font-bold text-slate-900">
                      {formatCurrency(details.statistics.ai_usage.total_cost_usd)}
                    </p>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                      <Share2 size={16} className="text-blue-500" />
                      Profiles / Jobs
                    </div>
                    <p className="mt-2 text-2xl font-bold text-slate-900">
                      {details.statistics.resources.social_profiles_count} / {details.statistics.resources.crawl_jobs_count}
                    </p>
                  </div>
                </div>

                {/* Breakdown by Run Type */}
                {details.statistics.ai_usage.breakdown_by_run_type.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">
                      <FileText size={16} className="text-indigo-500" />
                      Phân tích theo loại tác vụ
                    </h4>
                    <div className="space-y-2">
                      {details.statistics.ai_usage.breakdown_by_run_type.map((item) => (
                        <div key={item.key} className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-700">{item.key}</p>
                            <p className="text-xs text-slate-500">
                              {formatNumber(item.runs)} calls · {formatNumber(item.total_tokens)} tokens
                            </p>
                          </div>
                          <p className="text-sm font-bold text-slate-900">{formatCurrency(item.cost_usd)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Breakdown by Model */}
                {details.statistics.ai_usage.breakdown_by_model.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">
                      <TrendingUp size={16} className="text-indigo-500" />
                      Phân tích theo Model AI
                    </h4>
                    <div className="space-y-2">
                      {details.statistics.ai_usage.breakdown_by_model.map((item) => (
                        <div key={item.key} className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-700">{item.key}</p>
                            <p className="text-xs text-slate-500">
                              {formatNumber(item.runs)} calls · {formatNumber(item.total_tokens)} tokens
                            </p>
                          </div>
                          <p className="text-sm font-bold text-slate-900">{formatCurrency(item.cost_usd)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* No activity placeholder */}
                {details.statistics.ai_usage.prompt_runs_count === 0 && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
                    <Activity size={48} className="mx-auto text-slate-300" />
                    <p className="mt-3 text-sm font-medium text-slate-600">
                      Người dùng này chưa có hoạt động AI nào
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── Accounts Tab ── */}
            {activeTab === 'accounts' && (
              <div className="p-6">
                {/* Header row */}
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Tài khoản đã liên kết</h3>
                    <p className="mt-0.5 text-sm text-slate-500">
                      Danh sách các tài khoản mạng xã hội mà người dùng đã kết nối vào hệ thống
                    </p>
                  </div>
                  <button
                    onClick={loadSocialProfiles}
                    disabled={socialLoading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    <RefreshCw size={13} className={cn(socialLoading && 'animate-spin')} />
                    Làm mới
                  </button>
                </div>

                {socialLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600"></div>
                  </div>
                ) : socialProfiles.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center">
                    <Link2 size={40} className="mx-auto text-slate-300" />
                    <h4 className="mt-3 text-base font-bold text-slate-700">Chưa có tài khoản liên kết</h4>
                    <p className="mt-1 text-sm text-slate-500">
                      Người dùng này chưa kết nối bất kỳ tài khoản mạng xã hội nào.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {socialProfiles.map((profile) => (
                      <SocialProfileCard key={profile.id} profile={profile} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="p-20 text-center text-slate-500">
            Không tìm thấy thông tin người dùng
          </div>
        )}
      </div>
    </div>
  )
}
