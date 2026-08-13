import { api } from './client'

export type Module3Scene = {
  duration: number
  image: string
  effect: string
  subtitle: string
  media_type?: 'image' | 'video' | string
  subtitle_start?: number
  subtitle_duration?: number
  text_style?: Record<string, unknown>
  voice_subtitle?: string
  timing?: { start?: number; end?: number; voice_start?: number; voice_end?: number }
}

export type Module3Timeline = {
  version?: number
  duration?: number
  video?: Array<{ id: string; scene_index?: number; type: string; start: number; end: number; duration?: number; src?: string; effect?: string }>
  text?: Array<{ id: string; scene_index?: number; type: string; start: number; end: number; duration?: number; text: string; voice_text?: string; style?: Record<string, unknown>; timing?: { start?: number; end?: number; voice_start?: number; voice_end?: number } }>
  audio?: Array<{ id: string; type: 'voice' | 'music' | 'sfx' | 'audio' | string; start: number; end?: number | null; src?: string; volume?: number }>
}

export type Module3Story = {
  meta?: {
    handoff_id?: string | null
    profile_id?: string | null
    series_id?: string | null
    plan_id?: string | null
    context_id?: string | null
    title?: string | null
    source_content_id?: string | null
    part_ids?: string[]
    source?: string
  }
  video: { width: number; height: number; fps: number; background: string }
  audio?: {
    voice?: string
    music?: string
    voiceVolume?: number
    musicVolume?: number
    musicStart?: number
    musicDuration?: number
    tracks?: Array<{
      id: string
      type: 'voice' | 'music' | 'sfx'
      src: string
      start: number
      duration?: number
      volume: number
    }>
  }
  timeline?: Module3Timeline
  source?: Record<string, unknown>
  scenes?: Module3Scene[]
  story_data?: Module3Scene[]
}

export type Module3RenderJob = {
  id: string
  handoff_id: string
  story_version_id: string
  status: 'QUEUED' | 'RUNNING' | 'RENDERED' | 'FAILED' | string
  progress_percent: number
  output_path?: string | null
  video_url?: string | null
  error_message?: string | null
  story?: Module3Story | null
  created_at: string
  updated_at?: string
  started_at?: string | null
  completed_at?: string | null
}

export type ElevenLabsSharedVoice = {
  voice_id: string
  name: string
  description?: string | null
  preview_url?: string | null
  accent?: string | null
  gender?: string | null
  age?: string | null
  descriptive?: string | null
  use_case?: string | null
  category?: string | null
  language?: string | null
  locale?: string | null
  cloned_by_count?: number | null
  usage_character_count_7d?: number | null
  verified_languages?: Array<{
    language?: string
    model_id?: string
    accent?: string
    locale?: string
    preview_url?: string
  }>
}

const basePath = '/module3/video-production'
const defaultVideo = { width: 1080, height: 1920, fps: 30, background: '#05070b' }
const defaultAudio = { voiceVolume: 1, musicVolume: 0 }

const storyDataToTimeline = (storyData: Module3Scene[]): Module3Timeline => {
  let cursor = 0
  const video: NonNullable<Module3Timeline['video']> = []
  const text: NonNullable<Module3Timeline['text']> = []
  storyData.forEach((scene, index) => {
    const duration = Math.max(0.1, Number(scene.duration || 4))
    const start = cursor
    const end = cursor + duration
    video.push({
      id: `video-${index + 1}`,
      type: 'image',
      start,
      end,
      duration,
      src: scene.image,
      effect: scene.effect || 'slow-zoom',
    })
    if (scene.subtitle) {
      const textStart = typeof scene.subtitle_start === 'number' ? scene.subtitle_start : start
      const textDuration = typeof scene.subtitle_duration === 'number' ? scene.subtitle_duration : duration
      text.push({
        id: `text-${index + 1}`,
        type: 'subtitle',
        start: textStart,
        end: textStart + textDuration,
        duration: textDuration,
        text: scene.subtitle,
        timing: scene.timing,
      })
    }
    cursor = end
  })
  return { version: 1, duration: cursor, video, text, audio: [] }
}

const normalizeStoryResponse = (data: Partial<Module3Story>): Module3Story => {
  const storyData = data.story_data || data.scenes || []
  const timeline = data.timeline || storyDataToTimeline(storyData)
  return {
    meta: data.meta,
    video: data.video || defaultVideo,
    audio: data.audio || defaultAudio,
    timeline,
    source: data.source,
  }
}

