import { api, setAccessToken } from './client'

type LoginPayload = {
  email: string
  password: string
}

type RegisterPayload = LoginPayload & {
  full_name?: string
  roles?: string[]
}

export const loginApi = async (payload: LoginPayload) => {
  const { data } = await api.post('/auth/login', payload)
  setAccessToken(data.access_token)
  return data
}

export const registerApi = async (payload: RegisterPayload) => {
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
