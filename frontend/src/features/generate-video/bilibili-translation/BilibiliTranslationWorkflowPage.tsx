import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { fetchBilibiliOcrProgressApi, type BilibiliOcrEpisodeProgress } from '@/commons/apis/module1'
import { fetchVideoWorkspaceApi, fetchVideoWorkflowProgressApi, type VideoWorkspaceDetail, type VideoWorkflowProgress } from '@/commons/apis/generateVideo'
import WorkflowProgress from '../WorkflowProgress'
import BilibiliRenderPreview from './BilibiliRenderPreview'
import BilibiliSubtitleStylePanel from './BilibiliSubtitleStylePanel'
import BilibiliSubtitleTimeline from './BilibiliSubtitleTimeline'
import { defaultSubtitleStyle, type BilibiliWorkflowEpisode, type SubtitleStyle, type TimedSubtitleSegment } from './types'

type Props = {
  workflowId: string
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

const isActiveProgress = (progress: VideoWorkflowProgress | null) => (
  progress?.tasks.some((task) => ['PENDING', 'RUNNING', 'PROCESSING'].includes(task.status.toUpperCase()))
)

export default function BilibiliTranslationWorkflowPage({ workflowId, onBackToList }: Props) {
  const [workspace, setWorkspace] = useState<VideoWorkspaceDetail | null>(null)
  const [progress, setProgress] = useState<VideoWorkflowProgress | null>(null)
  const [episodes, setEpisodes] = useState<BilibiliWorkflowEpisode[]>([])
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string>('')
  const [selectedSegment, setSelectedSegment] = useState<TimedSubtitleSegment | null>(null)
  const [seekTime, setSeekTime] = useState<number | null>(null)
  const [style, setStyle] = useState<SubtitleStyle>(defaultSubtitleStyle)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const detail = await fetchVideoWorkspaceApi(workflowId)
    const wfProgress = await fetchVideoWorkflowProgressApi(workflowId)
    setWorkspace(detail)
    setProgress(wfProgress)
    if (detail.primary_content_id) {
      const ocr = await fetchBilibiliOcrProgressApi(detail.primary_content_id)
      const rows = ocr.episodes
        .filter((episode) => !episode.workflow_id || episode.workflow_id === workflowId)
        .map((episode) => ({ ...episode, segments: normalizeSegments(episode) }))
      setEpisodes(rows)
      setSelectedEpisodeId((current) => current || rows[0]?.id || '')
    }
  }, [workflowId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    load()
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
    if (!progress || !isActiveProgress(progress)) return
    const timer = window.setInterval(() => {
      void load().catch(() => undefined)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [load, progress])

  const selectedEpisode = useMemo(
    () => episodes.find((episode) => episode.id === selectedEpisodeId) || episodes[0],
    [episodes, selectedEpisodeId],
  )

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
        <button type="button" onClick={() => void load()} className="flex h-9 items-center gap-2 rounded-md border border-[var(--border)] px-3 text-xs font-medium text-[var(--on-surface)]">
          <RefreshCw className="h-4 w-4" />
          Làm mới
        </button>
      </header>

      <div className="border-b border-[var(--border)] px-4 py-3">
        <WorkflowProgress progress={progress} compact />
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
        <BilibiliRenderPreview episode={selectedEpisode} selectedSegment={selectedSegment} seekTime={seekTime} style={style} />
        <BilibiliSubtitleStylePanel value={style} onChange={setStyle} />
      </div>
    </div>
  )
}
