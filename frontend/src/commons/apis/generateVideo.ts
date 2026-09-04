import { api } from './client'
import { normalizeVideoWorkspaceList } from './videoWorkspaceList'
import { mediaProxyPlaybackUrl } from '@/commons/mediaUrls'
export type { VideoWorkspaceSummary } from './videoWorkspaceList'

export type GenerateVideoScene = {
  scene_index?: number
  video_id?: string
  video_ids?: string[]
  text_id?: string
  text_ids?: string[]
  text_weights?: Record<string, number>
  source_media_index?: number
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
  role?: string
  evidence_ids?: string[]
  visual_query?: string
  timing?: { start?: number; end?: number; voice_start?: number; voice_end?: number }
}

export type GenerateVideoTimeline = {
  version?: number
  duration?: number
  metadata?: Record<string, unknown>
  video?: Array<{ id: string; scene_index?: number; text_id?: string; text_ids?: string[]; text_weights?: Record<string, number>; source_media_index?: number; visual_direction?: string; type: string; start: number; end: number; duration?: number; src?: string; effect?: string; fit?: 'cover' | 'contain' | string; scale?: number; opacity?: number; position_x?: number; position_y?: number; rotation?: number }>
  text?: Array<{ id: string; scene_index?: number; video_id?: string; video_ids?: string[]; type: string; start: number; end: number; duration?: number; text: string; voice_text?: string; role?: string; evidence_ids?: string[]; style?: Record<string, unknown>; timing?: { start?: number; end?: number; voice_start?: number; voice_end?: number } }>
  audio?: Array<{ id: string; type: 'voice' | 'music' | 'sfx' | 'audio' | string; start: number; end?: number | null; src?: string; volume?: number }>
}

export type GenerateVideoStory = {
  meta?: {
    workflow_id?: string | null
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
    quality?: Record<string, unknown>
    draft_review?: Record<string, unknown>
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
  compact_scenes?: Array<{
    text_id?: string
    role?: string
    voice_text?: string
    evidence_ids?: string[]
    visual_query?: string
    source_media_index?: number
  }>
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
  workflow_id: string
  run_type?: string
  task_type?: string
  status: 'QUEUED' | 'RUNNING' | 'RENDERED' | 'FAILED' | string
  progress_percent: number
  current_stage?: string | null
  output_path?: string | null
  video_url?: string | null
  error_message?: string | null
  story?: GenerateVideoStory | null
  created_at: string
  updated_at?: string
  started_at?: string | null
  completed_at?: string | null
}

export type VideoWorkflowTask = {
  id: string
  workflow_id: string
  task_type: string
  status: string
  current_stage?: string | null
  progress_percent: number
  error_message?: string | null
  created_at: string
  started_at?: string | null
  completed_at?: string | null
}

export type VideoWorkspaceDetail = {
  id: string
  profile?: { id: string; name: string; platform: string } | null
  series?: { id: string; title: string; description?: string | null; status: string; current_part: number; total_parts: number } | null
  primary_content_id?: string | null
  title: string
  status: string
  current_stage?: string | null
  progress_percent: number
  planning_mode?: string | null
  metadata: Record<string, unknown>
  source_content?: Record<string, unknown> | null
  draft: Partial<GenerateVideoStory> & { story_data?: GenerateVideoScene[] }
  final_video?: string | null
  tasks: VideoWorkflowTask[]
  capabilities: {
    can_generate_draft: boolean
    can_edit: boolean
    can_approve_draft: boolean
    can_generate_voice: boolean
    can_render: boolean
    can_approve: boolean
    can_queue: boolean
  }
  created_at: string
  updated_at: string
}

export type VideoWorkflowProgress = {
  workflow_id: string
  status: string
  current_stage?: string | null
  progress_percent: number
  tasks: VideoWorkflowTask[]
  final_video?: string | null
  updated_at?: string | null
}

const basePath = '/generate-video'
const defaultVideo = { width: 1080, height: 1920, fps: 30, background: '#05070b' }
const defaultAudio = { voiceVolume: 1, musicVolume: 0 }
const renderJobRequestCache = new Map<string, Promise<{ job: GenerateVideoJob }>>()

const normalizeSceneMediaType = (value?: string | null, src?: string | null): 'image' | 'video' => {
  if (String(value || '').toLowerCase().includes('video')) return 'video'
  if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(String(src || ''))) return 'video'
  return 'image'
}

const defaultMediaForType = (type: 'image' | 'video') => {
  return type === 'video' ? '' : 'assets/images/001-signal-room.png'
}

