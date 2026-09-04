import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  AudioLines,
  Bot,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  Film,
  Loader2,
  RefreshCw,
  Send,
  Server,
  Sparkles,
  XCircle,
  ChevronRight,
  Zap,
  ShieldCheck,
} from 'lucide-react'
import {
  fetchAdminDashboardErrorsApi,
  fetchAdminDashboardPipelineApi,
  fetchAdminDashboardServicesApi,
  fetchAdminDashboardSummaryApi,
  fetchSchedulerStatusApi,
  startSchedulerApi,
  stopSchedulerApi,
  type AdminDashboardErrorsResponse,
  type AdminDashboardPipelineResponse,
  type AdminDashboardService,
  type AdminDashboardServicesResponse,
  type AdminDashboardSummaryResponse,
  type AdminDashboardTask,
  type AdminSchedulerStatus,
} from '@/commons/apis/api'
import { PageLayout } from '@/commons/component/social-ui'
import { cn } from '@/commons/lib/utils'

const PIPELINE_REFRESH_MS = 10_000
const DATA_REFRESH_MS = 30_000
const SERVICES_REFRESH_MS = 60_000

const compactNumber = new Intl.NumberFormat('vi-VN', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const stageCards = [
  { key: 'crawl', step: '01', label: 'Crawl', hint: 'Thu thập & chuẩn hóa dữ liệu', icon: <Database size={18} />, color: '#2563eb', bg: 'from-blue-50/80 to-indigo-50/40', border: 'border-blue-100' },
  { key: 'draft', step: '02', label: 'Sinh draft', hint: 'Kịch bản, edit & kiểm duyệt tự động', icon: <Sparkles size={18} />, color: '#7c3aed', bg: 'from-purple-50/80 to-violet-50/40', border: 'border-purple-100' },
  { key: 'voice', step: '03', label: 'Sinh voice', hint: 'Tạo và căn chỉnh âm thanh', icon: <AudioLines size={18} />, color: '#0891b2', bg: 'from-cyan-50/80 to-teal-50/40', border: 'border-cyan-100' },
  { key: 'render', step: '04', label: 'Render video', hint: 'Xuất định dạng video MP4', icon: <Film size={18} />, color: '#ea580c', bg: 'from-orange-50/80 to-amber-50/40', border: 'border-orange-100' },
  { key: 'publishing', step: '05', label: 'Đang push', hint: 'Đẩy bài lên các nền tảng', icon: <Send size={18} />, color: '#16a34a', bg: 'from-emerald-50/80 to-green-50/40', border: 'border-emerald-100' },
] as const

export default function DashboardPage() {
  const summary = useDashboardSection(fetchAdminDashboardSummaryApi, DATA_REFRESH_MS)
  const pipeline = useDashboardSection(fetchAdminDashboardPipelineApi, PIPELINE_REFRESH_MS)
  const errors = useDashboardSection(fetchAdminDashboardErrorsApi, DATA_REFRESH_MS)
  const services = useDashboardSection(fetchAdminDashboardServicesApi, SERVICES_REFRESH_MS)
  const scheduler = useDashboardSection(fetchSchedulerStatusApi, DATA_REFRESH_MS)
  const [actionBusy, setActionBusy] = useState<'scheduler' | null>(null)

  const refreshDashboard = useCallback(async () => {
    await Promise.allSettled([
      summary.refresh(),
      pipeline.refresh(),
      errors.refresh(),
      services.refresh(),
      scheduler.refresh(),
    ])
  }, [errors, pipeline, scheduler, services, summary])

  const handleScheduler = async () => {
    setActionBusy('scheduler')
    try {
      if (scheduler.data?.status === 'running') await stopSchedulerApi()
      else await startSchedulerApi()
      await scheduler.refresh(false)
    } finally {
      setActionBusy(null)
    }
  }

  const refreshing = summary.refreshing || pipeline.refreshing || errors.refreshing || services.refreshing || scheduler.refreshing

  return (
    <PageLayout
      title="Trung tâm vận hành hệ thống"
      description="Giám sát realtime pipeline xử lý đa tầng, task công việc và hạ tầng dịch vụ."
      actions={
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200/80 bg-emerald-50/80 px-3 text-xs font-bold text-emerald-700 shadow-2xs backdrop-blur-xs">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Jobs 10s · Health 60s
          </span>
          <button
            type="button"
            onClick={() => void refreshDashboard()}
            disabled={refreshing}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 hover:text-slate-900 active:scale-95 disabled:opacity-50"
          >
            <RefreshCw size={13} className={cn('text-slate-500 transition-transform duration-700', refreshing && 'animate-spin text-blue-600')} />
            {refreshing ? 'Đang tải...' : 'Làm mới'}
          </button>
        </div>
      }
    >
      <AdminOperationsContent
        summary={summary}
        pipeline={pipeline}
        errors={errors}
        services={services}
        scheduler={scheduler}
        actionBusy={actionBusy}
        onToggleScheduler={handleScheduler}
      />
    </PageLayout>
  )
}

type DashboardSectionState<T> = {
  data: T | null
  loading: boolean
  refreshing: boolean
  error: string
  refresh: (showIndicator?: boolean) => Promise<void>
}

function useDashboardSection<T>(fetcher: () => Promise<T>, intervalMs: number): DashboardSectionState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(0)

  const refresh = useCallback(async (showIndicator = true) => {
    const currentRequest = ++requestId.current
    if (showIndicator) setRefreshing(true)
    try {
      const response = await fetcher()
      if (requestId.current !== currentRequest) return
      setData(response)
      setError('')
    } catch (requestError: unknown) {
      if (requestId.current === currentRequest) setError(apiErrorMessage(requestError))
    } finally {
      if (requestId.current === currentRequest) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [fetcher])

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void refresh(false), 0)
    const interval = window.setInterval(() => void refresh(false), intervalMs)
    return () => {
      requestId.current += 1
      window.clearTimeout(initialLoad)
      window.clearInterval(interval)
    }
  }, [intervalMs, refresh])

  return { data, loading, refreshing, error, refresh }
}

