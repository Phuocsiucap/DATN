import { api } from './client'

// Pending (new profile)
export const initTikTokOAuthApi = async (payload: { profile_name?: string; username?: string }) => {
  const { data } = await api.post('/social-profiles/tiktok/oauth/init', payload)
  return data as { auth_url: string; state: string }
}

export const getTikTokOAuthStatusApi = async (state: string) => {
  const { data } = await api.get(`/social-profiles/tiktok/oauth/${state}/status`)
  return data as { authenticated: boolean; status?: string; profile?: unknown }
}

export const cancelTikTokOAuthApi = async (state: string) => {
  const { data } = await api.post(`/social-profiles/tiktok/oauth/${state}/cancel`)
  return data
}

// For existing profile
export const initTikTokOAuthForProfileApi = async (profileId: string | number, payload: { username?: string } = {}) => {
  const { data } = await api.post(`/social-profiles/${profileId}/tiktok/oauth/init`, payload)
  return data as { auth_url: string; state: string }
}

export const getTikTokOAuthStatusForProfileApi = async (profileId: string | number, state: string) => {
  const { data } = await api.get(`/social-profiles/${profileId}/tiktok/oauth/${state}/status`)
  return data as { authenticated: boolean; status?: string }
}