const storyDataToTimeline = (storyData: GenerateVideoScene[]): GenerateVideoTimeline => {
  let cursor = 0
  const video: NonNullable<GenerateVideoTimeline['video']> = []
  const text: NonNullable<GenerateVideoTimeline['text']> = []
  storyData.forEach((scene, index) => {
    const duration = Math.max(0.1, Number(scene.duration || 4))
    const start = cursor
    const end = cursor + duration
    const mediaType = normalizeSceneMediaType(scene.media_type, scene.image)
    const videoId = scene.video_id || `video-${index + 1}`
    video.push({
      id: videoId,
      scene_index: scene.scene_index,
      text_id: scene.text_id || `text-${index + 1}`,
      text_ids: scene.text_ids || [scene.text_id || `text-${index + 1}`],
      type: mediaType,
      start,
      end,
      duration,
      src: scene.image || defaultMediaForType(mediaType),
      effect: scene.effect || 'slow-zoom',
      fit: scene.fit || 'contain',
    })
    if (scene.subtitle) {
      const textStart = typeof scene.subtitle_start === 'number' ? scene.subtitle_start : start
      const textDuration = typeof scene.subtitle_duration === 'number' ? scene.subtitle_duration : duration
      text.push({
        id: scene.text_id || `text-${index + 1}`,
        scene_index: scene.scene_index,
        video_id: videoId,
        video_ids: scene.video_ids || [videoId],
        type: 'subtitle',
        start: textStart,
        end: textStart + textDuration,
        duration: textDuration,
        text: scene.subtitle,
        voice_text: scene.voice_text || scene.voice_subtitle,
        role: scene.role,
        evidence_ids: scene.evidence_ids,
        timing: scene.timing,
      })
    }
    cursor = end
  })
  return { version: 1, duration: cursor, video: collapseSharedVideoTimeline(video), text, audio: [] }
}

const collapseSharedVideoTimeline = (video: NonNullable<GenerateVideoTimeline['video']>) => {
  const groups = new Map<string, NonNullable<GenerateVideoTimeline['video']>[number]>()
  const order: string[] = []
  const passthrough: NonNullable<GenerateVideoTimeline['video']> = []

  video.forEach((clip) => {
    if (clip.type !== 'video') {
      passthrough.push(clip)
      return
    }
    const key = `${clip.id}::${clip.src || ''}`
    const existing = groups.get(key)
    if (!existing) {
      order.push(key)
      groups.set(key, { ...clip })
      return
    }
    const start = Math.min(Number(existing.start || 0), Number(clip.start || 0))
    const end = Math.max(Number(existing.end || 0), Number(clip.end || 0))
    const textIds = Array.from(
      new Set([...(existing.text_ids || []), ...(clip.text_ids || []), clip.text_id].filter((item): item is string => Boolean(item))),
    )
    groups.set(key, {
      ...existing,
      start,
      end,
      duration: Math.max(0.1, end - start),
      text_ids: textIds,
      text_id: textIds[0] || existing.text_id,
    })
  })

  return [...passthrough, ...order.map((key) => groups.get(key)!).filter(Boolean)].sort((left, right) => left.start - right.start || left.end - right.end)
}

export const normalizeStoryResponse = (data: Partial<GenerateVideoStory>): GenerateVideoStory => {
  const storyData = data.story_data || data.scenes || []
  const timeline = data.timeline || storyDataToTimeline(storyData)
  return {
    meta: data.meta,
    video: data.video || defaultVideo,
    audio: data.audio || defaultAudio,
    timeline,
    source: data.source,
    story_data: storyData,
    compact_scenes: data.compact_scenes,
  }
}

export const createGenerateVideoStoryFromProjectApi = async (workflowId: string) => {
  const { data } = await api.post(`${basePath}/projects/${workflowId}/create-story`, undefined, { timeout: 90000 })
  return data as { job: GenerateVideoJob }
}

export const saveGenerateVideoStoryApi = async (story: GenerateVideoStory) => {
  const workflowId = story.meta?.workflow_id
  if (!workflowId) throw new Error('Missing workflow_id')
  const { data } = await api.post(`${basePath}/save-story`, { workflow_id: workflowId, story })
  return data as { story: GenerateVideoStory; script_signature: string }
}

export const editGenerateVideoStoryWithAiApi = async (workflowId: string, prompt: string) => {
  const { data } = await api.post(`${basePath}/edit-story`, { workflow_id: workflowId, prompt })
  return data as { job: GenerateVideoJob }
}

