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
  WandSparkles,
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
      title="Không gian sáng tạo"
      description="Nội dung, dự án video và lịch xuất bản thuộc tài khoản của bạn."
      actions={
        <button
          type="button"
          onClick={() => void refreshAll()}
          disabled={refreshing}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 disabled:opacity-50"
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

      <section className="grid gap-4 xl:grid-cols-12">
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
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-700 via-indigo-700 to-blue-700 px-6 py-7 text-white shadow-lg shadow-indigo-200/60 md:px-8">
      <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
      <div className="absolute -bottom-20 left-1/3 h-48 w-48 rounded-full bg-cyan-300/10 blur-2xl" />
      <div className="relative grid items-center gap-7 lg:grid-cols-[1.35fr_1fr]">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-extrabold tracking-wider backdrop-blur-sm">
            <WandSparkles size={13} /> CREATOR WORKSPACE
          </span>
          <h2 className="mt-4 max-w-2xl text-2xl font-black tracking-tight md:text-3xl">Biến ý tưởng thành nội dung sẵn sàng xuất bản</h2>
          <p className="mt-2 max-w-xl text-sm font-medium leading-6 text-indigo-100">
            Tiếp tục dự án đang làm, duyệt nội dung và giữ lịch đăng của các kênh đi đúng nhịp.
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <button type="button" onClick={() => onNavigate('planning')} className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-xs font-extrabold text-indigo-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <Sparkles size={15} /> Lên ý tưởng mới
            </button>
            <button type="button" onClick={() => onNavigate('generateVideo')} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 text-xs font-extrabold text-white backdrop-blur-sm transition hover:bg-white/20">
              <Clapperboard size={15} /> Mở xưởng video
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <HeroMetric label="Kênh hoạt động" value={data.profiles.active} detail={`${data.profiles.total} kênh của bạn`} />
          <HeroMetric label="Dự án đang làm" value={data.projects.in_progress} detail={`${data.projects.total} tổng dự án`} />
          <HeroMetric label="Đã lên lịch" value={data.publishing.scheduled} detail="Chờ đến giờ đăng" />
          <HeroMetric label="Đã xuất bản" value={data.publishing.published} detail="Trên các kênh của bạn" />
        </div>
      </div>
    </section>
  )
}

function HeroMetric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/10 p-3.5 backdrop-blur-md">
      <div className="text-2xl font-black tabular-nums">{value}</div>
      <div className="mt-1 text-xs font-extrabold text-white">{label}</div>
      <div className="mt-0.5 truncate text-[10px] font-medium text-indigo-200">{detail}</div>
    </div>
  )
}

export function CreatorActions({ data, onNavigate }: { data: CreatorDashboardOverview; onNavigate: (tab: Tab) => void }) {
  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-black text-slate-900">Việc cần bạn xử lý</h2>
          <p className="mt-0.5 text-xs font-medium text-slate-500">Ưu tiên theo quy trình sáng tạo của riêng bạn</p>
        </div>
        <span className="text-[11px] font-semibold text-slate-400">Tự cập nhật mỗi 30 giây</span>
      </div>
      <div className="grid gap-3.5 md:grid-cols-3">
        <CreatorActionCard icon={<Sparkles size={19} />} value={data.recommendations_ready} title="Gợi ý chưa khai thác" description="Chọn nguồn phù hợp để bắt đầu một ý tưởng nội dung." action="Xem gợi ý" tone="violet" onClick={() => onNavigate('content')} />
        <CreatorActionCard icon={<PlayCircle size={19} />} value={data.projects.in_progress} title="Dự án đang sản xuất" description="Tiếp tục draft, voice hoặc video còn dang dở." action="Tiếp tục sản xuất" tone="blue" onClick={() => onNavigate('generateVideo')} />
        <CreatorActionCard icon={<FileCheck2 size={19} />} value={data.publishing.needs_approval} title="Video chờ bạn duyệt" description="Kiểm tra thành phẩm trước khi xếp lịch xuất bản." action="Mở danh sách duyệt" tone="amber" onClick={() => onNavigate('approvals')} />
      </div>
    </section>
  )
}

