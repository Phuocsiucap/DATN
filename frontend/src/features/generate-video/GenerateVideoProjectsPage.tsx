import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
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
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import {
  createGenerateVideoStoryFromProjectApi,
  fetchVideoWorkspacesApi,
  updateVideoWorkspaceApi,
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
import { SocialProfileAvatar, StatusPill, Thumbnail } from '@/commons/component/social-ui'
import { SeriesModal, TransferSeriesModal } from './components/SeriesModal'

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
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [seriesModalOpen, setSeriesModalOpen] = useState(false)
  const [editingSeries, setEditingSeries] = useState<ContentSeries | null>(null)
  const [assigningWorkflow, setAssigningWorkflow] = useState<VideoWorkspaceSummary | null>(null)
  const [assignSeriesId, setAssignSeriesId] = useState('')

  const profileSeries = useMemo(
    () => series.filter((item) => !selectedProfileId || !(item.profile_id || item.profileId) || item.profile_id === selectedProfileId || item.profileId === selectedProfileId),
    [selectedProfileId, series],
  )

  const activeTasksCount = useMemo(
    () => items.filter(hasActiveTask).length,
    [items],
  )

  // Compute KPI metrics
  const stats = useMemo(() => {
    let inProd = 0
    let pendingVideoReview = 0
    let ready = 0
    let failed = 0

    items.forEach((item) => {
      if (item.status === 'FAILED' || item.latest_task?.status === 'FAILED') {
        failed += 1
      } else if (['VIDEO_APPROVED', 'QUEUED_FOR_PUBLISHING', 'PUBLISHED'].includes(item.status)) {
        ready += 1
      } else if (item.status === 'RENDERED') {
        pendingVideoReview += 1
      } else if (hasActiveTask(item) || ['SCRIPTING', 'EDITING', 'REVIEWING', 'VOICE_READY', 'RENDERING'].includes(item.status)) {
        inProd += 1
      }
    })

    return { inProd, pendingVideoReview, ready, failed }
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
    } catch (error) {
      toast.error(readApiError(error, 'Không tải được danh sách video workflow'))
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
        toast.error(readApiError(error, 'Không tải được profile'))
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
      toast.success(`Đã đưa "${workflow.title}" vào hàng đợi tạo lại draft`)
      await loadWorkspaces(true)
    } catch (error) {
      toast.error(readApiError(error, 'Không tạo lại được draft'))
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
        toast.success('Đã cập nhật series!')
      } else {
        await createContentSeriesApi({ ...data, profile_id: selectedProfileId })
        toast.success('Đã tạo series mới!')
      }
      setSeriesModalOpen(false)
      setEditingSeries(null)
      await loadWorkspaces()
    } catch (error) {
      toast.error(readApiError(error, 'Không lưu được series'))
    } finally {
      setBusy(null)
    }
  }

  const removeSeries = async (item: ContentSeries) => {
    if (!window.confirm(`Xóa series "${item.title}"?`)) return
    setBusy(`delete-series-${item.id}`)
    try {
      await deleteContentSeriesApi(item.id)
      toast.success(`Đã xóa series "${item.title}"`)
      if (seriesFilter === item.id) setSeriesFilter('')
      await loadWorkspaces()
    } catch (error) {
      toast.error(readApiError(error, 'Không xóa được series'))
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
          onClick={() => setStatusFilter('RENDERED')}
          className={`flex items-center justify-between rounded-xl border p-3 text-left transition-all ${
            statusFilter === 'RENDERED'
              ? 'border-amber-500/80 bg-amber-50/40 shadow-xs ring-2 ring-amber-500/20'
              : 'border-slate-200/90 bg-white hover:border-slate-300 hover:shadow-xs'
          }`}
        >
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Chờ duyệt video</div>
            <div className="mt-1 text-xl font-black text-amber-700">{stats.pendingVideoReview}</div>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
            <Clock size={18} />
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
            <option value="RENDERED">Chờ duyệt video</option>
            <option value="FAILED">Thất bại</option>
          </select>
        </div>

        {/* Series Filter removed from here, moved to Sidebar */}
      </section>

      {/* Main Content Area */}
      <div className="min-h-0 flex-1 flex flex-col lg:flex-row gap-4 overflow-hidden">
        {/* Series Sidebar */}
        <aside className="w-full lg:w-64 shrink-0 overflow-y-auto rounded-2xl border border-slate-200/90 bg-white shadow-xs">
          <div className="sticky top-0 z-10 bg-white/95 p-4 backdrop-blur-sm border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-[13px] font-black text-slate-900 flex items-center gap-2">
              <FolderKanban size={16} className="text-blue-600" />
              Danh sách Series
            </h3>
            <div className="flex items-center gap-1.5">
              <button
                title="Tạo series mới"
                onClick={() => { setEditingSeries(null); setSeriesModalOpen(true) }}
                className="grid h-6 w-6 place-items-center rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
              >
                <Plus size={14} />
              </button>
              <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600">
                {profileSeries.length}
              </span>
            </div>
          </div>
          <div className="p-2 space-y-1">
            <button
              onClick={() => setSeriesFilter('')}
              className={`w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs font-bold transition-all ${
                seriesFilter === '' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              Mọi series 
            </button>
            {profileSeries.map((item) => (
              <div
                key={item.id}
                className={`group relative flex items-center justify-between rounded-xl px-3 py-2.5 text-left transition-all ${
                  seriesFilter === item.id ? 'bg-blue-50 ring-1 ring-blue-500/20' : 'hover:bg-slate-50'
                }`}
              >
                <button
                  onClick={() => setSeriesFilter(item.id)}
                  className="flex flex-1 flex-col gap-1 min-w-0 pr-1 text-left"
                >
                  <span className={`line-clamp-2 text-xs font-bold leading-5 ${seriesFilter === item.id ? 'text-blue-700' : 'text-slate-700 group-hover:text-blue-600'}`}>
                    {item.title}
                  </span>
                  <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-400">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${item.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    {item.total_parts > 0 ? `${item.current_part || 0}/${item.total_parts} part` : 'Không giới hạn'}
                  </div>
                </button>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    title="Sửa series"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingSeries(item)
                      setSeriesModalOpen(true)
                    }}
                    className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-white hover:text-blue-600 shadow-xs transition-colors"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    title="Xóa series"
                    onClick={(e) => {
                      e.stopPropagation()
                      void removeSeries(item)
                    }}
                    className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-white hover:text-rose-600 shadow-xs transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Workspaces Kanban */}
        <div className="min-h-0 flex-1 overflow-auto pr-0.5">
        {loading ? (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="h-[520px] animate-pulse rounded-2xl border border-slate-200/60 bg-white p-4 shadow-xs"
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
          <div className="grid w-full gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {kanbanColumns(items).map((column, columnIndex) => (
              <section key={column.id} className="flex min-h-[650px] flex-col rounded-[8px] border border-slate-200/90 bg-white shadow-xs">
                <div className="flex h-11 items-center justify-between border-b border-slate-100 px-3">
                  <div className="flex items-center gap-2">
                    <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-black ${column.badgeClass}`}>{columnIndex + 1}</span>
                    <h2 className="text-[13px] font-extrabold text-slate-900">{column.title}</h2>
                  </div>
                  <MoreHorizontal size={16} className="text-slate-400" />
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                  {column.items.map((item, index) => (
                    <VideoKanbanCard
                      key={item.id}
                      item={item}
                      index={index + columnIndex}
                      copied={copiedId === item.id}
                      busy={busy === `regen-${item.id}`}
                      disabled={Boolean(busy) || hasActiveTask(item)}
                      onOpen={() => onOpenProject(item.id)}
                      onRegenerate={() => void regenerateDraft(item)}
                      onCopy={() => copyId(item.id)}
                      onAssign={() => {
                        setAssigningWorkflow(item)
                        setAssignSeriesId(item.series?.id || '')
                      }}
                    />
                  ))}
                  {column.items.length === 0 && (
                    <div className="grid h-32 place-items-center rounded-[8px] border border-dashed border-slate-200 text-center text-[12px] font-semibold text-slate-400">
                      Chưa có video
                    </div>
                  )}
                </div>
                <button className="mx-3 mb-3 h-9 rounded-[8px] border border-slate-200 bg-white text-[12px] font-bold text-[#6d5dfc] hover:bg-[#f8faff]">
                  + Thêm video
                </button>
              </section>
            ))}
          </div>
        )}
        </div>
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
        <TransferSeriesModal
          itemTitle={assigningWorkflow.title}
          currentSeriesId={assignSeriesId}
          seriesList={profileSeries}
          isSubmitting={Boolean(busy)}
          onClose={() => setAssigningWorkflow(null)}
          onSubmit={async (targetSeriesId) => {
            setBusy(`assign-${assigningWorkflow.id}`)
            try {
              await updateVideoWorkspaceApi(assigningWorkflow.id, { series_id: targetSeriesId })
              toast.success('Đã chuyển bài qua series mới!')
              setAssigningWorkflow(null)
              setAssignSeriesId('')
              await loadWorkspaces(true)
            } catch (error) {
              toast.error(readApiError(error, 'Không cập nhật được series'))
            } finally {
              setBusy(null)
            }
          }}
          onCreateNewSeries={() => {
            setAssigningWorkflow(null)
            setEditingSeries(null)
            setSeriesModalOpen(true)
          }}
        />
      )}
    </div>
  )
}