export function AdminOperationsContent({
  summary,
  pipeline,
  errors,
  services,
  scheduler,
  actionBusy,
  onToggleScheduler,
}: {
  summary: DashboardSectionState<AdminDashboardSummaryResponse>
  pipeline: DashboardSectionState<AdminDashboardPipelineResponse>
  errors: DashboardSectionState<AdminDashboardErrorsResponse>
  services: DashboardSectionState<AdminDashboardServicesResponse>
  scheduler: DashboardSectionState<AdminSchedulerStatus>
  actionBusy: 'scheduler' | null
  onToggleScheduler: () => Promise<void>
}) {
  const summaryData = summary.data
  const pipelineData = pipeline.data
  const errorData = errors.data
  const serviceData = services.data
  const serviceSummary = useMemo(() => summarizeServices(serviceData?.services ?? []), [serviceData])
  const updatedAt = formatDateTime(pipelineData?.generated_at)

  return (
    <div className="space-y-5">
      {/* KPI Overview Grid */}
      <section className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {summaryData ? (
          <>
            <SummaryCard
              label="Crawl jobs"
              value={summaryData.totals.crawl_jobs}
              detail={`${summaryData.totals.crawl_jobs_completed} đã hoàn tất`}
              icon={<Database size={19} />}
              gradient="from-blue-500 to-indigo-600"
            />
            <SummaryCard
              label="Tổng content"
              value={summaryData.totals.contents}
              detail="Trong kho dữ liệu hệ thống"
              icon={<FileText size={19} />}
              gradient="from-purple-500 to-violet-600"
            />
            <SummaryCard
              label="Video đã render"
              value={summaryData.totals.videos_rendered}
              detail="Workflow xuất MP4"
              icon={<Film size={19} />}
              gradient="from-orange-500 to-amber-600"
            />
            <SummaryCard
              label="Audio đã sinh"
              value={summaryData.totals.audio_generated}
              detail="Workflow có voice"
              icon={<AudioLines size={19} />}
              gradient="from-cyan-500 to-teal-600"
            />
          </>
        ) : summary.loading ? (
          Array.from({ length: 4 }, (_, index) => <SummaryCardSkeleton key={`summary-${index}`} />)
        ) : (
          <SectionLoadError title="Không tải được số liệu tổng quan" detail={summary.error} className="sm:col-span-2 lg:col-span-3 xl:col-span-4" />
        )}

        {pipelineData ? (
          <SummaryCard
            label="Task đang hoạt động"
            value={pipelineData.active.total}
            detail={summaryData ? `${summaryData.totals.tasks_completed}/${summaryData.totals.tasks} task đã xong` : 'Pipeline realtime'}
            icon={<Activity size={19} />}
            gradient="from-emerald-500 to-green-600"
            active={pipelineData.active.total > 0}
          />
        ) : pipeline.loading ? (
          <SummaryCardSkeleton />
        ) : (
          <SectionLoadError title="Không tải được task" detail={pipeline.error} />
        )}

        {errorData ? (
          <SummaryCard
            label="Lỗi trong 24h"
            value={errorData.errors.last_24h}
            detail={`${errorData.errors.tasks} task · ${errorData.errors.publishing} publish`}
            icon={<AlertTriangle size={19} />}
            gradient="from-rose-500 to-red-600"
            danger={errorData.errors.last_24h > 0}
          />
        ) : errors.loading ? (
          <SummaryCardSkeleton />
        ) : (
          <SectionLoadError title="Không tải được lỗi" detail={errors.error} />
        )}
      </section>

      {/* Pipeline Stages Flow */}
      {pipelineData ? (
        <section className="relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-xs">
                <Zap size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-extrabold text-slate-900">Pipeline đang hoạt động</h2>
                  {pipelineData.active.total > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      </span>
                      {pipelineData.active.total} đang chạy
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">IDLE</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs font-medium text-slate-500">Luồng xử lý từ thu thập, kịch bản, âm thanh đến xuất bản video</p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                <Clock3 size={13} />
                Cập nhật {updatedAt}
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {stageCards.map((stage, idx) => (
              <div key={stage.key} className="relative flex items-stretch">
                <PipelineCard
                  step={stage.step}
                  label={stage.label}
                  hint={stage.key === 'crawl' ? `${pipelineData.active.crawl_jobs} crawl job đang chạy` : stage.hint}
                  value={pipelineData.active[stage.key]}
                  icon={stage.icon}
                  color={stage.color}
                  bg={stage.bg}
                  border={stage.border}
                />
                {idx < stageCards.length - 1 && (
                  <div className="hidden lg:absolute lg:-right-3 lg:top-1/2 lg:z-10 lg:grid lg:-translate-y-1/2 lg:h-6 lg:w-6 lg:place-items-center lg:rounded-full lg:bg-white lg:text-slate-300 lg:shadow-2xs border border-slate-100">
                    <ChevronRight size={14} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {pipelineData.active.other > 0 && (
            <div className="mt-3.5 flex items-center gap-2 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/50 px-3.5 py-2.5 text-xs font-bold text-indigo-700">
              <Activity size={15} className="shrink-0 text-indigo-500" />
              <span>Có {pipelineData.active.other} công việc thuộc tác vụ nền khác đang được xử lý song song.</span>
            </div>
          )}
        </section>
      ) : pipeline.loading ? (
        <PipelineSkeleton />
      ) : (
        <SectionLoadError title="Không tải được pipeline" detail={pipeline.error} className="min-h-48" />
      )}

      {/* Main Operational Section: Tasks Table + System Health */}
      <section className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-7">
          {pipelineData ? (
            <RunningTasksTable tasks={pipelineData.running_tasks} />
          ) : pipeline.loading ? (
            <RunningTasksSkeleton />
          ) : (
            <SectionLoadError title="Không tải được danh sách task" detail={pipeline.error} className="min-h-96" />
          )}
        </div>
        <div className="xl:col-span-5">
          <ServiceHealthPanel
            services={serviceData?.services ?? []}
            summary={serviceSummary}
            loading={services.loading}
            error={services.error}
            schedulerStatus={scheduler.data?.status}
            schedulerLoading={scheduler.loading}
            schedulerError={scheduler.error}
            actionBusy={actionBusy}
            onToggleScheduler={onToggleScheduler}
          />
        </div>
      </section>

      {/* Error Breakdown & Status Grid */}
      <section className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
        {errorData ? (
          <>
            <ErrorBreakdown label="Task pipeline" value={errorData.errors.tasks} icon={<Activity size={15} />} />
            <ErrorBreakdown label="Crawl dữ liệu" value={errorData.errors.crawl} icon={<Database size={15} />} />
            <ErrorBreakdown label="Lỗi sinh tự động" value={errorData.errors.ai} icon={<Sparkles size={15} />} />
            <ErrorBreakdown label="Đẩy bài xuất bản" value={errorData.errors.publishing} icon={<Send size={15} />} />
          </>
        ) : errors.loading ? (
          Array.from({ length: 4 }, (_, index) => <ErrorCardSkeleton key={`error-${index}`} />)
        ) : (
          <SectionLoadError title="Không tải được thống kê lỗi" detail={errors.error} className="sm:col-span-2 lg:col-span-4" />
        )}

        {summaryData ? (
          <div className="group relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:border-emerald-300 hover:shadow-sm">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-slate-500 uppercase">
                <Send size={14} className="text-emerald-600" /> Bài đã đăng
              </span>
              <span className="grid h-6 w-6 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
                <CheckCircle2 size={14} />
              </span>
            </div>
            <div className="mt-2.5 text-2xl font-extrabold tabular-nums text-slate-900">
              {compactNumber.format(summaryData.totals.published_posts)}
            </div>
            <div className="mt-1 flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Thành công hoàn tất</span>
              <span className="font-bold text-emerald-600">Live</span>
            </div>
          </div>
        ) : summary.loading ? (
          <ErrorCardSkeleton />
        ) : (
          <SectionLoadError title="Không tải được bài đã đăng" detail={summary.error} />
        )}
      </section>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  detail,
  icon,
  gradient,
  active = false,
  danger = false,
}: {
  label: string
  value: number
  detail: string
  icon: ReactNode
  gradient: string
  active?: boolean
  danger?: boolean
}) {
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-2xl border bg-white p-4 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
        danger ? 'border-rose-200 hover:border-rose-300' : 'border-slate-200/90 hover:border-slate-300'
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            'grid h-10 w-10 place-items-center rounded-xl text-white shadow-xs transition-transform group-hover:scale-105',
            `bg-gradient-to-br ${gradient}`
          )}
        >
          {icon}
        </span>
        {active && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 border border-emerald-200/60">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            LIVE
          </span>
        )}
      </div>

      <div className="mt-3.5">
        <div className="text-xs font-bold tracking-wider text-slate-500 uppercase">{label}</div>
        <div className={cn('mt-1 text-2xl font-extrabold tabular-nums tracking-tight', danger ? 'text-rose-600' : 'text-slate-900')}>
          {compactNumber.format(value)}
        </div>
        <div className="mt-1 truncate text-xs font-medium text-slate-400" title={detail}>
          {detail}
        </div>
      </div>

      <div className={cn('absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r opacity-0 transition-opacity group-hover:opacity-100', gradient)} />
    </div>
  )
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-lg bg-slate-200/80', className)} />
}

function SummaryCardSkeleton() {
  return (
    <div data-testid="summary-card-skeleton" aria-label="Đang tải chỉ số" className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs">
      <div className="flex items-center justify-between">
        <SkeletonBlock className="h-10 w-10 rounded-xl" />
        <SkeletonBlock className="h-5 w-12 rounded-full" />
      </div>
      <SkeletonBlock className="mt-4 h-3 w-24" />
      <SkeletonBlock className="mt-2 h-7 w-16" />
      <SkeletonBlock className="mt-2 h-3 w-32 max-w-full" />
    </div>
  )
}

function PipelineSkeleton() {
  return (
    <section data-testid="pipeline-skeleton" aria-label="Đang tải pipeline" className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
      <div className="flex items-center gap-3">
        <SkeletonBlock className="h-9 w-9 rounded-xl" />
        <div className="space-y-2">
          <SkeletonBlock className="h-4 w-44" />
          <SkeletonBlock className="h-3 w-72 max-w-full" />
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="rounded-xl border border-slate-100 p-4">
            <div className="flex justify-between">
              <SkeletonBlock className="h-8 w-8" />
              <SkeletonBlock className="h-3 w-12" />
            </div>
            <SkeletonBlock className="mt-5 h-4 w-20" />
            <SkeletonBlock className="mt-2 h-3 w-full" />
          </div>
        ))}
      </div>
    </section>
  )
}

