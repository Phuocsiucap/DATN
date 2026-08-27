import { api } from './client'

export type PlanningProfile = {
  id: string
  platform: string
  profile_name: string
  username?: string | null
  status: string
}

export type WorkflowSource = {
  id: string
  source_type: string
  source_id?: string | null
  content_id?: string | null
  story_id?: string | null
  episode_id?: string | null

  role: string
  status: string
  score: number
  metadata: Record<string, unknown>
}

export type ArtifactItem = {
  artifact_type: string
  uri: string
  status: string
  metadata?: Record<string, unknown>
  created_at?: string
}

export type InputItem = {
  type: string
  id: string
}

export type PlanningRun = {
  id: string
  profile_id: string
  profile_name: string
  workflow_id: string
  workflow_title: string
  crawl_job_id?: string | null
  planning_mode: string
  status: string
  current_stage: string
  progress_percent: number
  candidate_count: number
  selected_count: number
  eligible_count: number
  selected_content_id?: string | null
  selection_reasons: string[]
  trigger?: string | null
  error_message?: string | null
  started_at?: string | null
  completed_at?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type PlanningCandidate = {
  id: string
  planning_run_id: string
  content_id: string
  media_workflow_id?: string | null
  ai_score?: number | null
  final_score?: number | null
  status: string
  reason?: string | null
  created_at?: string | null
}

export type StoryScene = {
  start?: number
  end?: number
  duration: number
  image?: string | null
  effect?: string | null
  fit?: 'cover' | 'contain' | string | null
  subtitle: string
  media_type?: 'image' | 'video' | string
  scale?: number
  opacity?: number
  position_x?: number
  position_y?: number
  rotation?: number
  subtitle_start?: number
  subtitle_duration?: number
  text_style?: Record<string, unknown>
  voice_subtitle?: string
  voice_text?: string
  timing?: { start?: number; end?: number; voice_start?: number; voice_end?: number }
}

export type ContentSeries = {
  id: string
  content_plan_id?: string | null
  profile_id?: string | null
  title: string
  description?: string | null
  series_type: string
  total_parts: number
  current_part: number
  status: string
  context_version: number
  category_id?: string | null
  categoryId?: string | null
  category?: string | null
  metadata?: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

export type MediaWorkflow = {
  id: string
  user_id: string
  profile_id: string
  series_id?: string | null
  title: string
  status: string
  planning_mode?: string | null
  primary_content_id?: string | null
  primary_story_id?: string | null
  content_plan_id?: string | null
  video_draft_id?: string | null
  current_stage?: string | null
  progress_percent: number
  timeline_duration?: number | null
  rendered_video?: string | null
  metadata?: Record<string, unknown>
  source_content?: ReviewSourceContent | null
  media?: NonNullable<ReviewSourceContent['media']>
  images?: string[]
  series?: ContentSeries | null
  inputs_jsonb?: InputItem[]
  artifacts_jsonb?: ArtifactItem[]
  draft_json?: {
    title?: string
    story_data?: StoryScene[]
    [key: string]: unknown
  }
  created_at: string
  updated_at?: string | null
}

export type ContentPlan = {
  id: string
  workflow_id?: string | null
  workflow_run_id?: string | null
  profile_id: string
  series_id?: string | null
  source_content?: ReviewSourceContent | null
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
  draft_json?: {
    title?: string
    story_data?: StoryScene[]
    [key: string]: unknown
  }
  story_data?: StoryScene[]
  created_at: string
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
  source_metadata?: Record<string, unknown>
  article_id?: string | null
  articleId?: string | null
  category_id?: string | null
  categoryId?: string | null
  category?: string | null
  site_id?: string | null
  siteId?: string | null
  normalized?: {
    articleId?: string | null
    categoryId?: string | null
    siteId?: string | null
    title: string
    lead: string
    publishedAt?: string | null
    content: string
    images: Array<Record<string, unknown>>
    videos: Array<Record<string, unknown>>
    url?: string | null
  }
  quality_score: number
  published_at?: string | null
  created_at: string
  updated_at: string
  sources?: Array<{
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
  }>
  media?: Array<{
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
    alt?: string | null
    caption?: string | null
    role?: string | null
    width?: number | null
    height?: number | null
    duration_seconds?: number | null
    created_at?: string
  }>
}

export type ProfileSeriesReview = {
  series: ContentSeries
  articles: Array<{
    plan?: ContentPlan | null
    source_content?: ReviewSourceContent | null
    story_data?: StoryScene[]
  }>
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

export type PromptRun = {
  id: string
  workflow_run_id: string
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

export const fetchMediaWorkflowsApi = async (params: { videoWorkspaceOnly?: boolean } = {}) => {
  const { data } = await api.get('/media-workflows', {
    params: params.videoWorkspaceOnly ? { video_workspace_only: true } : undefined,
  })
  return data as MediaWorkflow[]
}

export const fetchMediaWorkflowApi = async (workflowId: string) => {
  const { data } = await api.get(`/media-workflows/${workflowId}`)
  return data as MediaWorkflow
}

export const fetchContentPlanApi = async (planId: string) => {
  const { data } = await api.get(`/media-workflows/${planId}`)
  const wf = data as MediaWorkflow
  return {
    id: wf.id,
    workflow_id: wf.id,
    profile_id: wf.profile_id,
    series_id: wf.series_id || null,
    source_content: wf.source_content || null,
    primary_content_id: wf.primary_content_id,
    primary_story_id: wf.primary_story_id,
    title: wf.title,
    content_angle: (wf.metadata?.content_angle as string) || null,
    target_audience: (wf.metadata?.target_audience as string) || null,
    tone: (wf.metadata?.tone as string) || null,
    format: (wf.metadata?.format as string) || null,
    planning_mode: wf.planning_mode || 'SINGLE',
    target_duration_seconds: (wf.metadata?.target_duration_seconds as number) || 60,
    recommended_part_count: (wf.metadata?.recommended_part_count as number) || 1,
    confidence_score: (wf.metadata?.confidence_score as number) || 0,
    risk_level: (wf.metadata?.risk_level as string) || null,
    status: wf.status,
    version: 1,
    ai_reasoning: (wf.metadata?.ai_reasoning as string[]) || [],
    production_requirements: (wf.metadata?.production_requirements as Record<string, unknown>) || {},
    draft_json: wf.draft_json || {},
    story_data: wf.draft_json?.story_data || [],
    created_at: wf.created_at,
    updated_at: wf.updated_at || wf.created_at,
  } as ContentPlan
}

export const fetchAllContentPlansApi = async () => {
  const { data } = await api.get('/media-workflows')
  return (data as MediaWorkflow[]).map((wf) => ({
    id: wf.id,
    workflow_id: wf.id,
    profile_id: wf.profile_id,
    series_id: wf.series_id || null,
    source_content: wf.source_content || null,
    primary_content_id: wf.primary_content_id,
    primary_story_id: wf.primary_story_id,
    title: wf.title,
    content_angle: (wf.metadata?.content_angle as string) || null,
    target_audience: (wf.metadata?.target_audience as string) || null,
    tone: (wf.metadata?.tone as string) || null,
    format: (wf.metadata?.format as string) || null,
    planning_mode: wf.planning_mode || 'SINGLE',
    target_duration_seconds: (wf.metadata?.target_duration_seconds as number) || 60,
    recommended_part_count: (wf.metadata?.recommended_part_count as number) || 1,
    confidence_score: (wf.metadata?.confidence_score as number) || 0,
    risk_level: (wf.metadata?.risk_level as string) || null,
    status: wf.status,
    version: 1,
    ai_reasoning: (wf.metadata?.ai_reasoning as string[]) || [],
    production_requirements: (wf.metadata?.production_requirements as Record<string, unknown>) || {},
    draft_json: wf.draft_json || {},
    story_data: wf.draft_json?.story_data || [],
    created_at: wf.created_at,
    updated_at: wf.updated_at || wf.created_at,
  })) as ContentPlan[]
}

export const approveContentPlanApi = async (planId: string, feedbackText?: string) => {
  const { data } = await api.post(`/media-workflows/${planId}/approve`, { feedback_text: feedbackText })
  if (data?.plan) return data as { plan: ContentPlan; media_workflows: MediaWorkflow[] }
  return { plan: data as ContentPlan, media_workflows: [] }
}

export const rejectContentPlanApi = async (planId: string, feedbackText?: string) => {
  const { data } = await api.post(`/media-workflows/${planId}/reject`, { feedback_text: feedbackText })
  return data as ContentPlan
}

export const regenerateContentPlanApi = async (planId: string, instructions?: string) => {
  const plan = await fetchContentPlanApi(planId)
  if (!plan.workflow_id) {
    throw new Error('Plan này chưa gắn kịch bản liên kết. Hãy tạo luồng kịch bản mới từ nguồn nội dung.')
  }
  const { data } = await api.post('/generate-video/edit-story', {
    workflow_id: plan.workflow_id,
    prompt: instructions?.trim() || 'Viết lại kịch bản và draft từ nội dung nguồn hiện tại.',
  })
  return data
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

export const createContentSeriesApi = async (payload: {
  title: string
  description?: string
  series_type?: string
  profile_id?: string
  status?: string
  total_parts?: number
}) => {
  const { data } = await api.post('/content-series', payload)
  return data as ContentSeries
}

export const updateContentSeriesApi = async (
  seriesId: string,
  payload: {
    title?: string
    description?: string
    series_type?: string
    status?: string
    total_parts?: number
    current_part?: number
    profile_id?: string
  }
) => {
  const { data } = await api.patch(`/content-series/${seriesId}`, payload)
  return data as ContentSeries
}

export const deleteContentSeriesApi = async (seriesId: string) => {
  const { data } = await api.delete(`/content-series/${seriesId}`)
  return data as { message: string; id: string }
}

export const regenerateContentSeriesApi = async (seriesId: string, instructions?: string) => {
  const workflows = await fetchMediaWorkflowsApi()
  const workflow = workflows.find((item) => item.series_id === seriesId)
  if (!workflow) {
    throw new Error('Series này chưa có kịch bản liên kết để tạo luồng chạy mới.')
  }
  const { data } = await api.post('/generate-video/edit-story', {
    workflow_id: workflow.id,
    prompt: instructions?.trim() || 'Viết lại kịch bản và draft, giữ đúng ngữ cảnh series hiện tại.',
  })
  return data
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

export const createMediaWorkflowFromSourcesApi = async (payload: {
  profile_id: string
  content_ids?: string[]
  story_ids?: string[]
  episode_ids?: string[]
  selection_mode?: string
  candidate_limit?: number
  title?: string
  note?: string
  filters?: Record<string, unknown>
}) => {
  const { data } = await api.post('/media-workflows/from-sources', payload)
  return data as MediaWorkflow
}

export const fetchPlanningRunsApi = async (params: {
  profile_id?: string
  status?: string
  limit?: number
  offset?: number
} = {}) => {
  const { data } = await api.get('/planning-runs', { params })
  return data as { items: PlanningRun[]; total: number; limit: number; offset: number }
}
