import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Download, Film, RefreshCw } from 'lucide-react'
import { fetchBilibiliOcrProgressApi, type BilibiliOcrEpisodeProgress } from '@/commons/apis/module1'
import {
  fetchGenerateVideoJobApi,
  fetchVideoWorkspaceApi,
  fetchVideoWorkflowProgressApi,
  generateVideoOutputUrl,
  renderGenerateVideoProjectApi,
  type GenerateVideoJob,
  type VideoWorkspaceDetail,
  type VideoWorkflowProgress,
} from '@/commons/apis/generateVideo'
import WorkflowProgress from '../WorkflowProgress'
import BilibiliRenderPreview from './BilibiliRenderPreview'
import BilibiliSubtitleStylePanel from './BilibiliSubtitleStylePanel'
import BilibiliSubtitleTimeline from './BilibiliSubtitleTimeline'
import { defaultSubtitleStyle, type BilibiliWorkflowEpisode, type SubtitleStyle, type TimedSubtitleSegment } from './types'

type Props = {
  workflowId: string
  initialWorkspace: VideoWorkspaceDetail
  onBackToList: () => void
}

const normalizeSegments = (episode: BilibiliOcrEpisodeProgress): TimedSubtitleSegment[] => (
  (episode.segments || [])
    .map((segment, fallbackIndex) => {
      const start = Number(segment.start ?? 0)
      const end = Number(segment.end ?? start + 1)
      return {
        ...segment,
        index: Number(segment.index || fallbackIndex + 1),
        start,
        end: end > start ? end : start + 1,
      }
    })
    .filter((segment) => segment.raw_text || segment.translated_text)
)

const ACTIVE_STATUSES = ['PENDING', 'RUNNING', 'PROCESSING']

const isActiveProgress = (progress: VideoWorkflowProgress | null, episodes: BilibiliWorkflowEpisode[]) => (
  Boolean(progress && ACTIVE_STATUSES.includes(progress.status.toUpperCase()) && episodes.length === 0)
  || Boolean(progress?.tasks.some((task) => ACTIVE_STATUSES.includes(task.status.toUpperCase())))
  || episodes.some((episode) => ACTIVE_STATUSES.includes(episode.status.toUpperCase()))
)

