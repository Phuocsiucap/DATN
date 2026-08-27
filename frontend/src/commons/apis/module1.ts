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
  source_metadata?: Record<string, unknown>
  article_id?: string | null
  category_id?: string | null
  category?: string | null
  site_id?: string | null
  articleId?: string | null
  categoryId?: string | null
  siteId?: string | null
  title?: string | null
  lead?: string | null
  publishedAt?: string | null
  content?: string | null
  images?: Array<Record<string, unknown>>
  videos?: Array<Record<string, unknown>>
  url?: string | null
  normalized?: NormalizedArticle
}

export type NormalizedArticle = {
  articleId?: string | null
  categoryId?: string | null
  siteId?: string | null
  title: string
  lead: string
  publishedAt?: string | null
  content: string
  images: Array<{
    src?: string | null
    alt?: string | null
    caption?: string | null
  }>
  videos: Array<{
    url?: string | null
    kind?: string | null
    mimeType?: string | null
    embedUrl?: string | null
    provider?: string | null
    title?: string | null
    description?: string | null
    thumbnail?: string | null
    uploadDate?: string | null
    duration?: string | null
    qualities?: string[]
    maxQuality?: string | null
    extractionSource?: string | null
  }>
  url?: string | null
}

export type ContentSourceDetail = {
  id?: string
  source_type: string
  source_external_id: string
  source_url?: string | null
  raw_document_id?: string | null
  processed_document_id?: string | null
  source_title?: string | null
  source_author?: string | null
  source_published_at?: string | null
  metadata_json?: Record<string, unknown>
  first_seen_at?: string
  last_seen_at?: string
}

export type ContentMediaDetail = {
  id?: string
  media_type: string
  source_url?: string | null
  storage_url?: string | null
  thumbnail_url?: string | null
  mime_type?: string | null
  format?: string | null
  embed_url?: string | null
  provider?: string | null
  title?: string | null
  description?: string | null
  upload_date?: string | null
  duration?: string | null
  qualities?: string[]
  max_quality?: string | null
  extraction_source?: string | null
  alt?: string | null
  caption?: string | null
  role?: string | null
  duration_seconds?: number | null
  created_at?: string
}

export type ProcessingRunDetail = {
  id: string
  processing_type: string
  status: string
  processor_version?: string | null
  input_reference?: string | null
  output_reference?: string | null
  started_at?: string | null
  completed_at?: string | null
  error_message?: string | null
  created_at: string
}

export type ContentDetail = ContentItem & {
  full_text?: string | null
  published_at?: string | null
  duration_seconds?: number | null
  source_type?: string | null
  source_url?: string | null
  source_author?: string | null
  source_published_at?: string | null
  updated_at: string
  sources?: ContentSourceDetail[]
  sources_jsonb?: ContentSourceDetail[]
  media?: ContentMediaDetail[]
  media_jsonb?: ContentMediaDetail[]
  processing_runs?: ProcessingRunDetail[]
}

export type FinalSeriesInfo = {
  id: string
  canonical_name: string
  completion_status: string
  total_episodes: number
  grouping_confidence: number
}

export type FinalContentItem = ContentItem & {
  source_type?: string | null
  source_url?: string | null
  published_at?: string | null
  media?: ContentMediaDetail[]
  media_jsonb?: ContentMediaDetail[]
  episode_id?: string | null
  episode_number?: number | null
  sequence_order?: number | null
  episode_title?: string | null
  story_id?: string | null
  episode_order?: number | null
  series?: FinalSeriesInfo | null
}

export type FinalContentView = {
  normal_items: FinalContentItem[]
  series_items: FinalContentItem[]
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

export const fetchCrawlJobsApi = async (params?: Record<string, string>) => {
  const { data } = await api.get('/crawl-jobs', { params })
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

export const fetchContentDetailApi = async (contentId: string) => {
  const { data } = await api.get(`/contents/${contentId}/detail`)
  return data as ContentDetail
}

export const fetchFinalContentViewApi = async (params?: { crawl_job_id?: string; content_scope?: string }) => {
  const { data } = await api.get('/contents/final-view', { params })
  return data as FinalContentView
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
