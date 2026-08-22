import { api, setAccessToken } from './client'

export const loginApi = async (payload: any) => {
  const { data } = await api.post('/auth/login', payload)
  setAccessToken(data.access_token)
  return data
}

export const registerApi = async (payload: any) => {
  const { data } = await api.post('/auth/register', payload)
  return data
}

export const getCurrentUserApi = async () => {
  const { data } = await api.get('/auth/me', { timeout: 3500 })
  return data
}

export const logoutApi = async () => {
  const { data } = await api.post('/auth/logout')
  setAccessToken(null)
  return data
}

export const getMyAiUsageApi = async () => {
  const { data } = await api.get('/users/me/ai-usage')
  return data
}

export const getAllUsersAiUsageApi = async () => {
  const { data } = await api.get('/users/ai-usage-summary')
  return data
}
