import axios from 'axios'

const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api' })

export const fetchArticlesApi = async (
  page = 1, 
  status?: string, 
  search?: string, 
  startDate?: string, 
  endDate?: string,
  hasVideo?: boolean | string
) => {
  const params: Record<string, string | number | boolean> = { page, limit: 20 }
  if (status) params.status = status
  if (search) params.search = search
  if (startDate) params.start_date = startDate
  if (endDate) params.end_date = endDate
  if (hasVideo !== undefined && hasVideo !== '') params.has_video = hasVideo === 'true' || hasVideo === true
  const { data } = await api.get('/articles', { params })
  return data
}

export const fetchArticleDetailApi = async (link: string) => {
  const { data } = await api.get('/articles/detail', { params: { link } })
  return data
}

export const fetchStatsApi = async () => {
  const { data } = await api.get('/stats')
  return data
}

export const publishArticleApi = async (link: string, platforms: string[]) => {
  const { data } = await api.post('/publish', { link, platforms })
  return data
}

export const triggerCrawlApi = async () => {
  const { data } = await api.post('/publish/crawl-now')
  return data
}

export const fetchSchedulerStatusApi = async () => {
  const { data } = await api.get('/publish/scheduler/status')
  return data
}

export const startSchedulerApi = async (interval_minutes: number = 30) => {
  const { data } = await api.post('/publish/scheduler/start', { interval_minutes })
  return data
}

export const stopSchedulerApi = async () => {
  const { data } = await api.post('/publish/scheduler/stop')
  return data
}
