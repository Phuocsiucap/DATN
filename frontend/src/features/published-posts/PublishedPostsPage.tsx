import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  BarChart3,
  ExternalLink,
  Eye,
  Heart,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  Share2,
  TrendingUp,
  UsersRound,
  Video,
  Trash2,
} from 'lucide-react'
import {
  fetchSocialPostsApi,
  fetchSocialProfilesApi,
  syncSocialProfileApi,
  deleteSocialPostApi,
  type SocialPost,
  type SocialProfile,
} from '@/commons/apis/api'
import { SocialProfileFilter } from '@/commons/component/SocialProfileFilter'
import {
  AppButton,
  DateInput,
  EmptyBlock,
  MetricCard,
  PageLayout,
  SearchField,
  SelectControl,
  SocialProfileAvatar,
  StatusPill,
  TableRowActions,
  type TableRowActionItem,
  platformLabel,
} from '@/commons/component/social-ui'
import { cn } from '@/commons/lib/utils'
import { PostDetailCard } from './components/PostDetailCard'

type PostStatusFilter = 'all' | 'published' | 'draft' | 'failed' | 'deleted'

const POST_STATUS_OPTIONS: Array<{ value: PostStatusFilter; label: string }> = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'published', label: 'Đã đăng' },
  { value: 'draft', label: 'Nháp' },
  { value: 'failed', label: 'Lỗi' },
  { value: 'deleted', label: 'Đã xóa' },
]

