import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Clapperboard, Layers, Pencil, Plus, RefreshCw, Search, X } from 'lucide-react'
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
  const [seriesModalOpen, setSeriesModalOpen] = useState(false)
  const [editingSeries, setEditingSeries] = useState<ContentSeries | null>(null)
  const [assigningWorkflow, setAssigningWorkflow] = useState<VideoWorkspaceSummary | null>(null)
  const [assignSeriesId, setAssignSeriesId] = useState('')

  const profileSeries = useMemo(
    () => series.filter((item) => !selectedProfileId || item.profile_id === selectedProfileId),
    [selectedProfileId, series],
  )

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
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex flex-col gap-3 border-b border-slate-200 bg-white px-3 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Clapperboard size={18} className="text-blue-700" />
            <h1 className="text-base font-black text-slate-900">Xưởng sản xuất video</h1>
            <span className="text-xs font-semibold text-slate-400">{total} workflow</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">Theo dõi draft, voice và render từ cùng một hàng đợi xử lý.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => { setEditingSeries(null); setSeriesModalOpen(true) }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 hover:bg-blue-100"
          >
            <Plus size={14} /> Tạo series
          </button>
          <button
            title="Tải lại"
            onClick={() => void loadWorkspaces()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      <section className="grid gap-2 border-b border-slate-200 bg-white px-3 pb-3 sm:grid-cols-2 xl:grid-cols-[220px_minmax(220px,1fr)_180px_180px]">
        <select value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)} className={filterClass}>
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.profile_name} · {profile.platform}</option>)}
        </select>
        <label className="relative">
          <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm workflow..." className={`${filterClass} w-full pl-9`} />
        </label>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={filterClass}>
          <option value="">Mọi trạng thái</option>
          <option value="SCRIPTING,EDITING,REVIEWING,VOICE_READY,RENDERING">Đang sản xuất</option>
          <option value="RENDERED,VIDEO_APPROVED,QUEUED_FOR_PUBLISHING,PUBLISHED">Đã có video</option>
          <option value="FAILED">Thất bại</option>
        </select>
        <select value={seriesFilter} onChange={(event) => setSeriesFilter(event.target.value)} className={filterClass}>
          <option value="">Mọi series</option>
          {profileSeries.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </section>

      {message && <div className={`mx-3 rounded-md border px-3 py-2 text-xs font-semibold ${/không|lỗi|failed|error/i.test(message) ? 'border-red-200 bg-red-50 text-red-700' : 'border-blue-200 bg-blue-50 text-blue-700'}`}>{message}</div>}

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        {loading ? (
          <div className="grid gap-2">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-md bg-slate-100" />)}</div>
        ) : items.length === 0 ? (
          <div className="flex h-56 flex-col items-center justify-center border border-dashed border-slate-300 bg-white text-center">
            <Clapperboard size={28} className="text-slate-300" />
            <strong className="mt-3 text-sm text-slate-700">Chưa có video workflow phù hợp</strong>
            <p className="mt-1 text-xs text-slate-500">Tạo từ ContentItem hoặc bật luồng auto trong strategy.</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {items.map((item) => (
              <article key={item.id} className="grid gap-3 rounded-md border border-slate-200 bg-white p-3 shadow-sm lg:grid-cols-[minmax(260px,1fr)_minmax(320px,0.9fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <h2 className="truncate text-sm font-black text-slate-900">{item.title}</h2>
                    <span className="shrink-0 text-[10px] font-bold uppercase text-slate-400">{workflowStatusLabel(item.status)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{item.primary_content?.summary || item.primary_content?.title || 'Không có mô tả nguồn'}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-semibold text-slate-500">
                    <button
                      onClick={() => { setAssigningWorkflow(item); setAssignSeriesId(item.series?.id || '') }}
                      className="inline-flex items-center gap-1 rounded-sm bg-slate-100 px-2 py-1 hover:bg-slate-200"
                    >
                      <Layers size={11} /> {item.series?.title || 'Chưa thuộc series'}
                    </button>
                    <span>{formatDateTime(item.updated_at)}</span>
                    <span>ID {item.id.slice(0, 8)}</span>
                  </div>
                </div>

                <WorkflowProgress progress={summaryProgress(item)} compact />

                <div className="flex items-center justify-end gap-1.5">
                  <button
                    title="Tạo lại draft"
                    disabled={Boolean(busy) || hasActiveTask(item)}
                    onClick={() => void regenerateDraft(item)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <RefreshCw size={14} className={busy === `regen-${item.id}` ? 'animate-spin' : ''} />
                  </button>
                  <button
                    title="Mở workspace"
                    onClick={() => onOpenProject(item.id)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-700 px-3 text-xs font-bold text-white hover:bg-blue-800"
                  >
                    Mở <ArrowUpRight size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4">
          <div className="w-full max-w-md rounded-md border border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-black text-slate-900">Gán series</h3>
                <p className="mt-1 truncate text-xs text-slate-500">{assigningWorkflow.title}</p>
              </div>
              <button title="Đóng" onClick={() => setAssigningWorkflow(null)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"><X size={15} /></button>
            </div>
            <div className="grid gap-3 p-4">
              <select value={assignSeriesId} onChange={(event) => setAssignSeriesId(event.target.value)} className={filterClass}>
                <option value="">Không thuộc series</option>
                {profileSeries.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
              <div className="flex justify-between gap-2">
                {assignSeriesId && (
                  <button
                    onClick={() => {
                      const target = profileSeries.find((item) => item.id === assignSeriesId)
                      if (target) { setEditingSeries(target); setSeriesModalOpen(true); setAssigningWorkflow(null) }
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-xs font-bold text-slate-700"
                  >
                    <Pencil size={13} /> Sửa series
                  </button>
                )}
                <div className="ml-auto flex gap-2">
                  <button onClick={() => setAssigningWorkflow(null)} className="h-8 rounded-md border border-slate-200 px-3 text-xs font-bold text-slate-600">Hủy</button>
                  <button disabled={Boolean(busy)} onClick={() => void assignSeries()} className="h-8 rounded-md bg-blue-700 px-3 text-xs font-bold text-white disabled:opacity-50">Lưu</button>
                </div>
              </div>
              {assignSeriesId && (
                <button
                  disabled={Boolean(busy)}
                  onClick={() => {
                    const target = profileSeries.find((item) => item.id === assignSeriesId)
                    if (target) void removeSeries(target)
                  }}
                  className="justify-self-start text-[11px] font-bold text-red-600 hover:underline"
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

const filterClass = 'h-9 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-blue-500'

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
    SCRIPTING: 'Tạo draft', EDITING: 'Biên tập', REVIEWING: 'Review', VOICE_READY: 'Có voice', RENDERING: 'Render', RENDERED: 'Có MP4', VIDEO_APPROVED: 'Đã duyệt', QUEUED_FOR_PUBLISHING: 'Đã vào queue', PUBLISHED: 'Đã đăng', FAILED: 'Lỗi',
  }
  return labels[value] || value.replaceAll('_', ' ')
}

function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
}

function readApiError(error: unknown, fallback: string) {
  const candidate = error as { response?: { data?: { detail?: string } }; message?: string }
  return candidate.response?.data?.detail || candidate.message || fallback
}
