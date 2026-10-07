import { PaginatedList } from '@/commons/component/ui/paginated-list'
import { Table, TableHeader as ShadcnTableHeader, TableBody, TableRow, TableHead, TableCell } from '@/commons/component/ui/table'
import { useEffect, useMemo, useRef, useState, type ReactNode, type WheelEvent } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft,
  BarChart3,
  Bookmark,
  ExternalLink,
  Eye,
  Heart,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  Share2,
  SlidersHorizontal,
  UsersRound,
  Video,
  Trash2,
} from 'lucide-react'
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  fetchAccountAnalyticsChartsApi,
  fetchAccountAnalyticsOverviewApi,
  fetchAccountAnalyticsTopTopicsApi,
  fetchSocialPostsApi,
  fetchSocialProfilesApi,
  fetchSocialProfileStrategyApi,
  syncSocialProfileApi,
  deleteSocialPostApi,
  updateSocialProfileStrategyApi,
  type AccountAnalyticsCharts,
  type AccountAnalyticsOverview,
  type AccountTopTopics,
  type AnalyticsMetric,
  type SocialPost,
  type SocialProfile,
} from '@/commons/apis/api'
import { SocialProfileFilter } from '@/commons/component/SocialProfileFilter'
import {
  AppButton,
  DateInput,
  EmptyBlock,
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
import { PostDetailSheet } from './components/PostDetailSheet'
import { SocialProfileStrategyDialog } from '@/features/settings/SocialProfileStrategyDialog'

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

const DEFAULT_STRATEGY_FORM = {
  content_topics: '',
  content_topic_descriptions: {},
  avoid_topics: '',
  avoid_topic_descriptions: {},
  tone: 'Professional & Authoritative',
  target_audience: '',
  post_frequency_per_day: null,
  approval_mode: 'manual',
  schedule_days: '0,1,2,3,4,5,6',
  schedule_times: '08:30,20:30',
  schedule_timezone: 'Asia/Bangkok',
  min_similarity: 0.62,
  avoid_similarity_threshold: 0.72,
  max_system_recommendations: 20,
  require_video: false,
  auto_project_queue_enabled: false,
  video_render_mode: 'manual',
  auto_queue_enabled: true,
  auto_publish_enabled: false,
  ai_management_enabled: false,
  ai_management_frequency_days: 7,
  receive_system_content: true,
}

const ACCOUNT_ANALYTICS_TABS = ['Tổng quan', 'Hiệu quả nội dung', 'Chủ đề', 'Thời gian đăng', 'Đối tượng'] as const
type AccountAnalyticsTab = typeof ACCOUNT_ANALYTICS_TABS[number]

export default function PublishedPostsPage({ scopedProfileId = '' }: { scopedProfileId?: string } = {}) {
  const [profiles, setProfiles] = useState<SocialProfile[]>([])
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState(scopedProfileId)
  const [selectedStatus, setSelectedStatus] = useState<PostStatusFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [loadingPosts, setLoadingPosts] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null)
  const [detailSheetOpen, setDetailSheetOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [strategyDialogOpen, setStrategyDialogOpen] = useState(false)
  const [strategyLoading, setStrategyLoading] = useState(false)
  const [savingStrategy, setSavingStrategy] = useState(false)
  const [strategyForm, setStrategyForm] = useState<any>(DEFAULT_STRATEGY_FORM)
  const [analyticsStartDate, setAnalyticsStartDate] = useState('')
  const [analyticsEndDate, setAnalyticsEndDate] = useState('')
  const [analyticsOverview, setAnalyticsOverview] = useState<AccountAnalyticsOverview | null>(null)
  const [analyticsCharts, setAnalyticsCharts] = useState<AccountAnalyticsCharts | null>(null)
  const [analyticsTopics, setAnalyticsTopics] = useState<AccountTopTopics | null>(null)
  const [loadingAnalytics, setLoadingAnalytics] = useState(false)
  const [activeAnalyticsTab, setActiveAnalyticsTab] = useState<AccountAnalyticsTab>('Tổng quan')
  const postsSectionRef = useRef<HTMLElement | null>(null)

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
        if (scopedProfileId && nextProfiles.some((profile) => String(profile.id) === scopedProfileId)) return scopedProfileId
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

  const loadAccountAnalytics = async (profileId = selectedProfileId) => {
    if (!profileId) {
      setAnalyticsOverview(null)
      setAnalyticsCharts(null)
      setAnalyticsTopics(null)
      return
    }
    setLoadingAnalytics(true)
    try {
      const params = {
        profile_id: profileId,
        ...(analyticsStartDate ? { start_date: analyticsStartDate } : {}),
        ...(analyticsEndDate ? { end_date: analyticsEndDate } : {}),
      }
      const [overviewData, chartsData, topicsData] = await Promise.all([
        fetchAccountAnalyticsOverviewApi(params),
        fetchAccountAnalyticsChartsApi(params),
        fetchAccountAnalyticsTopTopicsApi({ ...params, limit: 8 }),
      ])
      setAnalyticsOverview(overviewData)
      setAnalyticsCharts(chartsData)
      setAnalyticsTopics(topicsData)
    } catch (error: any) {
      setAnalyticsOverview(null)
      setAnalyticsCharts(null)
      setAnalyticsTopics(null)
      toast.error(error?.response?.data?.detail || 'Không tải được phân tích tài khoản')
    } finally {
      setLoadingAnalytics(false)
    }
  }

  useEffect(() => {
    void loadProfiles()
  }, [])

  useEffect(() => {
    if (scopedProfileId) setSelectedProfileId(scopedProfileId)
  }, [scopedProfileId])

  useEffect(() => {
    void loadPosts(selectedProfileId)
  }, [selectedProfileId])

  useEffect(() => {
    void loadAccountAnalytics(selectedProfileId)
  }, [analyticsEndDate, analyticsStartDate, selectedProfileId])

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

  const openStrategyDialog = async () => {
    if (!selectedProfile) return
    setStrategyDialogOpen(true)
    setStrategyLoading(true)
    try {
      const data = await fetchSocialProfileStrategyApi(selectedProfile.id)
      setStrategyForm(data || DEFAULT_STRATEGY_FORM)
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể tải cấu hình chiến lược')
    } finally {
      setStrategyLoading(false)
    }
  }

  const handleUpdateStrategyField = (key: string, value: any) => {
    setStrategyForm((prev: any) => ({ ...prev, [key]: value }))
  }

  const handleSaveStrategy = async () => {
    if (!selectedProfile) return
    setSavingStrategy(true)
    try {
      const data = await updateSocialProfileStrategyApi(selectedProfile.id, strategyForm)
      setStrategyForm(data)
      toast.success('Đã lưu cấu hình chiến lược')
      setStrategyDialogOpen(false)
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể lưu cấu hình chiến lược')
    } finally {
      setSavingStrategy(false)
    }
  }

  const handlePostsSectionWheel = (event: WheelEvent<HTMLElement>) => {
    const section = postsSectionRef.current
    const pageScroller = section?.closest('.app-page-content') as HTMLElement | null
    const listScroller = section?.querySelector('.app-list-scroll') as HTMLElement | null
    if (!section || !pageScroller || !listScroller || event.deltaY === 0) return

    const sectionTop = section.getBoundingClientRect().top
    const pageTop = pageScroller.getBoundingClientRect().top
    const distanceToStick = Math.max(0, sectionTop - pageTop)

    if (event.deltaY > 0) {
      event.preventDefault()
      if (distanceToStick > 1) {
        const pageDelta = Math.min(event.deltaY, distanceToStick)
        pageScroller.scrollTop += pageDelta
        const remaining = event.deltaY - pageDelta
        if (remaining > 0) listScroller.scrollTop += remaining
        return
      }

      const maxListScroll = listScroller.scrollHeight - listScroller.clientHeight
      if (listScroller.scrollTop < maxListScroll - 1) {
        listScroller.scrollTop += event.deltaY
      } else {
        pageScroller.scrollTop += event.deltaY
      }
      return
    }

    event.preventDefault()
    if (listScroller.scrollTop > 0) {
      const listDelta = Math.max(event.deltaY, -listScroller.scrollTop)
      listScroller.scrollTop += listDelta
      const remaining = event.deltaY - listDelta
      if (remaining < 0) pageScroller.scrollTop += remaining
      return
    }

    pageScroller.scrollTop += event.deltaY
  }

  const busy = loadingProfiles || loadingPosts || isDeleting
  const isProfileScoped = Boolean(scopedProfileId)

  return (
    <PageLayout
      title={isProfileScoped ? undefined : 'Bài đã đăng'}
      description={isProfileScoped ? undefined : 'Theo dõi các bài đã xuất bản theo từng tài khoản social cùng chỉ số mới nhất.'}
      header={isProfileScoped ? (
        <div className="app-page-header flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                window.history.pushState(null, '', '/social-account')
                window.dispatchEvent(new Event('popstate'))
              }}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[var(--outline-variant)] bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
              title="Quay lại Social account"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <h1 className="app-title truncate">Thông tin kênh</h1>
              <p className="mt-1 text-sm font-medium text-[var(--on-surface-variant)]">
                Tổng quan kênh, phân tích hiệu suất và các bài đã đăng.
              </p>
            </div>
          </div>
          <SelectedProfilePanel
            profile={selectedProfile}
            totalPosts={posts.length}
            loading={loadingProfiles}
            syncing={syncing}
            onSync={() => void handleSync()}
            onConfigure={() => void openStrategyDialog()}
          />
        </div>
      ) : undefined}
    >
      {!isProfileScoped && (
        <SocialProfileFilter profiles={profiles} value={selectedProfileId} onChange={setSelectedProfileId} loading={loadingProfiles} emptyLabel="Chưa có tài khoản social để theo dõi bài đã đăng." />
      )}

      {!isProfileScoped && (
        <SelectedProfilePanel
          profile={selectedProfile}
          totalPosts={posts.length}
          loading={loadingProfiles}
          syncing={syncing}
          onSync={() => void handleSync()}
          onConfigure={() => void openStrategyDialog()}
        />
      )}

      <AccountAnalyticsSection
        overview={analyticsOverview}
        charts={analyticsCharts}
        topics={analyticsTopics}
        loading={loadingAnalytics}
        profile={selectedProfile}
        startDate={analyticsStartDate}
        endDate={analyticsEndDate}
        activeTab={activeAnalyticsTab}
        onStartDateChange={setAnalyticsStartDate}
        onEndDateChange={setAnalyticsEndDate}
        onTabChange={setActiveAnalyticsTab}
        onRefresh={() => void loadAccountAnalytics(selectedProfileId)}
      />

      <section ref={postsSectionRef} onWheel={handlePostsSectionWheel} className="published-posts-table-section app-list-layout app-card app-table-card p-4">
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

        <PaginatedList items={filteredPosts} loading={loadingPosts} resetKey={filteredPosts.map(item => item.id).join()}>{(visibleItems) => (
loadingPosts ? (
          <div className="loading-state">
            <Loader2 size={16} className="animate-spin" />
            Đang tải bài đã đăng...
          </div>
        ) : filteredPosts.length === 0 ? (
          <EmptyBlock label="Không tìm thấy bài đã đăng phù hợp với bộ lọc hiện tại." />
        ) : (
          <div className="table-scroll">
                <Table className="min-w-[760px] table-fixed">
                  <colgroup>
                    <col style={{ width: '35%' }} />
                    <col style={{ width: '160px' }} />
                    <col style={{ width: '90px' }} />
                    <col style={{ width: '90px' }} />
                    <col style={{ width: '90px' }} />
                    <col style={{ width: '90px' }} />
                    <col style={{ width: '80px' }} />
                  </colgroup>
                  <ShadcnTableHeader>
                    <TableRow className="bg-slate-50/80">
                      <TableHead className="px-4 py-3 min-w-[160px]"><div>Bài đăng</div></TableHead>
                      <TableHead className="px-4 py-3"><div>Ngày đăng</div></TableHead>
                      <TableHead className="px-4 py-3"><div className="text-right">Views</div></TableHead>
                      <TableHead className="px-4 py-3"><div className="text-right">Likes</div></TableHead>
                      <TableHead className="px-4 py-3"><div className="text-right">Bình luận</div></TableHead>
                      <TableHead className="px-4 py-3"><div className="text-right">Chia sẻ</div></TableHead>
                      <TableHead className="px-4 py-3"><div className="text-right">Mở</div></TableHead>
                    </TableRow>
                  </ShadcnTableHeader>
                  <TableBody>
                    {visibleItems.map((post) => (
                      <PostRow
                        key={post.id}
                        post={post}
                        active={selectedPost?.id === post.id}
                        onSelect={() => { setSelectedPostId(post.id); setDetailSheetOpen(true) }}
                        onDelete={() => void handleDeletePost(post.id)}
                      />
                    ))}
                  </TableBody>
                </Table>
          </div>
        )
        )}</PaginatedList>
      </section>

      <PostDetailSheet
        post={selectedPost}
        selectedPostId={selectedPost?.id || null}
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
        onSelectPost={(postId) => setSelectedPostId(postId)}
      />

      <SocialProfileStrategyDialog
        open={strategyDialogOpen}
        profile={selectedProfile}
        strategyForm={strategyForm}
        strategyLoading={strategyLoading}
        saving={savingStrategy}
        onClose={() => setStrategyDialogOpen(false)}
        onChange={handleUpdateStrategyField}
        onSave={() => void handleSaveStrategy()}
      />
    </PageLayout>
  )
}

