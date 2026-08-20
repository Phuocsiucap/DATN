import { api } from './client'

const normalizeUserList = (data: unknown) => ({
  items: Array.isArray(data)
    ? data
    : Array.isArray((data as { items?: unknown })?.items)
      ? (data as { items: unknown[] }).items
      : [],
})

export const fetchAdminUsersApi = async () => {
  const { data } = await api.get('/users')
  return normalizeUserList(data)
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
