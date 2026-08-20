import { api, isSocialContentApiBase } from './client'

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
  if (isSocialContentApiBase()) {
    return {
      status: 'stopped',
      interval: 0,
      settings: DEFAULT_SCHEDULER_SETTINGS,
      jobs: {
        vnexpress: { id: 'unsupported', interval_minutes: DEFAULT_SCHEDULER_SETTINGS.vnexpress_interval_minutes },
        bilibili: { id: 'unsupported', interval_minutes: DEFAULT_SCHEDULER_SETTINGS.bilibili_interval_minutes },
        publish_queue: { id: 'unsupported', interval_minutes: DEFAULT_SCHEDULER_SETTINGS.publish_queue_interval_minutes },
      },
    } satisfies SchedulerSettingsStatus
  }
  const { data } = await api.get<SchedulerSettingsStatus>('/admin/settings/scheduler')
  return data
}

export const updateAdminSchedulerSettingsApi = async (payload: SchedulerSettings) => {
  if (isSocialContentApiBase()) {
    return {
      status: 'stopped',
      interval: 0,
      settings: payload,
      jobs: {
        vnexpress: { id: 'unsupported', interval_minutes: payload.vnexpress_interval_minutes },
        bilibili: { id: 'unsupported', interval_minutes: payload.bilibili_interval_minutes },
        publish_queue: { id: 'unsupported', interval_minutes: payload.publish_queue_interval_minutes },
      },
    } satisfies SchedulerSettingsStatus
  }
  const { data } = await api.put<SchedulerSettingsStatus>('/admin/settings/scheduler', payload)
  return data
}

const DEFAULT_SCHEDULER_SETTINGS: SchedulerSettings = {
  vnexpress_interval_minutes: 30,
  bilibili_interval_minutes: 30,
  publish_queue_interval_minutes: 5,
}
