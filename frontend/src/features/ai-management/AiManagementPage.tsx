import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { BrainCircuit, CalendarClock, Eye, Loader2, RefreshCw, Sparkles, Target, TriangleAlert } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import {
  fetchAiManagementReportApi,
  fetchSocialProfilesApi,
  runAiManagementAnalysisApi,
  updateAiManagementConfigApi,
  type AiAnalysisRun,
  type AiDecision,
  type AiManagementReport,
  type SocialProfile,
} from '@/commons/apis/api'
import { SocialProfileFilter } from '@/commons/component/SocialProfileFilter'
import { AppButton, EmptyBlock, PageLayout, SocialProfileAvatar, StatusPill } from '@/commons/component/social-ui'
import { cn } from '@/commons/lib/utils'

const numberFormatter = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 })

const formatNumber = (value: unknown) => numberFormatter.format(Math.max(Number(value) || 0, 0))

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Chưa chạy'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function AiManagementPage() {
  const [profiles, setProfiles] = useState<SocialProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [report, setReport] = useState<AiManagementReport | null>(null)
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [loadingReport, setLoadingReport] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)

  const selectedProfile = useMemo(
    () => profiles.find((profile) => String(profile.id) === selectedProfileId) || null,
    [profiles, selectedProfileId],
  )

  const latestRun = report?.latest_run || null
  const decision = latestRun?.decisions?.[0] || null
  const output = latestRun?.output || {}

  const loadProfiles = async () => {
    setLoadingProfiles(true)
    try {
      const data = await fetchSocialProfilesApi()
      const items = data.items || []
      setProfiles(items)
      setSelectedProfileId((current) => {
        if (current && items.some((profile) => String(profile.id) === current)) return current
        return items[0] ? String(items[0].id) : ''
      })
    } catch (error: any) {
      setProfiles([])
      toast.error(error?.response?.data?.detail || 'Không tải được danh sách social account')
    } finally {
      setLoadingProfiles(false)
    }
  }

  const loadReport = async (profileId = selectedProfileId) => {
    if (!profileId) {
      setReport(null)
      return
    }
    setLoadingReport(true)
    try {
      const data = await fetchAiManagementReportApi({ profile_id: profileId, limit: 8 })
      setReport(data)
    } catch (error: any) {
      setReport(null)
      toast.error(error?.response?.data?.detail || 'Không tải được báo cáo AI Management')
    } finally {
      setLoadingReport(false)
    }
  }

  useEffect(() => {
    void loadProfiles()
  }, [])

  useEffect(() => {
    void loadReport(selectedProfileId)
  }, [selectedProfileId])

  const updateEnabled = async (enabled: boolean) => {
    if (!selectedProfileId) return
    setSavingConfig(true)
    try {
      const config = await updateAiManagementConfigApi({
        profile_id: selectedProfileId,
        ai_management_enabled: enabled,
        ai_management_frequency_days: report?.config.ai_management_frequency_days || 7,
      })
      setReport((current) => current ? { ...current, config } : current)
      toast.success(enabled ? 'Đã bật AI Management' : 'Đã tắt AI Management')
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không lưu được cấu hình AI Management')
    } finally {
      setSavingConfig(false)
    }
  }

  const runAnalysis = async () => {
    if (!selectedProfileId) return
    setAnalyzing(true)
    try {
      await runAiManagementAnalysisApi({
        profile_id: selectedProfileId,
        days: report?.config.ai_management_frequency_days || 7,
      })
      toast.success('AI Management đã phân tích và lưu quyết định mới')
      await loadReport(selectedProfileId)
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không chạy được phân tích AI Management')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <PageLayout
      title="AI Management"
      description="Phân tích hiệu quả video, chọn tệp khách hàng, chủ đề nên đi sâu và khung giờ đăng hợp lý."
    >
      <SocialProfileFilter profiles={profiles} value={selectedProfileId} onChange={setSelectedProfileId} loading={loadingProfiles} emptyLabel="Chưa có tài khoản social để phân tích." />

      <section className="rounded-[8px] border border-[var(--outline-variant)] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <SocialProfileAvatar avatarUrl={selectedProfile?.avatar_url} name={selectedProfile?.profile_name || 'AI'} platform={selectedProfile?.platform || 'social'} size="xl" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-black text-slate-900">{selectedProfile?.profile_name || 'Chọn social account'}</h2>
                {selectedProfile && <StatusPill value={selectedProfile.status || 'active'} />}
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', report?.config.ai_management_enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                  {report?.config.ai_management_enabled ? 'AI Management ON' : 'AI Management OFF'}
                </span>
              </div>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                Chu kỳ {report?.config.ai_management_frequency_days || 7} ngày · Lần phân tích gần nhất: {formatDateTime(report?.config.ai_management_last_analysis_at)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <AppButton
              variant={report?.config.ai_management_enabled ? 'secondary' : 'primary'}
              icon={<BrainCircuit size={15} />}
              disabled={!selectedProfileId || savingConfig}
              onClick={() => void updateEnabled(!report?.config.ai_management_enabled)}
            >
              {savingConfig ? 'Đang lưu...' : report?.config.ai_management_enabled ? 'Tắt AI Management' : 'Bật AI Management'}
            </AppButton>
            <AppButton
              icon={analyzing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              disabled={!selectedProfileId || analyzing}
              onClick={() => void runAnalysis()}
            >
              {analyzing ? 'Đang phân tích...' : 'Phân tích ngay'}
            </AppButton>
            <AppButton
              variant="secondary"
              icon={<RefreshCw size={15} className={loadingReport ? 'animate-spin' : ''} />}
              disabled={!selectedProfileId || loadingReport}
              onClick={() => void loadReport(selectedProfileId)}
            >
              Tải lại
            </AppButton>
          </div>
        </div>
      </section>

      {!latestRun && !loadingReport ? (
        <section className="rounded-[8px] border border-[var(--outline-variant)] bg-white p-8 shadow-sm">
          <EmptyBlock label="Chưa có báo cáo AI Management. Bấm Phân tích ngay để tạo quyết định đầu tiên." />
        </section>
      ) : (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_380px]">
          <div className="space-y-4">
            <InsightSummary run={latestRun} decision={decision} loading={loadingReport} />
            <TopicsPanel topics={decision?.recommended_topics || output.top_topics || []} loading={loadingReport} />
            <TimeSlotsPanel slots={decision?.recommended_posting_times || output.best_posting_times || []} loading={loadingReport} />
          </div>
          <div className="space-y-4">
            <DecisionPanel decision={decision} loading={loadingReport} />
            <HistoryPanel history={report?.history || []} loading={loadingReport} />
          </div>
        </section>
      )}
    </PageLayout>
  )
}

function InsightSummary({ run, decision, loading }: { run: AiAnalysisRun | null; decision: AiDecision | null; loading: boolean }) {
  const output = run?.output || {}
  return (
    <section className="rounded-[8px] border border-[var(--outline-variant)] bg-white p-5 shadow-sm">
      <PanelTitle icon={<Sparkles size={18} />} title="Tổng quan quyết định" loading={loading} />
      <p className="mt-3 text-sm font-semibold leading-6 text-slate-700">
        {decision?.summary || run?.summary || 'Chưa có kết luận phân tích.'}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <MetricTile icon={<Eye size={17} />} label="Video phân tích" value={output.posts_analyzed ?? 0} />
        <MetricTile icon={<Eye size={17} />} label="Tổng views" value={output.total_views ?? 0} />
        <MetricTile icon={<Target size={17} />} label="Engagement TB" value={`${Number(output.avg_engagement_rate || 0).toFixed(1)}%`} />
        <MetricTile icon={<BrainCircuit size={17} />} label="Độ tin cậy" value={`${Math.round((decision?.confidence_score || 0) * 100)}%`} />
      </div>
    </section>
  )
}

function DecisionPanel({ decision, loading }: { decision: AiDecision | null; loading: boolean }) {
  return (
    <section className="rounded-[8px] border border-[var(--outline-variant)] bg-white p-5 shadow-sm">
      <PanelTitle icon={<Target size={18} />} title="Tệp khách hàng" loading={loading} />
      <p className="mt-3 text-sm font-semibold leading-6 text-slate-700">
        {decision?.target_audience || 'Chưa đủ dữ liệu để xác định tệp khách hàng.'}
      </p>
      <div className="mt-4 space-y-2">
        {(decision?.content_warnings || []).map((warning, index) => (
          <div key={index} className="flex gap-2 rounded-[8px] border border-amber-100 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" />
            <span>{warning.message || String(warning)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function TopicsPanel({ topics, loading }: { topics: Array<Record<string, any>>; loading: boolean }) {
  return (
    <section className="rounded-[8px] border border-[var(--outline-variant)] bg-white p-5 shadow-sm">
      <PanelTitle icon={<BrainCircuit size={18} />} title="Chủ đề nên đi sâu" loading={loading} />
      {topics.length === 0 ? <EmptyBlock label="Chưa có chủ đề đủ dữ liệu." /> : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {topics.slice(0, 6).map((topic, index) => (
            <div key={`${topic.topic}-${index}`} className="rounded-[8px] border border-slate-200 bg-slate-50/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="min-w-0 truncate text-sm font-black text-slate-900">#{topic.topic || topic.name || 'chung'}</h3>
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-black text-blue-700">{formatNumber(topic.score)}</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <MiniStat label="Views" value={formatNumber(topic.views)} />
                <MiniStat label="Bài" value={topic.posts || 0} />
                <MiniStat label="Tương tác" value={`${Number(topic.avg_engagement_rate || 0).toFixed(1)}%`} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function TimeSlotsPanel({ slots, loading }: { slots: Array<Record<string, any>>; loading: boolean }) {
  return (
    <section className="rounded-[8px] border border-[var(--outline-variant)] bg-white p-5 shadow-sm">
      <PanelTitle icon={<CalendarClock size={18} />} title="Khung giờ đăng đề xuất" loading={loading} />
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="h-[260px] min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={slots.slice(0, 8)}>
              <CartesianGrid stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="slot" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#dbe2ee', fontSize: 12 }} />
              <Bar dataKey="score" name="Điểm AI" fill="#2563eb" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-2">
          {slots.slice(0, 5).map((slot, index) => (
            <div key={`${slot.slot}-${index}`} className="flex items-center justify-between rounded-[8px] border border-slate-200 bg-slate-50 p-3 text-xs">
              <span className="font-black text-slate-900">{slot.slot}</span>
              <span className="font-bold text-slate-500">{formatNumber(slot.avg_views)} views TB</span>
            </div>
          ))}
          {slots.length === 0 && <EmptyBlock label="Chưa có khung giờ đủ dữ liệu." />}
        </div>
      </div>
    </section>
  )
}

function HistoryPanel({ history, loading }: { history: AiAnalysisRun[]; loading: boolean }) {
  return (
    <section className="rounded-[8px] border border-[var(--outline-variant)] bg-white p-5 shadow-sm">
      <PanelTitle icon={<RefreshCw size={18} />} title="Lịch sử phân tích" loading={loading} />
      <div className="mt-3 space-y-2">
        {history.map((run) => (
          <div key={run.id} className="rounded-[8px] border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-black uppercase text-blue-700">{run.trigger_type}</span>
              <span className="text-xs font-semibold text-slate-500">{formatDateTime(run.created_at)}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-600">{run.summary || 'Không có tóm tắt.'}</p>
          </div>
        ))}
        {history.length === 0 && <EmptyBlock label="Chưa có lịch sử phân tích." />}
      </div>
    </section>
  )
}

function PanelTitle({ icon, title, loading }: { icon: ReactNode; title: string; loading: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-black text-slate-900">
        <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-blue-50 text-blue-700">{icon}</span>
        {title}
      </h2>
      {loading && <Loader2 size={16} className="animate-spin text-blue-600" />}
    </div>
  )
}

function MetricTile({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center gap-2 text-xs font-bold text-slate-500">{icon}{label}</div>
      <div className="mt-2 text-xl font-black text-slate-900">{typeof value === 'number' ? formatNumber(value) : value}</div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-[8px] bg-white p-2">
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className="mt-1 truncate text-xs font-black text-slate-900">{value}</div>
    </div>
  )
}
