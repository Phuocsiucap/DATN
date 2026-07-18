import { api } from './client'

export const publishBilibiliJobToTikTokApi = async (jobId: number, payload: {
  profile_ids: number[]
  caption: string
  segment_indexes?: number[]
}) => {
  const { data } = await api.post(`/publish/bilibili/jobs/${jobId}/tiktok`, payload)
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