export const reviewGenerateVideoStoryWithAiApi = async (workflowId: string, instructions?: string) => {
  const { data } = await api.post(`${basePath}/review-story`, { workflow_id: workflowId, instructions })
  return data as { job: GenerateVideoJob }
}

export const generateFinalVideoApi = async (workflowId: string) => {
  const { data } = await api.post(`${basePath}/generate-video`, { workflow_id: workflowId })
  return data as { job: GenerateVideoJob }
}

export const renderGenerateVideoProjectApi = async (workflowId: string) => {
  const { data } = await api.post(`${basePath}/projects/${workflowId}/render`)
  return data as { job: GenerateVideoJob }
}

export const approveGenerateVideoProjectApi = async (workflowId: string) => {
  const { data } = await api.post(`${basePath}/projects/${workflowId}/approve-video`, undefined, { timeout: 60000 })
  return data as { workflow_id: string; status: string; rendered_video: string }
}

export const approveGenerateVideoDraftApi = async (workflowId: string, scriptSignature: string) => {
  const { data } = await api.post(`${basePath}/projects/${workflowId}/approve-draft`, { script_signature: scriptSignature })
  return data as {
    workflow_id: string
    status: string
    current_stage: string
    series_id?: string | null
    series_applied: boolean
    series_warning?: string | null
    job?: GenerateVideoJob | null
  }
}

export const queueGenerateVideoProjectApi = async (
  workflowId: string,
  payload: { scheduled_at?: string | null; caption?: string | null; status?: 'queued' | 'needs_approval' | 'approved' } = {},
) => {
  const { data } = await api.post(`${basePath}/projects/${workflowId}/queue-post`, payload, { timeout: 60000 })
  return data as { workflow_id: string; status: string; queue_item: Record<string, unknown> }
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

export const generateVideoVoiceApi = async (workflowId: string, voiceId?: string, voiceSpeed = 1.2, voiceProvider: GenerateVideoVoiceProvider = 'edge_tts_namminh') => {
  const { data } = await api.post(`${basePath}/projects/${workflowId}/voice`, {
    voice_id: voiceId,
    voice_speed: voiceSpeed,
    voice_provider: voiceProvider,
  })
  return data as { job: GenerateVideoJob }
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

export const generateVideoMediaUrl = (assetPath: string) => {
  if (!assetPath) return ''
  let cleaned = assetPath.trim()
  cleaned = cleaned.replace(/^https?:\/\/(127\.0\.0\.1|localhost|host\.docker\.internal)(:\d+)?\/?/, '')
  cleaned = cleaned.replace(/^\/?(api\/v1\/generate-video\/media\/)+/, '')
  if (/^https?:/i.test(cleaned)) return mediaProxyPlaybackUrl(cleaned)
  if (/^blob:/i.test(cleaned)) return cleaned
  const base = api.defaults.baseURL || ''
  return `${base}${basePath}/media/${cleaned.replace(/^\/+/, '')}`
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

/**
 * Tạo MediaWorkflow từ content/story item trực tiếp + enqueue AI script generation ngay.
 * Bỏ qua hoàn toàn bước AI chọn lọc / đánh giá điểm.
 */
export const createDirectScriptApi = async (payload: {
  profile_id: string
  content_id: string
  title?: string
  instructions?: string
  target_duration_seconds?: number
  note?: string
}) => {
  const { data } = await api.post(`${basePath}/direct-script`, payload)
  return data as { workflow: Record<string, unknown>; job: GenerateVideoJob | null; reused: boolean }
}

export const fetchVideoWorkspacesApi = async (params: {
  profile_id?: string
  series_id?: string
  status?: string
  stage?: string
  search?: string
  limit?: number
  offset?: number
} = {}) => {
  const { data } = await api.get('/media-workflows/video-workspace', { params })
  return normalizeVideoWorkspaceList(data)
}

export const fetchVideoWorkspaceApi = async (workflowId: string) => {
  const { data } = await api.get(`/media-workflows/${workflowId}/workspace`)
  return data as VideoWorkspaceDetail
}

export const fetchVideoWorkflowProgressApi = async (workflowId: string) => {
  const { data } = await api.get(`/media-workflows/${workflowId}/progress`)
  return data as VideoWorkflowProgress
}

export const updateVideoWorkspaceApi = async (workflowId: string, payload: Record<string, unknown>) => {
  const { data } = await api.patch(`/media-workflows/${workflowId}`, payload)
  return data
}

export const deleteVideoWorkspaceApi = async (workflowId: string) => {
  const { data } = await api.delete(`/media-workflows/${workflowId}`)
  return data as { message: string; workflow_id: string }
}
