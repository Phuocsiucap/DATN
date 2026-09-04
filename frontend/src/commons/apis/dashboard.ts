import { api, isSocialContentApiBase } from './client'

export type AdminDashboardTask = {
  id: string
  task_type: string
  label: string
  status: string
  stage?: string | null
  progress_percent: number
  reference_id?: string | null
  reference_type?: string | null
  reference_title?: string | null
  worker?: string | null
  attempt_count: number
  created_at?: string | null
  started_at?: string | null
  heartbeat_at?: string | null
}

export type AdminDashboardService = {
  key: string
  name: string
  kind: string
  status: 'online' | 'degraded' | 'offline'
  latency_ms?: number | null
  detail: string
}

export type AdminDashboardTotals = {
  crawl_jobs: number
  crawl_jobs_completed: number
  contents: number
  videos_rendered: number
  audio_generated: number
  published_posts: number
  tasks: number
  tasks_completed: number
}

export type AdminDashboardActivePipeline = {
  crawl: number
  crawl_jobs: number
  draft: number
  voice: number
  render: number
  publishing: number
  other: number
  total: number
}

export type AdminDashboardErrors = {
  last_24h: number
  tasks: number
  crawl: number
  publishing: number
  ai: number
}

export type AdminDashboardSummaryResponse = {
  generated_at: string
  totals: AdminDashboardTotals
}

export type AdminDashboardPipelineResponse = {
  generated_at: string
  active: AdminDashboardActivePipeline
  running_tasks: AdminDashboardTask[]
}

export type AdminDashboardErrorsResponse = {
  generated_at: string
  errors: AdminDashboardErrors
}

export type AdminDashboardServicesResponse = {
  generated_at: string
  services: AdminDashboardService[]
}

export type AdminSchedulerStatus = {
  status: string
}

export const fetchAdminDashboardSummaryApi = async () => {
  const { data } = await api.get<AdminDashboardSummaryResponse>('/admin/system/dashboard/summary', { cache: false })
  return data
}

export const fetchAdminDashboardPipelineApi = async () => {
  const { data } = await api.get<AdminDashboardPipelineResponse>('/admin/system/dashboard/pipeline', { cache: false })
  return data
}

export const fetchAdminDashboardErrorsApi = async () => {
  const { data } = await api.get<AdminDashboardErrorsResponse>('/admin/system/dashboard/errors', { cache: false })
  return data
}

export const fetchAdminDashboardServicesApi = async () => {
  const { data } = await api.get<AdminDashboardServicesResponse>('/admin/system/dashboard/services', { cache: false })
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
  const { data } = await api.get<AdminSchedulerStatus>('/admin/settings/scheduler', { cache: false })
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