export default function BilibiliTranslationWorkflowPage({ workflowId, initialWorkspace, onBackToList }: Props) {
  const [workspace, setWorkspace] = useState<VideoWorkspaceDetail | null>(initialWorkspace)
  const [progress, setProgress] = useState<VideoWorkflowProgress | null>(null)
  const [episodes, setEpisodes] = useState<BilibiliWorkflowEpisode[]>([])
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string>('')
  const [selectedSegment, setSelectedSegment] = useState<TimedSubtitleSegment | null>(null)
  const [seekTime, setSeekTime] = useState<number | null>(null)
  const [style, setStyle] = useState<SubtitleStyle>(defaultSubtitleStyle)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dataWarning, setDataWarning] = useState<string | null>(null)
  const [renderJob, setRenderJob] = useState<GenerateVideoJob | null>(null)
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [finalVideo, setFinalVideo] = useState<string | null>(null)

  const load = useCallback(async (refreshWorkspace = true) => {
    setError(null)
    const detail = refreshWorkspace ? await fetchVideoWorkspaceApi(workflowId) : initialWorkspace
    setWorkspace(detail)
    setFinalVideo(detail.final_video || null)

    const [progressResult, ocrResult] = await Promise.allSettled([
      fetchVideoWorkflowProgressApi(workflowId),
      detail.primary_content_id
        ? fetchBilibiliOcrProgressApi(detail.primary_content_id)
        : Promise.resolve(null),
    ])

    let progressUnavailable = false
    if (progressResult.status === 'fulfilled') {
      const wfProgress = progressResult.value
      setProgress(wfProgress)
      setFinalVideo(detail.final_video || wfProgress.final_video || null)
    } else {
      progressUnavailable = true
    }

    if (ocrResult.status === 'fulfilled') {
      const ocr = ocrResult.value
      const candidates = ocr?.episodes || []
      const scopedRows = candidates.filter((episode) => episode.workflow_id === workflowId)
      const contentRows = candidates.filter((episode) => !episode.workflow_id)
      const rowsByEpisode = new Map<string, BilibiliOcrEpisodeProgress>()
      for (const episode of [...contentRows, ...scopedRows]) {
        const key = String(episode.episode_index ?? episode.id)
        const current = rowsByEpisode.get(key)
        const rank = (item: BilibiliOcrEpisodeProgress) => (
          (item.status.toUpperCase() === 'COMPLETED' ? 2 : 0)
          + (item.segments?.some((segment) => segment.translated_text) ? 1 : 0)
        )
        if (!current || rank(episode) > rank(current)
          || (rank(episode) === rank(current) && episode.workflow_id === workflowId)) {
          rowsByEpisode.set(key, episode)
        }
      }
      const rows = [...rowsByEpisode.values()]
        .sort((left, right) => Number(left.episode_index || 0) - Number(right.episode_index || 0))
        .map((episode) => ({ ...episode, segments: normalizeSegments(episode) }))
      setEpisodes(rows)
      setSelectedEpisodeId((current) => rows.some((episode) => episode.id === current) ? current : rows[0]?.id || '')
    }

    const ocrUnavailable = ocrResult.status === 'rejected'
    setDataWarning(ocrUnavailable
      ? 'Không tải được tiến trình OCR. Bạn vẫn có thể xem workflow và thử làm mới.'
      : progressUnavailable ? 'Không tải được tiến trình workflow. Dữ liệu OCR vẫn được hiển thị nếu có.' : null)
  }, [initialWorkspace, workflowId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    load(false)
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Không tải được workflow dịch Bilibili.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [load])

  useEffect(() => {
    if (!progress || !isActiveProgress(progress, episodes)) return
    const timer = window.setInterval(() => {
      void load().catch(() => undefined)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [episodes, load, progress])

  useEffect(() => {
    if (!renderJob || !['PENDING', 'RUNNING', 'PROCESSING'].includes(renderJob.status.toUpperCase())) return
    const timer = window.setInterval(async () => {
      try {
        const result = await fetchGenerateVideoJobApi(renderJob.id)
        setRenderJob(result.job)
        if (result.job.status === 'COMPLETED' || result.job.status === 'RENDERED') {
          setRendering(false)
          setFinalVideo(result.job.output_path || result.job.video_url || null)
          void load().catch(() => undefined)
        } else if (result.job.status === 'FAILED') {
          setRendering(false)
          setRenderError(result.job.error_message || 'Render MP4 thất bại.')
        }
      } catch {
        // Keep polling; the workspace refresh loop will surface final state if the job finishes.
      }
    }, 3000)
    return () => window.clearInterval(timer)
  }, [load, renderJob])

  const handleRender = async () => {
    setRendering(true)
    setRenderError(null)
    try {
      const result = await renderGenerateVideoProjectApi(workflowId)
      setRenderJob(result.job)
      if (result.job.status === 'COMPLETED' || result.job.status === 'RENDERED') {
        setRendering(false)
        setFinalVideo(result.job.output_path || result.job.video_url || null)
      }
      void load().catch(() => undefined)
    } catch (err) {
      setRendering(false)
      setRenderError(err instanceof Error ? err.message : 'Không đưa được video vào hàng đợi render.')
    }
  }

  const selectedEpisode = useMemo(
    () => episodes.find((episode) => episode.id === selectedEpisodeId) || episodes[0],
    [episodes, selectedEpisodeId],
  )
  const renderedVideoUrl = finalVideo ? generateVideoOutputUrl(finalVideo) : null
  const ocrReady = episodes.some((episode) => episode.status === 'COMPLETED' && episode.segments.length > 0)
  const activeRender = rendering || Boolean(renderJob && ['PENDING', 'RUNNING', 'PROCESSING'].includes(renderJob.status.toUpperCase()))

  useEffect(() => {
    if (!selectedSegment || selectedEpisode?.segments.some((segment) => segment.index === selectedSegment.index)) return
    setSelectedSegment(null)
  }, [selectedEpisode?.segments, selectedSegment])

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-[var(--on-surface-variant)]">Đang mở workflow dịch Bilibili...</div>
  }

  if (error || !workspace) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-[var(--on-surface-variant)]">
        <p>{error || 'Không tìm thấy workflow.'}</p>
        <button type="button" onClick={onBackToList} className="rounded-md border border-[var(--border)] px-3 py-2 text-[var(--on-surface)]">Quay lại</button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--surface)]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onBackToList} className="grid h-9 w-9 place-items-center rounded-md border border-[var(--border)] text-[var(--on-surface)]" title="Quay lại">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-[var(--on-surface)]">{workspace.title}</h1>
            <p className="truncate text-xs text-[var(--on-surface-variant)]">
              {workspace.current_stage || workspace.status} · {Math.round(Number(workspace.progress_percent || 0))}%
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {renderedVideoUrl && (
            <a href={renderedVideoUrl} target="_blank" rel="noreferrer" className="flex h-9 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700">
              <Download className="h-4 w-4" />
              Video kết quả
            </a>
          )}
          <button type="button" onClick={() => void handleRender()} disabled={!ocrReady || activeRender} className="flex h-9 items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
            <Film className="h-4 w-4" />
            {activeRender ? `Đang render ${Math.round(Number(renderJob?.progress_percent || workspace.progress_percent || 0))}%` : 'Render MP4'}
          </button>
          <button type="button" onClick={() => void load()} className="flex h-9 items-center gap-2 rounded-md border border-[var(--border)] px-3 text-xs font-medium text-[var(--on-surface)]">
            <RefreshCw className="h-4 w-4" />
            Làm mới
          </button>
        </div>
      </header>

      <div className="border-b border-[var(--border)] px-4 py-3">
        <WorkflowProgress progress={progress} compact />
        {renderError && <p className="mt-2 text-xs font-medium text-red-600">{renderError}</p>}
        {dataWarning && <p className="mt-2 text-xs text-amber-700">{dataWarning}</p>}
      </div>

      <div className="flex min-h-0 flex-1">
        <BilibiliSubtitleTimeline
          episodes={episodes}
          selectedEpisodeId={selectedEpisode?.id}
          selectedSegmentIndex={selectedSegment?.index}
          onSelectEpisode={(episodeId) => {
            setSelectedEpisodeId(episodeId)
            setSelectedSegment(null)
            setSeekTime(0)
          }}
          onSelectSegment={(segment) => {
            setSelectedSegment(segment)
            setSeekTime(segment.start)
          }}
        />
        <BilibiliRenderPreview episode={selectedEpisode} selectedSegment={selectedSegment} seekTime={seekTime} style={style} renderedVideoUrl={renderedVideoUrl} />
        <BilibiliSubtitleStylePanel value={style} onChange={setStyle} />
      </div>
    </div>
  )
}
