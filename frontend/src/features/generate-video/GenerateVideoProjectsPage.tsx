import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  Clapperboard,
  Clock,
  Copy,
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
  deleteVideoWorkspaceApi,
  fetchVideoWorkspacesApi,
  renderGenerateVideoProjectApi,
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
import { hasActiveVideoTask as hasActiveTask, videoWorkspaceSeriesKey } from '@/commons/apis/videoWorkspaceList'
import { AppButton, PageLayout, SocialProfileAvatar, StatusPill, Thumbnail } from '@/commons/component/social-ui'
import { SocialProfileFilter } from '@/commons/component/SocialProfileFilter'
import { SeriesModal, TransferSeriesModal } from './components/SeriesModal'
import VideoRenderingIndicator from '@/commons/component/VideoRenderingIndicator'
import DraftGenerationIndicator from '@/commons/component/DraftGenerationIndicator'
import VoiceGenerationIndicator from '@/commons/component/VoiceGenerationIndicator'
import { RetryWorkflowModal } from './components/RetryWorkflowModal'
import { buildVideoKanbanColumns, classifyVideoWorkspace, getVideoWorkspaceActivity, isFailedVideoWorkspace } from './videoKanban'

type GenerateVideoProjectsPageProps = {
  onOpenProject: (workflowId: string) => void
}

