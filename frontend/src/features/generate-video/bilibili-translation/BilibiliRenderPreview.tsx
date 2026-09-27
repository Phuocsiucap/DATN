import { useEffect, useMemo, useRef, useState } from 'react'
import ReactPlayer from 'react-player'
import type { BilibiliWorkflowEpisode, SubtitleStyle, TimedSubtitleSegment } from './types'

type Props = {
  episode?: BilibiliWorkflowEpisode
  selectedSegment?: TimedSubtitleSegment | null
  seekTime?: number | null
  style: SubtitleStyle
  onTimeChange?: (seconds: number) => void
}

const overlaySubtitle = (value: string) => {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= 46) return text
  const chunks: string[] = []
  let cursor = 0
  while (cursor < text.length && chunks.length < 2) {
    chunks.push(text.slice(cursor, cursor + 23).trim())
    cursor += 23
  }
  return chunks.join('\n')
}

export default function BilibiliRenderPreview({ episode, selectedSegment, seekTime, style, onTimeChange }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const activeSegment = useMemo(() => {
    return episode?.segments.find((segment) => currentTime >= segment.start && currentTime <= segment.end) || null
  }, [currentTime, episode?.segments])

  useEffect(() => {
    onTimeChange?.(currentTime)
  }, [currentTime, onTimeChange])

  useEffect(() => {
    const video = videoRef.current
    if (!video || seekTime == null || !Number.isFinite(seekTime)) return
    video.currentTime = Math.max(0, seekTime)
    setCurrentTime(Math.max(0, seekTime))
  }, [seekTime])

  const subtitle = overlaySubtitle(activeSegment?.translated_text || activeSegment?.raw_text || selectedSegment?.translated_text || selectedSegment?.raw_text || '')
  const videoUrl = episode?.url || ''

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-black">
      <div className="relative min-h-0 flex-1">
        {videoUrl ? (
          <ReactPlayer
            ref={videoRef}
            src={videoUrl}
            controls
            width="100%"
            height="100%"
            playbackRate={style.playbackRate}
            onTimeUpdate={(event) => setCurrentTime(Number(event.currentTarget.currentTime || 0))}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/70">Chưa có URL video cho tập này.</div>
        )}
        {subtitle && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-center font-bold leading-tight"
            style={{
              whiteSpace: 'pre-line',
              left: `${style.positionX}%`,
              top: `${style.positionY}%`,
              maxWidth: `${style.maxWidth}%`,
              color: style.color,
              fontSize: `${style.fontSize}px`,
              textShadow: `0 0 ${style.outlineWidth}px ${style.outlineColor}, 0 0 ${Math.max(style.outlineWidth * 1.8, 1)}px ${style.outlineColor}`,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      <div className="flex h-12 items-center justify-between border-t border-white/10 px-4 text-xs text-white/70">
        <span>{episode?.title || 'Bilibili episode'}</span>
        <span>{currentTime.toFixed(2)}s</span>
      </div>
    </section>
  )
}
