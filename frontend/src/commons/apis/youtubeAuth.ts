import { api } from './client'

// ── Pending (new profile) ─────────────────────────────────────────────────────

export const initYouTubeOAuthApi = async (payload: { profile_name?: string }) => {
  const { data } = await api.post('/social-profiles/youtube/oauth/init', payload)
  return data as { auth_url: string; state: string }
}

export const getYouTubeOAuthStatusApi = async (state: string, profileName?: string) => {
  const params = profileName ? { profile_name: profileName } : {}
  const { data } = await api.get(
    `/social-profiles/youtube/oauth/${encodeURIComponent(state)}/status`,
    { params },
  )
  return data as { authenticated: boolean; status?: string; profile?: unknown }
}

export const cancelYouTubeOAuthApi = async (state: string) => {
  const { data } = await api.post(
    `/social-profiles/youtube/oauth/${encodeURIComponent(state)}/cancel`,
  )
  return data
}

// ── Existing profile reconnect ────────────────────────────────────────────────

export const initYouTubeOAuthForProfileApi = async (profileId: string | number) => {
  const { data } = await api.post(`/social-profiles/${profileId}/youtube/oauth/init`)
  return data as { auth_url: string; state: string }
}

export const getYouTubeOAuthStatusForProfileApi = async (
  profileId: string | number,
  state: string,
) => {
  const { data } = await api.get(
    `/social-profiles/${profileId}/youtube/oauth/${encodeURIComponent(state)}/status`,
  )
  return data as { authenticated: boolean; status?: string }
}

export const cancelYouTubeOAuthForProfileApi = async (
  profileId: string | number,
  state: string,
) => {
  const { data } = await api.post(
    `/social-profiles/${profileId}/youtube/oauth/${encodeURIComponent(state)}/cancel`,
  )
  return data
}