function kanbanColumns(items: VideoWorkspaceSummary[]) {
  const buckets = [
    { id: 'draft', title: 'Draft kịch bản', badgeClass: 'bg-[#f2f0ff] text-[#6d5dfc]', match: (item: VideoWorkspaceSummary) => ['SCRIPTING', 'READY', 'DRAFT_READY'].includes(item.status) },
    { id: 'editing', title: 'Đang biên tập & Voice', badgeClass: 'bg-[#eef4ff] text-[#2556ea]', match: (item: VideoWorkspaceSummary) => ['EDITING', 'REVIEWING', 'VOICE_READY'].includes(item.status) },
    { id: 'rendering', title: 'Đang render MP4', badgeClass: 'bg-[#fff3d6] text-[#f59e0b]', match: (item: VideoWorkspaceSummary) => ['RENDERING'].includes(item.status) || hasActiveTask(item) },
    { id: 'review', title: 'Chờ duyệt video', badgeClass: 'bg-[#fff3d6] text-[#b76b00]', match: (item: VideoWorkspaceSummary) => ['RENDERED'].includes(item.status) },
  ]

  const assigned = new Set<string>()
  const columns = buckets.map((bucket) => {
    const columnItems = items.filter((item) => !assigned.has(item.id) && bucket.match(item))
    columnItems.forEach((item) => assigned.add(item.id))
    return { ...bucket, items: columnItems }
  })
  const fallback = items.filter((item) => !assigned.has(item.id))
  columns[0].items.push(...fallback)
  return columns
}

