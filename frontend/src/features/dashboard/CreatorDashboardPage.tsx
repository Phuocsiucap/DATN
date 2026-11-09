import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CircleUserRound,
  Clapperboard,
  Clock3,
  FileCheck2,
  Layers3,
  PlayCircle,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react'

import {
  fetchCreatorDashboardOverviewApi,
  fetchCreatorDashboardProjectsApi,
  fetchCreatorDashboardPublishingApi,
  type CreatorDashboardOverview,
  type CreatorDashboardProject,
  type CreatorDashboardProjects,
  type CreatorDashboardPublishing,
} from '@/commons/apis/api'
import type { Tab } from '@/commons/component/navigation'
import { PageLayout } from '@/commons/component/social-ui'
import { cn } from '@/commons/lib/utils'


const CREATOR_REFRESH_MS = 30_000

type CreatorDashboardPageProps = {
  onNavigate: (tab: Tab) => void
  onOpenProject: (workflowId: string) => void
}

type SectionState<T> = {
  data: T | null
  loading: boolean
  refreshing: boolean
  error: string
  refresh: () => Promise<void>
}

export default function CreatorDashboardPage({ onNavigate, onOpenProject }: CreatorDashboardPageProps) {
  const overview = useCreatorSection(fetchCreatorDashboardOverviewApi)
  const projects = useCreatorSection(fetchCreatorDashboardProjectsApi)
  const publishing = useCreatorSection(fetchCreatorDashboardPublishingApi)

  const refreshAll = useCallback(async () => {
    await Promise.allSettled([overview.refresh(), projects.refresh(), publishing.refresh()])
  }, [overview, projects, publishing])

  const refreshing = overview.refreshing || projects.refreshing || publishing.refreshing

  return (
    <PageLayout
      title="Tổng quan"
      description="Công việc đang mở trên các kênh nội dung của bạn."
      actions={
        <button
          type="button"
          onClick={() => void refreshAll()}
          disabled={refreshing}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--outline-variant)] bg-white px-3 text-sm font-medium text-[var(--on-surface)] transition hover:bg-[var(--surface-container-low)] disabled:opacity-50"
        >
          <RefreshCw size={13} className={cn(refreshing && 'animate-spin')} />
          {refreshing ? 'Đang cập nhật' : 'Cập nhật'}
        </button>
      }
    >
      {overview.data ? (
        <CreatorHero data={overview.data} onNavigate={onNavigate} />
      ) : overview.loading ? (
        <CreatorHeroSkeleton />
      ) : (
        <CreatorSectionError title="Không tải được tổng quan của bạn" detail={overview.error} />
      )}

      {overview.data ? (
        <CreatorActions data={overview.data} onNavigate={onNavigate} />
      ) : overview.loading ? (
        <CreatorActionsSkeleton />
      ) : null}

      <section className="shrink-0 grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-7">
          {projects.data ? (
            <RecentProjects data={projects.data} onOpenProject={onOpenProject} onNavigate={onNavigate} />
          ) : projects.loading ? (
            <CreatorPanelSkeleton rows={5} testId="creator-projects-skeleton" />
          ) : (
            <CreatorSectionError title="Không tải được dự án gần đây" detail={projects.error} className="min-h-96" />
          )}
        </div>

        <div className="xl:col-span-5">
          {publishing.data ? (
            <PublishingJourney data={publishing.data} onNavigate={onNavigate} />
          ) : publishing.loading ? (
            <CreatorPanelSkeleton rows={6} testId="creator-publishing-skeleton" />
          ) : (
            <CreatorSectionError title="Không tải được lịch xuất bản" detail={publishing.error} className="min-h-96" />
          )}
        </div>
      </section>
    </PageLayout>
  )
}

function useCreatorSection<T>(fetcher: () => Promise<T>): SectionState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      setData(await fetcher())
      setError('')
    } catch (requestError: unknown) {
      setError(apiErrorMessage(requestError))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [fetcher])

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const response = await fetcher()
        if (active) {
          setData(response)
          setError('')
        }
      } catch (requestError: unknown) {
        if (active) setError(apiErrorMessage(requestError))
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    const interval = window.setInterval(() => void load(), CREATOR_REFRESH_MS)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [fetcher])

  return { data, loading, refreshing, error, refresh }
}

