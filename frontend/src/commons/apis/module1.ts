import { api } from './client'

export type CrawlJob = {
  id: string
  name: string
  crawl_mode: string
  content_scope?: string
  created_by_type?: string
  creator_name?: string | null
  status: string
  current_stage: string
  priority: number
  total_discovered: number
  total_crawled: number
  total_normalized: number
  total_failed: number
  total_duplicates: number
  progress_percent: number
  schedule?: CrawlJobSchedule | null
  created_at: string
  updated_at: string
}

export type CrawlJobSchedule = {
  enabled: boolean
  runs_per_day: number
  window_start: string
  window_end: string
  weekdays: number[]
  timezone: string
  next_run_at?: string | null
  last_run_at?: string | null
}

export type CrawlJobScheduleInput = Pick<
  CrawlJobSchedule,
  'enabled' | 'runs_per_day' | 'window_start' | 'window_end' | 'weekdays' | 'timezone'
>

export type ContentItem = {
  id: string
  content_type: string
  canonical_title: string
  normalized_title?: string | null
  summary?: string | null
  language: string
  content_scope?: 'GLOBAL' | 'PRIVATE' | string
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
  thumbnail_url?: string | null
  tags?: string[]
  media_counts?: {
    images?: number
    videos?: number
  }
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

export type ProfileContentMatch = {
  profile_id: string
  profile_name: string
  username?: string | null
  platform: string
  avatar_url?: string | null
  status: string
  score: number
  recommendation_status: string
  relation_reason?: string | null
  threshold?: number
  embedding_similarity?: number | null
  similarity_threshold?: number | null
  passed_similarity_gate?: boolean | null
  similarity_source?: string | null
  top_topic_match?: {
    topic: string
    topic_key?: string | null
    description?: string | null
    similarity: number
    threshold?: number
    matched?: boolean
    match_source?: string
  } | null
  avoid_similarity_threshold?: number | null
  embedding_model?: string | null
  matched_topics?: string[]
  avoided_topics?: string[]
  blocked_by_avoid_topics?: boolean
  topic_matches?: Array<{
    topic: string
    topic_key?: string | null
    description?: string | null
    similarity: number
    threshold?: number
    matched?: boolean
    match_source?: string
  }>
  avoid_topic_matches?: Array<{
    topic: string
    topic_key?: string | null
    description?: string | null
    similarity: number
    threshold?: number
    matched?: boolean
    match_source?: string
  }>
  tone?: string | null
  target_audience?: string | null
  can_create_script?: boolean
  existing_workflow_id?: string | null
  existing_workflow_status?: string | null
  selection_reason?: string | null
  ai_decision_reason?: string | null
  fit_insights?: Array<{
    label: string
    value: string
    tone?: 'green' | 'blue' | 'amber' | 'red' | 'purple' | 'gray' | string
  }>
  suggested_angle?: string | null
  risk_notes?: string[]
  source_evidence?: string[]
}

export type ContentDetail = ContentItem & {
  full_text?: string | null
  published_at?: string | null
  duration_seconds?: number | null
  ai_selection_summary?: string | null
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
  profile_matches?: ProfileContentMatch[]
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

export type VnExpressRssFeed = {
  key: string
  label: string
  url: string
}

export const fetchCrawlJobsApi = async (params?: Record<string, string>) => {
  const { data } = await api.get('/crawl-jobs', { params })
  return data as CrawlJob[]
}

export const fetchVnExpressRssFeedsApi = async () => {
  const { data } = await api.get('/source-types/vnexpress/rss-feeds')
  return data as { items: VnExpressRssFeed[] }
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

export const updateCrawlJobScheduleApi = async (jobId: string, payload: CrawlJobScheduleInput) => {
  const { data } = await api.put(`/crawl-jobs/${jobId}/schedule`, payload)
  return data as CrawlJob
}

export const fetchContentDetailApi = async (contentId: string) => {
  const { data } = await api.get(`/contents/${contentId}/detail`)
  return data as ContentDetail
}

export const fetchFinalContentViewApi = async (params?: { crawl_job_id?: string; content_scope?: string; view?: string }) => {
  const { data } = await api.get('/contents/final-view', { params })
  return data as FinalContentView
}

// Crawl Source Management
export type CrawlSource = {
  id: string
  job_id: string
  source_type: string
  source_url?: string | null
  keywords: string[]
  configuration: Record<string, unknown>
  status: 'ACTIVE' | 'INACTIVE' | string
  created_at: string
  updated_at: string
}

export const fetchCrawlSourcesApi = async () => {
  const { data } = await api.get('/crawl-sources')
  return data as CrawlSource[]
}

export const updateCrawlSourceStatusApi = async (sourceId: string, status: 'ACTIVE' | 'INACTIVE') => {
  const { data } = await api.patch(`/crawl-sources/${sourceId}/status`, null, { params: { status } })
  return data as CrawlSource
}

export const deleteCrawlSourceApi = async (sourceId: string) => {
  const { data } = await api.delete(`/crawl-sources/${sourceId}`)
  return data as { deleted: boolean; message: string }
}
