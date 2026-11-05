import { Player } from '@remotion/player'
import { StorytellingDemo, getDurationSeconds, type Story, type Clip } from './StoryComposition'
import type { GenerateVideoStory } from '@/commons/apis/generateVideo'

function adaptStoryForRemotionPlayer(story: GenerateVideoStory): Story {
  return {
    meta: story.meta as Record<string, unknown> | undefined,
    video: story.video,
    audio: story.audio
      ? {
          voice: story.audio.voice,
          voiceVolume: story.audio.voiceVolume,
          music: story.audio.music,
          musicVolume: story.audio.musicVolume,
          musicDuration: story.audio.musicDuration,
        }
      : undefined,
    timeline: story.timeline
      ? {
          duration: story.timeline.duration,
          video: story.timeline.video as Clip[] | undefined,
          text: story.timeline.text as Clip[] | undefined,
          audio: story.timeline.audio as Clip[] | undefined,
        }
      : undefined,
  }
}

export default function RemotionPreview({
  story,
  className,
}: {
  story: GenerateVideoStory | null
  className?: string
}) {
  if (!story) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-950 text-slate-400 text-sm ${className || ''}`}
      >
        Chưa có story để preview.
      </div>
    )
  }
  const adaptedStory = adaptStoryForRemotionPlayer(story)
  const fps = story.video?.fps ?? 30
  const durationInFrames = Math.max(30, Math.ceil(getDurationSeconds(adaptedStory) * fps))
  const compositionWidth = story.video?.width ?? 1080
  const compositionHeight = story.video?.height ?? 1920
  return (
    <div className={className} style={{ position: 'relative' }}>
      <Player
        component={StorytellingDemo}
        inputProps={{ story: adaptedStory }}
        durationInFrames={durationInFrames}
        fps={fps}
        compositionWidth={compositionWidth}
        compositionHeight={compositionHeight}
        controls
        style={{ width: '100%', height: '100%' }}
        acknowledgeRemotionLicense
      />
    </div>
  )
}