export function CreatorHero({ data, onNavigate }: { data: CreatorDashboardOverview; onNavigate: (tab: Tab) => void }) {
  return (
    <section className="shrink-0 overflow-hidden rounded-xl border border-[var(--outline-variant)] bg-white">
      <div className="flex flex-col justify-between gap-5 p-5 md:flex-row md:items-center md:p-6">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold text-[var(--on-surface-variant)]">BẮT ĐẦU TỪ ĐÂY</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-[var(--on-surface)]">Tiếp tục công việc đang mở</h2>
          <p className="mt-1.5 text-sm leading-6 text-[var(--on-surface-variant)]">
            Xem kế hoạch nội dung hoặc quay lại xưởng video để hoàn thành dự án.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" onClick={() => onNavigate('planning')} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)]">
            <Sparkles size={16} /> Kế hoạch nội dung
          </button>
          <button type="button" onClick={() => onNavigate('generateVideo')} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--outline-variant)] bg-white px-4 text-sm font-medium text-[var(--on-surface)] transition hover:bg-[var(--surface-container-low)]">
            <Clapperboard size={16} /> Xưởng video
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 border-t border-[var(--outline-variant)] sm:grid-cols-4">
        <HeroMetric label="Kênh hoạt động" value={data.profiles.active} detail={`/ ${data.profiles.total}`} />
        <HeroMetric label="Dự án đang làm" value={data.projects.in_progress} detail={`/ ${data.projects.total}`} />
        <HeroMetric label="Chờ xuất bản" value={data.publishing.scheduled} detail="đã lên lịch" />
        <HeroMetric label="Đã đăng" value={data.publishing.published} detail="bài viết" />
      </div>
    </section>
  )
}

function HeroMetric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="creator-hero-metric px-4 py-3 md:px-5">
      <div className="flex items-baseline gap-1.5">
        <span className="text-xl font-semibold tabular-nums text-[var(--on-surface)]">{value}</span>
        <span className="text-xs text-[var(--on-surface-variant)]">{detail}</span>
      </div>
      <div className="mt-1 text-xs font-medium text-[var(--on-surface-variant)]">{label}</div>
    </div>
  )
}

export function CreatorActions({ data, onNavigate }: { data: CreatorDashboardOverview; onNavigate: (tab: Tab) => void }) {
  return (
    <section className="shrink-0">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--on-surface)]">Việc cần bạn xử lý</h2>
          <p className="mt-1 text-sm text-[var(--on-surface-variant)]">Các bước đang chờ bạn tiếp tục.</p>
        </div>
        <span className="text-xs text-[var(--on-surface-variant)]">Cập nhật mỗi 30 giây</span>
      </div>
      <div className="grid gap-3.5 md:grid-cols-3">
        <CreatorActionCard icon={<Sparkles size={19} />} value={data.recommendations_ready} title="Gợi ý chưa khai thác" description="Chọn nguồn phù hợp để bắt đầu một ý tưởng nội dung." action="Xem gợi ý" tone="primary" onClick={() => onNavigate('content')} />
        <CreatorActionCard icon={<PlayCircle size={19} />} value={data.projects.in_progress} title="Dự án đang sản xuất" description="Tiếp tục kịch bản, giọng đọc hoặc video còn dang dở." action="Tiếp tục sản xuất" tone="primary" onClick={() => onNavigate('generateVideo')} />
        <CreatorActionCard icon={<FileCheck2 size={19} />} value={data.publishing.needs_approval} title="Video chờ bạn duyệt" description="Kiểm tra thành phẩm trước khi xếp lịch xuất bản." action="Mở danh sách duyệt" tone="warning" onClick={() => onNavigate('approvals')} />
      </div>
    </section>
  )
}

const actionTones = {
  primary: { icon: 'text-[var(--accent)]', value: 'text-[var(--accent)]', border: 'hover:border-[var(--outline)]', button: 'text-[var(--accent)]' },
  warning: { icon: 'text-amber-700', value: 'text-amber-700', border: 'hover:border-amber-300', button: 'text-amber-700' },
} as const

