import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  Clapperboard,
  Clock,
  Copy,
  Filter,
  FolderKanban,
  Hash,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Sparkles,
  X,
} from 'lucide-react'
import {
  createGenerateVideoStoryFromProjectApi,
  fetchVideoWorkspacesApi,
  updateVideoWorkspaceApi,
  type VideoWorkflowProgress,
  type VideoWorkspaceSummary,
} from '@/commons/apis/generateVideo'
import {
  createContentSeriesApi,
  deleteContentSeriesApi,
  fetchContentSeriesApi,
  updateContentSeriesApi,
  type ContentSeries,
  type PlanningProfile,
} from '@/commons/apis/planning'
import { fetchSocialProfilesApi } from '@/commons/apis/socialProfiles'
import { SeriesModal } from './components/SeriesModal'
import WorkflowProgress from './WorkflowProgress'

type GenerateVideoProjectsPageProps = {
  onOpenProject: (workflowId: string) => void
}

const activeTaskStatuses = new Set(['PENDING', 'RUNNING', 'PROCESSING'])

export default function GenerateVideoProjectsPage({ onOpenProject }: GenerateVideoProjectsPageProps) {
  const [profiles, setProfiles] = useState<PlanningProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [series, setSeries] = useState<ContentSeries[]>([])
  const [items, setItems] = useState<VideoWorkspaceSummary[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [seriesFilter, setSeriesFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [seriesModalOpen, setSeriesModalOpen] = useState(false)
  const [editingSeries, setEditingSeries] = useState<ContentSeries | null>(null)
  const [assigningWorkflow, setAssigningWorkflow] = useState<VideoWorkspaceSummary | null>(null)
  const [assignSeriesId, setAssignSeriesId] = useState('')

  const profileSeries = useMemo(
    () => series.filter((item) => !selectedProfileId || item.profile_id === selectedProfileId),
    [selectedProfileId, series],
  )

  const activeTasksCount = useMemo(
    () => items.filter(hasActiveTask).length,
    [items],
  )

  // Compute KPI metrics
  const stats = useMemo(() => {
    let inProd = 0
    let ready = 0
    let failed = 0

    items.forEach((item) => {
      if (item.status === 'FAILED' || item.latest_task?.status === 'FAILED') {
        failed += 1
      } else if (['RENDERED', 'VIDEO_APPROVED', 'QUEUED_FOR_PUBLISHING', 'PUBLISHED'].includes(item.status)) {
        ready += 1
      } else if (hasActiveTask(item) || ['SCRIPTING', 'EDITING', 'REVIEWING', 'VOICE_READY', 'RENDERING'].includes(item.status)) {
        inProd += 1
      }
    })

    return { inProd, ready, failed }
  }, [items])

  const loadWorkspaces = useCallback(async (quiet = false) => {
    if (!selectedProfileId) return
    if (!quiet) setLoading(true)
    try {
      const [workspaceData, seriesData] = await Promise.all([
        fetchVideoWorkspacesApi({
          profile_id: selectedProfileId,
          series_id: seriesFilter || undefined,
          status: statusFilter || undefined,
          search: search.trim() || undefined,
          limit: 100,
        }),
        fetchContentSeriesApi(selectedProfileId),
      ])
      setItems(workspaceData.items)
      setTotal(workspaceData.total)
      setSeries(seriesData)
      if (!quiet) setMessage('')
    } catch (error) {
      setMessage(readApiError(error, 'Không tải được danh sách video workflow'))
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [search, selectedProfileId, seriesFilter, statusFilter])

  useEffect(() => {
    let disposed = false
    fetchSocialProfilesApi()
      .then((response) => {
        if (disposed) return
        const nextProfiles = (response.items || response || []) as PlanningProfile[]
        setProfiles(nextProfiles)
        setSelectedProfileId((current) => current || nextProfiles[0]?.id || '')
      })
      .catch((error) => {
        if (disposed) return
        setMessage(readApiError(error, 'Không tải được profile'))
        setLoading(false)
      })
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    if (!selectedProfileId) return
    const timer = window.setTimeout(() => void loadWorkspaces(), 250)
    return () => window.clearTimeout(timer)
  }, [loadWorkspaces, selectedProfileId])

  useEffect(() => {
    if (!selectedProfileId || !items.some(hasActiveTask)) return
    const timer = window.setInterval(() => void loadWorkspaces(true), 2500)
    return () => window.clearInterval(timer)
  }, [items, loadWorkspaces, selectedProfileId])

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const regenerateDraft = async (workflow: VideoWorkspaceSummary) => {
    setBusy(`regen-${workflow.id}`)
    try {
      await createGenerateVideoStoryFromProjectApi(workflow.id)
      setMessage(`Đã đưa "${workflow.title}" vào hàng đợi tạo lại draft`)
      await loadWorkspaces(true)
    } catch (error) {
      setMessage(readApiError(error, 'Không tạo lại được draft'))
    } finally {
      setBusy(null)
    }
  }

  const saveSeries = async (data: {
    title: string
    description?: string
    series_type?: string
    profile_id?: string
    status?: string
    total_parts?: number
    current_part?: number
  }) => {
    setBusy('save-series')
    try {
      if (editingSeries) {
        await updateContentSeriesApi(editingSeries.id, data)
      } else {
        await createContentSeriesApi({ ...data, profile_id: selectedProfileId })
      }
      setSeriesModalOpen(false)
      setEditingSeries(null)
      await loadWorkspaces()
    } catch (error) {
      setMessage(readApiError(error, 'Không lưu được series'))
    } finally {
      setBusy(null)
    }
  }

  const removeSeries = async (item: ContentSeries) => {
    if (!window.confirm(`Xóa series "${item.title}"?`)) return
    setBusy(`delete-series-${item.id}`)
    try {
      await deleteContentSeriesApi(item.id)
      if (seriesFilter === item.id) setSeriesFilter('')
      await loadWorkspaces()
    } catch (error) {
      setMessage(readApiError(error, 'Không xóa được series'))
    } finally {
      setBusy(null)
    }
  }

  const assignSeries = async () => {
    if (!assigningWorkflow) return
    setBusy(`assign-${assigningWorkflow.id}`)
    try {
      await updateVideoWorkspaceApi(assigningWorkflow.id, { series_id: assignSeriesId || null })
      setAssigningWorkflow(null)
      setAssignSeriesId('')
      await loadWorkspaces(true)
    } catch (error) {
      setMessage(readApiError(error, 'Không cập nhật được series'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3.5 bg-slate-50/60 p-3 sm:p-4">
      {/* Top Header */}
      <header className="flex flex-col gap-3 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-violet-600 text-white shadow-md shadow-blue-500/20">
            <Clapperboard size={22} strokeWidth={2.2} />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg font-black tracking-tight text-slate-900">Xưởng sản xuất video</h1>
              <span className="inline-flex items-center rounded-full border border-blue-200/80 bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-blue-700">
                {total} workflow
              </span>
              {activeTasksCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 workflow-status-pulse" />
                  Đang tự động cập nhật
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Quản lý và theo dõi quy trình tạo kịch bản, tổng hợp voice AI và render MP4 theo thời gian thực.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center">
          <button
            onClick={() => { setEditingSeries(null); setSeriesModalOpen(true) }}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 text-xs font-bold text-white shadow-sm transition-all hover:from-blue-700 hover:to-indigo-700 hover:shadow-md hover:shadow-blue-500/25 active:scale-[0.98]"
          >
            <Plus size={15} strokeWidth={2.5} />
            Tạo series
          </button>
          <button
            title="Tải lại dữ liệu"
            onClick={() => void loadWorkspaces()}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-xs transition-all hover:border-slate-300 hover:bg-slate-50 active:scale-95"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin text-blue-600' : ''} />
          </button>
        </div>
      </header>

      {/* KPI Stats Overview Bar */}
      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <button
          onClick={() => setStatusFilter('')}
          className={`flex items-center justify-between rounded-xl border p-3 text-left transition-all ${
            statusFilter === ''
              ? 'border-blue-500/80 bg-blue-50/40 shadow-xs ring-2 ring-blue-500/20'
              : 'border-slate-200/90 bg-white hover:border-slate-300 hover:shadow-xs'
          }`}
        >
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Tổng Workflow</div>
            <div className="mt-1 text-xl font-black text-slate-900">{total}</div>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Layers size={18} />
          </div>
        </button>

        <button
          onClick={() => setStatusFilter('SCRIPTING,EDITING,REVIEWING,VOICE_READY,RENDERING')}
          className={`flex items-center justify-between rounded-xl border p-3 text-left transition-all ${
            statusFilter === 'SCRIPTING,EDITING,REVIEWING,VOICE_READY,RENDERING'
              ? 'border-cyan-500/80 bg-cyan-50/40 shadow-xs ring-2 ring-cyan-500/20'
              : 'border-slate-200/90 bg-white hover:border-slate-300 hover:shadow-xs'
          }`}
        >
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Đang sản xuất</div>
            <div className="mt-1 flex items-center gap-1.5 text-xl font-black text-cyan-700">
              {stats.inProd}
              {stats.inProd > 0 && <span className="h-2 w-2 rounded-full bg-cyan-500 workflow-status-pulse" />}
            </div>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-50 text-cyan-600">
            <Sparkles size={18} />
          </div>
        </button>

        <button
          onClick={() => setStatusFilter('RENDERED,VIDEO_APPROVED,QUEUED_FOR_PUBLISHING,PUBLISHED')}
          className={`flex items-center justify-between rounded-xl border p-3 text-left transition-all ${
            statusFilter === 'RENDERED,VIDEO_APPROVED,QUEUED_FOR_PUBLISHING,PUBLISHED'
              ? 'border-emerald-500/80 bg-emerald-50/40 shadow-xs ring-2 ring-emerald-500/20'
              : 'border-slate-200/90 bg-white hover:border-slate-300 hover:shadow-xs'
          }`}
        >
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Đã có video</div>
            <div className="mt-1 text-xl font-black text-emerald-700">{stats.ready}</div>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <Check size={18} strokeWidth={2.5} />
          </div>
        </button>

        <button
          onClick={() => setStatusFilter('FAILED')}
          className={`flex items-center justify-between rounded-xl border p-3 text-left transition-all ${
            statusFilter === 'FAILED'
              ? 'border-rose-500/80 bg-rose-50/40 shadow-xs ring-2 ring-rose-500/20'
              : 'border-slate-200/90 bg-white hover:border-slate-300 hover:shadow-xs'
          }`}
        >
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Thất bại</div>
            <div className={`mt-1 text-xl font-black ${stats.failed > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
              {stats.failed}
            </div>
          </div>
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${stats.failed > 0 ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-400'}`}>
            <AlertCircle size={18} />
          </div>
        </button>
      </section>

      {/* Filter Toolbar */}
      <section className="flex flex-col gap-2.5 rounded-2xl border border-slate-200/90 bg-white p-3 shadow-xs lg:flex-row lg:items-center">
        {/* Profile Select */}
        <div className="relative flex-1 min-w-[200px]">
          <Share2 size={15} className="absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
          <select
            value={selectedProfileId}
            onChange={(event) => setSelectedProfileId(event.target.value)}
            className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/50 pl-9 pr-3 text-xs font-bold text-slate-800 outline-none transition-all focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/15"
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.profile_name} · {profile.platform.toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        {/* Search Input */}
        <div className="relative flex-2 min-w-[240px]">
          <Search size={15} className="absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tìm theo tiêu đề, ID..."
            className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/50 pl-9 pr-8 text-xs font-semibold text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/15"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Status Filter */}
        <div className="relative flex-1 min-w-[160px]">
          <Filter size={15} className="absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/50 pl-9 pr-3 text-xs font-bold text-slate-700 outline-none transition-all focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/15"
          >
            <option value="">Mọi trạng thái</option>
            <option value="SCRIPTING,EDITING,REVIEWING,VOICE_READY,RENDERING">Đang sản xuất</option>
            <option value="RENDERED,VIDEO_APPROVED,QUEUED_FOR_PUBLISHING,PUBLISHED">Đã có video</option>
            <option value="FAILED">Thất bại</option>
          </select>
        </div>

        {/* Series Filter */}
        <div className="relative flex-1 min-w-[160px]">
          <FolderKanban size={15} className="absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
          <select
            value={seriesFilter}
            onChange={(event) => setSeriesFilter(event.target.value)}
            className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/50 pl-9 pr-3 text-xs font-bold text-slate-700 outline-none transition-all focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/15"
          >
            <option value="">Mọi series ({profileSeries.length})</option>
            {profileSeries.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Notification Toast Message */}
      {message && (
        <div
          className={`flex items-center justify-between rounded-xl border px-4 py-2.5 text-xs font-bold shadow-xs transition-all ${
            /không|lỗi|failed|error/i.test(message)
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-blue-200 bg-blue-50 text-blue-700'
          }`}
        >
          <span>{message}</span>
          <button onClick={() => setMessage('')} className="ml-2 text-slate-400 hover:text-slate-700">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Workspaces List */}
      <div className="min-h-0 flex-1 overflow-auto pr-0.5">
        {loading ? (
          <div className="grid gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="h-28 animate-pulse rounded-2xl border border-slate-200/60 bg-white p-4 shadow-xs"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center shadow-xs">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <Clapperboard size={28} />
            </div>
            <strong className="mt-3 text-sm font-extrabold text-slate-800">
              Chưa có video workflow phù hợp
            </strong>
            <p className="mt-1 max-w-sm text-xs text-slate-500">
              Thử thay đổi bộ lọc hoặc tạo bài viết mới từ trang Kế hoạch Content để khởi chạy workflow sản xuất.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {items.map((item) => {
              const active = hasActiveTask(item)
              const failed = item.status === 'FAILED' || item.latest_task?.status === 'FAILED'
              const completed = ['RENDERED', 'VIDEO_APPROVED', 'QUEUED_FOR_PUBLISHING', 'PUBLISHED'].includes(item.status)

              return (
                <article
                  key={item.id}
                  className={`group relative grid gap-3.5 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs transition-all hover:border-slate-300 hover:shadow-md ${
                    failed
                      ? 'border-l-4 border-l-rose-500'
                      : active
                      ? 'border-l-4 border-l-blue-500'
                      : completed
                      ? 'border-l-4 border-l-emerald-500'
                      : 'border-l-4 border-l-slate-300'
                  } lg:grid-cols-[minmax(280px,1fr)_minmax(320px,0.9fr)_auto] lg:items-center`}
                >
                  {/* Left Column: Title & Info */}
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <h2
                        onClick={() => onOpenProject(item.id)}
                        className="cursor-pointer truncate text-sm font-black text-slate-900 transition-colors group-hover:text-blue-600"
                      >
                        {item.title}
                      </h2>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold tracking-wide ${
                          failed
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : active
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : completed
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}
                      >
                        {workflowStatusLabel(item.status)}
                      </span>
                    </div>

                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                      {item.primary_content?.summary || item.primary_content?.title || 'Không có mô tả nguồn'}
                    </p>

                    <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-500">
                      <button
                        onClick={() => {
                          setAssigningWorkflow(item)
                          setAssignSeriesId(item.series?.id || '')
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200/80 bg-slate-50 px-2.5 py-1 text-slate-700 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                      >
                        <Layers size={12} className="text-slate-400 group-hover:text-blue-500" />
                        {item.series?.title || 'Chưa thuộc series'}
                      </button>

                      <span className="inline-flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 text-slate-500">
                        <Clock size={11} className="text-slate-400" />
                        {formatDateTime(item.updated_at)}
                      </span>

                      <button
                        onClick={() => copyId(item.id)}
                        title="Click để copy ID đầy đủ"
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 font-mono text-[10px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                      >
                        <Hash size={10} className="text-slate-400" />
                        {item.id.slice(0, 8)}
                        {copiedId === item.id ? <Check size={10} className="text-emerald-600" /> : <Copy size={10} className="text-slate-400" />}
                      </button>
                    </div>
                  </div>

                  {/* Middle Column: Visual Workflow Progress */}
                  <WorkflowProgress progress={summaryProgress(item)} compact />

                  {/* Right Column: Actions */}
                  <div className="flex items-center justify-end gap-2 pt-2 lg:pt-0">
                    <button
                      title="Tạo lại draft"
                      disabled={Boolean(busy) || hasActiveTask(item)}
                      onClick={() => void regenerateDraft(item)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-xs transition-all hover:border-slate-300 hover:bg-slate-50 active:scale-95 disabled:opacity-40"
                    >
                      <RefreshCw size={14} className={busy === `regen-${item.id}` ? 'animate-spin text-blue-600' : ''} />
                    </button>
                    <button
                      title="Mở Workspace sản xuất"
                      onClick={() => onOpenProject(item.id)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 text-xs font-extrabold text-white shadow-xs transition-all hover:from-blue-700 hover:to-indigo-700 hover:shadow-md hover:shadow-blue-500/20 active:scale-[0.98]"
                    >
                      Mở Workspace <ArrowUpRight size={15} strokeWidth={2.2} />
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal Components */}
      {seriesModalOpen && (
        <SeriesModal
          key={editingSeries?.id || 'new-series'}
          seriesToEdit={editingSeries}
          profiles={profiles}
          onClose={() => { setSeriesModalOpen(false); setEditingSeries(null) }}
          onSubmit={(data) => void saveSeries(data)}
        />
      )}

      {assigningWorkflow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 p-4">
              <div className="min-w-0">
                <h3 className="truncate text-base font-black text-slate-900">Gán series</h3>
                <p className="mt-0.5 truncate text-xs text-slate-500">{assigningWorkflow.title}</p>
              </div>
              <button
                title="Đóng"
                onClick={() => setAssigningWorkflow(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X size={16} />
              </button>
            </div>
            <div className="grid gap-3.5 p-4">
              <select
                value={assignSeriesId}
                onChange={(event) => setAssignSeriesId(event.target.value)}
                className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="">Không thuộc series</option>
                {profileSeries.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
              <div className="flex justify-between gap-2 pt-2">
                {assignSeriesId && (
                  <button
                    onClick={() => {
                      const target = profileSeries.find((item) => item.id === assignSeriesId)
                      if (target) { setEditingSeries(target); setSeriesModalOpen(true); setAssigningWorkflow(null) }
                    }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <Pencil size={13} /> Sửa series
                  </button>
                )}
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={() => setAssigningWorkflow(null)}
                    className="h-9 rounded-xl border border-slate-200 px-4 text-xs font-bold text-slate-600 hover:bg-slate-50"
                  >
                    Hủy
                  </button>
                  <button
                    disabled={Boolean(busy)}
                    onClick={() => void assignSeries()}
                    className="h-9 rounded-xl bg-blue-600 px-4 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    Lưu
                  </button>
                </div>
              </div>
              {assignSeriesId && (
                <button
                  disabled={Boolean(busy)}
                  onClick={() => {
                    const target = profileSeries.find((item) => item.id === assignSeriesId)
                    if (target) void removeSeries(target)
                  }}
                  className="justify-self-start text-xs font-bold text-rose-600 hover:underline"
                >
                  Xóa series đang chọn
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function hasActiveTask(item: VideoWorkspaceSummary) {
  return Boolean(item.latest_task && activeTaskStatuses.has(item.latest_task.status))
}

function summaryProgress(item: VideoWorkspaceSummary): VideoWorkflowProgress {
  return {
    workflow_id: item.id,
    status: item.status,
    current_stage: item.current_stage,
    progress_percent: item.progress_percent,
    tasks: item.latest_task ? [item.latest_task] : [],
    final_video: item.final_video,
    updated_at: item.updated_at,
  }
}

function workflowStatusLabel(value: string) {
  const labels: Record<string, string> = {
    SCRIPTING: 'Tạo draft',
    EDITING: 'Biên tập',
    REVIEWING: 'Review',
    VOICE_READY: 'Có voice',
    RENDERING: 'Render MP4',
    RENDERED: 'Có MP4',
    VIDEO_APPROVED: 'Đã duyệt',
    QUEUED_FOR_PUBLISHING: 'Đã vào queue',
    PUBLISHED: 'Đã đăng',
    FAILED: 'Lỗi',
  }
  return labels[value] || value.replaceAll('_', ' ')
}

function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
}

function readApiError(error: unknown, fallback: string) {
  const candidate = error as { response?: { data?: { detail?: string } }; message?: string }
  return candidate.response?.data?.detail || candidate.message || fallback
}

