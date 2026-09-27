import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react'
import type { BilibiliWorkflowEpisode, TimedSubtitleSegment } from './types'

type Props = {
  episodes: BilibiliWorkflowEpisode[]
  selectedEpisodeId?: string
  selectedSegmentIndex?: number
  onSelectEpisode: (episodeId: string) => void
  onSelectSegment: (segment: TimedSubtitleSegment) => void
}

const formatTime = (seconds?: number | null) => {
  const value = Math.max(0, Number(seconds || 0))
  const minutes = Math.floor(value / 60)
  const secs = value - minutes * 60
  return `${String(minutes).padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`
}

const statusIcon = (status: string) => {
  const upper = status.toUpperCase()
  if (upper === 'COMPLETED') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
  if (upper === 'FAILED') return <XCircle className="h-4 w-4 text-red-500" />
  if (['RUNNING', 'PROCESSING'].includes(upper)) return <Loader2 className="h-4 w-4 animate-spin text-sky-500" />
  return <Clock className="h-4 w-4 text-[var(--on-surface-variant)]" />
}

export default function BilibiliSubtitleTimeline({ episodes, selectedEpisodeId, selectedSegmentIndex, onSelectEpisode, onSelectSegment }: Props) {
  const selectedEpisode = episodes.find((episode) => episode.id === selectedEpisodeId) || episodes[0]

  return (
    <section className="flex h-full min-h-0 w-[390px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--on-surface)]">Tiến trình dịch</h2>
        <p className="mt-1 text-xs text-[var(--on-surface-variant)]">
          {episodes.length ? `${episodes.length} task/tập OCR` : 'Đang chờ worker tạo task'}
        </p>
      </div>
      <div className="flex gap-2 overflow-x-auto border-b border-[var(--border)] px-3 py-2">
        {episodes.map((episode, index) => (
          <button
            key={episode.id}
            type="button"
            onClick={() => onSelectEpisode(episode.id)}
            className={`flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-xs ${
              episode.id === selectedEpisode?.id
                ? 'border-sky-500 bg-sky-50 text-sky-700'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--on-surface)]'
            }`}
          >
            {statusIcon(episode.status)}
            <span>Tập {episode.episode_index || index + 1}</span>
            <span>{Math.round(Number(episode.progress_percent || 0))}%</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!selectedEpisode && (
          <div className="px-4 py-10 text-center text-sm text-[var(--on-surface-variant)]">Chưa có task dịch.</div>
        )}
        {selectedEpisode?.segments.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-[var(--on-surface-variant)]">
            {selectedEpisode.status === 'FAILED' ? selectedEpisode.error_message || 'OCR thất bại.' : 'Đang OCR/dịch, segment sẽ hiện dần khi worker hoàn tất.'}
          </div>
        )}
        {selectedEpisode?.segments.map((segment) => (
          <button
            key={`${selectedEpisode.id}-${segment.index}`}
            type="button"
            onClick={() => onSelectSegment(segment)}
            className={`grid w-full gap-1 border-b border-[var(--border)] px-4 py-3 text-left ${
              selectedSegmentIndex === segment.index ? 'bg-sky-50' : 'bg-transparent hover:bg-[var(--surface-variant)]'
            }`}
          >
            <div className="flex items-center justify-between gap-3 text-[11px] font-semibold text-[var(--on-surface-variant)]">
              <span>#{segment.index}</span>
              <span>{formatTime(segment.start)} - {formatTime(segment.end)}</span>
            </div>
            <p className="text-xs text-[var(--on-surface-variant)]">{segment.raw_text}</p>
            <p className="text-sm font-medium text-[var(--on-surface)]">{segment.translated_text || segment.raw_text}</p>
          </button>
        ))}
      </div>
    </section>
  )
}