const actionTones = {
  violet: { icon: 'bg-violet-100 text-violet-700', value: 'text-violet-700', border: 'hover:border-violet-300', button: 'text-violet-700' },
  blue: { icon: 'bg-blue-100 text-blue-700', value: 'text-blue-700', border: 'hover:border-blue-300', button: 'text-blue-700' },
  amber: { icon: 'bg-amber-100 text-amber-700', value: 'text-amber-700', border: 'hover:border-amber-300', button: 'text-amber-700' },
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
    <button type="button" onClick={onClick} className={cn('group rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-xs transition hover:-translate-y-0.5 hover:shadow-md', colors.border)}>
      <div className="flex items-start justify-between gap-3"><span className={cn('grid h-10 w-10 place-items-center rounded-xl', colors.icon)}>{icon}</span><span className={cn('text-3xl font-black tabular-nums', colors.value)}>{value}</span></div>
      <h3 className="mt-4 text-sm font-black text-slate-900">{title}</h3>
      <p className="mt-1 min-h-10 text-xs font-medium leading-5 text-slate-500">{description}</p>
      <span className={cn('mt-3 inline-flex items-center gap-1 text-xs font-extrabold', colors.button)}>{action}<ArrowRight size={13} className="transition group-hover:translate-x-1" /></span>
    </button>
  )
}

export function RecentProjects({ data, onOpenProject, onNavigate }: { data: CreatorDashboardProjects; onOpenProject: (workflowId: string) => void; onNavigate: (tab: Tab) => void }) {
  return (
    <div className="h-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-2.5"><span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-700"><Layers3 size={17} /></span><div><h2 className="text-sm font-black text-slate-900">Dự án gần đây</h2><p className="mt-0.5 text-[11px] font-medium text-slate-500">Tiếp tục đúng nơi bạn đang dừng</p></div></div>
        <button type="button" onClick={() => onNavigate('generateVideo')} className="text-xs font-extrabold text-blue-700 hover:text-blue-800">Xem tất cả</button>
      </div>

      {data.recent_projects.length === 0 ? (
        <div className="grid min-h-80 place-items-center p-8 text-center"><div><Clapperboard size={28} className="mx-auto text-slate-300" /><h3 className="mt-3 text-sm font-black text-slate-800">Chưa có dự án video</h3><p className="mt-1 text-xs text-slate-500">Bắt đầu từ một gợi ý nội dung phù hợp với kênh.</p></div></div>
      ) : (
        <div className="divide-y divide-slate-100">{data.recent_projects.map((project) => <ProjectRow key={project.id} project={project} onOpen={() => onOpenProject(project.id)} />)}</div>
      )}
    </div>
  )
}

function ProjectRow({ project, onOpen }: { project: CreatorDashboardProject; onOpen: () => void }) {
  const progress = Math.min(100, Math.max(0, Number(project.progress_percent || 0)))
  return (
    <button type="button" onClick={onOpen} className="group flex w-full items-center gap-3 px-5 py-3.5 text-left transition hover:bg-blue-50/40">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 group-hover:bg-blue-100 group-hover:text-blue-700"><Clapperboard size={16} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-3"><span className="truncate text-xs font-black text-slate-900">{project.title}</span><span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold text-slate-600">{projectStatusLabel(project.status)}</span></span>
        <span className="mt-1.5 flex items-center gap-2"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500" style={{ width: `${progress}%` }} /></span><span className="w-8 text-right text-[10px] font-bold tabular-nums text-slate-500">{Math.round(progress)}%</span></span>
        <span className="mt-1.5 flex items-center gap-2 text-[10px] font-medium text-slate-400"><CircleUserRound size={11} />{project.profile_name}<span>·</span>{formatRelativeTime(project.updated_at)}</span>
      </span>
      <ArrowRight size={15} className="shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-blue-600" />
    </button>
  )
}

