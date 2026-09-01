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
  Share2,
  Video,
} from 'lucide-react'
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
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
  fetchSocialProfilesApi,
  type AccountAnalyticsCharts,
  type AccountAnalyticsOverview,
  type AccountTopTopics,
  type SocialProfile,
} from '@/commons/apis/api'
import { AppButton, DateInput, PageLayout, platformLabel } from '@/commons/component/social-ui'
import { SocialProfileFilter } from '@/commons/component/SocialProfileFilter'
import { cn } from '@/commons/lib/utils'

const compactNumber = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 })
const plainNumber = new Intl.NumberFormat('vi-VN')

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

const formatMetric = (value?: number | null) => compactNumber.format(Math.max(Number(value || 0), 0))
const formatChange = (value?: number | null) => {
  if (value === null || value === undefined) return 'Không có kỳ trước'
  return `${value >= 0 ? '+' : ''}${value}%`
}

const tabs = ['Tổng quan', 'Hiệu quả nội dung', 'Chủ đề', 'Thời gian đăng', 'Đối tượng']

export default function AccountAnalyticsPage() {
  const [profiles, setProfiles] = useState<SocialProfile[]>([])
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [startDate, setStartDate] = useState(() => formatDateInput(addDays(new Date(), -6)))
  const [endDate, setEndDate] = useState(() => formatDateInput(new Date()))
  const [activeTab, setActiveTab] = useState('Tổng quan')
  const [overview, setOverview] = useState<AccountAnalyticsOverview | null>(null)
  const [charts, setCharts] = useState<AccountAnalyticsCharts | null>(null)
  const [topics, setTopics] = useState<AccountTopTopics | null>(null)
  const [loading, setLoading] = useState(true)

  const selectedProfile = useMemo(
    () => profiles.find((profile) => String(profile.id) === selectedProfileId) || null,
    [profiles, selectedProfileId],
  )

  const loadProfiles = async () => {
    const data = await fetchSocialProfilesApi()
    const nextProfiles = data.items || []
    setProfiles(nextProfiles)
    setSelectedProfileId((current) => {
      if (current && nextProfiles.some((profile) => String(profile.id) === current)) return current
      return nextProfiles[0] ? String(nextProfiles[0].id) : ''
    })
  }

  const loadAnalytics = async () => {
    if (!selectedProfileId) {
      setOverview(null)
      setCharts(null)
      setTopics(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const params = { profile_id: selectedProfileId, start_date: startDate, end_date: endDate }
      const [overviewData, chartsData, topicsData] = await Promise.all([
        fetchAccountAnalyticsOverviewApi(params),
        fetchAccountAnalyticsChartsApi(params),
        fetchAccountAnalyticsTopTopicsApi({ ...params, limit: 8 }),
      ])
      setOverview(overviewData)
      setCharts(chartsData)
      setTopics(topicsData)
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không tải được dữ liệu phân tích tài khoản')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProfiles().catch((error: any) => {
      setLoading(false)
      toast.error(error?.response?.data?.detail || 'Không tải được tài khoản social')
    }).finally(() => setLoadingProfiles(false))
  }, [])

  useEffect(() => {
    void loadAnalytics()
  }, [selectedProfileId, startDate, endDate])

  const metrics = overview?.metrics || {}

  return (
    <PageLayout
      title="Phân tích theo tài khoản"
      description="Tổng hợp tăng trưởng kênh, hiệu quả nội dung và chủ đề dựa trên snapshot TikTok."
      actions={
        <>
          <DateInput label="Từ" value={startDate} onChange={setStartDate} className="w-full sm:w-[165px]" />
          <DateInput label="Đến" value={endDate} onChange={setEndDate} className="w-full sm:w-[165px]" />
          <AppButton variant="secondary" icon={<RefreshCw size={15} className={loading ? 'animate-spin' : ''} />} onClick={() => void loadAnalytics()} disabled={loading || !selectedProfileId}>
            Tải lại
          </AppButton>
          <AppButton variant="secondary" icon={<Download size={15} />} disabled={!overview}>
            Xuất báo cáo
          </AppButton>
        </>
      }
    >

      <div className="flex gap-6 overflow-x-auto border-b border-[var(--outline-variant)]">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn('relative h-11 whitespace-nowrap text-sm font-bold text-[#718096]', activeTab === tab && 'text-[#2556ea]')}
          >
            {tab}
            {activeTab === tab && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-[#2556ea]" />}
          </button>
        ))}
      </div>

      <SocialProfileFilter profiles={profiles} value={selectedProfileId} onChange={setSelectedProfileId} loading={loadingProfiles} emptyLabel="Chưa có tài khoản social để phân tích." />

      {profiles.length > 0 && (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <MetricTile icon={<Eye size={18} />} label="Tổng lượt xem" metric={metrics.views} tint="#2556ea" />
            <MetricTile icon={<Heart size={18} />} label="Tổng lượt thích" metric={metrics.likes} tint="#db2777" />
            <MetricTile icon={<MessageCircle size={18} />} label="Tổng bình luận" metric={metrics.comments} tint="#f59e0b" />
            <MetricTile icon={<Share2 size={18} />} label="Tổng chia sẻ" metric={metrics.shares} tint="#16a34a" />
            <MetricTile icon={<Bookmark size={18} />} label="Tổng lượt lưu" metric={metrics.saves} tint="#7c3aed" />
            <MetricTile icon={<Video size={18} />} label="Video đã đăng" metric={metrics.videos_count} tint="#0f766e" />
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_320px_360px]">
            <ChartCard title="Lượt xem theo ngày" subtitle={selectedProfile ? platformLabel(selectedProfile.platform) : ''} loading={loading}>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={charts?.views_by_day || []}>
                  <CartesianGrid stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(value) => String(value).slice(5)} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#dbe2ee', fontSize: 12 }} />
                  <Legend />
                  <Bar dataKey="views" name="Views" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                  <Line dataKey="avg_views" name="Avg views" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Hiệu suất theo loại" subtitle="Dựa trên dữ liệu bài đã lưu" loading={loading}>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={charts?.content_mix || []} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={3}>
                    {(charts?.content_mix || []).map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#dbe2ee', fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="grid gap-2">
                {(charts?.content_mix || []).map((item) => (
                  <div key={item.name} className="flex items-center justify-between text-xs font-semibold text-[#64748b]">
                    <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />{item.name}</span>
                    <span className="text-[#111827]">{plainNumber.format(item.value)}</span>
                  </div>
                ))}
              </div>
            </ChartCard>

            <ChartCard title="Top chủ đề hiệu quả" subtitle="Theo hashtag hoặc tiêu đề" loading={loading}>
              <div className="space-y-2">
                {(topics?.items || []).length === 0 && <div className="empty-state">Chưa có chủ đề đủ dữ liệu.</div>}
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
            </ChartCard>
          </section>
        </>
      )}
    </PageLayout>
  )
}

