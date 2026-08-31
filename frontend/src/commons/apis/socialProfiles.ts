import { api } from './client'

export type SocialProfileStrategyPayload = {
  content_topics?: string | null
  content_topic_descriptions?: Record<string, string> | null
  avoid_topics?: string | null
  avoid_topic_descriptions?: Record<string, string> | null
  tone?: string | null
  target_audience?: string | null
  post_frequency_per_day?: number | null
  active_hours?: string | null
  schedule_enabled?: boolean | null
  schedule_days?: string | null
  schedule_times?: string | null
  schedule_timezone?: string | null
  approval_mode?: string | null
  risk_level?: string | null
  min_similarity?: number | null
  avoid_similarity_threshold?: number | null
  require_video?: boolean | null
  receive_system_content?: boolean | null
  auto_project_queue_enabled?: boolean | null
  video_render_mode?: string | null
  max_system_recommendations?: number | null
  auto_queue_enabled?: boolean | null
  auto_publish_enabled?: boolean | null
}

export type StrategyTopicDetail = {
  topic: string
  topic_key: string
  description: string
  embedding_text: string
  custom_description?: boolean
}

export type SocialProfileStrategy = {
  id: string
  content_topics: string
  content_topic_descriptions?: Record<string, string>
  content_topic_details?: StrategyTopicDetail[]
  avoid_topics: string
  avoid_topic_descriptions?: Record<string, string>
  avoid_topic_details?: StrategyTopicDetail[]
  tone: string
  target_audience: string
  post_frequency_per_day: number
  active_hours: string
  schedule_enabled: boolean
  schedule_days: string
  schedule_times: string
  schedule_timezone: string
  approval_mode: string
  risk_level: string
  min_similarity: number
  avoid_similarity_threshold: number
  require_video: boolean
  receive_system_content: boolean
  auto_project_queue_enabled: boolean
  video_render_mode: string
  max_system_recommendations: number
  auto_queue_enabled: boolean
  auto_publish_enabled: boolean
  created_at: string
  updated_at: string
}

export type SocialProfile = {
  id: string
  platform: string
  profile_name: string
  username?: string | null
  external_id?: string | null
  avatar_url?: string | null
  follower_count?: number | null
  following_count?: number | null
  likes_count?: number | null
  video_count?: number | null
  status: string
  scopes: string[]
  metadata: Record<string, unknown>
  token_expires_at?: string | null
  refresh_expires_at?: string | null
  created_at: string
  strategy?: SocialProfileStrategy | null
}

export type SocialProfileListResponse = {
  items: SocialProfile[]
}

export const fetchSocialProfilesApi = async (platform?: string): Promise<SocialProfileListResponse> => {
  const { data } = await api.get('/social-profiles', { params: platform ? { platform } : undefined })
  return data
}

export const fetchSocialProfileStrategyApi = async (profileId: string | number): Promise<SocialProfileStrategy> => {
  const { data } = await api.get(`/social-profiles/${profileId}/strategy`)
  return data
}

export const updateSocialProfileStrategyApi = async (profileId: string | number, payload: SocialProfileStrategyPayload): Promise<SocialProfileStrategy> => {
  const { data } = await api.put(`/social-profiles/${profileId}/strategy`, payload)
  return data
}

export const fetchStrategyTopicDescriptionsApi = async (topics: string): Promise<StrategyTopicDetail[]> => {
  const { data } = await api.get('/social-profiles/topic-descriptions', { params: { topics } })
  return data
}

export const fetchSocialProfileStrategyTopicsApi = async (profileId: string | number, kind: 'content' | 'avoid' = 'content'): Promise<StrategyTopicDetail[]> => {
  const { data } = await api.get(`/social-profiles/${profileId}/strategy/topics`, { params: { kind } })
  return data
}

export const addSocialProfileStrategyTopicApi = async (
  profileId: string | number,
  payload: { kind?: 'content' | 'avoid'; topic: string; description?: string | null },
): Promise<SocialProfileStrategy> => {
  const { data } = await api.post(`/social-profiles/${profileId}/strategy/topics`, payload)
  return data
}

