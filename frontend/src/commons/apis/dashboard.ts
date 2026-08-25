import { api, isSocialContentApiBase } from './client'

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

export const startSchedulerApi = async (intervalMinutes = 30) => {
  if (isSocialContentApiBase()) {
    return { status: 'stopped', supported: false, interval_minutes: intervalMinutes }
  }
  const { data } = await api.post('/publish/scheduler/start', { interval_minutes: intervalMinutes })
  return data
}

export const stopSchedulerApi = async () => {
  if (isSocialContentApiBase()) {
    return { status: 'stopped', supported: false }
  }
  const { data } = await api.post('/publish/scheduler/stop')
  return data
}
