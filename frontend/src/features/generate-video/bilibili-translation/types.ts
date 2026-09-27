import type { BilibiliOcrEpisodeProgress, BilibiliOcrSegment } from '@/commons/apis/module1'

export type SubtitleStyle = {
  fontSize: number
  positionX: number
  positionY: number
  maxWidth: number
  color: string
  outlineColor: string
  outlineWidth: number
  playbackRate: number
}

export type TimedSubtitleSegment = Omit<BilibiliOcrSegment, 'index' | 'start' | 'end'> & {
  index: number
  start: number
  end: number
  raw_text?: string | null
  translated_text?: string | null
}

export type BilibiliWorkflowEpisode = Omit<BilibiliOcrEpisodeProgress, 'segments'> & {
  segments: TimedSubtitleSegment[]
}

export const defaultSubtitleStyle: SubtitleStyle = {
  fontSize: 24,
  positionX: 50,
  positionY: 86,
  maxWidth: 72,
  color: '#ffffff',
  outlineColor: '#111111',
  outlineWidth: 4,
  playbackRate: 1,
}
