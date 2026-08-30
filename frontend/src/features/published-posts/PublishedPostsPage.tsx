import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  BarChart3,
  CalendarDays,
  ExternalLink,
  Eye,
  Heart,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  Share2,
  TrendingUp,
} from 'lucide-react'
import {
  fetchSocialPostsApi,
  fetchSocialProfilesApi,
  syncSocialProfileApi,
  type SocialPost,
  type SocialProfile,
} from '@/commons/apis/api'
import TikTokEmbedPlayer from '@/features/analytics/TikTokEmbedPlayer'
import {
  AppButton,
  EmptyBlock,
  MetricCard,
  PageHeader,
  PlatformIcon,
  SearchField,
  SelectControl,
  SocialProfileAvatar,
  StatusPill,
  platformLabel,
} from '@/commons/component/social-ui'
import { cn } from '@/commons/lib/utils'

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

  const busy = loadingProfiles || loadingPosts

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bài đã đăng"
        description="Theo dõi các bài đã xuất bản theo từng tài khoản social cùng chỉ số mới nhất."
        actions={
          <>
            <SearchField
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Tìm bài đăng, caption, ID..."
              className="w-full sm:w-[280px]"
            />
            <AppButton variant="secondary" icon={<RefreshCw size={15} className={busy ? 'animate-spin' : ''} />} onClick={() => void loadPosts()} disabled={busy || !selectedProfileId}>
              Tải lại
            </AppButton>
            <AppButton icon={<RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />} onClick={() => void handleSync()} disabled={syncing || !selectedProfileId}>
              Đồng bộ
            </AppButton>
          </>
        }
      />

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="app-card p-4">
          <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="app-section-title">Tài khoản đang theo dõi</h2>
              <p className="mt-1 text-xs font-medium text-[var(--on-surface-variant)]">
                {selectedProfile ? `${selectedProfile.profile_name} - ${platformLabel(selectedProfile.platform)}` : 'Chưa có tài khoản social'}
              </p>
            </div>
            <SelectControl value={selectedProfileId} onChange={setSelectedProfileId} className="w-full md:w-[280px]">
              {profiles.length === 0 && <option value="">Chưa có tài khoản</option>}
              {profiles.map((profile) => (
                <option key={profile.id} value={String(profile.id)}>
                  {profile.profile_name}{profile.username ? ` (@${profile.username})` : ''}
                </option>
              ))}
            </SelectControl>
          </div>

          {loadingProfiles ? (
            <div className="loading-state">
              <Loader2 size={16} className="animate-spin" />
              Đang tải tài khoản...
            </div>
          ) : profiles.length === 0 ? (
            <EmptyBlock label="Chưa có tài khoản social để theo dõi bài đã đăng." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {profiles.map((profile) => (
                <ProfileCard
                  key={profile.id}
                  profile={profile}
                  active={String(profile.id) === selectedProfileId}
                  onClick={() => setSelectedProfileId(String(profile.id))}
                />
              ))}
            </div>
          )}
        </div>

        <SelectedProfilePanel profile={selectedProfile} totalPosts={posts.length} loading={loadingProfiles} />
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<Send size={18} />} label="Bài trong bộ lọc" value={plainNumberFormatter.format(filteredPosts.length)} tint="#2556ea" />
        <MetricCard icon={<Eye size={18} />} label="Tổng lượt xem" value={formatMetric(totals.views)} trend={`+${formatMetric(totals.views24h)} / 24h`} tint="#16a34a" />
        <MetricCard icon={<Heart size={18} />} label="Tương tác" value={formatMetric(totals.likes + totals.comments + totals.shares)} tint="#db2777" />
        <MetricCard icon={<TrendingUp size={18} />} label="Đăng 7 ngày qua" value={plainNumberFormatter.format(totals.last7d)} tint="#f59e0b" />
      </section>

      <section className="app-card p-4">
        <div className="mb-4 grid gap-3 md:grid-cols-[minmax(180px,220px)_minmax(180px,220px)_minmax(140px,1fr)_minmax(140px,1fr)]">
          <SelectControl value={selectedStatus} onChange={(value) => setSelectedStatus(value as PostStatusFilter)}>
            {POST_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </SelectControl>
          <label className="relative">
            <CalendarDays size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#718096]" />
            <input className="app-input w-full pl-9" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <label className="relative">
            <CalendarDays size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#718096]" />
            <input className="app-input w-full pl-9" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
          <div className="flex items-center justify-end text-xs font-semibold text-[var(--on-surface-variant)]">
            {filteredPosts.length}/{posts.length} bài
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
    </div>
  )
}

function ProfileCard({ profile, active, onClick }: { profile: SocialProfile; active: boolean; onClick: () => void }) {
  const postCount = Number(profile.video_count ?? 0)
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex min-h-[86px] items-center gap-3 rounded-[8px] border bg-white p-3 text-left shadow-sm transition hover:border-[#b9c3d5] hover:shadow-md',
        active && 'border-[#818cf8] bg-[#f8f7ff]',
      )}
    >
      <SocialProfileAvatar avatarUrl={profile.avatar_url} name={profile.profile_name} platform={profile.platform} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-extrabold text-[#111827]" title={profile.profile_name}>{profile.profile_name}</div>
        <div className="truncate text-xs font-medium text-[#64748b]">{profile.username ? `@${profile.username}` : platformLabel(profile.platform)}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <StatusPill value={profile.status || 'active'} />
          {postCount > 0 && <span className="text-[10px] font-bold text-[#64748b]">{formatMetric(postCount)} bài</span>}
        </div>
      </div>
    </button>
  )
}

