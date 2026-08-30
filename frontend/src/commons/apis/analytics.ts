import { api } from './client'
import type { SocialPost, SocialProfile } from './socialProfiles'

export type AnalyticsMetric = {
  value: number | null
  change_pct?: number | null
  change_count?: number | null
}

export type AccountAnalyticsOverview = {
  profile: SocialProfile
  profile_id: string
  period: { start_date: string; end_date: string }
  metrics: Record<string, AnalyticsMetric>
}

export type AccountAnalyticsCharts = {
  profile_id: string
  views_by_day: Array<{ date: string; views: number; avg_views: number; videos: number }>
  account_snapshots: Array<{ date: string; followers: number; following: number; likes: number; videos: number }>
  content_mix: Array<{ name: string; value: number; color: string }>
}

export type AccountTopTopics = {
  profile_id: string
  items: Array<{ topic: string; views: number; avg_watch_pct?: number | null; avg_engagement_pct: number; posts: number }>
}

export type PostAnalyticsOverview = {
  post: SocialPost & {
    profile: SocialProfile
    tiktok_embed_url?: string | null
  }
  metrics: Record<string, AnalyticsMetric>
}

export type PostAnalyticsCharts = {
  post_id: string
  retention_curve: Array<{ second: number; retention_pct: number }>
  traffic_sources: Array<{ name: string; value: number; color?: string }>
  engagement_timeline: Array<{
    time: string
    hours_since_publish: number
    views: number
    likes: number
    comments: number
    shares: number
  }>
  data_availability: Record<string, boolean>
}

export const fetchAccountAnalyticsOverviewApi = async (params: {
  profile_id: string | number
  start_date?: string
  end_date?: string
}): Promise<AccountAnalyticsOverview> => {
  const { data } = await api.get('/analytics/account/overview', { params })
  return data
}

export const fetchAccountAnalyticsChartsApi = async (params: {
  profile_id: string | number
  start_date?: string
  end_date?: string
  granularity?: string
}): Promise<AccountAnalyticsCharts> => {
  const { data } = await api.get('/analytics/account/charts', { params })
  return data
}

export const fetchAccountAnalyticsTopTopicsApi = async (params: {
  profile_id: string | number
  start_date?: string
  end_date?: string
  limit?: number
}): Promise<AccountTopTopics> => {
  const { data } = await api.get('/analytics/account/top-topics', { params })
  return data
}

export const fetchPostAnalyticsOverviewApi = async (postId: string | number): Promise<PostAnalyticsOverview> => {
  const { data } = await api.get(`/analytics/post/${postId}/overview`)
  return data
}

export const fetchPostAnalyticsChartsApi = async (postId: string | number): Promise<PostAnalyticsCharts> => {
  const { data } = await api.get(`/analytics/post/${postId}/charts`)
  return data
}