function formatAccountMetric(metric?: AnalyticsMetric) {
  return formatMetric(Number(metric?.value || 0))
}

function formatAccountChange(metric?: AnalyticsMetric) {
  if (!metric) return 'Không có kỳ trước'
  if (metric.change_count !== null && metric.change_count !== undefined) {
    return `${metric.change_count >= 0 ? '+' : ''}${plainNumberFormatter.format(metric.change_count)}`
  }
  if (metric.change_pct !== null && metric.change_pct !== undefined) {
    return `${metric.change_pct >= 0 ? '+' : ''}${metric.change_pct}%`
  }
  return 'Không có kỳ trước'
}

function AccountAnalyticsSection({
  overview,
  charts,
  topics,
  loading,
  profile,
  startDate,
  endDate,
  activeTab,
  onStartDateChange,
  onEndDateChange,
  onTabChange,
  onRefresh,
}: {
  overview: AccountAnalyticsOverview | null
  charts: AccountAnalyticsCharts | null
  topics: AccountTopTopics | null
  loading: boolean
  profile: SocialProfile | null
  startDate: string
  endDate: string
  activeTab: AccountAnalyticsTab
  onStartDateChange: (value: string) => void
  onEndDateChange: (value: string) => void
  onTabChange: (value: AccountAnalyticsTab) => void
  onRefresh: () => void
}) {
  const metrics = overview?.metrics || {}
  const renderMetrics = activeTab === 'Tổng quan' || activeTab === 'Hiệu quả nội dung'
  const renderViewsChart = activeTab === 'Tổng quan' || activeTab === 'Thời gian đăng'
  const renderContentMix = activeTab === 'Tổng quan' || activeTab === 'Hiệu quả nội dung'
  const renderTopics = activeTab === 'Tổng quan' || activeTab === 'Chủ đề'
  const renderAudience = activeTab === 'Đối tượng'

  return (
    <section className="space-y-4 rounded-[8px] border border-[var(--outline-variant)] bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex gap-6 overflow-x-auto border-b border-[var(--outline-variant)]">
          {ACCOUNT_ANALYTICS_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => onTabChange(tab)}
              className={cn('relative h-11 whitespace-nowrap text-sm font-bold text-[#718096]', activeTab === tab && 'text-[#2556ea]')}
            >
              {tab}
              {activeTab === tab && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-[#2556ea]" />}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <DateInput label="Từ" value={startDate} onChange={onStartDateChange} className="w-full sm:w-[165px]" />
          <DateInput label="Đến" value={endDate} onChange={onEndDateChange} className="w-full sm:w-[165px]" />
          <AppButton variant="secondary" icon={<RefreshCw size={15} className={loading ? 'animate-spin' : ''} />} onClick={onRefresh} disabled={loading || !profile}>
            Tải lại
          </AppButton>
        </div>
      </div>

      {renderMetrics && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <AccountMetricTile icon={<Eye size={18} />} label="Tổng lượt xem" metric={metrics.views} tint="#2556ea" />
          <AccountMetricTile icon={<Heart size={18} />} label="Tổng lượt thích" metric={metrics.likes} tint="#db2777" />
          <AccountMetricTile icon={<MessageCircle size={18} />} label="Bình luận" metric={metrics.comments} tint="#f59e0b" />
          <AccountMetricTile icon={<Share2 size={18} />} label="Chia sẻ" metric={metrics.shares} tint="#16a34a" />
          <AccountMetricTile icon={<Bookmark size={18} />} label="Lượt lưu" metric={metrics.saves} tint="#7c3aed" />
          <AccountMetricTile icon={<Video size={18} />} label="Video" metric={metrics.videos_count} tint="#0f766e" />
        </div>
      )}

      <div className={cn('grid gap-4', activeTab === 'Tổng quan' ? 'xl:grid-cols-[minmax(0,1.5fr)_320px_360px]' : 'xl:grid-cols-1')}>
        {renderViewsChart && (
          <div className="flex flex-col gap-4 min-w-0">
            <AnalyticsChartCard title="Lượt xem tăng theo ngày" loading={loading}>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={charts?.views_by_day || []}>
                  <CartesianGrid stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(value) => String(value).slice(5)} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#dbe2ee', fontSize: 12 }} />
                  <Bar dataKey="views" name="Views tăng" fill="#2563eb" radius={[6, 6, 0, 0]} />
                  <Line dataKey="avg_views" name="TB views tăng/video" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </AnalyticsChartCard>

            <AnalyticsChartCard title="Số bài đăng theo ngày" loading={loading}>
              <ResponsiveContainer width="100%" height={160}>
                <ComposedChart data={charts?.posts_by_day || []}>
                  <CartesianGrid stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(value) => String(value).slice(5)} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#dbe2ee', fontSize: 12 }} />
                  <Bar dataKey="published_videos" name="Số bài đăng" fill="#14b8a6" radius={[4, 4, 0, 0]} maxBarSize={32} />
                </ComposedChart>
              </ResponsiveContainer>
            </AnalyticsChartCard>
          </div>
        )}

        {renderContentMix && <AnalyticsChartCard title="Hiệu suất theo loại" loading={loading}>
          <ResponsiveContainer width="100%" height={activeTab === 'Tổng quan' ? 200 : 320}>
            <PieChart>
              <Pie data={charts?.content_mix || []} dataKey="value" nameKey="name" innerRadius={48} outerRadius={76} paddingAngle={3}>
                {(charts?.content_mix || []).map((entry) => <Cell key={entry.name} fill={entry.color} />)}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#dbe2ee', fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="grid gap-2">
            {(charts?.content_mix || []).map((item) => (
              <div key={item.name} className="flex items-center justify-between text-xs font-semibold text-[#64748b]">
                <span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} /><span className="truncate">{item.name}</span></span>
                <span className="text-[#111827]">{plainNumberFormatter.format(item.value)}</span>
              </div>
            ))}
            {!loading && (charts?.content_mix || []).length === 0 && <div className="empty-state min-h-[80px]">Chưa có dữ liệu loại nội dung.</div>}
          </div>
        </AnalyticsChartCard>}

        {renderTopics && <AnalyticsChartCard title="Top chủ đề hiệu quả" loading={loading}>
          <div className="space-y-2">
            {!loading && (topics?.items || []).length === 0 && <div className="empty-state min-h-[120px]">Chưa có chủ đề đủ dữ liệu.</div>}
            {(topics?.items || []).map((topic, index) => (
              <div key={topic.topic} className="grid grid-cols-[28px_minmax(0,1fr)_72px_64px] items-center gap-2 rounded-[8px] border border-[var(--outline-variant)] bg-white p-2">
                <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-[#eef2ff] text-xs font-black text-[#4f46e5]">{index + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-extrabold text-[#111827]">#{topic.topic}</span>
                  <span className="text-xs font-semibold text-[#64748b]">{topic.posts} bài</span>
                </span>
                <span className="text-right text-xs font-extrabold text-[#111827]">{formatMetric(topic.views)}</span>
                <span className="text-right text-xs font-bold text-[#16a34a]">{topic.avg_engagement_pct}%</span>
              </div>
            ))}
          </div>
        </AnalyticsChartCard>}

        {renderAudience && (
          <AnalyticsChartCard title="Đối tượng" loading={loading}>
            <EmptyBlock label="Chưa có dữ liệu đối tượng." />
          </AnalyticsChartCard>
        )}
      </div>
    </section>
  )
}

