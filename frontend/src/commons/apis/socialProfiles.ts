import { api } from './client'

export const fetchSocialProfilesApi = async (platform?: string) => {
  const { data } = await api.get('/social-profiles', { params: platform ? { platform } : undefined })
  return data
}

export const fetchSocialProfileStrategyApi = async (profileId: string | number) => {
  const { data } = await api.get(`/social-profiles/${profileId}/strategy`)
  return data
}

export const updateSocialProfileStrategyApi = async (profileId: string | number, payload: any) => {
  const { data } = await api.put(`/social-profiles/${profileId}/strategy`, payload)
  return data
}

export const fetchSocialProfileQueueApi = async (profileId: string | number, queueStatus?: string) => {
  const { data } = await api.get(`/social-profiles/${profileId}/queue`, {
    params: queueStatus ? { queue_status: queueStatus } : undefined,
  })
  return data
}

export const fetchPublishingQueueApi = async (queueStatus?: string) => {
  const { data } = await api.get('/social-profiles/queue/items', {
    params: queueStatus ? { queue_status: queueStatus } : undefined,
  })
  return data
}

export const updatePublishingQueueItemApi = async (queueItemId: string | number, status: string) => {
  const { data } = await api.patch(`/social-profiles/queue/items/${queueItemId}`, { status })
  return data
}

export const publishPublishingQueueItemApi = async (queueItemId: string | number) => {
  const { data } = await api.post(`/social-profiles/queue/items/${queueItemId}/publish`)
  return data
}

export const createSocialProfileApi = async (payload: any) => {
  const { data } = await api.post('/social-profiles', payload)
  return data
}

export const deleteSocialProfileApi = async (profileId: string | number) => {
  const { data } = await api.delete(`/social-profiles/${profileId}`)
  return data
}

export const fetchSocialPostsApi = async (profileId: string | number) => {
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