export const getModule3ProductionStateApi = async () => {
  const { data } = await api.get(`${basePath}/state`)
  return data as { story: Module3Story }
}

export const createModule3StoryFromManualApi = async (source: any) => {
  const { data } = await api.post(`${basePath}/create-story`, { source })
  return normalizeStoryResponse(data)
}

export const createModule3StoryFromHandoffApi = async (handoffId: string, rawSource?: any) => {
  const { data } = await api.post(`${basePath}/handoffs/${handoffId}/create-story`, { raw_source: rawSource })
  return normalizeStoryResponse(data)
}

export const saveModule3StoryApi = async (story: Module3Story) => {
  const { data } = await api.post(`${basePath}/save-story`, { story })
  return data as { story: Module3Story }
}

export const fetchModule3SavedStoryApi = async (handoffId: string) => {
  const { data } = await api.get(`${basePath}/handoffs/${handoffId}/story`)
  return normalizeStoryResponse(data)
}

export const editModule3StoryWithAiApi = async (story: Module3Story, prompt: string) => {
  const handoffId = story.meta?.handoff_id
  const payload = handoffId ? { handoff_id: handoffId, story, prompt } : { story, prompt }
  const { data } = await api.post(`${basePath}/edit-story`, payload)
  return normalizeStoryResponse(data)
}

export const generateModule3FinalVideoApi = async (story: Module3Story) => {
  const handoffId = story.meta?.handoff_id
  const payload = handoffId ? { handoff_id: handoffId, story } : { story }
  const { data } = await api.post(`${basePath}/generate-video`, payload)
  return data as { job: Module3RenderJob }
}

export const fetchModule3RenderJobApi = async (jobId: string) => {
  const { data } = await api.get(`${basePath}/render-jobs/${jobId}`)
  return data as { job: Module3RenderJob }
}

export const generateModule3VoiceApi = async (story: Module3Story, voiceId?: string, voiceSpeed = 1) => {
  const handoffId = story.meta?.handoff_id
  const payload = handoffId
    ? { handoff_id: handoffId, voice_id: voiceId, voice_speed: voiceSpeed }
    : { story, voice_id: voiceId, voice_speed: voiceSpeed }
  const { data } = await api.post(`${basePath}/emotion-voice`, payload)
  return data as { meta?: Module3Story['meta']; audio: Module3Story['audio']; timeline?: Module3Story['timeline']; voice_id: string; voice_speed: number; voice_text?: string; audio_url: string }
}

export const fitModule3FramesApi = async (story: Module3Story) => {
  const handoffId = story.meta?.handoff_id
  const payload = handoffId ? { handoff_id: handoffId } : { story }
  const { data } = await api.post(`${basePath}/fit-frames`, payload)
  return data as { meta?: Module3Story['meta']; audio?: Module3Story['audio']; timeline?: Module3Story['timeline']; debug: any }
}

export const uploadModule3AudioApi = async (file: File) => {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index])
  }
  const { data } = await api.post(`${basePath}/audio/upload`, {
    filename: file.name,
    content_base64: window.btoa(binary),
  })
  return data as { asset_path: string }
}

export const fetchElevenLabsSharedVoicesApi = async (params: { search?: string; sort?: string; page_size?: number; page?: number } = {}) => {
  const { data } = await api.get(`${basePath}/voices`, {
    params: {
      sort: params.sort || 'trending',
      page_size: params.page_size || 30,
      page: params.page || 0,
      ...(params.search ? { search: params.search } : {}),
    },
  })
  return data as { voices: ElevenLabsSharedVoice[]; has_more?: boolean; total_count?: number }
}

export const module3MediaUrl = (assetPath: string) => {
  if (/^(https?:|blob:)/i.test(assetPath)) return assetPath
  const base = api.defaults.baseURL || ''
  return `${base}${basePath}/media/${assetPath.replace(/^\/+/, '')}`
}

export const module3OutputUrl = (outputUrlOrPath: string) => {
  const base = api.defaults.baseURL || ''
  const value = outputUrlOrPath.replace(/^\/+/, '')
  if (value.startsWith('api/v1/module3/video-production/output/')) {
    return `${base.replace(/\/api\/v1$/, '')}/${value}`
  }
  return `${base}${basePath}/output/${value.replace(/^out\//, '')}`
}