const numberFormatter = new Intl.NumberFormat('vi-VN', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const plainNumberFormatter = new Intl.NumberFormat('vi-VN')

const normalizeText = (value?: string | null) => String(value || '').trim().toLowerCase()

const metricValue = (post: SocialPost, key: 'views' | 'likes' | 'comments' | 'shares') => {
  const value = post.latest_metric?.[key]
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

const formatMetric = (value: number) => numberFormatter.format(Math.max(value, 0))

const formatDateTime = (value?: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const formatDateInput = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const addDays = (date: Date, days: number) => {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export default function PublishedPostsPage() {
  const [profiles, setProfiles] = useState<SocialProfile[]>([])
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [selectedStatus, setSelectedStatus] = useState<PostStatusFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [startDate, setStartDate] = useState(() => formatDateInput(addDays(new Date(), -30)))
  const [endDate, setEndDate] = useState(() => formatDateInput(new Date()))
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [loadingPosts, setLoadingPosts] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const selectedProfile = useMemo(
    () => profiles.find((profile) => String(profile.id) === selectedProfileId) || null,
    [profiles, selectedProfileId],
  )

  const loadProfiles = async () => {
    setLoadingProfiles(true)
    try {
      const data = await fetchSocialProfilesApi()
      const nextProfiles = data.items || []
      setProfiles(nextProfiles)
      setSelectedProfileId((current) => {
        if (current && nextProfiles.some((profile) => String(profile.id) === current)) return current
        return nextProfiles[0] ? String(nextProfiles[0].id) : ''
      })
    } catch (error: any) {
      setProfiles([])
      toast.error(error?.response?.data?.detail || 'Không thể tải danh sách tài khoản social')
    } finally {
      setLoadingProfiles(false)
    }
  }

  const loadPosts = async (profileId = selectedProfileId) => {
    if (!profileId) {
      setPosts([])
      return
    }
    setLoadingPosts(true)
    try {
      const data = await fetchSocialPostsApi(profileId)
      const nextPosts = data.items || []
      setPosts(nextPosts)
      setSelectedPostId((current) => {
        if (current && nextPosts.some((post) => post.id === current)) return current
        return nextPosts[0]?.id || null
      })
    } catch (error: any) {
      setPosts([])
      toast.error(error?.response?.data?.detail || 'Không thể tải bài đã đăng')
    } finally {
      setLoadingPosts(false)
    }
  }

  useEffect(() => {
    void loadProfiles()
  }, [])

  useEffect(() => {
    void loadPosts(selectedProfileId)
  }, [selectedProfileId])

  const filteredPosts = useMemo(() => {
    const query = normalizeText(searchQuery)
    const startTime = startDate ? new Date(`${startDate}T00:00:00`).getTime() : null
    const endTime = endDate ? new Date(`${endDate}T23:59:59`).getTime() : null

    return posts.filter((post) => {
      const status = normalizeText(post.status || 'published')
      if (selectedStatus !== 'all' && status !== selectedStatus) return false

      const publishedTime = post.published_at ? new Date(post.published_at).getTime() : null
      if (startTime !== null && publishedTime !== null && publishedTime < startTime) return false
      if (endTime !== null && publishedTime !== null && publishedTime > endTime) return false

      if (!query) return true
      return [post.title, post.caption, post.platform_post_id, post.post_url]
        .some((value) => normalizeText(value).includes(query))
    })
  }, [endDate, posts, searchQuery, selectedStatus, startDate])

  const selectedPost = useMemo(
    () => filteredPosts.find((post) => post.id === selectedPostId) || filteredPosts[0] || null,
    [filteredPosts, selectedPostId],
  )

  const totals = useMemo(() => {
    const last7d = Date.now() - 7 * 24 * 60 * 60 * 1000
    return filteredPosts.reduce(
      (acc, post) => {
        acc.views += metricValue(post, 'views')
        acc.likes += metricValue(post, 'likes')
        acc.comments += metricValue(post, 'comments')
        acc.shares += metricValue(post, 'shares')
        const views24h = post.growth?.views_24h
        if (Number.isFinite(Number(views24h))) acc.views24h += Number(views24h)
        const publishedTime = post.published_at ? new Date(post.published_at).getTime() : 0
        if (publishedTime >= last7d) acc.last7d += 1
        return acc
      },
      { views: 0, likes: 0, comments: 0, shares: 0, views24h: 0, last7d: 0 },
    )
  }, [filteredPosts])

  const topPosts = useMemo(() => {
    return [...filteredPosts]
      .sort((left, right) => metricValue(right, 'views') - metricValue(left, 'views'))
      .slice(0, 5)
  }, [filteredPosts])

  const handleSync = async () => {
    if (!selectedProfileId) return
    setSyncing(true)
    try {
      const result = await syncSocialProfileApi(selectedProfileId)
      setProfiles((current) => current.map((profile) => (
        String(profile.id) === selectedProfileId ? result.profile : profile
      )))
      await loadPosts(selectedProfileId)
      const countText = result.synced_videos_count !== undefined ? ` (${result.synced_videos_count} bài)` : ''
      const resolvedText = result.resolved_post_ids_count ? ` Đã bổ sung ${result.resolved_post_ids_count} post_id.` : ''
      const snapshotText = result.snapshot_created ? 'Đã lưu snapshot chỉ số mới.' : 'Chỉ số tài khoản chưa đổi.'
      toast.success(`Đã đồng bộ bài đăng từ tài khoản${countText}.${resolvedText} ${snapshotText}`)
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể đồng bộ tài khoản')
    } finally {
      setSyncing(false)
    }
  }

  const handleDeletePost = async (postId: string) => {
    if (!selectedProfileId || !window.confirm('Bạn có chắc chắn muốn xóa bản ghi bài đăng này? Lượt xem và tương tác của bài này sẽ bị xóa khỏi hệ thống.')) return
    setIsDeleting(true)
    try {
      await deleteSocialPostApi(selectedProfileId, postId)
      toast.success('Đã xóa bản ghi bài đăng.')
      await loadPosts(selectedProfileId)
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể xóa bài đăng')
    } finally {
      setIsDeleting(false)
    }
  }

  const busy = loadingProfiles || loadingPosts || isDeleting

  return (
    <PageLayout
      title="Bài đã đăng"
      description="Theo dõi các bài đã xuất bản theo từng tài khoản social cùng chỉ số mới nhất."
    >
      <SocialProfileFilter profiles={profiles} value={selectedProfileId} onChange={setSelectedProfileId} loading={loadingProfiles} emptyLabel="Chưa có tài khoản social để theo dõi bài đã đăng." />

      <SelectedProfilePanel
        profile={selectedProfile}
        totalPosts={posts.length}
        loading={loadingProfiles}
        syncing={syncing}
        onSync={() => void handleSync()}
      />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<Send size={18} />} label="Bài trong bộ lọc" value={plainNumberFormatter.format(filteredPosts.length)} tint="#2556ea" />
        <MetricCard icon={<Eye size={18} />} label="Tổng lượt xem" value={formatMetric(totals.views)} trend={`+${formatMetric(totals.views24h)} / 24h`} tint="#16a34a" />
        <MetricCard icon={<Heart size={18} />} label="Tương tác" value={formatMetric(totals.likes + totals.comments + totals.shares)} tint="#db2777" />
        <MetricCard icon={<TrendingUp size={18} />} label="Đăng 7 ngày qua" value={plainNumberFormatter.format(totals.last7d)} tint="#f59e0b" />
      </section>

      <section className="app-card p-4">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <SearchField
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Tìm bài đăng, caption, ID..."
              className="w-full sm:w-[260px]"
            />
            <SelectControl value={selectedStatus} onChange={(value) => setSelectedStatus(value as PostStatusFilter)} className="w-full sm:w-[170px]">
              {POST_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </SelectControl>
            <DateInput label="Từ" value={startDate} onChange={setStartDate} className="w-full sm:w-[165px]" />
            <DateInput label="Đến" value={endDate} onChange={setEndDate} className="w-full sm:w-[165px]" />
          </div>

          <div className="flex items-center gap-3 self-end lg:self-center">
            <AppButton
              variant="secondary"
              icon={<RefreshCw size={15} className={busy ? 'animate-spin' : ''} />}
              onClick={() => void loadPosts(selectedProfileId)}
              disabled={busy || !selectedProfileId}
            >
              Tải lại
            </AppButton>
            <div className="text-xs font-semibold text-[var(--on-surface-variant)] shrink-0">
              {filteredPosts.length}/{posts.length} bài
            </div>
          </div>
        </div>

        {loadingPosts ? (
          <div className="loading-state">
            <Loader2 size={16} className="animate-spin" />
            Đang tải bài đã đăng...
          </div>
        ) : filteredPosts.length === 0 ? (
          <EmptyBlock label="Không tìm thấy bài đã đăng phù hợp với bộ lọc hiện tại." />
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="table-scroll">
              <div className="data-grid">
                <div className="app-table-header grid grid-cols-[minmax(280px,1.4fr)_140px_repeat(4,88px)_84px] items-center px-3 py-2">
                  <div>Bài đăng</div>
                  <div>Ngày đăng</div>
                  <div className="text-right">Views</div>
                  <div className="text-right">Likes</div>
                  <div className="text-right">Bình luận</div>
                  <div className="text-right">Chia sẻ</div>
                  <div className="text-right">Mở</div>
                </div>
                {filteredPosts.map((post) => (
                  <PostRow
                    key={post.id}
                    post={post}
                    active={selectedPost?.id === post.id}
                    onSelect={() => setSelectedPostId(post.id)}
                    onDelete={() => void handleDeletePost(post.id)}
                  />
                ))}
              </div>
            </div>

            <aside className="space-y-3">
              <PostDetailCard post={selectedPost} />
              <TopPostsCard posts={topPosts} onSelect={setSelectedPostId} selectedPostId={selectedPost?.id || null} />
            </aside>
          </div>
        )}
      </section>
    </PageLayout>
  )
}

function SelectedProfilePanel({
  profile,
  totalPosts,
  loading,
  syncing,
  onSync,
}: {
  profile: SocialProfile | null
  totalPosts: number
  loading: boolean
  syncing: boolean
  onSync: () => void
}) {
  if (loading) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs">
        <div className="flex animate-pulse items-center gap-4">
          <div className="h-16 w-16 rounded-full bg-slate-200" />
          <div className="space-y-2">
            <div className="h-4 w-32 rounded bg-slate-200" />
            <div className="h-3 w-24 rounded bg-slate-200" />
          </div>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs">
        <EmptyBlock label="Chọn một tài khoản để xem bài đã đăng." />
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-1 shadow-xs transition-shadow hover:shadow-md">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 h-32 w-64 -translate-y-8 translate-x-16 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 h-24 w-48 translate-y-8 -translate-x-8 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

      <div className="relative flex flex-col gap-6 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="shrink-0 relative">
            <SocialProfileAvatar avatarUrl={profile.avatar_url} name={profile.profile_name} platform={profile.platform} size="xl" className="ring-4 ring-white shadow-sm" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-xl font-black text-slate-900" title={profile.profile_name}>
                {profile.profile_name}
              </h2>
              <StatusPill value={profile.status || 'active'} />
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-500">
              <span className="truncate text-blue-600">{profile.username ? `@${profile.username.replace(/^@/, '')}` : platformLabel(profile.platform)}</span>
              <span className="text-slate-300">•</span>
              <span className="text-slate-500">Tài khoản liên kết</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-6 lg:gap-8">
            <ProfileStatBox icon={<UsersRound size={16} />} label="Follower" value={profile.follower_count} tint="text-indigo-600" bgTint="bg-indigo-50" />
            <ProfileStatBox icon={<Send size={16} />} label="Đã lưu" value={totalPosts} tint="text-blue-600" bgTint="bg-blue-50" />
            <ProfileStatBox icon={<Heart size={16} />} label="Likes kênh" value={profile.likes_count} tint="text-pink-600" bgTint="bg-pink-50" />
            <ProfileStatBox icon={<Video size={16} />} label="Video kênh" value={profile.video_count} tint="text-emerald-600" bgTint="bg-emerald-50" />
          </div>

          <div className="hidden h-12 w-px bg-slate-200 sm:block" />

          <button
            onClick={onSync}
            disabled={syncing}
            className={cn(
              "group relative flex h-10 w-full shrink-0 sm:w-auto items-center justify-center gap-2 overflow-hidden rounded-xl px-5 font-bold text-white shadow-sm transition-all focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:opacity-60",
              syncing ? "bg-slate-400" : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 hover:shadow-md"
            )}
          >
            <div className="absolute inset-0 bg-white/20 opacity-0 transition-opacity group-hover:opacity-100" />
            <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
            <span className="relative">Đồng bộ</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function ProfileStatBox({ label, value, icon, tint, bgTint }: { label: string; value?: number | null; icon: ReactNode; tint: string; bgTint: string }) {
  return (
    <div className="flex flex-col justify-center">
      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
        <span className={cn("flex h-6 w-6 items-center justify-center rounded-md", bgTint, tint)}>
          {icon}
        </span>
        {label}
      </div>
      <div className="mt-1.5 text-xl font-black text-slate-800">
        {value === null || value === undefined ? '-' : formatMetric(value)}
      </div>
    </div>
  )
}

function PostRow({ post, active, onSelect, onDelete }: { post: SocialPost; active: boolean; onSelect: () => void; onDelete: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect()
      }}
      className={cn('app-row grid grid-cols-[minmax(280px,1.4fr)_140px_repeat(4,88px)_84px] items-center px-3 py-2', active && 'app-row-selected')}
    >
      <div className="min-w-0 pr-3">
        <div className="line-clamp-1 text-sm font-bold text-[#111827]" title={post.title}>{post.title || 'Untitled post'}</div>
        <div className="mt-0.5 line-clamp-1 text-xs font-medium text-[#64748b]">{post.caption || post.platform_post_id || 'Không có caption'}</div>
      </div>
      <div className="text-xs font-semibold text-[#526179]">{formatDateTime(post.published_at)}</div>
      <MetricCell icon={<Eye size={13} />} value={metricValue(post, 'views')} />
      <MetricCell icon={<Heart size={13} />} value={metricValue(post, 'likes')} />
      <MetricCell icon={<MessageCircle size={13} />} value={metricValue(post, 'comments')} />
      <MetricCell icon={<Share2 size={13} />} value={metricValue(post, 'shares')} />
      <div className="flex justify-end">
        <TableRowActions
          actions={([
            { label: 'Xem chi tiết', icon: <Eye size={14} />, onClick: onSelect },
            post.post_url ? {
              label: 'Mở trang bài gốc',
              icon: <ExternalLink size={14} />,
              onClick: () => window.open(post.post_url!, '_blank'),
            } : null,
            { label: 'Xóa bài đăng', icon: <Trash2 size={14} className="text-red-500" />, onClick: onDelete, danger: true },
          ].filter(Boolean)) as TableRowActionItem[]}
        />
      </div>
    </div>
  )
}

function MetricCell({ icon, value }: { icon: ReactNode; value: number }) {
  return (
    <div className="flex items-center justify-end gap-1.5 text-xs font-extrabold text-[#172033]">
      <span className="text-[#94a3b8]">{icon}</span>
      {formatMetric(value)}
    </div>
  )
}

function TopPostsCard({ posts, selectedPostId, onSelect }: { posts: SocialPost[]; selectedPostId: string | null; onSelect: (postId: string) => void }) {
  return (
    <div className="rounded-[8px] border border-[var(--outline-variant)] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <BarChart3 size={16} className="text-[#2556ea]" />
        <h3 className="text-sm font-extrabold text-[#111827]">Top lượt xem</h3>
      </div>
      <div className="space-y-2">
        {posts.length === 0 && <div className="empty-state min-h-[96px]">Chưa có dữ liệu top bài.</div>}
        {posts.map((post, index) => (
          <button
            key={post.id}
            onClick={() => onSelect(post.id)}
            className={cn('flex w-full items-center gap-3 rounded-[8px] border p-2 text-left transition hover:bg-[#f8faff]', selectedPostId === post.id ? 'border-[#818cf8] bg-[#f8f7ff]' : 'border-[var(--outline-variant)] bg-white')}
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-[#eef2ff] text-xs font-black text-[#4f46e5]">{index + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-1 text-xs font-bold text-[#111827]">{post.title || 'Untitled post'}</span>
              <span className="text-xs font-semibold text-[#64748b]">{formatMetric(metricValue(post, 'views'))} views</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
