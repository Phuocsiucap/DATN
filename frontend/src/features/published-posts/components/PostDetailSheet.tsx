import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { BarChart3, ChevronLeft, ChevronRight, ExternalLink, Eye, Heart, Loader2, Maximize2, MessageCircle, Minimize2, Share2 } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { SocialPost } from '@/commons/apis/api'
import { fetchPostAnalyticsChartsApi, fetchPostAnalyticsOverviewApi, type PostAnalyticsCharts, type PostAnalyticsOverview } from '@/commons/apis/api'
import TikTokEmbedPlayer from '@/features/analytics/TikTokEmbedPlayer'
import { StatusPill } from '@/commons/component/social-ui'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/commons/component/ui/sheet'
import { cn } from '@/commons/lib/utils'

const numberFormatter = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 })
const formatMetric = (value: number) => numberFormatter.format(Math.max(value, 0))
const metricValue = (post: SocialPost, key: 'views' | 'likes' | 'comments' | 'shares') => {
  const value = post.latest_metric?.[key]
  return Number.isFinite(Number(value)) ? Number(value) : 0
}
const formatDateTime = (value?: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })
}
const dateKey = (value?: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}
const shortDateLabel = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
}

export function PostDetailSheet({
  post,
  selectedPostId,
  open,
  onOpenChange,
  onSelectPost,
}: {
  post: SocialPost | null
  selectedPostId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectPost: (postId: string) => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [analyticsOverview, setAnalyticsOverview] = useState<PostAnalyticsOverview | null>(null)
  const [analyticsCharts, setAnalyticsCharts] = useState<PostAnalyticsCharts | null>(null)
  const [loadingAnalytics, setLoadingAnalytics] = useState(false)
  const [chartMode, setChartMode] = useState<'daily' | 'cumulative'>('cumulative')

  // Reset expansion and data when sheet closes or when post changes
  useEffect(() => {
    setIsExpanded(false)
    setAnalyticsOverview(null)
    setAnalyticsCharts(null)
    setChartMode('cumulative')
  }, [open, post?.id])

  // Fetch analytics data only when sheet is expanded
  useEffect(() => {
    let isMounted = true
    if (isExpanded && post?.id && open && !analyticsOverview) {
      setLoadingAnalytics(true)
      Promise.all([
        fetchPostAnalyticsOverviewApi(post.id),
        fetchPostAnalyticsChartsApi(post.id)
      ])
        .then(([overview, charts]) => {
          if (isMounted) {
            setAnalyticsOverview(overview)
            setAnalyticsCharts(charts)
          }
        })
        .catch((err) => console.error('Failed to fetch post analytics:', err))
        .finally(() => {
          if (isMounted) setLoadingAnalytics(false)
        })
    }
    return () => { isMounted = false }
  }, [isExpanded, post?.id, open, analyticsOverview])

  const dailyViewGrowth = useMemo(() => {
    const timeline = analyticsCharts?.engagement_timeline || []
    const latestByDay = new Map<string, { date: string; views: number; capturedAt: number }>()
    for (const item of timeline) {
      const capturedAt = new Date(item.time).getTime()
      if (Number.isNaN(capturedAt)) continue
      const key = dateKey(item.time)
      if (!key) continue
      const current = latestByDay.get(key)
      if (!current || capturedAt >= current.capturedAt) {
        latestByDay.set(key, { date: key, views: Number(item.views || 0), capturedAt })
      }
    }

    let previousViews: number | null = null
    const publishedDay = dateKey(post?.published_at)
    return Array.from(latestByDay.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((item) => {
        const baseline = previousViews ?? (item.date === publishedDay ? 0 : item.views)
        const views = Math.max(item.views - baseline, 0)
        previousViews = item.views
        return {
          date: item.date,
          label: shortDateLabel(item.date),
          views,
          total_views: item.views,
        }
      })
  }, [analyticsCharts?.engagement_timeline, post?.published_at])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={cn("flex flex-col transition-all duration-300 !overflow-visible", isExpanded ? "!max-w-[80vw] w-[80vw]" : "")}>
        {post && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="absolute top-1/2 -left-4 z-50 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--outline-variant)] bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-50 hover:text-[#2556ea] focus:outline-none"
            title={isExpanded ? "Thu nhỏ" : "Mở rộng"}
          >
            {isExpanded ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        )}
        {post ? (
          <>
            <SheetHeader>
              <div className="flex items-start justify-between gap-3 pr-6">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <StatusPill value={post.status || 'published'} />
                    {post.platform_post_id && (
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-[var(--on-surface-variant)]">
                        ID {post.platform_post_id}
                      </span>
                    )}
                  </div>
                  <SheetTitle className="line-clamp-2" title={post.title || ''}>{post.title || 'Untitled post'}</SheetTitle>
                </div>
                
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsExpanded(!isExpanded)}
                    className={cn("icon-button border border-[var(--outline-variant)] bg-white transition-colors hover:bg-slate-50", isExpanded ? "text-[#2556ea] bg-blue-50 border-blue-200" : "text-slate-600")}
                    title={isExpanded ? "Thu nhỏ" : "Mở rộng và xem phân tích"}
                  >
                    {isExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                  </button>
                  {post.post_url && (
                    <a
                      href={post.post_url}
                      target="_blank"
                      rel="noreferrer"
                      className="icon-button border border-[var(--outline-variant)] bg-white text-[var(--accent-strong)] hover:bg-slate-50"
                      title="Mở bài đăng gốc"
                    >
                      <ExternalLink size={15} />
                    </a>
                  )}
                </div>
              </div>
            </SheetHeader>

            <SheetBody className="p-0 overflow-hidden">
              <div className={cn("flex h-full", isExpanded ? "flex-row divide-x divide-[var(--outline-variant)]" : "flex-col")}>
                
                {/* Details Side */}
                <div className={cn("space-y-4 p-5 overflow-y-auto", isExpanded ? "w-[460px] shrink-0" : "flex-1")}>
                  {/* Info section */}
                  <div className="space-y-2 text-xs text-[var(--on-surface-variant)]">
                    <InfoLine label="Ngày đăng" value={formatDateTime(post.published_at)} />
                    <InfoLine label="Cập nhật chỉ số" value={formatDateTime(post.latest_metric?.captured_at)} />
                  </div>

                  {/* Metrics grid */}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <MiniMetric label="Views" value={metricValue(post, 'views')} icon={<Eye size={14} />} />
                    <MiniMetric label="Likes" value={metricValue(post, 'likes')} icon={<Heart size={14} />} />
                    <MiniMetric label="Comments" value={metricValue(post, 'comments')} icon={<MessageCircle size={14} />} />
                    <MiniMetric label="Shares" value={metricValue(post, 'shares')} icon={<Share2 size={14} />} />
                  </div>

                  {/* Video embed */}
                  <div>
                    <TikTokEmbedPlayer postId={post.platform_post_id} postUrl={post.post_url} title={post.title} />
                  </div>

                  {/* Caption */}
                  {post.caption && (
                    <div className="rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-3">
                      <div className="mb-1 text-xs font-bold uppercase text-[var(--on-surface-variant)]">Caption</div>
                      <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--on-surface)]">{post.caption}</p>
                    </div>
                  )}
                </div>

                {/* Analytics Side */}
                {isExpanded && (
                  <div className="flex-1 space-y-4 p-6 overflow-y-auto bg-slate-50/40">
                    <div className="mb-6 flex items-center gap-2 text-lg font-black text-[#111827]">
                      <BarChart3 size={20} className="text-[#2556ea]" />
                      Phân tích bài đăng
                    </div>

                    {loadingAnalytics ? (
                      <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm font-semibold text-[var(--on-surface-variant)]">
                        <Loader2 size={28} className="animate-spin text-[#2556ea]" />
                        Đang tải dữ liệu phân tích...
                      </div>
                    ) : analyticsOverview && analyticsCharts ? (
                      <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                          <AnalyticsMetricTile label="Lượt xem" value={analyticsOverview.metrics.views?.value} icon={<Eye size={16} />} tint="#2556ea" />
                          <AnalyticsMetricTile label="Lượt thích" value={analyticsOverview.metrics.likes?.value} icon={<Heart size={16} />} tint="#db2777" />
                          <AnalyticsMetricTile label="Bình luận" value={analyticsOverview.metrics.comments?.value} icon={<MessageCircle size={16} />} tint="#f59e0b" />
                          <AnalyticsMetricTile label="Chia sẻ" value={analyticsOverview.metrics.shares?.value} icon={<Share2 size={16} />} tint="#16a34a" />
                        </div>

                        <div className="rounded-xl border border-[var(--outline-variant)] bg-white p-5 shadow-sm">
                          <div className="mb-1 text-sm font-bold text-[#64748b]">Tỷ lệ tương tác (Engagement Rate)</div>
                          <div className="text-3xl font-black text-[#16a34a]">
                            {analyticsOverview.metrics.engagement_rate?.value || 0}%
                          </div>
                        </div>

                        <div className="rounded-xl border border-[var(--outline-variant)] bg-white p-5 shadow-sm">
                          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                            <div className="text-base font-extrabold text-[#111827]">
                              {chartMode === 'daily' ? 'Lượt xem tăng theo ngày' : 'Tăng trưởng lượt xem theo thời gian'}
                            </div>
                            <div className="inline-flex rounded-lg border border-[var(--outline-variant)] bg-slate-50 p-1">
                              <button
                                type="button"
                                onClick={() => setChartMode('daily')}
                                className={cn(
                                  'rounded-md px-3 py-1.5 text-xs font-bold transition-colors',
                                  chartMode === 'daily' ? 'bg-white text-[#2556ea] shadow-sm' : 'text-slate-600 hover:text-slate-900'
                                )}
                              >
                                View theo ngày
                              </button>
                              <button
                                type="button"
                                onClick={() => setChartMode('cumulative')}
                                className={cn(
                                  'rounded-md px-3 py-1.5 text-xs font-bold transition-colors',
                                  chartMode === 'cumulative' ? 'bg-white text-[#2556ea] shadow-sm' : 'text-slate-600 hover:text-slate-900'
                                )}
                              >
                                Lũy kế
                              </button>
                            </div>
                          </div>
                          {analyticsCharts.engagement_timeline.length > 0 ? (
                            <div className="h-[300px]">
                              <ResponsiveContainer width="100%" height="100%">
                                {chartMode === 'daily' ? (
                                  <BarChart data={dailyViewGrowth}>
                                    <CartesianGrid stroke="#f1f5f9" vertical={false} />
                                    <XAxis
                                      dataKey="label"
                                      tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }}
                                      axisLine={{ stroke: '#e2e8f0' }}
                                      tickLine={false}
                                      dy={10}
                                    />
                                    <YAxis
                                      tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }}
                                      axisLine={false}
                                      tickLine={false}
                                      dx={-10}
                                    />
                                    <Tooltip
                                      contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12, fontWeight: 600, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                      formatter={(value, name) => [formatMetric(Number(value || 0)), name]}
                                      labelFormatter={(_, payload) => payload?.[0]?.payload?.date || ''}
                                    />
                                    <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 600 }} />
                                    <Bar dataKey="views" name="View tăng trong ngày" fill="#2556eb" radius={[5, 5, 0, 0]} maxBarSize={44} />
                                  </BarChart>
                                ) : (
                                  <LineChart data={analyticsCharts.engagement_timeline}>
                                    <CartesianGrid stroke="#f1f5f9" vertical={false} />
                                    <XAxis
                                      dataKey="hours_since_publish"
                                      tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }}
                                      axisLine={{ stroke: '#e2e8f0' }}
                                      tickLine={false}
                                      tickFormatter={(v) => `${v}h`}
                                      dy={10}
                                    />
                                    <YAxis 
                                      tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} 
                                      axisLine={false} 
                                      tickLine={false}
                                      dx={-10}
                                    />
                                    <Tooltip
                                      contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 12, fontWeight: 600, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                      labelFormatter={(v) => `Sau ${v} giờ`}
                                    />
                                    <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 600 }} />
                                    <Line 
                                      type="monotone" 
                                      dataKey="views" 
                                      name="Lượt xem" 
                                      stroke="#2556eb" 
                                      strokeWidth={3} 
                                      dot={false}
                                      activeDot={{ r: 6, strokeWidth: 0 }}
                                    />
                                    <Line 
                                      type="monotone" 
                                      dataKey="likes" 
                                      name="Lượt thích" 
                                      stroke="#db2777" 
                                      strokeWidth={2} 
                                      dot={false}
                                    />
                                    <Line 
                                      type="monotone" 
                                      dataKey="comments" 
                                      name="Bình luận" 
                                      stroke="#f59e0b" 
                                      strokeWidth={2} 
                                      dot={false}
                                    />
                                    <Line 
                                      type="monotone" 
                                      dataKey="shares" 
                                      name="Chia sẻ" 
                                      stroke="#16a34a" 
                                      strokeWidth={2} 
                                      dot={false}
                                    />
                                  </LineChart>
                                )}
                              </ResponsiveContainer>
                            </div>
                          ) : (
                            <div className="flex h-40 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm font-semibold text-[#64748b]">
                              Chưa có dữ liệu biểu đồ thời gian
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm font-semibold text-[var(--on-surface-variant)]">
                        Không thể tải dữ liệu phân tích.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </SheetBody>
          </>
        ) : (
          <SheetBody>
            <div className="flex h-full items-center justify-center text-sm font-semibold text-[var(--on-surface-variant)]">
              Chọn một bài để xem chi tiết.
            </div>
          </SheetBody>
        )}
      </SheetContent>
    </Sheet>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-semibold text-slate-600">{label}</span>
      <span className="truncate font-bold text-slate-900">{value}</span>
    </div>
  )
}

function MiniMetric({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-2">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">{icon}{label}</div>
      <div className="mt-1 text-base font-black text-slate-900">{formatMetric(value)}</div>
    </div>
  )
}

function AnalyticsMetricTile({ label, value, icon, tint }: { label: string; value?: number | null; icon: ReactNode; tint: string }) {
  return (
    <div className="rounded-xl border border-[var(--outline-variant)] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ color: tint, backgroundColor: `${tint}15` }}>
          {icon}
        </div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      </div>
      <div className="mt-3 text-2xl font-black text-slate-900">{formatMetric(Number(value || 0))}</div>
    </div>
  )
}
