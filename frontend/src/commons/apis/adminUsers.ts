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
  page?: number
  limit?: number
}

export const fetchAdminUsersApi = async (filters?: AdminUserFilterParams) => {
  const params: Record<string, string> = {}
  if (filters?.search?.trim()) params.search = filters.search.trim()
  if (filters?.role) params.role = filters.role
  if (filters?.is_active !== undefined) params.is_active = String(filters.is_active)
  if (filters?.page) params.page = String(filters.page)
  if (filters?.limit) params.limit = String(filters.limit)

  const res = await api.get('/users', { params })
  const data = res.data

  const items = Array.isArray(data)
    ? data
    : Array.isArray(data?.items)
      ? data.items
      : []

  const pagination = data?.pagination || {
    page: filters?.page || 1,
    limit: filters?.limit || 10,
    total: typeof data?.total === 'number' ? data.total : items.length,
    totalPages: Math.ceil((typeof data?.total === 'number' ? data.total : items.length) / (filters?.limit || 10)) || 1,
  }

  return {
    items,
    pagination,
  }
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

export const fetchUserDetailsApi = async (userId: number | string) => {
  const { data } = await api.get(`/users/${userId}/details`)
  return data
}

export const toggleUserActiveApi = async (userId: number | string) => {
  const { data } = await api.patch(`/users/${userId}/toggle-active`)
  return data
}

export type AdminUserSocialProfile = {
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
  created_at: string
}

export const fetchUserSocialProfilesApi = async (userId: string): Promise<{ items: AdminUserSocialProfile[] }> => {
  const { data } = await api.get(`/users/${userId}/social-profiles`)
  return data
}
