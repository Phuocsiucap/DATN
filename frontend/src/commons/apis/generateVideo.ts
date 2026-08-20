import { api } from './client'

export type GenerateVideoScene = {
  start?: number
  end?: number
  duration: number
  image: string
  effect: string
  subtitle: string
  media_type?: 'image' | 'video' | string
  fit?: 'cover' | 'contain' | string
  scale?: number
  opacity?: number
  position_x?: number
  position_y?: number
  rotation?: number
  subtitle_start?: number
  subtitle_duration?: number
  text_style?: Record<string, unknown>
  voice_subtitle?: string
  voice_text?: string
  timing?: { start?: number; end?: number; voice_start?: number; voice_end?: number }
}

export type GenerateVideoTimeline = {
  version?: number
  duration?: number
  video?: Array<{ id: string; scene_index?: number; type: string; start: number; end: number; duration?: number; src?: string; effect?: string; fit?: 'cover' | 'contain' | string; scale?: number; opacity?: number; position_x?: number; position_y?: number; rotation?: number }>
  text?: Array<{ id: string; scene_index?: number; type: string; start: number; end: number; duration?: number; text: string; voice_text?: string; style?: Record<string, unknown>; timing?: { start?: number; end?: number; voice_start?: number; voice_end?: number } }>
  audio?: Array<{ id: string; type: 'voice' | 'music' | 'sfx' | 'audio' | string; start: number; end?: number | null; src?: string; volume?: number }>
}

export type GenerateVideoStory = {
  meta?: {
    project_id?: string | null
    profile_id?: string | null
    series_id?: string | null
    plan_id?: string | null
    context_id?: string | null
    title?: string | null
    source_content_id?: string | null
    part_ids?: string[]
    source?: string
    ai_story_review?: GenerateVideoStoryReview | null
    voice_invalidated_by_story_review?: boolean
  }
  video: { width: number; height: number; fps: number; background: string }
  audio?: {
    voice?: string
    voiceProvider?: string
    voiceId?: string
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
  timeline?: GenerateVideoTimeline
  source?: Record<string, unknown>
  scenes?: GenerateVideoScene[]
  story_data?: GenerateVideoScene[]
}

export type GenerateVideoStoryReview = {
  approved?: boolean
  action?: 'APPROVED' | 'REVISED' | string
  notes?: string[]
  reviewed_at?: string
  provider?: string
  model?: string
}

export type GenerateVideoVoiceProvider = 'elevenlabs' | 'edge_tts_namminh' | 'edge_tts_hoaimy'

export type GenerateVideoJob = {
  id: string
  project_id: string
  run_type?: string
  status: 'QUEUED' | 'RUNNING' | 'RENDERED' | 'FAILED' | string
  progress_percent: number
  output_path?: string | null
  video_url?: string | null
  error_message?: string | null
  story?: GenerateVideoStory | null
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

const basePath = '/generate-video'
const defaultVideo = { width: 1080, height: 1920, fps: 30, background: '#05070b' }
const defaultAudio = { voiceVolume: 1, musicVolume: 0 }
const renderJobRequestCache = new Map<string, Promise<{ job: GenerateVideoJob }>>()

const storyDataToTimeline = (storyData: GenerateVideoScene[]): GenerateVideoTimeline => {
  let cursor = 0
  const video: NonNullable<GenerateVideoTimeline['video']> = []
  const text: NonNullable<GenerateVideoTimeline['text']> = []
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
      fit: scene.fit || 'contain',
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
        voice_text: scene.voice_text || scene.voice_subtitle,
        timing: scene.timing,
      })
    }
    cursor = end
  })
  return { version: 1, duration: cursor, video, text, audio: [] }
}