export function PublishingJourney({ data, onNavigate }: { data: CreatorDashboardPublishing; onNavigate: (tab: Tab) => void }) {
  const rows = [
    { key: 'needs_approval', label: 'Chờ duyệt', icon: <FileCheck2 size={14} />, color: 'bg-amber-500' },
    { key: 'approved', label: 'Đã duyệt', icon: <CheckCircle2 size={14} />, color: 'bg-blue-500' },
    { key: 'queued', label: 'Đã xếp lịch', icon: <CalendarDays size={14} />, color: 'bg-violet-500' },
    { key: 'publishing', label: 'Đang đăng', icon: <Send size={14} />, color: 'bg-cyan-500' },
    { key: 'published', label: 'Đã đăng', icon: <CheckCircle2 size={14} />, color: 'bg-emerald-500' },
    { key: 'failed', label: 'Cần xử lý lỗi', icon: <AlertTriangle size={14} />, color: 'bg-rose-500' },
  ]
  const max = Math.max(1, ...rows.map((row) => Number(data.status_counts[row.key] || 0)))

  return (
    <div className="h-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div className="flex items-center gap-2.5"><span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-50 text-violet-700"><Send size={17} /></span><div><h2 className="text-sm font-black text-slate-900">Hành trình xuất bản</h2><p className="mt-0.5 text-[11px] font-medium text-slate-500">Chỉ nội dung trên các kênh của bạn</p></div></div><button type="button" onClick={() => onNavigate('schedule')} className="text-xs font-extrabold text-violet-700">Mở lịch</button></div>
      <div className="space-y-3.5 p-5">
        {rows.map((row) => {
          const value = Number(data.status_counts[row.key] || 0)
          return <div key={row.key}><div className="mb-1.5 flex items-center justify-between text-xs"><span className="flex items-center gap-1.5 font-bold text-slate-600">{row.icon}{row.label}</span><span className="font-black tabular-nums text-slate-900">{value}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={cn('h-full rounded-full transition-all', row.color)} style={{ width: `${Math.max(value > 0 ? 8 : 0, (value / max) * 100)}%` }} /></div></div>
        })}
      </div>
      <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-4">
        <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-black text-slate-800">Sắp tới</h3><Clock3 size={14} className="text-slate-400" /></div>
        {data.upcoming.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-[11px] font-medium text-slate-500">Chưa có bài nào được xếp lịch.</p>
        ) : (
          <div className="space-y-2">{data.upcoming.slice(0, 3).map((item) => <div key={item.id} className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-2.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-700"><CalendarDays size={14} /></span><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-extrabold text-slate-800">{item.title}</span><span className="mt-0.5 block truncate text-[10px] font-medium text-slate-400">{item.profile_name} · {formatDateTime(item.scheduled_at)}</span></span></div>)}</div>
        )}
      </div>
    </div>
  )
}

function CreatorHeroSkeleton() {
  return <div data-testid="creator-hero-skeleton" className="h-72 animate-pulse rounded-3xl bg-indigo-200/70 md:h-64" />
}

function CreatorActionsSkeleton() {
  return <section data-testid="creator-actions-skeleton"><div className="mb-3 h-9 w-56 animate-pulse rounded-lg bg-slate-200" /><div className="grid gap-3.5 md:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-48 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />)}</div></section>
}

function CreatorPanelSkeleton({ rows, testId }: { rows: number; testId: string }) {
  return <div data-testid={testId} className="min-h-96 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"><div className="h-10 w-48 animate-pulse rounded-lg bg-slate-200" /><div className="mt-5 space-y-4">{Array.from({ length: rows }, (_, item) => <div key={item} className="h-10 animate-pulse rounded-xl bg-slate-100" />)}</div></div>
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