function RunningTasksSkeleton() {
  return (
    <div data-testid="tasks-skeleton" aria-label="Đang tải danh sách task" className="min-h-[420px] overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs">
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
        <SkeletonBlock className="h-8 w-8" />
        <div className="space-y-2">
          <SkeletonBlock className="h-4 w-36" />
          <SkeletonBlock className="h-3 w-56" />
        </div>
      </div>
      <div className="space-y-4 p-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="grid grid-cols-5 items-center gap-4">
            <div className="col-span-2 space-y-2"><SkeletonBlock className="h-3 w-4/5" /><SkeletonBlock className="h-3 w-2/5" /></div>
            <SkeletonBlock className="h-6 w-20 rounded-full" />
            <SkeletonBlock className="h-2 w-full rounded-full" />
            <SkeletonBlock className="h-3 w-4/5" />
          </div>
        ))}
      </div>
    </div>
  )
}

function ErrorCardSkeleton() {
  return (
    <div data-testid="error-card-skeleton" aria-label="Đang tải thống kê lỗi" className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs">
      <div className="flex justify-between"><SkeletonBlock className="h-3 w-24" /><SkeletonBlock className="h-2 w-2 rounded-full" /></div>
      <SkeletonBlock className="mt-4 h-7 w-12" />
      <SkeletonBlock className="mt-2 h-3 w-28" />
    </div>
  )
}