const normalizeStoryResponse = (data: Partial<GenerateVideoStory>): GenerateVideoStory => {
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

export const createGenerateVideoStoryFromManualApi = async (source: any) => {
  const { data } = await api.post(`${basePath}/create-story`, { source }, { timeout: 90000 })
  return normalizeStoryResponse(data)
}

export const createGenerateVideoStoryFromProjectApi = async (projectId: string) => {
  const { data } = await api.post(`${basePath}/projects/${projectId}/create-story`, undefined, { timeout: 90000 })
  return data as { job: GenerateVideoJob }
}

export const saveGenerateVideoStoryApi = async (story: GenerateVideoStory) => {
  const projectId = story.meta?.project_id
  if (!projectId) throw new Error('Missing project_id')
  const { data } = await api.post(`${basePath}/save-story`, { project_id: projectId, story })
  return data as { story: GenerateVideoStory }
}

export const fetchGenerateVideoSavedStoryApi = async (projectId: string) => {
  const { data } = await api.get(`${basePath}/projects/${projectId}/story`)
  return normalizeStoryResponse(data)
}

export const editGenerateVideoStoryWithAiApi = async (story: GenerateVideoStory, prompt: string) => {
  const projectId = story.meta?.project_id
  if (!projectId) throw new Error('Missing project_id')
  const { data } = await api.post(`${basePath}/edit-story`, { project_id: projectId, story, prompt }, { timeout: 90000 })
  return normalizeStoryResponse(data)
}

export const reviewGenerateVideoStoryWithAiApi = async (story: GenerateVideoStory, instructions?: string) => {
  const projectId = story.meta?.project_id
  if (!projectId) throw new Error('Missing project_id')
  const { data } = await api.post(`${basePath}/review-story`, { project_id: projectId, story, instructions }, { timeout: 90000 })
  return { story: normalizeStoryResponse(data.story), review: data.review as GenerateVideoStoryReview | undefined }
}

export const generateFinalVideoApi = async (story: GenerateVideoStory) => {
  const projectId = story.meta?.project_id
  if (!projectId) throw new Error('Missing project_id')
  const { data } = await api.post(`${basePath}/generate-video`, { project_id: projectId, story })
  return data as { job: GenerateVideoJob }
}

export const approveGenerateVideoProjectApi = async (projectId: string) => {
  const { data } = await api.post(`${basePath}/projects/${projectId}/approve-video`)
  return data as { project_id: string; status: string; rendered_video: string }
}

export const queueGenerateVideoProjectApi = async (
  projectId: string,
  payload: { scheduled_at?: string | null; caption?: string | null; status?: 'queued' | 'needs_approval' | 'approved' } = {},
) => {
  const { data } = await api.post(`${basePath}/projects/${projectId}/queue-post`, payload)
  return data as { project_id: string; status: string; queue_item: Record<string, unknown> }
}

export const fetchGenerateVideoJobApi = async (jobId: string) => {
  const pending = renderJobRequestCache.get(jobId)
  if (pending) return pending
  const request = api
    .get(`${basePath}/render-jobs/${jobId}`)
    .then(({ data }) => data as { job: GenerateVideoJob })
    .finally(() => {
      renderJobRequestCache.delete(jobId)
    })
  renderJobRequestCache.set(jobId, request)
  return request
}

export const generateVideoVoiceApi = async (story: GenerateVideoStory, voiceId?: string, voiceSpeed = 1, voiceProvider: GenerateVideoVoiceProvider = 'elevenlabs') => {
  const projectId = story.meta?.project_id
  if (!projectId) throw new Error('Missing project_id')
  const { data } = await api.post(`${basePath}/emotion-voice`, { project_id: projectId, story, voice_id: voiceId, voice_speed: voiceSpeed, voice_provider: voiceProvider }, { timeout: 300000 })
  return data as { meta?: GenerateVideoStory['meta']; audio: GenerateVideoStory['audio']; timeline?: GenerateVideoStory['timeline']; voice_id: string; voice_provider?: GenerateVideoVoiceProvider; voice_speed: number; voice_text?: string; audio_url: string; debug?: any; fit_frame_error?: string | null }
}

export const fitGenerateVideoFramesApi = async (story: GenerateVideoStory) => {
  const projectId = story.meta?.project_id
  if (!projectId) throw new Error('Missing project_id')
  const { data } = await api.post(`${basePath}/fit-frames`, { project_id: projectId, story }, { timeout: 180000 })
  return data as { meta?: GenerateVideoStory['meta']; audio?: GenerateVideoStory['audio']; timeline?: GenerateVideoStory['timeline']; debug: any }
}

export const uploadGenerateVideoAudioApi = async (file: File) => {
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

export const generateVideoMediaUrl = (assetPath: string) => {
  if (/^(https?:|blob:)/i.test(assetPath)) return assetPath
  const base = api.defaults.baseURL || ''
  return `${base}${basePath}/media/${assetPath.replace(/^\/+/, '')}`
}

export const generateVideoOutputUrl = (outputUrlOrPath: string) => {
  if (/^(https?:|blob:)/i.test(outputUrlOrPath)) return outputUrlOrPath
  const base = api.defaults.baseURL || ''
  const value = outputUrlOrPath.replace(/^\/+/, '')
  if (value.startsWith('api/v1/generate-video/output/')) {
    return `${base.replace(/\/api\/v1$/, '')}/${value}`
  }
  return `${base}${basePath}/output/${value.replace(/^out\//, '')}`
}
