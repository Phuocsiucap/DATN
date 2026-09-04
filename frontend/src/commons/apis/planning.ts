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
  // Legacy flat fields remain optional while cached/older responses are still
  // readable alongside the normalized profile and crawl_job objects.
  profile_id?: string
  profile_name?: string
  crawl_job_name?: string | null
  profile: {
    profile_id: string
    profile_name: string
    profile_username?: string | null
    profile_platform?: string | null
    profile_avatar_url?: string | null
  }
  crawl_job?: {
    id?: string | null
    name?: string | null
  } | null
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
  profileId?: string | null
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
  current_stage?: string | null
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
    target_duration_seconds: (wf.metadata?.target_duration_seconds as number) || (wf.metadata?.draft_generation_mode === 'compact-v2' ? null : 60),
    recommended_part_count: (wf.metadata?.recommended_part_count as number) || 1,
    confidence_score: (wf.metadata?.confidence_score as number) || 0,
    risk_level: (wf.metadata?.risk_level as string) || null,
    status: wf.status,
    current_stage: wf.current_stage,
    version: 1,
    ai_reasoning: (wf.metadata?.ai_reasoning as string[]) || [],
    production_requirements: (wf.metadata?.production_requirements as Record<string, unknown>) || {},
    draft_json: wf.draft_json || {},
    story_data: wf.draft_json?.story_data || [],
    created_at: wf.created_at,
    updated_at: wf.updated_at || wf.created_at,
  } as ContentPlan
}

