import { api } from './client'

export const fetchStatsApi = async () => {
  const { data } = await api.get('/stats')
  return data
}
