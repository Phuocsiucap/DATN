import { api, isSocialContentApiBase } from './client'

export const triggerCrawlApi = async () => {
  if (isSocialContentApiBase()) {
    return { status: 'unsupported', detail: 'Use the Crawl page to create a crawl job.' }
  }
  const { data } = await api.post('/publish/crawl-now')
  return data
}

export const fetchSchedulerStatusApi = async () => {
  const { data } = await api.get('/admin/settings/scheduler')
  return data
}

export const startSchedulerApi = async (intervalMinutes = 30) => {
  await api.put('/admin/settings/scheduler', {
    vnexpress_interval_minutes: intervalMinutes,
    bilibili_interval_minutes: intervalMinutes,
    publish_queue_interval_minutes: intervalMinutes,
  })
  const { data } = await api.post('/admin/settings/scheduler/start')
  return data
}

export const stopSchedulerApi = async () => {
  const { data } = await api.post('/admin/settings/scheduler/stop')
  return data
}