export const updateSocialProfileStrategyTopicApi = async (
  profileId: string | number,
  topicKey: string,
  payload: { kind?: 'content' | 'avoid'; topic?: string | null; description?: string | null },
): Promise<SocialProfileStrategy> => {
  const { data } = await api.put(`/social-profiles/${profileId}/strategy/topics/${encodeURIComponent(topicKey)}`, payload)
  return data
}

export const deleteSocialProfileStrategyTopicApi = async (
  profileId: string | number,
  topicKey: string,
  kind: 'content' | 'avoid' = 'content',
): Promise<SocialProfileStrategy> => {
  const { data } = await api.delete(`/social-profiles/${profileId}/strategy/topics/${encodeURIComponent(topicKey)}`, { params: { kind } })
  return data
}

export type PublishingQueueFilters = {
  queue_status?: string
  status?: string
  profile_id?: string | number
  platform?: string
  start_date?: string
  end_date?: string
  q?: string
  view?: 'schedule' | string
  timezone?: string
}

export const fetchSocialProfileQueueApi = async (profileId: string | number, filters?: string | Omit<PublishingQueueFilters, 'profile_id' | 'platform'>) => {
  const params = typeof filters === 'string' ? { queue_status: filters } : filters
  const { data } = await api.get(`/social-profiles/${profileId}/queue`, {
    params,
  })
  return data
}

export const fetchPublishingQueueApi = async (filters?: string | PublishingQueueFilters) => {
  const params = typeof filters === 'string' ? { queue_status: filters } : filters
  const { data } = await api.get('/social-profiles/queue/items', {
    params,
  })
  return data
}

export const fetchPublishingQueueItemApi = async (queueItemId: string | number) => {
  const { data } = await api.get(`/social-profiles/queue/items/${queueItemId}`)
  return data
}

export const fetchPublishingQueueApprovalItemApi = async (queueItemId: string | number) => {
  const { data } = await api.get(`/social-profiles/queue/items/${queueItemId}`, {
    params: { view: 'approval', timezone: 'Asia/Bangkok' },
  })
  return data
}

export const updatePublishingQueueItemApi = async (queueItemId: string | number, status: string) => {
  const { data } = await api.patch(`/social-profiles/queue/items/${queueItemId}`, { status })
  return data
}

export const approveAndScheduleQueueItemApi = async (
  queueItemId: string | number,
  payload: {
    schedule_mode: 'ai' | 'manual'
    scheduled_at?: string | null
    timezone?: string
  },
) => {
  const { data } = await api.post(`/social-profiles/queue/items/${queueItemId}/approve-schedule`, payload, { timeout: 60000 })
  return data
}

export const requestPublishingQueueItemChangesApi = async (queueItemId: string | number, note?: string | null) => {
  const { data } = await api.post(`/social-profiles/queue/items/${queueItemId}/request-changes`, { note })
  return data
}

export const approveAndPublishQueueItemNowApi = async (
  queueItemId: string | number,
  payload: {
    mode?: 'inbox' | 'direct'
    privacy_level?: string | null
    disable_comment?: boolean
    disable_duet?: boolean
    disable_stitch?: boolean
    is_aigc?: boolean
    brand_content_toggle?: boolean
    brand_organic_toggle?: boolean
  } = {},
) => {
  const { data } = await api.post(`/social-profiles/queue/items/${queueItemId}/approve-publish-now`, payload)
  return data
}

export const publishPublishingQueueItemApi = async (
  queueItemId: string | number,
  payload: {
    mode?: 'inbox' | 'direct'
    privacy_level?: string | null
    disable_comment?: boolean
    disable_duet?: boolean
    disable_stitch?: boolean
    is_aigc?: boolean
    brand_content_toggle?: boolean
    brand_organic_toggle?: boolean
  } = {},
) => {
  const { data } = await api.post(`/social-profiles/queue/items/${queueItemId}/publish`, payload)
  return data
}

