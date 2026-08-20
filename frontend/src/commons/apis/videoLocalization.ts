import { api, assertLegacyGatewayApiBase, isSocialContentApiBase } from './client'

export const searchBilibiliVideosApi = async (q: string, limit = 10) => {
  assertLegacyGatewayApiBase('Video localization')
  const { data } = await api.get('/video-localization/bilibili/search', { params: { q, limit } })
  return data
}

export const fetchBilibiliVideoDetailApi = async (params: { bvid?: string | number; aid?: string | number }) => {
  assertLegacyGatewayApiBase('Video localization')
  const { data } = await api.get('/video-localization/bilibili/detail', { params })
  return data
}

export const searchBilibiliSeriesApi = async (q: string, limit = 10) => {
  assertLegacyGatewayApiBase('Video localization')
  const { data } = await api.get('/video-localization/bilibili/series/search', { params: { q, limit } })
  return data
}

export const fetchBilibiliSeriesDetailApi = async (seasonId: string | number) => {
  assertLegacyGatewayApiBase('Video localization')
  const { data } = await api.get(`/video-localization/bilibili/series/${seasonId}`)
  return data
}

export const fetchVideoLocalizationJobsApi = async () => {
  assertLegacyGatewayApiBase('Video localization')
  const { data } = await api.get('/video-localization/jobs')
  return data
}

export const createVideoLocalizationJobApi = async (payload: any) => {
  assertLegacyGatewayApiBase('Video localization')
  const { data } = await api.post('/video-localization/jobs', payload)
  return data
}

export const fetchVideoLocalizationJobApi = async (jobId: string) => {
  assertLegacyGatewayApiBase('Video localization')
  const { data } = await api.get(`/video-localization/jobs/${jobId}`)
  return data
}

export const getVideoLocalizationDownloadUrl = (jobId: string) => {
  if (isSocialContentApiBase()) return ''
  return `${api.defaults.baseURL}/video-localization/jobs/${jobId}/download`
}

export const resolveApiAssetUrl = (path?: string | null) => {
  if (!path) return ''
  if (path.startsWith('http')) return path
  const base = String(api.defaults.baseURL || '').replace(/\/$/, '')
  if (path.startsWith('/api/')) {
    return `${base}${path.slice(4)}`
  }
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}
