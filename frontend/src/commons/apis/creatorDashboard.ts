import { api } from './client'

export type CreatorDashboardOverview = {
  generated_at: string
  recommendations_ready: number
  profiles: {
    total: number
    active: number
  }
  projects: {
    total: number
    in_progress: number
  }
  publishing: {
    needs_approval: number
    scheduled: number
    published: number
    failed: number
  }
}

export type CreatorPublishingItem = {
  id: string
  title: string
  platform: string
  profile_name: string
  status: string
  scheduled_at?: string | null
}

export type CreatorDashboardPublishing = {
  generated_at: string
  status_counts: Record<string, number>
  upcoming: CreatorPublishingItem[]
}

export type CreatorDashboardProject = {
  id: string
  title: string
  status: string
  current_stage?: string | null
  progress_percent: number
  profile_name: string
  platform: string
  updated_at?: string | null
}

export type CreatorDashboardProjects = {
  generated_at: string
  status_counts: Record<string, number>
  recent_projects: CreatorDashboardProject[]
}

export const fetchCreatorDashboardOverviewApi = async () => {
  const { data } = await api.get<CreatorDashboardOverview>('/creator/dashboard/overview', { cache: false })
  return data
}

export const fetchCreatorDashboardPublishingApi = async () => {
  const { data } = await api.get<CreatorDashboardPublishing>('/creator/dashboard/publishing', { cache: false })
  return data
}

export const fetchCreatorDashboardProjectsApi = async () => {
  const { data } = await api.get<CreatorDashboardProjects>('/creator/dashboard/projects', { cache: false })
  return data
}