function SectionLoadError({ title, detail, className }: { title: string; detail: string; className?: string }) {
  return (
    <div role="alert" className={cn('grid place-items-center rounded-2xl border border-rose-200 bg-rose-50/70 p-5 text-center shadow-xs', className)}>
      <div>
        <AlertTriangle size={20} className="mx-auto text-rose-600" />
        <div className="mt-2 text-xs font-extrabold text-rose-800">{title}</div>
        <div className="mt-1 text-[11px] font-medium text-rose-600">{detail}</div>
      </div>
    </div>
  )
}

function PipelineCard({
  step,
  label,
  hint,
  value,
  icon,
  color,
  bg,
  border,
}: {
  step: string
  label: string
  hint: string;
  value: number
  icon: ReactNode
  color: string
  bg: string
  border: string
}) {
  const isActive = value > 0
  return (
    <div
      className={cn(
        'relative flex w-full flex-col justify-between overflow-hidden rounded-xl border p-4 transition-all duration-200 hover:shadow-xs',
        border,
        `bg-gradient-to-br ${bg}`
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-white shadow-2xs" style={{ color }}>
          {icon}
        </span>
        <span className="text-[11px] font-extrabold text-slate-300">STEP {step}</span>
      </div>

      <div className="mt-4 flex items-end justify-between gap-2">
        <div>
          <div className="text-sm font-extrabold text-slate-900">{label}</div>
          <div className="mt-0.5 line-clamp-1 text-[11px] font-medium text-slate-500">{hint}</div>
        </div>
        <div className="flex items-center gap-1.5">
          {isActive && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: color }} />
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
            </span>
          )}
          <div className="text-2xl font-black tabular-nums" style={{ color }}>
            {value}
          </div>
        </div>
      </div>
    </div>
  )
}

