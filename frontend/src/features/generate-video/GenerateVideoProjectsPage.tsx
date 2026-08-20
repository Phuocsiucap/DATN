import { useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Wand2, X } from 'lucide-react'
import { fetchContentProjectsApi, type ContentProject } from '@/commons/apis/planning'
import { createGenerateVideoStoryFromManualApi, generateVideoMediaUrl, generateVideoOutputUrl, type GenerateVideoStory } from '@/commons/apis/generateVideo'

type GenerateVideoProjectsPageProps = {
  onOpenProject: (projectId: string) => void
}

export default function GenerateVideoProjectsPage({ onOpenProject }: GenerateVideoProjectsPageProps) {
  const [projects, setProjects] = useState<ContentProject[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState('Sẵn sàng')
  const [showNewManual, setShowNewManual] = useState(false)
  const [manualTitle, setManualTitle] = useState('')
  const [manualText, setManualText] = useState('')
  const [manualImages, setManualImages] = useState('')
  const [manualStory, setManualStory] = useState<GenerateVideoStory | null>(null)

  const sortedProjects = useMemo(() => sortProjectsNewestFirst(projects), [projects])

  const loadProjects = async () => {
    setBusy('load')
    try {
      const nextProjects = await fetchContentProjectsApi()
      setProjects(nextProjects)
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

  const createManualStory = async () => {
    if (!manualText.trim()) return
    setBusy('manual-story')
    try {
      const story = await createGenerateVideoStoryFromManualApi({
        title: manualTitle.trim() || 'Kịch bản nhập tay',
        text: manualText,
        images: manualImages.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        media_type: 'IMAGE',
      })
      setManualStory(story)
      setStatus('Đã tạo kịch bản từ nội dung nhập tay')
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không tạo được kịch bản nhập tay')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="workspace-page">
      <div className="workspace-header">
        <div>
          <h1 className="workspace-title">Generate Video · Projects</h1>
          <p className="workspace-subtitle">Danh sách project video tách riêng khỏi màn hình xử lý chi tiết.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowNewManual(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-xs font-semibold text-white">
            <Plus size={14} /> New
          </button>
          <button onClick={() => void loadProjects()} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--outline-variant)] bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-[var(--surface-container-low)]">
            <RefreshCw size={14} /> Reload
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
        {busy ? 'Đang xử lý...' : status}
      </div>

      {showNewManual && (
        <ManualStoryComposer
          busy={busy === 'manual-story'}
          title={manualTitle}
          text={manualText}
          images={manualImages}
          story={manualStory}
          onClose={() => setShowNewManual(false)}
          onTitleChange={setManualTitle}
          onTextChange={setManualText}
          onImagesChange={setManualImages}
          onCreate={() => void createManualStory()}
        />
      )}

      <ContentProjectList projects={sortedProjects} onOpenProject={onOpenProject} />
    </div>
  )
}

function ManualStoryComposer({
  busy,
  title,
  text,
  images,
  story,
  onClose,
  onTitleChange,
  onTextChange,
  onImagesChange,
  onCreate,
}: {
  busy: boolean
  title: string
  text: string
  images: string
  story: GenerateVideoStory | null
  onClose: () => void
  onTitleChange: (value: string) => void
  onTextChange: (value: string) => void
  onImagesChange: (value: string) => void
  onCreate: () => void
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black text-[#0f172a]">New manual script</div>
          <div className="mt-1 text-xs font-semibold text-slate-500">Nhập nội dung, bấm tạo để sinh kịch bản video.</div>
        </div>
        <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-600">
          <X size={15} />
        </button>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="grid content-start gap-3">
          <input value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="Tiêu đề" className="h-10 rounded-lg border border-slate-200 px-3 text-sm" />
          <textarea value={text} onChange={(event) => onTextChange(event.target.value)} placeholder="Nội dung bài" className="h-44 rounded-lg border border-slate-200 p-3 text-sm" />
          <textarea value={images} onChange={(event) => onImagesChange(event.target.value)} placeholder="Link ảnh/video, mỗi dòng một link" className="h-24 rounded-lg border border-slate-200 p-3 text-sm" />
          <button disabled={!text.trim() || busy} onClick={onCreate} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-xs font-semibold text-white disabled:opacity-50">
            <Wand2 size={14} /> {busy ? 'Đang tạo...' : 'Tạo kịch bản'}
          </button>
        </div>
        <ManualStoryPreview story={story} />
      </div>
    </div>
  )
}

function ManualStoryPreview({ story }: { story: GenerateVideoStory | null }) {
  if (!story) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-sm font-semibold text-slate-400">
        Kịch bản nhập tay sẽ hiển thị ở đây
      </div>
    )
  }
  const scenes = story.timeline?.text || []
  const video = story.timeline?.video || []
  return (
    <div className="max-h-[520px] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="mb-3 text-sm font-black text-[#0f172a]">{story.meta?.title || 'Kịch bản video'}</div>
      <div className="grid gap-2">
        {scenes.map((scene, index) => {
          const media = video[index]?.src || ''
          return (
            <div key={scene.id || index} className="grid gap-2 rounded-md border border-slate-200 bg-white p-2 sm:grid-cols-[92px_1fr]">
              <div className="overflow-hidden rounded bg-black">
                {media ? <img src={generateVideoMediaUrl(media)} alt="" className="aspect-[9/16] w-full object-contain" /> : <div className="aspect-[9/16]" />}
              </div>
              <div>
                <div className="text-[11px] font-black uppercase text-slate-400">Scene {index + 1}</div>
                <div className="mt-1 text-sm font-semibold leading-5 text-slate-700">{scene.text}</div>
                <div className="mt-2 text-[11px] font-semibold text-slate-400">{Number(scene.start || 0).toFixed(2)}s - {Number(scene.end || 0).toFixed(2)}s</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ContentProjectList({
  projects,
  onOpenProject,
}: {
  projects: ContentProject[]
  onOpenProject: (projectId: string) => void
}) {
  if (!projects.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-white p-5 text-sm font-semibold text-slate-500">
        Chưa có content project nào trong Generate Video. Hãy duyệt một plan ở Module 2 để tạo project.
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-black text-[#0f172a]">Content projects</div>
          <div className="mt-1 text-xs font-semibold text-slate-500">{projects.length} project · nguồn chính từ content_projects</div>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => {
          const renderedVideoUrl = getProjectRenderedVideoUrl(project)
          const status = project.status || 'READY'
          return (
            <div
              key={project.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenProject(project.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onOpenProject(project.id)
              }}
              className="grid min-h-[168px] cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-white text-left transition hover:border-[var(--accent)] hover:shadow-sm sm:grid-cols-[132px_minmax(0,1fr)]"
            >
              <ProjectPreview renderedVideoUrl={renderedVideoUrl} imageUrl="" title={renderedVideoUrl ? 'Video đã render' : 'Preview'} />
              <div className="min-w-0 p-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="line-clamp-2 text-sm font-black leading-5 text-[#0f172a]">{project.title || project.id}</div>
                    <div className="mt-1 font-mono text-[11px] font-semibold text-slate-400">{project.id.slice(0, 8)}</div>
                  </div>
                  <span className={`shrink-0 rounded px-2 py-1 text-[10px] font-black uppercase ${projectStatusClass(status)}`}>{projectStatusLabel(status)}</span>
                </div>
                <div className="grid gap-1 text-[11px] font-semibold text-slate-500">
                  <span>Time: {formatDateTime(project.updated_at || project.created_at)}</span>
                  <span>Duration: {formatDuration(project.timeline_duration)}</span>
                  <span>{project.parts?.length || 0} part · {project.current_stage || status}</span>
                </div>
                {renderedVideoUrl && (
                  <a href={renderedVideoUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="mt-3 inline-flex text-xs font-black text-emerald-700 hover:underline">
                    Mở video đã render
                  </a>
                )}
              </div>
            </div>
          )
        })}
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

function sortProjectsNewestFirst(projects: ContentProject[]) {
  return [...projects].sort((left, right) => {
    const leftTime = new Date(left.updated_at || left.created_at || 0).getTime()
    const rightTime = new Date(right.updated_at || right.created_at || 0).getTime()
    return rightTime - leftTime
  })
}

function getProjectRenderedVideoUrl(project: ContentProject) {
  if (!project.rendered_video) return ''
  if (!isVersionedRenderPath(project.rendered_video)) return ''
  const url = generateVideoOutputUrl(project.rendered_video)
  const version = encodeURIComponent(project.updated_at || project.created_at || '')
  return version ? `${url}${url.includes('?') ? '&' : '?'}v=${version}` : url
}

function isVersionedRenderPath(value: string) {
  return /(?:^|\/)final-[^/]+-[a-f0-9]{8,12}\.mp4$/i.test(value)
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
