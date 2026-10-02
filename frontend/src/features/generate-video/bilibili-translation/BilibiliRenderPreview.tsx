import { useEffect, useMemo, useRef, useState } from 'react'
import ReactPlayer from 'react-player'
import { mediaProxyPlaybackUrl } from '@/commons/mediaUrls'
import type { BilibiliWorkflowEpisode, SubtitleStyle, TimedSubtitleSegment } from './types'

type Props = {
  episode?: BilibiliWorkflowEpisode
  selectedSegment?: TimedSubtitleSegment | null
  seekTime?: number | null
  style: SubtitleStyle
  renderedVideoUrl?: string | null
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

const cleanVideoUrl = (value?: string | null) => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const markdownMatch = raw.match(/\]\((https?:\/\/.+)\)$/)
  return markdownMatch?.[1] || raw
}

export default function BilibiliRenderPreview({ episode, selectedSegment, seekTime, style, renderedVideoUrl, onTimeChange }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const lastTimeStateRef = useRef(0)
  const lastAudioSyncRef = useRef(0)
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
    const nextTime = Math.max(0, seekTime)
    video.currentTime = nextTime
    if (audioRef.current) audioRef.current.currentTime = nextTime
    setCurrentTime(nextTime)
  }, [seekTime])

  const subtitle = overlaySubtitle(activeSegment?.translated_text || activeSegment?.raw_text || selectedSegment?.translated_text || selectedSegment?.raw_text || '')
  const sourceVideoUrl = cleanVideoUrl(episode?.url)
  const videoUrl = renderedVideoUrl ? cleanVideoUrl(renderedVideoUrl) : mediaProxyPlaybackUrl(sourceVideoUrl)
  const audioUrl = !renderedVideoUrl && sourceVideoUrl
    ? `${mediaProxyPlaybackUrl(sourceVideoUrl)}&kind=audio`
    : ''
  const showPreviewSubtitle = !renderedVideoUrl

  const setPreviewTime = (time: number) => {
    if (Math.abs(lastTimeStateRef.current - time) < 0.15) return
    lastTimeStateRef.current = time
    setCurrentTime(time)
  }

  const syncAudio = (time: number, options?: { play?: boolean; force?: boolean }) => {
    const audio = audioRef.current
    if (!audio) return
    audio.playbackRate = style.playbackRate
    const drift = Math.abs(audio.currentTime - time)
    const threshold = options?.force ? 0.2 : 0.75
    if (drift > threshold) audio.currentTime = time
    if (options?.play && audio.paused) void audio.play().catch(() => undefined)
  }

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
            onPlay={(event) => syncAudio(Number(event.currentTarget.currentTime || 0), { play: true, force: true })}
            onPause={() => audioRef.current?.pause()}
            onSeeking={(event) => syncAudio(Number(event.currentTarget.currentTime || 0), { force: true })}
            onSeeked={(event) => syncAudio(Number(event.currentTarget.currentTime || 0), { play: !event.currentTarget.paused, force: true })}
            onTimeUpdate={(event) => {
              const nextTime = Number(event.currentTarget.currentTime || 0)
              setPreviewTime(nextTime)
              const now = Date.now()
              if (now - lastAudioSyncRef.current > 1000) {
                lastAudioSyncRef.current = now
                syncAudio(nextTime)
              }
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/70">Chưa có URL video cho tập này.</div>
        )}
        {audioUrl && <audio ref={audioRef} src={audioUrl} preload="metadata" />}
        {showPreviewSubtitle && subtitle && (
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
        <span>{renderedVideoUrl ? 'Video MP4 đã render' : episode?.title || 'Bilibili episode'}</span>
        <span>{currentTime.toFixed(2)}s</span>
      </div>
    </section>
  )
}