function RunningTasksTable({ tasks }: { tasks: AdminDashboardTask[] }) {
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 bg-slate-50/50">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-blue-50 text-blue-600">
            <Activity size={17} />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-slate-900">Task đang thực thi</h2>
            <p className="text-[11px] font-medium text-slate-500">30 task gần nhất đang chạy trên hệ thống</p>
          </div>
        </div>
        <span className="rounded-full bg-blue-100/70 px-2.5 py-1 text-xs font-extrabold text-blue-700">
          {tasks.length} active
        </span>
      </div>

      {tasks.length === 0 ? (
        <div className="grid min-h-[320px] flex-1 place-items-center p-6 text-center">
          <div className="max-w-xs">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 shadow-2xs">
              <ShieldCheck size={24} />
            </div>
            <h3 className="mt-3 text-sm font-extrabold text-slate-900">Không có task đang chạy</h3>
            <p className="mt-1 text-xs font-medium text-slate-500">Pipeline hệ thống đang ở trạng thái rảnh rỗi.</p>
          </div>
        </div>
      ) : (
        <div className="max-h-[440px] flex-1 overflow-auto">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50/90 backdrop-blur-xs border-b border-slate-100">
              <tr className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">Công việc</th>
                <th className="px-4 py-3">Trạng thái</th>
                <th className="px-4 py-3">Giai đoạn</th>
                <th className="px-4 py-3">Tiến độ</th>
                <th className="px-4 py-3">Worker / Thời gian</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {tasks.map((task) => (
                <TaskRow key={`${task.task_type}-${task.id}`} task={task} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function TaskRow({ task }: { task: AdminDashboardTask }) {
  const progress = Math.min(100, Math.max(0, Number(task.progress_percent || 0)))
  return (
    <tr className="align-middle transition hover:bg-slate-50/80">
      <td className="max-w-[240px] px-4 py-3">
        <div className="truncate font-extrabold text-slate-900">{task.label}</div>
        <div className="mt-0.5 truncate text-[11px] font-medium text-slate-400" title={task.reference_title || task.reference_id || task.id}>
          {task.reference_title || task.reference_id || task.id}
        </div>
      </td>
      <td className="px-4 py-3">
        <TaskStatus status={task.status} />
      </td>
      <td className="px-4 py-3 text-[11px] font-bold text-slate-600">
        <span className="rounded-md bg-slate-100 px-2 py-1">{formatStage(task.stage)}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <span className="w-8 text-right text-[11px] font-bold tabular-nums text-slate-600">{Math.round(progress)}%</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="font-bold text-slate-700">{task.worker || 'Chờ worker'}</div>
        <div className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-slate-400">
          <Clock3 size={11} />
          {formatRelativeTime(task.started_at || task.created_at)}
        </div>
      </td>
    </tr>
  )
}

function TaskStatus({ status }: { status: string }) {
  const normalized = status.toUpperCase()
  const running = ['RUNNING', 'PROCESSING'].includes(normalized)
  const retrying = normalized === 'RETRYING'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-extrabold',
        running
          ? 'bg-blue-50 text-blue-700 border border-blue-200/60'
          : retrying
          ? 'bg-rose-50 text-rose-700 border border-rose-200/60'
          : 'bg-amber-50 text-amber-700 border border-amber-200/60'
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', running ? 'animate-pulse bg-blue-500' : retrying ? 'bg-rose-500' : 'bg-amber-500')} />
      {normalized}
    </span>
  )
}

function ServiceHealthPanel({
  services,
  summary,
  loading,
  error,
  schedulerStatus,
  schedulerLoading,
  schedulerError,
  actionBusy,
  onToggleScheduler,
}: {
  services: AdminDashboardService[]
  summary: ReturnType<typeof summarizeServices>
  loading: boolean
  error: string
  schedulerStatus?: string
  schedulerLoading: boolean
  schedulerError: string
  actionBusy: 'scheduler' | null
  onToggleScheduler: () => Promise<void>
}) {
  const isSchedulerRunning = schedulerStatus === 'running'

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs">
      <div className="border-b border-slate-100 px-5 py-4 bg-slate-50/50">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-purple-50 text-purple-600">
              <Server size={17} />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-slate-900">Sức khỏe hạ tầng</h2>
              <p className="text-[11px] font-medium text-slate-500">Trạng thái kết nối microservice & database</p>
            </div>
          </div>
          {loading && services.length === 0 ? (
            <SkeletonBlock className="h-6 w-20 rounded-full" />
          ) : (
            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-extrabold border', summary.tone)}>
              {summary.label}
            </span>
          )}
        </div>
        <div className="mt-3.5">
          {loading && services.length === 0 ? (
            <div data-testid="services-summary-skeleton" aria-label="Đang tải sức khỏe hạ tầng" className="space-y-2">
              <div className="flex justify-between"><SkeletonBlock className="h-3 w-40" /><SkeletonBlock className="h-3 w-10" /></div>
              <SkeletonBlock className="h-2 w-full rounded-full" />
            </div>
          ) : (
            <>
              <div className="mb-1.5 flex justify-between text-xs font-bold text-slate-600">
                <span>Chỉ số hoạt động ({summary.online}/{services.length} online)</span>
                <span>{summary.percent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className={cn('h-full rounded-full transition-all duration-500', summary.bar)} style={{ width: `${summary.percent}%` }} />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="max-h-[350px] flex-1 divide-y divide-slate-100 overflow-y-auto">
        {loading && services.length === 0 ? (
          <div data-testid="services-list-skeleton" className="space-y-4 p-4">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex items-center gap-3">
                <SkeletonBlock className="h-8 w-8 shrink-0" />
                <div className="flex-1 space-y-2"><SkeletonBlock className="h-3 w-1/2" /><SkeletonBlock className="h-3 w-4/5" /></div>
                <SkeletonBlock className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        ) : error && services.length === 0 ? (
          <div className="p-4"><SectionLoadError title="Không tải được trạng thái services" detail={error} className="min-h-64" /></div>
        ) : (
          services.map((service) => <ServiceRow key={service.key} service={service} />)
        )}
      </div>

      <div className="border-t border-slate-100 bg-slate-50/80 p-3.5">
        {schedulerLoading && !schedulerStatus ? (
          <div data-testid="scheduler-skeleton" aria-label="Đang tải scheduler">
            <SkeletonBlock className="h-9 w-full rounded-xl" />
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void onToggleScheduler()}
              disabled={actionBusy !== null || !schedulerStatus}
              className={cn(
                'flex h-9 w-full items-center justify-center gap-2 rounded-xl text-xs font-extrabold transition shadow-2xs active:scale-[0.99] disabled:opacity-50',
                isSchedulerRunning
                  ? 'border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700'
              )}
            >
              {actionBusy === 'scheduler' ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}
              {isSchedulerRunning ? 'Tạm dừng Publish Scheduler' : 'Khởi động Publish Scheduler'}
            </button>
            {schedulerError && !schedulerStatus && (
              <div className="mt-2 text-center text-[11px] font-semibold text-rose-600">{schedulerError}</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ServiceRow({ service }: { service: AdminDashboardService }) {
  const status =
    service.status === 'online'
      ? { label: 'ONLINE', dot: 'bg-emerald-500', text: 'text-emerald-700 bg-emerald-50 border-emerald-200/60', icon: <CheckCircle2 size={13} /> }
      : service.status === 'degraded'
      ? { label: 'DEGRADED', dot: 'bg-amber-500', text: 'text-amber-700 bg-amber-50 border-amber-200/60', icon: <AlertTriangle size={13} /> }
      : { label: 'OFFLINE', dot: 'bg-rose-500', text: 'text-rose-700 bg-rose-50 border-rose-200/60', icon: <XCircle size={13} /> }

  return (
    <div className="flex items-start gap-3 px-4 py-3 transition hover:bg-slate-50/60">
      <span className="relative mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
        {service.kind === 'database' ? <Database size={15} /> : service.kind === 'message-broker' ? <Activity size={15} /> : <Server size={15} />}
        <span className={cn('absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white', status.dot, service.status === 'online' && 'animate-pulse')} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-extrabold text-slate-900">{service.name}</span>
          <span className={cn('flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold border', status.text)}>
            {status.icon}
            {status.label}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-xs font-medium text-slate-500">
          <span className="truncate text-[11px]" title={service.detail}>
            {service.detail}
          </span>
          {service.latency_ms !== null && service.latency_ms !== undefined && (
            <span className="shrink-0 text-[11px] font-bold tabular-nums text-slate-400">{service.latency_ms} ms</span>
          )}
        </div>
      </div>
    </div>
  )
}

function ErrorBreakdown({ label, value, icon }: { label: string; value: number; icon?: ReactNode }) {
  return (
    <div className={cn('group relative overflow-hidden rounded-2xl border bg-white p-4 shadow-xs transition hover:shadow-sm', value > 0 ? 'border-rose-200' : 'border-slate-200/90')}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-slate-500 uppercase">
          {icon}
          {label}
        </span>
        <span className={cn('h-2 w-2 rounded-full', value > 0 ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500')} />
      </div>
      <div className={cn('mt-2.5 text-2xl font-extrabold tabular-nums', value > 0 ? 'text-rose-600' : 'text-slate-900')}>{value}</div>
      <div className="mt-1 text-xs font-medium text-slate-400">24 giờ gần nhất</div>
    </div>
  )
}

function summarizeServices(services: AdminDashboardService[]) {
  const online = services.filter((service) => service.status === 'online').length
  const offline = services.filter((service) => service.status === 'offline').length
  const degraded = services.filter((service) => service.status === 'degraded').length
  const percent = services.length ? Math.round((online / services.length) * 100) : 0
  if (offline > 0) return { online, percent, label: 'CRITICAL', tone: 'bg-rose-50 text-rose-700 border-rose-200', bar: 'bg-rose-500' }
  if (degraded > 0) return { online, percent, label: 'WARNING', tone: 'bg-amber-50 text-amber-700 border-amber-200', bar: 'bg-amber-500' }
  return { online, percent, label: 'HEALTHY', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500' }
}

function formatStage(stage?: string | null) {
  return stage ? stage.replaceAll('_', ' ') : 'Đang chờ'
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatRelativeTime(value?: string | null) {
  if (!value) return 'Chưa bắt đầu'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Không rõ'
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return `${seconds}s trước`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} phút trước`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} giờ trước`
  return date.toLocaleDateString('vi-VN')
}

function apiErrorMessage(error: unknown) {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' && detail ? detail : 'Không tải được dữ liệu vận hành hệ thống'
}
