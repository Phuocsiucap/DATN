import { api } from './client'

export type CrawlJob = {
  id: string
  name: string
  crawl_mode: string
  status: string
  current_stage: string
  priority: number
  total_discovered: number
  total_crawled: number
  total_normalized: number
  total_failed: number
  total_duplicates: number
  progress_percent: number
  created_at: string
  updated_at: string
}

export type ContentItem = {
  id: string
  content_type: string
  canonical_title: string
  normalized_title?: string | null
  summary?: string | null
  language: string
  status: string
  canonical_url?: string | null
  quality_score: number
  created_at: string
}

export type Story = {
  id: string
  canonical_name: string
  normalized_name: string
  language: string
  total_episodes: number
  completion_status: string
  grouping_confidence: number
  created_at: string
}

export type Episode = {
  id: string
  story_id: string
  episode_number?: number | null
  sequence_order?: number | null
  episode_title?: string | null
  duration_seconds?: number | null
  is_missing: boolean
}

export type CrawlLog = {
  id: string
  job_id: string
  task_id?: string | null
  source_type?: string | null
  stage: string
  level: string
  message: string
  metadata_json: Record<string, unknown>
  created_at: string
}

export type QualitySummary = {
  total_content: number
  ready: number
  needs_review: number
  average_quality_score: number
  failed_tasks: number
}

export const fetchCrawlJobsApi = async () => {
  const { data } = await api.get('/crawl-jobs')
  return data as CrawlJob[]
}

export const createCrawlJobApi = async (payload: Record<string, unknown>) => {
  const { data } = await api.post('/crawl-jobs', payload)
  return data as CrawlJob
}

export const cancelCrawlJobApi = async (jobId: string) => {
  const { data } = await api.post(`/crawl-jobs/${jobId}/cancel`)
  return data as CrawlJob
}

export const retryCrawlJobApi = async (jobId: string) => {
  const { data } = await api.post(`/crawl-jobs/${jobId}/retry`)
  return data as CrawlJob
}

export const fetchCrawlJobLogsApi = async (jobId: string) => {
  const { data } = await api.get(`/crawl-jobs/${jobId}/logs`)
  return data as CrawlLog[]
}

export const fetchContentsApi = async (params?: Record<string, string>) => {
  const { data } = await api.get('/contents', { params })
  return data as ContentItem[]
}

export const fetchStoriesApi = async () => {
  const { data } = await api.get('/stories')
  return data as Story[]
}

export const fetchStoryEpisodesApi = async (storyId: string) => {
  const { data } = await api.get(`/stories/${storyId}/episodes`)
  return data as Episode[]
}

export const regroupStoryApi = async (storyId: string) => {
  const { data } = await api.post(`/stories/${storyId}/regroup`)
  return data
}

export const fetchQualitySummaryApi = async () => {
  const { data } = await api.get('/data-quality/summary')
  return data as QualitySummary
}

export const fetchQualityIssuesApi = async () => {
  const { data } = await api.get('/data-quality/issues')
  return data
}
