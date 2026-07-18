import { api } from './client'

export const fetchArticlesApi = async (
  page = 1,
  status?: string,
  search?: string,
  startDate?: string,
  endDate?: string,
  hasVideo?: boolean | string,
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

export const fetchMyArticleFeedApi = async (page = 1, includeLow = false) => {
  const { data } = await api.get('/articles/feed', { params: { page, limit: 20, include_low: includeLow } })
  return data
}

export const fetchCrawlSettingsApi = async () => {
  const { data } = await api.get('/articles/crawl-settings')
  return data
}

export const updateCrawlSettingsApi = async (payload: any) => {
  const { data } = await api.put('/articles/crawl-settings', payload)
  return data
}

export const matchArticlesForMeApi = async (payload?: any) => {
  const { data } = await api.post('/articles/match-for-me', payload || {})
  return data
}

export const customTopicCrawlApi = async (payload: any) => {
  const { data } = await api.post('/articles/custom-crawl', payload)
  return data
}

export const fetchArticleDetailApi = async (link: string) => {
  const { data } = await api.get('/articles/detail', { params: { link } })
  return data
}

export const publishArticleApi = async (link: string, platforms: string[], profileIds: number[] = []) => {
  const { data } = await api.post('/publish', { link, platforms, profile_ids: profileIds })
  return data
}