export default function GenerateVideoProjectsPage({ onOpenProject }: GenerateVideoProjectsPageProps) {
  const [profiles, setProfiles] = useState<PlanningProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [series, setSeries] = useState<ContentSeries[]>([])
  const seriesSnapshot = useRef('')
  const [items, setItems] = useState<VideoWorkspaceSummary[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [seriesFilter, setSeriesFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [seriesModalOpen, setSeriesModalOpen] = useState(false)
  const [editingSeries, setEditingSeries] = useState<ContentSeries | null>(null)
  const [assigningWorkflow, setAssigningWorkflow] = useState<VideoWorkspaceSummary | null>(null)
  const [assignSeriesId, setAssignSeriesId] = useState('')
  const [retryTargetWorkflow, setRetryTargetWorkflow] = useState<VideoWorkspaceSummary | null>(null)

  const profileSeries = useMemo(
    () => series.filter((item) => !selectedProfileId || !(item.profile_id || item.profileId) || item.profile_id === selectedProfileId || item.profileId === selectedProfileId),
    [selectedProfileId, series],
  )

  const activeTasksCount = useMemo(
    () => items.filter(hasActiveTask).length,
    [items],
  )
  const attentionItems = items.filter((item) => ['failed', 'unknown'].includes(classifyVideoWorkspace(item)))
  const approvalsUrl = `/approvals${selectedProfileId ? `?profile_id=${encodeURIComponent(selectedProfileId)}` : ''}`

  // Compute KPI metrics
  const stats = useMemo(() => {
    let inProd = 0
    let pendingVideoReview = 0
    let ready = 0
    let failed = 0

    items.forEach((item) => {
      if (isFailedVideoWorkspace(item)) {
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
          search: search.trim() || undefined,
          limit: 100,
        }),
        quiet ? Promise.resolve(null) : fetchContentSeriesApi(selectedProfileId),
      ])
      setItems(workspaceData.items)
      setTotal(workspaceData.total)
      const nextSnapshot = `${selectedProfileId}:${videoWorkspaceSeriesKey(workspaceData.items)}`
      const nextSeries = seriesData ?? (seriesSnapshot.current !== nextSnapshot ? await fetchContentSeriesApi(selectedProfileId) : null)
      if (nextSeries) setSeries(nextSeries)
      seriesSnapshot.current = nextSnapshot
    } catch (error) {
      toast.error(readApiError(error, 'Không tải được danh sách video workflow'))
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [search, selectedProfileId, seriesFilter])

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

  const handleRegenerateDraft = async (workflowId: string) => {
    setBusy(`regen-${workflowId}`)
    try {
      await createGenerateVideoStoryFromProjectApi(workflowId)
      toast.success('Đã đưa bài viết vào hàng đợi tạo lại draft kịch bản')
      setRetryTargetWorkflow(null)
      await loadWorkspaces(true)
    } catch (error) {
      toast.error(readApiError(error, 'Không tạo lại được draft kịch bản'))
    } finally {
      setBusy(null)
    }
  }

  const handleReRenderVideo = async (workflowId: string) => {
    setBusy(`render-${workflowId}`)
    try {
      await renderGenerateVideoProjectApi(workflowId)
      toast.success('Đã đưa bài viết vào hàng đợi render MP4')
      setRetryTargetWorkflow(null)
      await loadWorkspaces(true)
    } catch (error) {
      toast.error(readApiError(error, 'Không khởi chạy render được'))
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

  const deleteWorkflow = async (item: VideoWorkspaceSummary) => {
    if (!window.confirm(`Xóa workflow "${item.title}"? Hành động này sẽ xóa vĩnh viễn kịch bản và không thể phục hồi.`)) return
    setBusy(`delete-${item.id}`)
    try {
      await deleteVideoWorkspaceApi(item.id)
      toast.success('Đã xóa workflow thành công!')
      setItems((prev) => prev.filter((w) => w.id !== item.id))
      await loadWorkspaces(true)
    } catch (error) {
      toast.error(readApiError(error, 'Không xóa được workflow'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <PageLayout
      title="Xưởng sản xuất video"
      description="Quản lý và theo dõi quy trình tạo kịch bản, tổng hợp voice AI và render MP4 theo thời gian thực."
      actions={
        <>
          <span className="inline-flex items-center rounded-full border border-blue-200/80 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
            {total} workflow
          </span>
          {activeTasksCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 workflow-status-pulse" />
              Đang tự động cập nhật
            </span>
          )}
          <AppButton variant="secondary" icon={<ArrowUpRight size={15} />} onClick={() => { window.location.href = approvalsUrl }}>
            Duyệt video
          </AppButton>
          <AppButton icon={<Plus size={15} />} onClick={() => { setEditingSeries(null); setSeriesModalOpen(true) }}>
            Tạo series
          </AppButton>
          <AppButton variant="secondary" icon={<RefreshCw size={15} className={loading ? 'animate-spin' : ''} />} onClick={() => void loadWorkspaces()}>
            Tải lại
          </AppButton>
        </>
      }
    >
      <SocialProfileFilter
        profiles={profiles}
        value={selectedProfileId}
        onChange={setSelectedProfileId}
        loading={loading}
        emptyLabel="Chưa có kênh social để tạo video."
      />

      {/* KPI Stats Overview Bar */}
      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="flex items-center justify-between rounded-xl border border-slate-200/90 bg-white p-3 shadow-xs">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Tổng Workflow</div>
            <div className="mt-1 text-xl font-black text-slate-900">{total}</div>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Layers size={18} />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-slate-200/90 bg-white p-3 shadow-xs">
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
        </div>

        <div className="flex items-center justify-between rounded-xl border border-slate-200/90 bg-white p-3 shadow-xs">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Video hoàn tất</div>
            <div className="mt-1 text-xl font-black text-amber-700">{stats.pendingVideoReview + stats.ready}</div>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
            <Clock size={18} />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-slate-200/90 bg-white p-3 shadow-xs">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Thất bại</div>
            <div className={`mt-1 text-xl font-black ${stats.failed > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
              {stats.failed}
            </div>
          </div>
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${stats.failed > 0 ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-400'}`}>
            <AlertCircle size={18} />
          </div>
        </div>
      </section>

      {/* Filter Toolbar */}
      <section className="flex flex-col gap-2.5 rounded-2xl border border-slate-200/90 bg-white p-3 shadow-xs lg:flex-row lg:items-center">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[240px]">
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
      </section>

      {/* Main Content Area */}
      {attentionItems.length > 0 && (
        <details open={true} className="shrink-0 rounded-xl border border-rose-200 bg-rose-50 p-3">
          <summary className="cursor-pointer text-xs font-bold text-rose-700">Cần xử lý ({attentionItems.length}) — video lỗi hoặc trạng thái chưa xác định</summary>
          <div className="mt-2 grid max-h-40 gap-2 overflow-y-auto sm:grid-cols-2">
            {attentionItems.map((item) => (
              <button key={item.id} onClick={() => onOpenProject(item.id)} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-left text-xs">
                <span className="min-w-0 truncate font-semibold">{item.title}</span>
                <span className="shrink-0 font-bold text-blue-700">Mở để xử lý ↗</span>
              </button>
            ))}
          </div>
        </details>
      )}
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
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden pr-0.5">
        {loading ? (
          <div className="grid h-full gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
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
          <div className="h-full overflow-x-auto overflow-y-hidden pb-1">
            <div className="flex h-full min-w-full gap-3">
            {buildVideoKanbanColumns(items).map((column, columnIndex) => (
              <section key={column.id} className="flex h-[calc(100vh-270px)] min-h-[450px] w-[250px] shrink-0 flex-col overflow-hidden rounded-[8px] border border-slate-200/90 bg-white shadow-xs lg:w-auto lg:min-w-[220px] lg:flex-1">
                <div className="flex h-11 shrink-0 items-center justify-between border-b border-slate-100 bg-white px-3">
                  <div className="flex items-center gap-2">
                    <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-black ${column.badgeClass}`}>{columnIndex + 1}</span>
                    <h2 className="text-[13px] font-extrabold text-slate-900">{column.title}</h2>
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-100 px-1.5 text-[10px] font-black text-slate-600">
                      {column.items.length}
                    </span>
                  </div>
                  <MoreHorizontal size={16} className="text-slate-400" />
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                  {column.items.map((item) => (
                    <VideoKanbanCard
                      key={item.id}
                      item={item}
                      copied={copiedId === item.id}
                      busy={busy === `regen-${item.id}`}
                      disabled={Boolean(busy) || hasActiveTask(item)}
                      onOpen={() => onOpenProject(item.id)}
                      onRegenerate={() => setRetryTargetWorkflow(item)}
                      onCopy={() => copyId(item.id)}
                      onAssign={() => {
                        setAssigningWorkflow(item)
                        setAssignSeriesId(item.series?.id || '')
                      }}
                      onDelete={() => void deleteWorkflow(item)}
                    />
                  ))}
                  {column.items.length === 0 && (
                    <div className="grid h-32 place-items-center rounded-[8px] border border-dashed border-slate-200 text-center text-[12px] font-semibold text-slate-400">
                      Chưa có video
                    </div>
                  )}
                </div>
                {column.id === 'review' && <a href={approvalsUrl} className="mx-3 my-3 grid h-9 shrink-0 place-items-center rounded-[8px] border border-blue-200 text-[12px] font-bold text-blue-700 hover:bg-blue-50">Duyệt và lên lịch tại Approvals ↗</a>}
              </section>
            ))}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Modal Components */}
      <RetryWorkflowModal
        item={retryTargetWorkflow}
        isOpen={Boolean(retryTargetWorkflow)}
        isSubmitting={Boolean(busy)}
        onClose={() => setRetryTargetWorkflow(null)}
        onOpenEdit={(workflowId) => onOpenProject(workflowId)}
        onRegenerateDraft={(workflowId) => handleRegenerateDraft(workflowId)}
        onReRenderVideo={(workflowId) => handleReRenderVideo(workflowId)}
      />

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
    </PageLayout>
  )
}

export function VideoKanbanCard({
  item,
  copied,
  busy,
  disabled,
  onOpen,
  onRegenerate,
  onCopy,
  onAssign,
  onDelete,
}: {
  item: VideoWorkspaceSummary
  copied: boolean
  busy: boolean
  disabled: boolean
  onOpen: () => void
  onRegenerate: () => void
  onCopy: () => void
  onAssign: () => void
  onDelete: () => void
}) {
  const activity = getVideoWorkspaceActivity(item)
  const ActivityIndicator = activity?.kind === 'draft'
    ? DraftGenerationIndicator
    : activity?.kind === 'voice'
      ? VoiceGenerationIndicator
      : activity?.kind === 'rendering' ? VideoRenderingIndicator : null

  return (
    <article className="group overflow-hidden rounded-[8px] border border-slate-200 bg-white shadow-xs transition hover:border-[#c8d0ff] hover:shadow-sm">
      <div className="relative">
        <button onClick={onOpen} aria-label={`Mở video: ${item.title}`} className="block w-full text-left">
          <Thumbnail
            src={item.thumbnail_url}
            title={item.title}
            className="h-[138px] w-full rounded-none"
          />
        </button>
        {ActivityIndicator && (
          <ActivityIndicator
            progress={item.progress_percent}
            queued={activity?.queued}
            className="pointer-events-none absolute inset-0"
          />
        )}
      </div>
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
          <StatusPill value={item.current_stage === 'DRAFT_REVIEW_REQUIRED' ? 'Cần duyệt draft' : workflowStatusLabel(item.status)} tone={isFailedVideoWorkspace(item) ? 'red' : item.status === 'RENDERING' || item.current_stage === 'DRAFT_REVIEW_REQUIRED' ? 'amber' : 'purple'} />
          {item.category && <span className="rounded-[5px] bg-[#f2f0ff] px-2 py-0.5 text-[10px] font-bold text-[#6d5dfc]">{item.category}</span>}
        </div>

        {['RENDERED', 'VIDEO_APPROVED', 'QUEUED_FOR_PUBLISHING', 'PUBLISHED'].includes(item.status) && (
          <a href={`${item.status === 'PUBLISHED' ? '/published-posts' : item.status === 'QUEUED_FOR_PUBLISHING' ? '/schedule' : '/approvals'}?profile_id=${encodeURIComponent(item.profile?.id || item.profile_id || '')}`} className="block rounded-md bg-emerald-50 px-2 py-1.5 text-center text-[11px] font-bold text-emerald-700 hover:bg-emerald-100">{item.status === 'PUBLISHED' ? 'Xem video đã đăng' : item.status === 'QUEUED_FOR_PUBLISHING' ? 'Xem lịch đăng' : 'Mở Approvals để duyệt và chọn lịch'} ↗</a>
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
            <button disabled={disabled} onClick={onDelete} title="Xóa workflow này" className="grid h-8 w-8 place-items-center rounded-[8px] border border-red-200 text-red-500 hover:bg-red-50 hover:border-red-300 disabled:opacity-40 transition-colors">
              <Trash2 size={13} />
            </button>
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

function workflowStatusLabel(value: string) {
  const labels: Record<string, string> = {
    SCRIPTING: 'Tạo draft',
    EDITING: 'Biên tập',
    REVIEWING: 'Review kịch bản',
    VOICE_READY: 'Có voice',
    RENDERING: 'Render MP4',
    FAILED: 'Lỗi',
  }
  return labels[value] || 'Hoàn tất'
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
