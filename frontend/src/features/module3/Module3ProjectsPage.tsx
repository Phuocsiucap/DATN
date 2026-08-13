import { useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, X } from 'lucide-react'
import { createModule3HandoffApi, fetchAllContentSeriesApi, fetchModule3HandoffsApi, type ContentSeries, type Module3Handoff } from '@/commons/apis/planning'
import { module3MediaUrl, module3OutputUrl } from '@/commons/apis/module3VideoProduction'

type Module3ProjectsPageProps = {
  onOpenProject: (handoffId: string) => void
}

export default function Module3ProjectsPage({ onOpenProject }: Module3ProjectsPageProps) {
  const [handoffs, setHandoffs] = useState<Module3Handoff[]>([])
  const [seriesOptions, setSeriesOptions] = useState<ContentSeries[]>([])
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [addSeriesId, setAddSeriesId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState('Sẵn sàng')

  const approvedSeries = seriesOptions.filter((item) => ['APPROVED', 'HANDED_OFF', 'READY'].includes(item.status))
  const sortedHandoffs = useMemo(() => sortHandoffsNewestFirst(handoffs), [handoffs])
  const grouped = useMemo(() => groupHandoffsBySeries(sortedHandoffs), [sortedHandoffs])

  const loadProjects = async () => {
    setBusy('load')
    try {
      const [nextHandoffs, nextSeries] = await Promise.all([
        fetchModule3HandoffsApi(),
        fetchAllContentSeriesApi(),
      ])
      setHandoffs(nextHandoffs)
      setSeriesOptions(nextSeries)
      setStatus('Đã tải danh sách video project')
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không tải được danh sách')
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    void loadProjects()
  }, [])

  const addProjectFromSeries = async () => {
    if (!addSeriesId) return
    setBusy('add-project')
    try {
      const handoff = await createModule3HandoffApi({
        content_series_id: addSeriesId,
        priority: 5,
        handoff_note: 'Created from Module 3 project list',
      })
      setShowAddDialog(false)
      setAddSeriesId('')
      onOpenProject(handoff.id)
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không tạo được project')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="workspace-page">
      <div className="workspace-header">
        <div>
          <h1 className="workspace-title">Module 3 · Video Projects</h1>
          <p className="workspace-subtitle">Danh sách project video tách riêng khỏi màn hình xử lý chi tiết.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowAddDialog(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-xs font-semibold text-white hover:bg-[var(--accent-strong)]">
            <Plus size={14} /> Thêm
          </button>
          <button onClick={() => void loadProjects()} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--outline-variant)] bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-[var(--surface-container-low)]">
            <RefreshCw size={14} /> Reload
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
        {busy ? 'Đang xử lý...' : status}
      </div>

      <ProjectList handoffs={sortedHandoffs} grouped={grouped} onOpenProject={onOpenProject} />

      {showAddDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4">
          <div className="w-full max-w-lg rounded-lg border border-[var(--outline-variant)] bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <div className="text-base font-black text-[#0f172a]">Thêm video project</div>
                <div className="mt-1 text-xs font-semibold text-slate-500">Chọn series đã duyệt để tạo project Module 3.</div>
              </div>
              <button onClick={() => setShowAddDialog(false)} className="icon-button border border-slate-200 bg-white text-slate-600">
                <X size={16} />
              </button>
            </div>
            <div className="grid gap-3 p-4">
              <select value={addSeriesId} onChange={(event) => setAddSeriesId(event.target.value)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm">
                <option value="">Chọn series</option>
                {approvedSeries.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {item.status}
                  </option>
                ))}
              </select>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowAddDialog(false)} className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700">
                  Hủy
                </button>
                <button disabled={!addSeriesId || Boolean(busy)} onClick={() => void addProjectFromSeries()} className="h-8 rounded-md bg-[var(--accent)] px-3 text-xs font-semibold text-white disabled:opacity-50">
                  Tạo project
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ProjectList({
  handoffs,
  grouped,
  onOpenProject,
}: {
  handoffs: Module3Handoff[]
  grouped: Record<string, Module3Handoff[]>
  onOpenProject: (handoffId: string) => void
}) {
  if (!handoffs.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-white p-5 text-sm font-semibold text-slate-500">
        Chưa có video project nào trong Module 3. Bấm Thêm hoặc duyệt một bài ở Module 2 để tạo tự động.
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-black text-[#0f172a]">Video projects</div>
          <div className="mt-1 text-xs font-semibold text-slate-500">{handoffs.length} project · nhóm theo series</div>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] font-black uppercase">
          {['READY', 'EDITING', 'VOICE_READY', 'RENDERED'].map((status) => (
            <span key={status} className={`rounded px-2 py-1 ${projectStatusClass(status)}`}>{projectStatusLabel(status)}</span>
          ))}
        </div>
      </div>
      <div className="grid gap-3">
        {Object.entries(grouped).map(([seriesId, items]) => (
          <div key={seriesId} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
            <div className="mb-2 text-[11px] font-black uppercase tracking-wider text-slate-500">Series {seriesId.slice(0, 8)}</div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {items.map((handoff) => {
                const status = handoff.project_status || handoff.status || 'READY'
                const renderedVideoUrl = getRenderedVideoUrl(handoff)
                const hasStaleRenderedVideo = Boolean(handoff.rendered_video && !renderedVideoUrl)
                const articlePreviewUrl = getArticlePreviewImage(handoff)
                const previewTitle = renderedVideoUrl ? 'Video đã render' : articlePreviewUrl ? 'Ảnh bài báo' : 'Preview'
                return (
                  <div
                    key={handoff.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenProject(handoff.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') onOpenProject(handoff.id)
                    }}
                    className="grid min-h-[168px] cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-white text-left transition hover:border-[var(--accent)] hover:shadow-sm sm:grid-cols-[132px_minmax(0,1fr)]"
                  >
                    <ProjectPreview
                      renderedVideoUrl={renderedVideoUrl}
                      imageUrl={articlePreviewUrl}
                      title={previewTitle}
                    />
                    <div className="min-w-0 p-3">
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="line-clamp-2 text-sm font-black leading-5 text-[#0f172a]">{handoff.title || handoff.handoff_note || handoff.id}</div>
                          <div className="mt-1 font-mono text-[11px] font-semibold text-slate-400">{handoff.id.slice(0, 8)}</div>
                        </div>
                        <span className={`shrink-0 rounded px-2 py-1 text-[10px] font-black uppercase ${projectStatusClass(status)}`}>{projectStatusLabel(status)}</span>
                      </div>
                      <div className="grid gap-1 text-[11px] font-semibold text-slate-500">
                        <span>Time: {formatDateTime(handoff.updated_at || handoff.created_at)}</span>
                        <span>Duration: {formatDuration(handoff.timeline_duration)}</span>
                        <span>{handoff.part_count || 0} part · {handoff.status}</span>
                      </div>
                      {renderedVideoUrl && (
                        <a
                          href={renderedVideoUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="mt-3 inline-flex text-xs font-black text-emerald-700 hover:underline"
                        >
                          Mở video đã render
                        </a>
                      )}
                      {hasStaleRenderedVideo && (
                        <div className="mt-3 text-xs font-bold text-amber-700">
                          Bản render cũ, render lại để tạo MP4 mới.
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProjectPreview({
  renderedVideoUrl,
  imageUrl,
  title,
}: {
  renderedVideoUrl: string
  imageUrl: string
  title: string
}) {
  return (
    <div className="relative aspect-video bg-slate-950 sm:aspect-auto sm:h-full">
      {renderedVideoUrl ? (
        <video
          src={renderedVideoUrl}
          muted
          playsInline
          preload="metadata"
          onClick={(event) => event.stopPropagation()}
          className="h-full w-full object-cover"
        />
      ) : imageUrl ? (
        <img src={imageUrl} alt={title} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center px-3 text-center text-xs font-bold text-slate-400">
          Chưa có preview
        </div>
      )}
      <span className="absolute left-2 top-2 rounded bg-black/65 px-2 py-1 text-[10px] font-black uppercase text-white">
        {title}
      </span>
    </div>
  )
}

function groupHandoffsBySeries(handoffs: Module3Handoff[]) {
  return handoffs.reduce<Record<string, Module3Handoff[]>>((acc, handoff) => {
    const key = handoff.content_series_id || handoff.id
    acc[key] = [...(acc[key] || []), handoff]
    return acc
  }, {})
}

function sortHandoffsNewestFirst(handoffs: Module3Handoff[]) {
  return [...handoffs].sort((left, right) => {
    const leftTime = new Date(left.updated_at || left.created_at || 0).getTime()
    const rightTime = new Date(right.updated_at || right.created_at || 0).getTime()
    return rightTime - leftTime
  })
}

function getArticlePreviewImage(handoff: Module3Handoff) {
  const payload = (handoff.payload || {}) as Record<string, any>
  const videoProject = asRecord(payload.video_project)
  const source = asRecord(videoProject.source)
  const rawArticle = asRecord(source.raw_article)
  const candidates = [
    ...collectPreviewUrls(payload.source_content),
    ...collectPreviewUrls(payload.raw_source),
    ...collectPreviewUrls(source.source_content),
    ...collectPreviewUrls(rawArticle.source_content),
    ...collectPreviewUrls(rawArticle.raw_source),
    ...collectPreviewUrls(source),
    ...collectPreviewUrls(payload),
  ]
  return candidates.find(Boolean) || ''
}

function getRenderedVideoUrl(handoff: Module3Handoff) {
  if (!handoff.rendered_video) return ''
  if (!isVersionedRenderPath(handoff.rendered_video)) return ''
  const url = module3OutputUrl(handoff.rendered_video)
  const version = encodeURIComponent(handoff.updated_at || handoff.created_at || '')
  return version ? `${url}${url.includes('?') ? '&' : '?'}v=${version}` : url
}

function isVersionedRenderPath(value: string) {
  return /(?:^|\/)final-[^/]+-[a-f0-9]{8,12}\.mp4$/i.test(value)
}

function collectPreviewUrls(value: unknown): string[] {
  const source = asRecord(value)
  const urls: string[] = []
  const media = Array.isArray(source.media) ? source.media : []
  for (const item of media) {
    const record = asRecord(item)
    const mediaType = String(record.media_type || record.type || '').toUpperCase()
    const mimeType = String(record.mime_type || '').toLowerCase()
    const candidate = record.thumbnail_url || record.storage_url || record.source_url || record.url
    const looksImage = mediaType.includes('IMAGE') || mediaType.includes('THUMBNAIL') || mimeType.startsWith('image/') || String(candidate || '').match(/\.(png|jpe?g|webp|gif|avif)(\?|$)/i)
    if (candidate && looksImage) urls.push(resolveAssetUrl(String(candidate)))
  }
  const images = Array.isArray(source.images) ? source.images : []
  urls.push(...images.map((item) => resolveAssetUrl(String(item))).filter(Boolean))
  return urls
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? value as Record<string, any> : {}
}

function resolveAssetUrl(value: string) {
  if (!value) return ''
  if (/^(https?:|blob:|data:)/i.test(value)) return value
  return module3MediaUrl(value)
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Không rõ'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Không rõ'
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatDuration(value?: number | null) {
  const seconds = Number(value || 0)
  if (!seconds) return 'Chưa có'
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds % 60)
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`
}


function projectStatusLabel(status?: string | null) {
  const value = String(status || '').toUpperCase()
  if (value === 'RENDERED') return 'Đã render'
  if (value === 'VOICE_READY') return 'Đã có voice'
  if (value === 'EDITING' || value === 'IN_PROGRESS') return 'Đang chỉnh'
  if (value === 'READY') return 'Sẵn sàng'
  return value || 'Sẵn sàng'
}

function projectStatusClass(status?: string | null) {
  const value = String(status || '').toUpperCase()
  if (value === 'RENDERED') return 'bg-emerald-100 text-emerald-800'
  if (value === 'VOICE_READY') return 'bg-blue-100 text-blue-800'
  if (value === 'EDITING' || value === 'IN_PROGRESS') return 'bg-blue-100 text-blue-800'
  return 'bg-slate-100 text-slate-700'
}