export const refreshPublishingQueueItemPublishStatusApi = async (
  queueItemId: string | number,
  params?: {
    view?: 'schedule' | 'approval' | string
    timezone?: string
  },
) => {
  const { data } = await api.post(`/social-profiles/queue/items/${queueItemId}/publish-status`, null, { params })
  return data
}

export const createSocialProfileApi = async (payload: any): Promise<SocialProfile> => {
  const { data } = await api.post('/social-profiles', payload)
  return data
}

export const deleteSocialProfileApi = async (profileId: string | number) => {
  const { data } = await api.delete(`/social-profiles/${profileId}`)
  return data
}

export type SyncSocialProfileResponse = {
  profile: SocialProfile
  synced_videos_count?: number
  resolved_post_ids_count?: number
  snapshot_created?: boolean
  synced_at?: string
}

export type SocialPostMetric = {
  id: string
  views: number
  likes: number
  comments: number
  shares: number
  captured_at: string
}

export type SocialPost = {
  id: string
  profile_id: string
  title: string
  post_url?: string | null
  platform_post_id?: string | null
  platform_publish_id?: string | null
  tiktok_embed_url?: string | null
  caption?: string | null
  status: string
  published_at: string
  created_at: string
  latest_metric?: SocialPostMetric | null
  growth?: {
    views_1h?: number | null
    views_24h?: number | null
    views_7d?: number | null
  } | null
  metrics?: SocialPostMetric[]
}

export type SocialPostsResponse = {
  items: SocialPost[]
}

export const syncSocialProfileApi = async (profileId: string | number): Promise<SyncSocialProfileResponse> => {
  const { data } = await api.post(`/social-profiles/${profileId}/sync`)
  return data
}

export const fetchProfileSnapshotsApi = async (profileId: string | number, days: number = 30) => {
  const { data } = await api.get(`/social-profiles/${profileId}/snapshots`, { params: { days } })
  return data
}

export const fetchSocialPostsApi = async (profileId: string | number): Promise<SocialPostsResponse> => {
  const { data } = await api.get(`/social-profiles/${profileId}/posts`)
  return data
}

export const fetchSocialPostOverviewApi = async () => {
  const { data } = await api.get('/social-profiles/posts/overview')
  return data
}

export const createSocialPostApi = async (profileId: string | number, payload: any) => {
  const { data } = await api.post(`/social-profiles/${profileId}/posts`, payload)
  return data
}

export const deleteSocialPostApi = async (postId: string | number) => {
  const { data } = await api.delete(`/social-profiles/post-items/${postId}`)
  return data
}

export const createSocialPostMetricApi = async (postId: string | number, payload: any) => {
  const { data } = await api.post(`/social-profiles/post-items/${postId}/metrics`, payload)
  return data
}

export const startPendingTikTokQrLoginApi = async (payload: any) => {
  const { data } = await api.post('/social-profiles/tiktok/qr/start', payload)
  return data
}

export const getPendingTikTokQrLoginStatusApi = async (sessionId: string, params?: any) => {
  const { data } = await api.get(`/social-profiles/tiktok/qr/${sessionId}/status`, { params })
  return data
}

export const stopPendingTikTokQrLoginApi = async (sessionId: string) => {
  const { data } = await api.post(`/social-profiles/tiktok/qr/${sessionId}/stop`)
  return data
}

export const startTikTokQrLoginApi = async (profileId: string | number) => {
  const { data } = await api.post(`/social-profiles/${profileId}/tiktok/qr/start`)
  return data
}

export const getTikTokQrLoginStatusApi = async (profileId: string | number) => {
  const { data } = await api.get(`/social-profiles/${profileId}/tiktok/qr/status`)
  return data
}

export const stopTikTokQrLoginApi = async (profileId: string | number) => {
  const { data } = await api.post(`/social-profiles/${profileId}/tiktok/qr/stop`)
  return data
}