function MetricTile({ icon, label, metric, tint }: { icon: ReactNode; label: string; metric?: { value: number | null; change_pct?: number | null; change_count?: number | null }; tint: string }) {
  return (
    <div className="rounded-[8px] border border-[var(--outline-variant)] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="grid h-9 w-9 place-items-center rounded-[8px]" style={{ color: tint, backgroundColor: `${tint}16` }}>{icon}</div>
        <span className={cn('text-xs font-extrabold', (metric?.change_pct ?? 0) >= 0 ? 'text-[#16a34a]' : 'text-[#ef233c]')}>
          {metric?.change_count !== undefined && metric.change_count !== null ? `${metric.change_count >= 0 ? '+' : ''}${metric.change_count}` : formatChange(metric?.change_pct)}
        </span>
      </div>
      <div className="mt-3 text-xs font-bold text-[#64748b]">{label}</div>
      <div className="mt-1 text-2xl font-extrabold text-[#111827]">{formatMetric(metric?.value)}</div>
    </div>
  )
}

function ChartCard({ title, subtitle, loading, children }: { title: string; subtitle?: string; loading: boolean; children: ReactNode }) {
  return (
    <div className="rounded-[8px] border border-[var(--outline-variant)] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-extrabold text-[#111827]">{title}</h3>
          {subtitle && <p className="text-xs font-semibold text-[#64748b]">{subtitle}</p>}
        </div>
        {loading && <Loader2 size={16} className="animate-spin text-[#2556ea]" />}
      </div>
      {children}
    </div>
  )
}