// Legacy workflow approval only restores a rejected workflow; it does not approve
// draft quality or a final video. Draft approval lives in generateVideo.ts.
export const restoreContentPlanApi = async (planId: string, feedbackText?: string) => {
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

export type PlanningTopic = {
  id: string
  kind: 'CONTENT' | 'AVOID'
  name: string
  key: string | null
  description: string | null
}

export type PlanningTopicScore = {
  topic_id: string
  similarity: number | null
  threshold: number | null
  matched: boolean
  source: string | null
}

export type PlanningDraftIssue = {
  code: string
  message: string | null
  severity: string | null
  scene_indexes: number[]
  details: Record<string, unknown>
}

export type PlanningCandidateDetail = {
  id: string
  content_id: string | null
  title: string | null
  summary: string | null
  rank: number | null
  selected: boolean
  workflow_id: string | null
  review?: PlanningCandidateReview | null
  matching: {
    eligible: boolean
    score: number
    source_quality_score: number | null
    similarity: number | null
    similarity_threshold: number | null
    avoid_threshold: number | null
    passed_similarity_gate: boolean | null
    blocked_by_avoid_topics: boolean | null
    require_video: boolean | null
    has_required_video: boolean | null
    embedding_model: string | null
    source: string | null
    topics: PlanningTopicScore[]
    avoid_topics: PlanningTopicScore[]
    selection_reasons: string[]
    rejection_reasons: string[]
  }
  decision: {
    status: string | null
    production: {
      status: string | null
      source: string | null
      reason_code: string | null
      reason: string | null
      confidence_score: number | null
    } | null
    draft: {
      title: string | null
      angle: string | null
      format: string | null
      hook_type: string | null
      cta_mode: string | null
      tone: string | null
      target_audience: string | null
      confidence_score: number | null
      quality: {
        status: string | null
        score: number | null
        word_count: number | null
        scene_count: number | null
        retry_count: number | null
        retry_error: string | null
        issues: PlanningDraftIssue[]
      } | null
      risk_flags: Array<{ type: string | null; severity: string | null; message: string | null }>
    } | null
    series: {
      action: string | null
      target_series_id: string | null
      title: string | null
      description: string | null
      series_type: string | null
      total_parts: number | null
      reason: string | null
      followup_angles: string[]
    } | null
    provider: string | null
    model: string | null
    token_usage: {
      input_tokens: number | null
      output_tokens: number | null
      creative_call_count: number | null
      fit_judge_call_count: number | null
    } | null
    error_message: string | null
    legacy_reason: string | null
    notes: string[]
  } | null
}

export type PlanningCandidateReview = {
  status: string | null
  action: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  reason: string | null
  task_id: string | null
  error_message: string | null
  can_approve: boolean
  can_reject: boolean
  can_retry: boolean
  original_production: NonNullable<PlanningCandidateDetail['decision']>['production']
}

export type PlanningCandidateSource = {
  id: string
  title: string
  summary: string | null
  full_text: string
  source_url: string | null
}

export type PlanningCandidateReviewResult = { candidate_id: string; workflow_id: string | null; review: PlanningCandidateReview }

export const reviewPlanningCandidateApi = async (runId: string, candidateId: string, action: 'APPROVE' | 'REJECT' | 'RETRY', reason: string) => {
  const { data } = await api.post(`/planning-runs/${runId}/candidates/${candidateId}/review`, { action, reason })
  return data as PlanningCandidateReviewResult
}

export const fetchPlanningCandidateSourceApi = async (runId: string, candidateId: string) => {
  const { data } = await api.get(`/planning-runs/${runId}/candidates/${candidateId}/source`)
  return data as PlanningCandidateSource
}

export type PlanningWorkflowState = {
  id: string
  title: string | null
  status: string | null
  current_stage: string | null
  series: { id: string; name: string | null } | null
  pending_series: boolean
  series_error: string | null
  updated_at: string | null
}

export type PlanningRunDiagnostics = {
  schema_version: 2
  id: string
  profile: { id: string; name: string | null } | null
  crawl_job: { id: string; name: string | null } | null
  planning_mode: string
  status: string
  trigger: string | null
  algorithm: string | null
  similarity_threshold: number | null
  error_code: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string | null
  updated_at: string | null
  summary: {
    candidate_count: number
    eligible_count: number
    filtered_count: number
    selected_count: number
    workflow_count: number
    production: Record<string, number>
    draft_quality: Record<string, number>
  }
  topics: PlanningTopic[]
  candidates: PlanningCandidateDetail[]
  workflows: PlanningWorkflowState[]
}

export type PlanningCandidateSummary = {
  id: string
  content_id?: string | null
  title?: string | null
  rank?: number | null
  status: string
  reason: string
  reason_code?: string | null
  similarity?: number | null
  workflow_id?: string | null
  review?: PlanningCandidateReview | null
}

export type PlanningRunCompactDetail = Omit<PlanningRunDiagnostics, 'schema_version' | 'topics' | 'candidates'> & {
  schema_version: 3
  candidates: PlanningCandidateSummary[]
}
export type PlanningRunDetail = PlanningRunDiagnostics | PlanningRunCompactDetail

export type PlanningCandidateDiagnostics = {
  schema_version: 3
  run_id: string
  candidate: PlanningCandidateDetail
  topics: PlanningTopic[]
  workflow: PlanningWorkflowState | null
}

export const fetchPlanningCandidateDiagnosticsApi = async (runId: string, candidateId: string, signal?: AbortSignal) => {
  const { data } = await api.get(`/planning-runs/${runId}/candidates/${candidateId}/diagnostics`, { signal })
  if (data?.schema_version !== 3 || data.run_id !== runId || data.candidate?.id !== candidateId) {
    throw new Error('Chi tiết ứng viên không khớp yêu cầu. Hãy tải lại.')
  }
  return data as PlanningCandidateDiagnostics
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

export const fetchPlanningRunDetailApi = async (runId: string) => {
  const { data } = await api.get(`/planning-runs/${runId}`)
  if (data?.schema_version !== 2 && data?.schema_version !== 3) {
    throw new Error('API chi tiết plan chưa đồng bộ phiên bản. Hãy cập nhật API và tải lại trang.')
  }
  return data as PlanningRunDetail
}
