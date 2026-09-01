import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Bookmark,
  Download,
  Eye,
  Heart,
  Loader2,
  MessageCircle,
  RefreshCw,
  Share,
  Share2,
  Timer,
  TrendingUp,
  Video,
} from 'lucide-react'
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  fetchPostAnalyticsChartsApi,
  fetchPostAnalyticsOverviewApi,
  fetchSocialPostsApi,
  fetchSocialProfilesApi,
  type PostAnalyticsCharts,
  type PostAnalyticsOverview,
  type SocialPost,
  type SocialProfile,
} from '@/commons/apis/api'
import { AppButton, EmptyBlock, PageHeader, SelectControl, SocialProfileAvatar, StatusPill, platformLabel } from '@/commons/component/social-ui'
import { cn } from '@/commons/lib/utils'
import TikTokEmbedPlayer from './TikTokEmbedPlayer'

const compactNumber = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 })

const metricText = (value?: number | null, suffix = '') => {
  if (value === null || value === undefined) return '-'
  return `${typeof value === 'number' ? compactNumber.format(value) : value}${suffix}`
}

const formatDateTime = (value?: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })
}

const tabs = ['Tổng quan', 'Tương tác', 'Đối tượng', 'Giữ chân', 'Nguồn truy cập', 'Thời gian thực', 'Bình luận']

