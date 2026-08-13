import { api } from './client'

export type PlanningProfile = {
  id: string
  platform: string
  profile_name: string
  username?: string | null
  status: string
}

export type Module2Handoff = {
  id: string
  profile_id: string
  selection_mode: string
  status: string
  handoff_note?: string | null
  eligible_count: number
  rejected_count: number
  filters?: Record<string, unknown>
  strategy_snapshot?: Record<string, unknown>
  created_at: string
  updated_at: string
  items?: Module2HandoffItem[]
}

export type Module2HandoffItem = {
  id: string
  handoff_id: string
  content_id?: string | null
  story_id?: string | null
  episode_id?: string | null
  source_crawl_job_id?: string | null
  item_role: string
  relation_reason?: string | null
  similarity_score?: number | null
  candidate_score?: number | null
  status: string
  rejection_reason?: string | null
  metadata_json?: Record<string, unknown>
  created_at: string
}

export type PlanningJob = {
  id: string
  profile_id: string
  handoff_id: string
  planning_mode: string
  status: string
  current_stage: string
  progress_percent: number
  target_duration_seconds?: number | null
  preferred_part_count?: number | null
  language: string
  instructions?: string | null
  attempt_count: number
  error_message?: string | null
  created_at: string
  updated_at: string
}

export type ContentPlan = {
  id: string
  planning_job_id: string
  profile_id: string
  primary_content_id?: string | null
  primary_story_id?: string | null
  title: string
  content_angle?: string | null
  target_audience?: string | null
  tone?: string | null
  format?: string | null
  planning_mode: string
  target_duration_seconds?: number | null
  recommended_part_count?: number | null
  confidence_score: number
  risk_level?: string | null
  status: string
  version: number
  ai_reasoning: string[]
  production_requirements: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type ContentSeries = {
  id: string
  content_plan_id: string
  profile_id: string
  title: string
  description?: string | null
  series_type: string
  total_parts: number
  current_part: number
  status: string
  context_version: number
  updated_at: string
}

export type ReviewSourceContent = {
  id: string
  content_type: string
  canonical_title: string
  summary?: string | null
  full_text?: string | null
  language: string
  status: string
  canonical_url?: string | null
  source_type?: string | null
  source_url?: string | null
  source_author?: string | null
  source_published_at?: string | null
  quality_score: number
  published_at?: string | null
  created_at: string
  updated_at: string
  sources?: Array<{
    id: string
    source_type: string
    source_external_id: string
    source_url?: string | null
    raw_document_id?: string | null
    source_title?: string | null
    source_author?: string | null
    source_published_at?: string | null
    metadata_json?: Record<string, unknown>
    first_seen_at: string
    last_seen_at: string
  }>
  media?: Array<{
    id: string
    media_type: string
    source_url?: string | null
    storage_url?: string | null
    thumbnail_url?: string | null
    mime_type?: string | null
    width?: number | null
    height?: number | null
    duration_seconds?: number | null
    created_at: string
  }>
}

export type SeriesPart = {
  id: string
  series_id: string
  part_number: number
  part_type: string
  title: string
  goal?: string | null
  hook_direction?: string | null
  ending_direction?: string | null
  previous_part_recap?: string | null
  next_part_tease?: string | null
  target_duration_seconds?: number | null
  status: string
  main_beats: string[]
  production_notes?: unknown
  risk_notes?: string[]
  created_at?: string
  updated_at?: string
}

export type SeriesCharacterContext = {
  name: string
  role?: string
  personality?: string
  status?: string
}

export type SeriesEventContext = {
  part_number: number
  summary: string
  key_developments?: string[]
}

export type MongoSeriesContextDoc = {
  _id?: string
  series_id: string
  version: number
  title?: string
  content_angle?: string
  tone?: string
  story_summary?: {
    premise?: string
    world_building?: string
    theme?: string
  }
  characters?: SeriesCharacterContext[]
  story_events?: SeriesEventContext[]
  open_questions?: string[]
  created_at?: string
}

export type SeriesContextResponse = {
  series_id: string
  context_version: number
  contexts: MongoSeriesContextDoc[]
}

export type ConsistencyWarning = {
  type: string
  severity: string
  message: string
  part_id?: string
}

export type ConsistencyCheck = {
  series_id: string
  passed: boolean
  warning_count: number
  warnings: ConsistencyWarning[]
}

export type Module3Handoff = {
  id: string
  user_id?: string
  profile_id?: string
  content_series_id: string
  content_plan_id: string
  context_id?: string | null
  status: string
  handoff_note?: string | null
  title?: string | null
  part_count?: number | null
  priority?: number | null
  project_status?: string | null
  timeline_duration?: number | null
  rendered_video?: string | null
  payload?: Record<string, unknown>
  created_at: string
  updated_at?: string
  parts?: Array<{
    id: string
    handoff_id: string
    series_part_id: string
    part_number: number
    status: string
    payload: Record<string, unknown>
    created_at: string
  }>
}

export type ProfileSeriesReview = {
  series: ContentSeries
  articles: Array<{
    plan?: ContentPlan | null
    source_content?: ReviewSourceContent | null
    parts: SeriesPart[]
  }>
}

export const fetchModule2HandoffsApi = async () => {
  const { data } = await api.get('/module2/handoffs')
  return data as Module2Handoff[]
}

export const createModule2HandoffApi = async (payload: Record<string, unknown>) => {
  const { data } = await api.post('/module2/handoffs', payload)
  return data as Module2Handoff
}

export const createAutoModule2HandoffFromCrawlApi = async (payload: Record<string, unknown>) => {
  const { data } = await api.post('/module2/handoffs/auto-from-crawl', payload)
  return data as { handoff: Module2Handoff; planning_job?: PlanningJob | null }
}

export const fetchPlanningJobsApi = async () => {
  const { data } = await api.get('/planning-jobs')
  return data as PlanningJob[]
}

export const createPlanningJobApi = async (payload: Record<string, unknown>) => {
  const { data } = await api.post('/planning-jobs', payload)
  return data as PlanningJob
}

export const cancelPlanningJobApi = async (jobId: string) => {
  const { data } = await api.post(`/planning-jobs/${jobId}/cancel`)
  return data as PlanningJob
}

export const retryPlanningJobApi = async (jobId: string) => {
  const { data } = await api.post(`/planning-jobs/${jobId}/retry`)
  return data as PlanningJob
}

export const fetchAllContentPlansApi = async () => {
  const { data } = await api.get('/content-plans')
  return data as ContentPlan[]
}

export const fetchContentPlansApi = async (profileId: string) => {
  const { data } = await api.get(`/profile/${profileId}/content-plans`)
  return data as ContentPlan[]
}

export const approveContentPlanApi = async (planId: string, feedbackText?: string) => {
  const { data } = await api.post(`/content-plans/${planId}/approve`, { feedback_text: feedbackText })
  if (data?.plan) return data as { plan: ContentPlan; module3_handoffs: Module3Handoff[] }
  return { plan: data as ContentPlan, module3_handoffs: [] }
}

export const rejectContentPlanApi = async (planId: string, feedbackText?: string) => {
  const { data } = await api.post(`/content-plans/${planId}/reject`, { feedback_text: feedbackText })
  return data as ContentPlan
}

export const regenerateContentPlanApi = async (planId: string, instructions?: string) => {
  const { data } = await api.post(`/content-plans/${planId}/regenerate`, { instructions })
  return data as PlanningJob
}

export const fetchAllContentSeriesApi = async () => {
  const { data } = await api.get('/content-series')
  return data as ContentSeries[]
}

export const fetchContentSeriesApi = async (profileId: string) => {
  const { data } = await api.get(`/profile/${profileId}/content-series`)
  return data as ContentSeries[]
}

export const fetchProfileSeriesReviewApi = async (profileId: string) => {
  const { data } = await api.get(`/profile/${profileId}/series-review`)
  return data as ProfileSeriesReview[]
}

export const fetchSeriesPartsApi = async (seriesId: string) => {
  const { data } = await api.get(`/content-series/${seriesId}/parts`)
  return data as SeriesPart[]
}

export const regenerateContentSeriesApi = async (seriesId: string, instructions?: string) => {
  const { data } = await api.post(`/content-series/${seriesId}/regenerate`, { instructions })
  return data as PlanningJob
}

export const fetchSeriesContextApi = async (seriesId: string) => {
  const { data } = await api.get(`/content-series/${seriesId}/context`)
  return data as SeriesContextResponse
}

export const rebuildSeriesContextApi = async (seriesId: string) => {
  const { data } = await api.post(`/content-series/${seriesId}/context/rebuild`)
  return data as { series_id: string; context_id: string; context_version: number; mongo_document_id?: string | null }
}

export const fetchSeriesConsistencyApi = async (seriesId: string) => {
  const { data } = await api.get(`/content-series/${seriesId}/consistency-check`)
  return data as ConsistencyCheck
}

export const createModule3HandoffApi = async (payload: { content_series_id: string; part_ids?: string[]; priority?: number; handoff_note?: string }) => {
  const { data } = await api.post('/module3/handoffs', payload)
  return data as Module3Handoff
}

export const fetchModule3HandoffsApi = async () => {
  const { data } = await api.get('/module3/handoffs')
  return data as Module3Handoff[]
}

export const fetchModule3HandoffApi = async (handoffId: string) => {
  const { data } = await api.get(`/module3/handoffs/${handoffId}`)
  return data as Module3Handoff
}

export const updateModule3HandoffApi = async (handoffId: string, payload: Partial<Pick<Module3Handoff, 'status' | 'handoff_note' | 'payload' | 'parts'>>) => {
  const { data } = await api.patch(`/module3/handoffs/${handoffId}`, payload)
  return data as Module3Handoff
}

export type PlanningCandidate = {
  id: string
  planning_job_id: string
  content_id?: string | null
  candidate_score: number
  eligible: boolean
  rank_order?: number | null
  selection_reasons: string[]
  rejection_reasons: string[]
  content_title?: string | null
  content_url?: string | null
  created_at: string
}

export type PromptRun = {
  id: string
  planning_job_id: string
  step_name: string
  model_provider?: string | null
  model_name?: string | null
  prompt_version?: string | null
  input_tokens?: number | null
  output_tokens?: number | null
  latency_ms?: number | null
  status: string
  error_message?: string | null
  created_at: string
}

export const fetchPlanningJobCandidatesApi = async (jobId: string) => {
  const { data } = await api.get(`/planning-jobs/${jobId}/candidates`)
  return data as PlanningCandidate[]
}

export const fetchPlanningJobLogsApi = async (jobId: string) => {
  const { data } = await api.get(`/planning-jobs/${jobId}/logs`)
  return data as PromptRun[]
}
