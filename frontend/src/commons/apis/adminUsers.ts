import { api } from './client'

const normalizeUserList = (data: unknown) => ({
  items: Array.isArray(data)
    ? data
    : Array.isArray((data as { items?: unknown })?.items)
      ? (data as { items: unknown[] }).items
      : [],
})

export type AdminUserFilterParams = {
  search?: string
  role?: string
  is_active?: boolean
}

export const fetchAdminUsersApi = async (filters?: AdminUserFilterParams) => {
  const params: Record<string, string> = {}
  if (filters?.search?.trim()) params.search = filters.search.trim()
  if (filters?.role) params.role = filters.role
  if (filters?.is_active !== undefined) params.is_active = String(filters.is_active)
  const { data } = await api.get('/users', { params })
  return normalizeUserList(data)
}

export const fetchUsersAiUsageSummaryApi = async () => {
  const { data } = await api.get('/users/ai-usage-summary')
  return data.users_ai_usage
}

export const createAdminUserApi = async (payload: any) => {
  const { data } = await api.post('/users', payload)
  return data
}

export const updateAdminUserApi = async (userId: number | string, payload: any) => {
  const { data } = await api.patch(`/users/${userId}`, payload)
  return data
}

export const deleteAdminUserApi = async (userId: number | string) => {
  const { data } = await api.delete(`/users/${userId}`)
  return data
}