export default function PostAnalyticsPage() {
  const [profiles, setProfiles] = useState<SocialProfile[]>([])
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [selectedPostId, setSelectedPostId] = useState('')
  const [overview, setOverview] = useState<PostAnalyticsOverview | null>(null)
  const [charts, setCharts] = useState<PostAnalyticsCharts | null>(null)
  const [activeTab, setActiveTab] = useState('Tổng quan')
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [loadingPosts, setLoadingPosts] = useState(false)
  const [loadingAnalytics, setLoadingAnalytics] = useState(false)

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
      toast.error(error?.response?.data?.detail || 'Không tải được tài khoản social')
    } finally {
      setLoadingProfiles(false)
    }
  }

  const loadPosts = async () => {
    if (!selectedProfileId) {
      setPosts([])
      setSelectedPostId('')
      return
    }
    setLoadingPosts(true)
    try {
      const data = await fetchSocialPostsApi(selectedProfileId)
      const nextPosts = data.items || []
      setPosts(nextPosts)
      setSelectedPostId((current) => {
        if (current && nextPosts.some((post) => String(post.id) === current)) return current
        return nextPosts[0] ? String(nextPosts[0].id) : ''
      })
    } catch (error: any) {
      setPosts([])
      toast.error(error?.response?.data?.detail || 'Không tải được bài đã đăng')
    } finally {
      setLoadingPosts(false)
    }
  }

  const loadAnalytics = async () => {
    if (!selectedPostId) {
      setOverview(null)
      setCharts(null)
      return
    }
    setLoadingAnalytics(true)
    try {
      const [overviewData, chartsData] = await Promise.all([
        fetchPostAnalyticsOverviewApi(selectedPostId),
        fetchPostAnalyticsChartsApi(selectedPostId),
      ])
      setOverview(overviewData)
      setCharts(chartsData)
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không tải được phân tích bài đăng')
    } finally {
      setLoadingAnalytics(false)
    }
  }

  useEffect(() => {
    void loadProfiles()
  }, [])

  useEffect(() => {
    void loadPosts()
  }, [selectedProfileId])

  useEffect(() => {
    void loadAnalytics()
  }, [selectedPostId])

  const post = overview?.post || null
  const metrics = overview?.metrics || {}
  const timeline = charts?.engagement_timeline || []
  const hasRetention = Boolean(charts?.data_availability?.retention_curve && charts.retention_curve.length)
  const hasTraffic = Boolean(charts?.data_availability?.traffic_sources && charts.traffic_sources.length)

  return (
    <div className="app-page">
      <PageHeader
        title="Phân tích theo bài đăng"
        description="Theo dõi hiệu suất từng video đã xuất bản, tăng trưởng tương tác và nguồn dữ liệu TikTok."
        actions={
          <>
            <SelectControl value={selectedProfileId} onChange={setSelectedProfileId} className="w-full sm:w-[260px]">
              {profiles.length === 0 && <option value="">Chưa có tài khoản</option>}
              {profiles.map((profile) => <option key={profile.id} value={String(profile.id)}>{profile.profile_name}</option>)}
            </SelectControl>
            <SelectControl value={selectedPostId} onChange={setSelectedPostId} className="w-full sm:w-[320px]">
              {posts.length === 0 && <option value="">Chưa có bài đăng</option>}
              {posts.map((item) => <option key={item.id} value={String(item.id)}>{item.title || item.platform_post_id || item.id}</option>)}
            </SelectControl>
            <AppButton variant="secondary" icon={<RefreshCw size={15} className={(loadingPosts || loadingAnalytics) ? 'animate-spin' : ''} />} onClick={() => void loadPosts()} disabled={loadingProfiles || loadingPosts}>
              Tải lại
            </AppButton>
          </>
        }
      />

      <div className="flex gap-6 overflow-x-auto border-b border-[var(--outline-variant)]">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn('relative h-11 whitespace-nowrap text-[13px] font-bold text-[#718096]', activeTab === tab && 'text-[#2556ea]')}
          >
            {tab}
            {activeTab === tab && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-[#2556ea]" />}
          </button>
        ))}
      </div>

      {loadingProfiles || loadingAnalytics ? (
        <div className="loading-state">
          <Loader2 size={16} className="animate-spin" />
          Đang tải phân tích...
        </div>
      ) : !post ? (
        <EmptyBlock label="Chọn một bài đã đăng để xem phân tích chi tiết." />
      ) : (
        <>
          <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
            <TikTokEmbedPlayer postId={post.platform_post_id} postUrl={post.post_url} title={post.title} />

            <div className="rounded-[8px] border border-[var(--outline-variant)] bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <StatusPill value={post.status || 'published'} />
                    <span className="rounded-[6px] bg-slate-100 px-2 py-1 text-[10px] font-bold text-[#64748b]">{platformLabel(post.profile?.platform || selectedProfile?.platform)}</span>
                    {post.platform_post_id && <span className="rounded-[6px] bg-slate-100 px-2 py-1 text-[10px] font-bold text-[#64748b]">ID {post.platform_post_id}</span>}
                  </div>
                  <h2 className="text-xl font-extrabold leading-tight text-[#111827]">{post.title || 'Untitled post'}</h2>
                  {post.caption && <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-[#64748b]">{post.caption}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <AppButton variant="secondary" icon={<Download size={15} />}>Tải video gốc</AppButton>
                  <AppButton variant="secondary" icon={<Share size={15} />}>Chia sẻ báo cáo</AppButton>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-4 border-y border-[var(--outline-variant)] py-4">
                <SocialProfileAvatar avatarUrl={post.profile?.avatar_url || selectedProfile?.avatar_url} name={post.profile?.profile_name || selectedProfile?.profile_name} platform={post.profile?.platform || selectedProfile?.platform} size="lg" />
                <InfoBlock label="Kênh đăng" value={post.profile?.profile_name || selectedProfile?.profile_name || '-'} />
                <InfoBlock label="Thời gian đăng" value={formatDateTime(post.published_at)} />
                <InfoBlock label="Loại" value="Video ngắn" />
                <InfoBlock label="TikTok publish_id" value={post.platform_publish_id || '-'} />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricTile icon={<Eye size={17} />} label="Lượt xem" value={metrics.views?.value} tint="#2556ea" />
                <MetricTile icon={<Heart size={17} />} label="Lượt thích" value={metrics.likes?.value} tint="#db2777" />
                <MetricTile icon={<MessageCircle size={17} />} label="Bình luận" value={metrics.comments?.value} tint="#f59e0b" />
                <MetricTile icon={<Share2 size={17} />} label="Chia sẻ" value={metrics.shares?.value} tint="#16a34a" />
                <MetricTile icon={<Bookmark size={17} />} label="Lượt lưu" value={metrics.saves?.value} tint="#7c3aed" />
                <MetricTile icon={<TrendingUp size={17} />} label="Tỷ lệ tương tác" value={metrics.engagement_rate?.value} suffix="%" tint="#0f766e" />
                <MetricTile icon={<Timer size={17} />} label="Watch time TB" value={metrics.avg_watch_seconds?.value} suffix="s" tint="#ea580c" />
                <MetricTile icon={<Video size={17} />} label="Tỷ lệ xem hết" value={metrics.completion_rate?.value} suffix="%" tint="#4f46e5" />
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <ChartCard title="Tương tác theo thời gian" loading={loadingAnalytics}>
              {timeline.length === 0 ? (
                <div className="empty-state">Chưa có timeline metric. Scheduler sẽ ghi dữ liệu mỗi giờ khi TikTok trả chỉ số.</div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={timeline}>
                    <CartesianGrid stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="hours_since_publish" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#dbe2ee', fontSize: 12 }} />
                    <Legend />
                    <Line type="monotone" dataKey="views" stroke="#2556ea" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="likes" stroke="#db2777" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="comments" stroke="#f59e0b" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="shares" stroke="#16a34a" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <div className="grid gap-4">
              <ChartCard title="Giữ chân người xem" loading={loadingAnalytics}>
                {hasRetention ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={charts?.retention_curve || []}>
                      <XAxis dataKey="second" tick={{ fontSize: 10, fill: '#64748b' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="retention_pct" stroke="#7c3aed" strokeWidth={2.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="empty-state">TikTok API hiện chưa trả dữ liệu retention cho bài này.</div>
                )}
              </ChartCard>

              <ChartCard title="Nguồn truy cập" loading={loadingAnalytics}>
                {hasTraffic ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={charts?.traffic_sources || []} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78}>
                        {(charts?.traffic_sources || []).map((entry) => <Cell key={entry.name} fill={entry.color || '#2556ea'} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="empty-state">Chưa có dữ liệu phân nguồn truy cập từ TikTok.</div>
                )}
              </ChartCard>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[140px]">
      <div className="text-[10px] font-bold uppercase text-[#64748b]">{label}</div>
      <div className="mt-1 truncate text-sm font-extrabold text-[#111827]">{value}</div>
    </div>
  )
}

function MetricTile({ icon, label, value, suffix = '', tint }: { icon: ReactNode; label: string; value?: number | null; suffix?: string; tint: string }) {
  return (
    <div className="rounded-[8px] border border-[var(--outline-variant)] bg-[#fbfcff] p-3">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase text-[#64748b]">
        <span className="grid h-7 w-7 place-items-center rounded-[8px]" style={{ color: tint, backgroundColor: `${tint}16` }}>{icon}</span>
        {label}
      </div>
      <div className="mt-2 text-lg font-extrabold text-[#111827]">{metricText(value, suffix)}</div>
    </div>
  )
}

function ChartCard({ title, loading, children }: { title: string; loading: boolean; children: ReactNode }) {
  return (
    <div className="rounded-[8px] border border-[var(--outline-variant)] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-extrabold text-[#111827]">{title}</h3>
        {loading && <Loader2 size={16} className="animate-spin text-[#2556ea]" />}
      </div>
      {children}
    </div>
  )
}