function VideoKanbanCard({
  item,
  index,
  copied,
  busy,
  disabled,
  onOpen,
  onRegenerate,
  onCopy,
  onAssign,
}: {
  item: VideoWorkspaceSummary
  index: number
  copied: boolean
  busy: boolean
  disabled: boolean
  onOpen: () => void
  onRegenerate: () => void
  onCopy: () => void
  onAssign: () => void
}) {
  const duration = item.status === 'RENDERING' ? '01:04' : index % 2 ? '00:57' : '01:15'
  return (
    <article className="group overflow-hidden rounded-[8px] border border-slate-200 bg-white shadow-xs transition hover:border-[#c8d0ff] hover:shadow-sm">
      <button onClick={onOpen} className="block w-full text-left">
        <Thumbnail
          src={item.primary_content?.thumbnail_url || item.primary_content?.thumbnailUrl || item.primary_content?.image_url}
          title={item.title}
          className="h-[138px] w-full rounded-none"
          duration={duration}
        />
      </button>
      <div className="space-y-3 p-3">
        <div>
          <button onClick={onOpen} className="line-clamp-2 text-left text-[13px] font-extrabold leading-5 text-slate-900 transition group-hover:text-[#2556ea]">
            {item.title}
          </button>
          <div className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-slate-600">
            <SocialProfileAvatar
              avatarUrl={item.profile?.avatar}
              name={item.profile?.name}
              platform={item.profile?.platform || 'tiktok'}
              size="sm"
            />
            <span className="truncate">{item.profile?.name || 'SocialContentHub'}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <StatusPill value={workflowStatusLabel(item.status)} tone={item.status === 'FAILED' ? 'red' : item.status === 'RENDERING' ? 'amber' : 'purple'} />
          {item.primary_content?.category && <span className="rounded-[5px] bg-[#f2f0ff] px-2 py-0.5 text-[10px] font-bold text-[#6d5dfc]">{item.primary_content.category}</span>}
        </div>

        {item.status === 'RENDERING' && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-slate-500">{Math.round(Number(item.progress_percent || 45))}%</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-[#f59e0b]" style={{ width: `${Math.max(8, Math.min(100, Number(item.progress_percent || 45)))}%` }} />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] font-semibold text-slate-500">
          <button
            onClick={onAssign}
            title="Bấm để chuyển series cho bài viết này"
            className={`inline-flex min-w-0 max-w-[170px] items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold transition-all ${
              item.series
                ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 ring-1 ring-indigo-500/15'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200'
            }`}
          >
            <FolderKanban size={12} className={item.series ? 'text-indigo-600' : 'text-slate-400'} />
            <span className="truncate">{item.series?.title || 'Chưa thuộc series'}</span>
            <Pencil size={10} className="ml-0.5 opacity-60 shrink-0" />
          </button>
          <span className="inline-flex items-center gap-1 text-[10px] text-slate-400"><Clock size={11} />{formatDateTime(item.updated_at)}</span>
        </div>

        <div className="flex items-center justify-between">
          <button onClick={onCopy} className="inline-flex items-center gap-1 rounded-[6px] bg-slate-50 px-2 py-1 font-mono text-[10px] font-bold text-slate-500 hover:bg-slate-100">
            <Hash size={10} />
            {item.id.slice(0, 8)}
            {copied ? <Check size={10} className="text-emerald-600" /> : <Copy size={10} />}
          </button>
          <div className="flex items-center gap-1">
            <button disabled={disabled} onClick={onRegenerate} title="Tạo lại draft" className="grid h-8 w-8 place-items-center rounded-[8px] border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
              <RefreshCw size={13} className={busy ? 'animate-spin text-[#2556ea]' : ''} />
            </button>
            <button onClick={onOpen} className="inline-flex h-8 items-center gap-1 rounded-[8px] bg-[#2556ea] px-2.5 text-[11px] font-extrabold text-white">
              Mở <ArrowUpRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

function hasActiveTask(item: VideoWorkspaceSummary) {
  return Boolean(item.latest_task && activeTaskStatuses.has(item.latest_task.status))
}

function workflowStatusLabel(value: string) {
  const labels: Record<string, string> = {
    SCRIPTING: 'Tạo draft',
    EDITING: 'Biên tập',
    REVIEWING: 'Review kịch bản',
    VOICE_READY: 'Có voice',
    RENDERING: 'Render MP4',
    RENDERED: 'Chờ duyệt video',
    VIDEO_APPROVED: 'Video đã duyệt',
    QUEUED_FOR_PUBLISHING: 'Đã vào lịch đăng',
    PUBLISHED: 'Đã xuất bản',
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
