import { api, assertLegacyGatewayApiBase, isSocialContentApiBase } from './client'

export const publishBilibiliJobToTikTokApi = async (jobId: number, payload: {
  profile_ids: number[]
  caption: string
  segment_indexes?: number[]
}) => {
  assertLegacyGatewayApiBase('Publish Bilibili to TikTok')
  const { data } = await api.post(`/publish/bilibili/jobs/${jobId}/tiktok`, payload)
  return data
}

export const triggerCrawlApi = async () => {
  if (isSocialContentApiBase()) {
    return { status: 'unsupported', detail: 'Use the Crawl page to create a crawl job.' }
  }
  const { data } = await api.post('/publish/crawl-now')
  return data
}

export const fetchSchedulerStatusApi = async () => {
  if (isSocialContentApiBase()) {
    return { status: 'stopped', supported: false }
  }
  const { data } = await api.get('/publish/scheduler/status')
  return data
}

export const startSchedulerApi = async (interval_minutes: number = 30) => {
  if (isSocialContentApiBase()) {
    return { status: 'stopped', supported: false, interval_minutes }
  }
  const { data } = await api.post('/publish/scheduler/start', { interval_minutes })
  return data
}

export const stopSchedulerApi = async () => {
  if (isSocialContentApiBase()) {
    return { status: 'stopped', supported: false }
  }
  const { data } = await api.post('/publish/scheduler/stop')
  return data
}