function SelectedProfilePanel({ profile, totalPosts, loading }: { profile: SocialProfile | null; totalPosts: number; loading: boolean }) {
  if (loading) {
    return (
      <div className="app-card p-4">
        <div className="loading-state">
          <Loader2 size={16} className="animate-spin" />
          Đang tải...
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="app-card p-4">
        <EmptyBlock label="Chọn một tài khoản để xem bài đã đăng." />
      </div>
    )
  }

  return (
    <div className="app-card flex flex-col gap-4 p-4">
      <div className="flex items-start gap-3">
        <SocialProfileAvatar avatarUrl={profile.avatar_url} name={profile.profile_name} platform={profile.platform} size="xl" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-extrabold text-[#111827]" title={profile.profile_name}>{profile.profile_name}</div>
          <div className="truncate text-xs font-semibold text-[#64748b]">{profile.username ? `@${profile.username}` : platformLabel(profile.platform)}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill value={profile.status || 'active'} />
            <span className="inline-flex items-center gap-1 rounded-[6px] bg-slate-100 px-2 py-1 text-[10px] font-bold text-[#526179]">
              <PlatformIcon platform={profile.platform} size="sm" />
              {platformLabel(profile.platform)}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ProfileStat label="Follower" value={profile.follower_count} />
        <ProfileStat label="Đã lưu" value={totalPosts} />
        <ProfileStat label="Likes kênh" value={profile.likes_count} />
        <ProfileStat label="Video kênh" value={profile.video_count} />
      </div>
    </div>
  )
}

function ProfileStat({ label, value }: { label: string; value?: number | null }) {
  return (
    <div className="rounded-[8px] border border-[var(--outline-variant)] bg-[#fbfcff] p-3">
      <div className="text-[10px] font-bold uppercase text-[#64748b]">{label}</div>
      <div className="mt-1 text-lg font-extrabold text-[#111827]">{value === null || value === undefined ? '-' : formatMetric(value)}</div>
    </div>
  )
}

function PostRow({ post, active, onSelect }: { post: SocialPost; active: boolean; onSelect: () => void }) {
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
        {post.post_url ? (
          <a
            href={post.post_url}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="icon-button border border-[var(--outline-variant)] bg-white text-[#2556ea]"
            title="Mở bài đăng"
          >
            <ExternalLink size={15} />
          </a>
        ) : (
          <span className="text-xs font-semibold text-[#94a3b8]">-</span>
        )}
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

function PostDetailCard({ post }: { post: SocialPost | null }) {
  if (!post) {
    return <EmptyBlock label="Chọn một bài để xem chi tiết nhanh." />
  }

  const latestCapturedAt = post.latest_metric?.captured_at
  const growth24h = Number(post.growth?.views_24h || 0)

  return (
    <div className="rounded-[8px] border border-[var(--outline-variant)] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusPill value={post.status || 'published'} />
            {post.platform_post_id && <span className="rounded-[6px] bg-slate-100 px-2 py-1 text-[10px] font-bold text-[#64748b]">ID {post.platform_post_id}</span>}
          </div>
          <h3 className="line-clamp-2 text-base font-extrabold text-[#111827]">{post.title || 'Untitled post'}</h3>
        </div>
        {post.post_url && (
          <a href={post.post_url} target="_blank" rel="noreferrer" className="icon-button shrink-0 border border-[var(--outline-variant)] bg-white text-[#2556ea]" title="Mở bài đăng">
            <ExternalLink size={15} />
          </a>
        )}
      </div>

      <div className="mt-3 space-y-2 text-xs text-[#64748b]">
        <InfoLine label="Ngày đăng" value={formatDateTime(post.published_at)} />
        <InfoLine label="Cập nhật chỉ số" value={formatDateTime(latestCapturedAt)} />
        <InfoLine label="Tăng view 24h" value={`${growth24h >= 0 ? '+' : ''}${formatMetric(growth24h)}`} />
      </div>

      <div className="mt-3">
        <TikTokEmbedPlayer postId={post.platform_post_id} postUrl={post.post_url} title={post.title} />
      </div>

      {post.caption && (
        <div className="mt-3 rounded-[8px] border border-[var(--outline-variant)] bg-[#fbfcff] p-3">
          <div className="mb-1 text-[10px] font-bold uppercase text-[#64748b]">Caption</div>
          <p className="line-clamp-6 whitespace-pre-line text-sm leading-relaxed text-[#111827]">{post.caption}</p>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <MiniMetric label="Views" value={metricValue(post, 'views')} icon={<Eye size={14} />} />
        <MiniMetric label="Likes" value={metricValue(post, 'likes')} icon={<Heart size={14} />} />
        <MiniMetric label="Comments" value={metricValue(post, 'comments')} icon={<MessageCircle size={14} />} />
        <MiniMetric label="Shares" value={metricValue(post, 'shares')} icon={<Share2 size={14} />} />
      </div>
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-semibold">{label}</span>
      <span className="truncate font-bold text-[#111827]">{value}</span>
    </div>
  )
}

function MiniMetric({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="rounded-[8px] border border-[var(--outline-variant)] bg-[#fbfcff] p-2">
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase text-[#64748b]">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-base font-extrabold text-[#111827]">{formatMetric(value)}</div>
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
              <span className="text-[10px] font-semibold text-[#64748b]">{formatMetric(metricValue(post, 'views'))} views</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
