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

export type WorkflowCandidate = {
  id: string
  workflow_run_id?: string | null
  content_id?: string | null
  story_id?: string | null
  episode_id?: string | null
  rank_order?: number | null
  score?: number
  candidate_score: number
  eligible: boolean
  score_breakdown?: Record<string, unknown>
  selection_reasons: string[]
  rejection_reasons: string[]
  content_title?: string | null
  content_url?: string | null
  metadata?: Record<string, unknown>
  created_at?: string | null
  updated_at?: string | null
}

export type WorkflowRun = {
  id: string
  workflow_id: string
  profile_id?: string | null
  run_type?: 'PLANNING' | 'RENDER' | string
  planning_mode?: string | null
  status: string
  current_stage?: string | null
  progress_percent: number
  target_duration_seconds?: number | null
  preferred_part_count?: number | null
  language?: string | null
  instructions?: string | null
  attempt_count?: number
  error_code?: string | null
  error_message?: string | null
  metadata?: Record<string, unknown>
  started_at?: string | null
  completed_at?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type WorkflowArtifact = {
  id: string
  artifact_type: string
  uri: string
  status: string
  metadata: Record<string, unknown>
  created_at?: string | null
  updated_at?: string | null
}

export type WorkflowPart = {
  id: string
  series_id?: string | null
  part_number: number
  part_type?: string | null
  title: string
  goal?: string | null
  hook_direction?: string | null
  ending_direction?: string | null
  previous_part_recap?: string | null
  next_part_tease?: string | null
  target_duration_seconds?: number | null
  status: string
  source_refs?: unknown[]
  main_beats?: string[]
  production_notes?: unknown
  risk_notes?: string[]
  payload?: Record<string, unknown>
  created_at?: string | null
  updated_at?: string | null
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
  sources?: WorkflowSource[]
  candidates?: WorkflowCandidate[]
  parts?: WorkflowPart[]
  runs?: WorkflowRun[]
  artifacts?: WorkflowArtifact[]
  created_at: string
  updated_at?: string | null
}

export type ContentPlan = {
  id: string
  workflow_id?: string | null
  workflow_run_id?: string | null
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

export type ProfileSeriesReview = {
  series: ContentSeries
  articles: Array<{
    plan?: ContentPlan | null
    source_content?: ReviewSourceContent | null
    parts: WorkflowPart[]
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

export const updateMediaWorkflowApi = async (workflowId: string, payload: Record<string, unknown>) => {
  const { data } = await api.patch(`/media-workflows/${workflowId}`, payload)
  return data as MediaWorkflow
}

export const fetchContentPlanApi = async (planId: string) => {
  const { data } = await api.get(`/content-plans/${planId}`)
  return data as ContentPlan
}

export const createMediaWorkflowFromSourcesApi = async (payload: Record<string, unknown>) => {
  const { data } = await api.post('/media-workflows/from-sources', payload)
  return data as MediaWorkflow
}

export const createMediaWorkflowFromCrawlApi = async (payload: Record<string, unknown>) => {
  const { data } = await api.post('/media-workflows/from-crawl', payload)
  const workflow = data as MediaWorkflow
  let workflowRun: WorkflowRun | null = null
  if (payload.create_workflow_run !== false) {
    workflowRun = await createWorkflowRunApi({
      profile_id: payload.profile_id,
      workflow_id: workflow.id,
      planning_mode: payload.planning_mode || 'SERIES',
      target_duration_seconds: payload.target_duration_seconds || 60,
      preferred_part_count: payload.preferred_part_count || null,
      language: payload.language || 'vi',
      instructions: payload.instructions || null,
    })
  }
  return { project: workflow, media_workflow: workflow, workflow_run: workflowRun }
}

export const createMediaWorkflowFromContentSeriesApi = async (payload: { series_id: string; part_ids?: string[]; priority?: number; note?: string }) => {
  const workflows = await fetchMediaWorkflowsApi()
  const workflow = workflows.find((item) => item.series_id === payload.series_id)
  if (!workflow) {
    throw new Error('Series này chưa có kịch bản liên kết. Hãy duyệt plan trước khi mở Generate Video.')
  }
  return workflow
}

export const fetchWorkflowRunsApi = async () => {
  const { data } = await api.get('/workflow-runs')
  return data as WorkflowRun[]
}

export const createWorkflowRunApi = async (payload: Record<string, unknown>) => {
  const { data } = await api.post('/workflow-runs', payload)
  return data as WorkflowRun
}

export const cancelWorkflowRunApi = async (runId: string) => {
  const { data } = await api.post(`/workflow-runs/${runId}/cancel`)
  return data as WorkflowRun
}

export const retryWorkflowRunApi = async (runId: string) => {
  const { data } = await api.post(`/workflow-runs/${runId}/retry`)
  return data as WorkflowRun
}

export const fetchWorkflowRunCandidatesApi = async (runId: string) => {
  const { data } = await api.get(`/workflow-runs/${runId}/candidates`)
  return data as WorkflowCandidate[]
}

export const fetchWorkflowRunLogsApi = async (runId: string) => {
  const { data } = await api.get(`/workflow-runs/${runId}/logs`)
  return data as PromptRun[]
}

export const fetchAllContentPlansApi = async () => {
  const workflows = await fetchMediaWorkflowsApi()
  return workflows.map((wf) => ({
    id: wf.id,
    workflow_id: wf.id,
    profile_id: wf.profile_id,
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
    created_at: wf.created_at,
    updated_at: wf.updated_at || wf.created_at,
  })) as ContentPlan[]
}

export const fetchContentPlansApi = async (profileId: string) => {
  const { data } = await api.get(`/profile/${profileId}/content-plans`)
  const workflows = data as MediaWorkflow[]
  return workflows.map((wf) => ({
    id: wf.id,
    workflow_id: wf.id,
    profile_id: wf.profile_id,
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
  return createWorkflowRunApi({
    profile_id: plan.profile_id,
    workflow_id: plan.workflow_id,
    planning_mode: plan.planning_mode || 'SERIES',
    target_duration_seconds: plan.target_duration_seconds || 60,
    preferred_part_count: plan.recommended_part_count || null,
    language: 'vi',
    instructions: instructions || null,
  })
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

export const fetchWorkflowPartsApi = async (seriesId: string) => {
  const { data } = await api.get(`/content-series/${seriesId}/parts`)
  return data as WorkflowPart[]
}

export const regenerateContentSeriesApi = async (seriesId: string, instructions?: string) => {
  const workflows = await fetchMediaWorkflowsApi()
  const workflow = workflows.find((item) => item.series_id === seriesId)
  if (!workflow) {
    throw new Error('Series này chưa có kịch bản liên kết để tạo luồng chạy mới.')
  }
  return createWorkflowRunApi({
    profile_id: workflow.profile_id,
    workflow_id: workflow.id,
    planning_mode: workflow.planning_mode || 'SERIES',
    target_duration_seconds: 60,
    preferred_part_count: workflow.parts?.length || null,
    language: 'vi',
    instructions: instructions || null,
  })
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
