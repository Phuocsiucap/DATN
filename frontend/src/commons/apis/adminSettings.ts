import { api } from './client'

export type SchedulerSettings = {
  vnexpress_interval_minutes: number
  bilibili_interval_minutes: number
  publish_queue_interval_minutes: number
}

export type SchedulerSettingsStatus = {
  status: 'running' | 'paused' | 'stopped'
  interval: number
  settings: SchedulerSettings
  jobs: {
    vnexpress: { id: string; interval_minutes: number }
    bilibili: { id: string; interval_minutes: number }
    publish_queue: { id: string; interval_minutes: number }
  }
}

export const fetchAdminSchedulerSettingsApi = async () => {
  const { data } = await api.get<SchedulerSettingsStatus>('/admin/settings/scheduler')
  return data
}

export const updateAdminSchedulerSettingsApi = async (payload: SchedulerSettings) => {
  const { data } = await api.put<SchedulerSettingsStatus>('/admin/settings/scheduler', payload)
  return data
}

export const startAdminSchedulerApi = async () => {
  const { data } = await api.post<SchedulerSettingsStatus>('/admin/settings/scheduler/start')
  return data
}

export const stopAdminSchedulerApi = async () => {
  const { data } = await api.post<SchedulerSettingsStatus>('/admin/settings/scheduler/stop')
  return data
}

export const runPublishQueueSchedulerOnceApi = async () => {
  const { data } = await api.post<SchedulerSettingsStatus>('/admin/settings/scheduler/publish-queue/run-once')
  return data
}