function CreatorActionCard({ icon, value, title, description, action, tone, onClick }: {
  icon: ReactNode
  value: number
  title: string
  description: string
  action: string
  tone: keyof typeof actionTones
  onClick: () => void
}) {
  const colors = actionTones[tone]
  return (
    <button type="button" onClick={onClick} className={cn('group rounded-xl border border-[var(--outline-variant)] bg-white p-4 text-left transition-colors', colors.border)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={cn('flex h-8 w-8 items-center justify-center', colors.icon)}>{icon}</span>
          <h3 className="text-sm font-semibold text-[var(--on-surface)]">{title}</h3>
        </div>
        <span className={cn('text-2xl font-semibold tabular-nums', colors.value)}>{value}</span>
      </div>
      <p className="mt-3 min-h-[2.5rem] text-sm leading-5 text-[var(--on-surface-variant)]">{description}</p>
      <span className={cn('mt-3 flex items-center gap-1 text-sm font-semibold', colors.button)}>
        {action}<ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
      </span>
    </button>
  )
}

export function RecentProjects({ data, onOpenProject, onNavigate }: { data: CreatorDashboardProjects; onOpenProject: (workflowId: string) => void; onNavigate: (tab: Tab) => void }) {
  return (
    <div className="h-full overflow-hidden rounded-xl border border-[var(--outline-variant)] bg-white">
      <div className="flex items-center justify-between border-b border-[var(--outline-variant)] px-5 py-4">
        <div className="flex items-center gap-3"><Layers3 size={18} className="text-[var(--accent)]" /><div><h2 className="text-sm font-semibold text-[var(--on-surface)]">Dự án gần đây</h2><p className="mt-0.5 text-xs text-[var(--on-surface-variant)]">Tiếp tục một dự án đang làm</p></div></div>
        <button type="button" onClick={() => onNavigate('generateVideo')} className="text-sm font-medium text-[var(--accent)] hover:underline">Xem tất cả</button>
      </div>

      {data.recent_projects.length === 0 ? (
        <div className="grid min-h-64 place-items-center p-8 text-center"><div><Clapperboard size={26} className="mx-auto text-[var(--on-surface-variant)]" /><h3 className="mt-3 text-sm font-semibold text-[var(--on-surface)]">Chưa có dự án video</h3><p className="mt-1 text-sm text-[var(--on-surface-variant)]">Chọn một nội dung để bắt đầu sản xuất.</p><button type="button" onClick={() => onNavigate('content')} className="mt-4 text-sm font-semibold text-[var(--accent)] hover:underline">Mở kho nội dung</button></div></div>
      ) : (
        <div className="divide-y divide-slate-100">{data.recent_projects.map((project) => <ProjectRow key={project.id} project={project} onOpen={() => onOpenProject(project.id)} />)}</div>
      )}
    </div>
  )
}

function ProjectRow({ project, onOpen }: { project: CreatorDashboardProject; onOpen: () => void }) {
  const progress = Math.min(100, Math.max(0, Number(project.progress_percent || 0)))
  return (
    <button type="button" onClick={onOpen} className="group flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-[var(--surface-container-low)]">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--surface-container-low)] text-[var(--on-surface-variant)] group-hover:text-[var(--accent)]"><Clapperboard size={16} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-3"><span className="truncate text-sm font-medium text-[var(--on-surface)]">{project.title}</span><span className="shrink-0 rounded-md bg-[var(--surface-container)] px-2 py-0.5 text-xs font-medium text-[var(--on-surface-variant)]">{projectStatusLabel(project.status)}</span></span>
        <span className="mt-2 flex items-center gap-2"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-container)]"><span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${progress}%` }} /></span><span className="w-9 text-right text-xs tabular-nums text-[var(--on-surface-variant)]">{Math.round(progress)}%</span></span>
        <span className="mt-1.5 flex items-center gap-2 text-xs text-[var(--on-surface-variant)]"><CircleUserRound size={12} />{project.profile_name}<span>·</span>{formatRelativeTime(project.updated_at)}</span>
      </span>
      <ArrowRight size={15} className="shrink-0 text-slate-300 transition-colors group-hover:text-[var(--accent)]" />
    </button>
  )
}