function AccountMetricTile({ icon, label, metric, tint }: { icon: ReactNode; label: string; metric?: AnalyticsMetric; tint: string }) {
  return (
    <div className="rounded-[8px] border border-[var(--outline-variant)] bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="grid h-9 w-9 place-items-center rounded-[8px]" style={{ color: tint, backgroundColor: `${tint}16` }}>{icon}</div>
        <span className={cn('text-xs font-extrabold', (metric?.change_pct ?? metric?.change_count ?? 0) >= 0 ? 'text-[#16a34a]' : 'text-[#ef233c]')}>
          {formatAccountChange(metric)}
        </span>
      </div>
      <div className="mt-3 text-xs font-bold text-[#64748b]">{label}</div>
      <div className="mt-1 text-2xl font-extrabold text-[#111827]">{formatAccountMetric(metric)}</div>
    </div>
  )
}

function AnalyticsChartCard({ title, loading, children }: { title: string; loading: boolean; children: ReactNode }) {
  return (
    <div className="rounded-[8px] border border-[var(--outline-variant)] bg-slate-50/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-extrabold text-[#111827]">{title}</h3>
        {loading && <Loader2 size={16} className="animate-spin text-[#2556ea]" />}
      </div>
      {children}
    </div>
  )
}

function SelectedProfilePanel({
  profile,
  totalPosts,
  loading,
  syncing,
  onSync,
  onConfigure,
}: {
  profile: SocialProfile | null
  totalPosts: number
  loading: boolean
  syncing: boolean
  onSync: () => void
  onConfigure: () => void
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
          <button
            onClick={onConfigure}
            className="group relative flex h-10 w-full shrink-0 sm:w-auto items-center justify-center gap-2 overflow-hidden rounded-xl border border-slate-200 bg-white px-5 font-bold text-slate-700 shadow-sm transition-all hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none"
          >
            <SlidersHorizontal size={15} />
            <span className="relative">Cấu hình</span>
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
    <TableRow
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if(event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onSelect()
        }
      }}
      className={cn('cursor-pointer', active && 'app-row-selected')}
    >
      <TableCell className="px-4 py-3 min-w-[160px]"><div className="min-w-0 pr-3">
        <div className="line-clamp-1 text-sm font-bold text-[#111827]" title={post.title}>{post.title || 'Untitled post'}</div>
        <div className="mt-0.5 line-clamp-1 text-xs font-medium text-[#64748b]">{post.caption || post.platform_post_id || 'Không có caption'}</div>
      </div></TableCell>
      <TableCell className="px-4 py-3"><div className="text-xs font-semibold text-[#526179]">{formatDateTime(post.published_at)}</div></TableCell>
      <TableCell className="px-4 py-3"><MetricCell icon={<Eye size={13} />} value={metricValue(post, 'views')} /></TableCell>
      <TableCell className="px-4 py-3"><MetricCell icon={<Heart size={13} />} value={metricValue(post, 'likes')} /></TableCell>
      <TableCell className="px-4 py-3"><MetricCell icon={<MessageCircle size={13} />} value={metricValue(post, 'comments')} /></TableCell>
      <TableCell className="px-4 py-3"><MetricCell icon={<Share2 size={13} />} value={metricValue(post, 'shares')} /></TableCell>
      <TableCell className="px-4 py-3"><div className="flex justify-end">
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
      </div></TableCell>
    </TableRow>
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
