import { api } from './client'

export const fetchAdminUsersApi = async () => {
  const { data } = await api.get('/admin/users')
  return data
}

export const createAdminUserApi = async (payload: any) => {
  const { data } = await api.post('/admin/users', payload)
  return data
}

export const updateAdminUserApi = async (userId: number, payload: any) => {
  const { data } = await api.patch(`/admin/users/${userId}`, payload)
  return data
}

export const deleteAdminUserApi = async (userId: number) => {
  const { data } = await api.delete(`/admin/users/${userId}`)
  return data
}