export function PublishingJourney({ data, onNavigate }: { data: CreatorDashboardPublishing; onNavigate: (tab: Tab) => void }) {
  const rows = [
    { key: 'needs_approval', label: 'Chờ duyệt', icon: <FileCheck2 size={14} />, color: 'bg-amber-600' },
    { key: 'approved', label: 'Đã duyệt', icon: <CheckCircle2 size={14} />, color: 'bg-[var(--accent)]' },
    { key: 'queued', label: 'Đã xếp lịch', icon: <CalendarDays size={14} />, color: 'bg-[var(--accent)]' },
    { key: 'publishing', label: 'Đang đăng', icon: <Send size={14} />, color: 'bg-[var(--accent)]' },
    { key: 'published', label: 'Đã đăng', icon: <CheckCircle2 size={14} />, color: 'bg-emerald-500' },
    { key: 'failed', label: 'Cần xử lý lỗi', icon: <AlertTriangle size={14} />, color: 'bg-rose-500' },
  ]
  const max = Math.max(1, ...rows.map((row) => Number(data.status_counts[row.key] || 0)))

  return (
    <div className="h-full overflow-hidden rounded-xl border border-[var(--outline-variant)] bg-white">
      <div className="flex items-center justify-between border-b border-[var(--outline-variant)] px-5 py-4"><div className="flex items-center gap-3"><Send size={18} className="text-[var(--accent)]" /><div><h2 className="text-sm font-semibold text-[var(--on-surface)]">Hành trình xuất bản</h2><p className="mt-0.5 text-xs text-[var(--on-surface-variant)]">Trạng thái nội dung của bạn</p></div></div><button type="button" onClick={() => onNavigate('schedule')} className="text-sm font-medium text-[var(--accent)] hover:underline">Mở lịch</button></div>
      <div className="space-y-4 p-5">
        {rows.map((row) => {
          const value = Number(data.status_counts[row.key] || 0)
          return <div key={row.key}><div className="mb-1.5 flex items-center justify-between text-sm"><span className="flex items-center gap-2 text-[var(--on-surface-variant)]">{row.icon}{row.label}</span><span className="font-semibold tabular-nums text-[var(--on-surface)]">{value}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-container)]"><div className={cn('h-full rounded-full transition-all', row.color)} style={{ width: `${Math.max(value > 0 ? 8 : 0, (value / max) * 100)}%` }} /></div></div>
        })}
      </div>
      <div className="border-t border-[var(--outline-variant)] bg-[var(--surface-container-low)] px-5 py-4">
        <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold text-[var(--on-surface)]">Sắp tới</h3><Clock3 size={15} className="text-[var(--on-surface-variant)]" /></div>
        {data.upcoming.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--outline)] bg-white px-3 py-4 text-center text-sm text-[var(--on-surface-variant)]">Chưa có bài nào được xếp lịch.</p>
        ) : (
          <div className="space-y-2">{data.upcoming.slice(0, 3).map((item) => <div key={item.id} className="flex items-center gap-2.5 rounded-lg border border-[var(--outline-variant)] bg-white p-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[var(--accent-light)] text-[var(--accent)]"><CalendarDays size={15} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-[var(--on-surface)]">{item.title}</span><span className="mt-0.5 block truncate text-xs text-[var(--on-surface-variant)]">{item.profile_name} · {formatDateTime(item.scheduled_at)}</span></span></div>)}</div>
        )}
      </div>
    </div>
  )
}

function CreatorHeroSkeleton() {
  return <div data-testid="creator-hero-skeleton" className="h-64 animate-pulse rounded-xl border border-[var(--outline-variant)] bg-white md:h-56" />
}

function CreatorActionsSkeleton() {
  return <section data-testid="creator-actions-skeleton"><div className="mb-3 h-9 w-56 animate-pulse rounded-lg bg-[var(--surface-container)]" /><div className="grid gap-3.5 md:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-44 animate-pulse rounded-xl border border-[var(--outline-variant)] bg-white" />)}</div></section>
}

function CreatorPanelSkeleton({ rows, testId }: { rows: number; testId: string }) {
  return <div data-testid={testId} className="min-h-96 rounded-xl border border-[var(--outline-variant)] bg-white p-5"><div className="h-10 w-48 animate-pulse rounded-lg bg-[var(--surface-container)]" /><div className="mt-5 space-y-4">{Array.from({ length: rows }, (_, item) => <div key={item} className="h-10 animate-pulse rounded-lg bg-[var(--surface-container-low)]" />)}</div></div>
}

function CreatorSectionError({ title, detail, className }: { title: string; detail: string; className?: string }) {
  return <div role="alert" className={cn('grid min-h-48 place-items-center rounded-2xl border border-rose-200 bg-rose-50/70 p-6 text-center', className)}><div><AlertTriangle size={22} className="mx-auto text-rose-600" /><h3 className="mt-2 text-sm font-black text-rose-800">{title}</h3><p className="mt-1 text-xs font-medium text-rose-600">{detail}</p></div></div>
}

function projectStatusLabel(status: string) {
  const labels: Record<string, string> = {
    DRAFT: 'Đang soạn', SCRIPTING: 'Sinh draft', EDITING: 'Đang chỉnh sửa', REVIEWING: 'AI kiểm duyệt',
    VOICE_READY: 'Sẵn sàng voice', RENDERING: 'Đang render', RENDERED: 'Chờ duyệt', VIDEO_APPROVED: 'Đã duyệt',
    QUEUED_FOR_PUBLISHING: 'Đã xếp lịch', PUBLISHED: 'Đã đăng', FAILED: 'Có lỗi',
  }
  return labels[status.toUpperCase()] || status.replaceAll('_', ' ')
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Chưa có giờ'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Không rõ'
  return date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatRelativeTime(value?: string | null) {
  if (!value) return 'Chưa cập nhật'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Không rõ'
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) return 'Vừa cập nhật'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} phút trước`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} giờ trước`
  return date.toLocaleDateString('vi-VN')
}

function apiErrorMessage(error: unknown) {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' && detail ? detail : 'Không tải được dữ liệu Creator Dashboard'
}
