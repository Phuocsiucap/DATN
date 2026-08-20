import { api } from './client'

export type PlanningProfile = {
  id: string
  platform: string
  profile_name: string
  username?: string | null
  status: string
}

export type ProjectSource = {
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

export type ProjectCandidate = {
  id: string
  project_run_id?: string | null
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

export type ProjectRun = {
  id: string
  project_id: string
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

export type ProjectArtifact = {
  id: string
  artifact_type: string
  uri: string
  status: string
  metadata: Record<string, unknown>
  created_at?: string | null
  updated_at?: string | null
}

export type ProjectPart = {
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

export type ProjectSeries = {
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

export type ContentProject = {
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
  series?: ProjectSeries | null
  sources?: ProjectSource[]
  candidates?: ProjectCandidate[]
  parts?: ProjectPart[]
  runs?: ProjectRun[]
  artifacts?: ProjectArtifact[]
  created_at: string
  updated_at?: string | null
}

export type ContentPlan = {
  id: string
  project_id?: string | null
  project_run_id?: string | null
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
  series: ProjectSeries
  articles: Array<{
    plan?: ContentPlan | null
    source_content?: ReviewSourceContent | null
    parts: ProjectPart[]
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
  project_run_id: string
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

export const fetchContentProjectsApi = async () => {
  const { data } = await api.get('/content-projects')
  return data as ContentProject[]
}

export const fetchContentProjectApi = async (projectId: string) => {
  const { data } = await api.get(`/content-projects/${projectId}`)
  return data as ContentProject
}

export const fetchContentPlanApi = async (planId: string) => {
  const { data } = await api.get(`/content-plans/${planId}`)
  return data as ContentPlan
}

export const createContentProjectFromSourcesApi = async (payload: Record<string, unknown>) => {
  const { data } = await api.post('/content-projects/from-sources', payload)
  return data as ContentProject
}

export const createContentProjectFromCrawlApi = async (payload: Record<string, unknown>) => {
  const { data } = await api.post('/content-projects/from-crawl', payload)
  const project = data as ContentProject
  let projectRun: ProjectRun | null = null
  if (payload.create_project_run !== false) {
    projectRun = await createProjectRunApi({
      profile_id: payload.profile_id,
      project_id: project.id,
      planning_mode: payload.planning_mode || 'SERIES',
      target_duration_seconds: payload.target_duration_seconds || 60,
      preferred_part_count: payload.preferred_part_count || null,
      language: payload.language || 'vi',
      instructions: payload.instructions || null,
    })
  }
  return { project, project_run: projectRun }
}

export const createContentProjectFromProjectSeriesApi = async (payload: { series_id: string; part_ids?: string[]; priority?: number; note?: string }) => {
  const projects = await fetchContentProjectsApi()
  const project = projects.find((item) => item.series_id === payload.series_id)
  if (!project) {
    throw new Error('Series này chưa có content project. Hãy duyệt plan trước khi mở Generate Video.')
  }
  return project
}

export const fetchProjectRunsApi = async () => {
  const { data } = await api.get('/project-runs')
  return data as ProjectRun[]
}

export const createProjectRunApi = async (payload: Record<string, unknown>) => {
  const { data } = await api.post('/project-runs', payload)
  return data as ProjectRun
}

export const cancelProjectRunApi = async (runId: string) => {
  const { data } = await api.post(`/project-runs/${runId}/cancel`)
  return data as ProjectRun
}

export const retryProjectRunApi = async (runId: string) => {
  const { data } = await api.post(`/project-runs/${runId}/retry`)
  return data as ProjectRun
}

export const fetchProjectRunCandidatesApi = async (runId: string) => {
  const { data } = await api.get(`/project-runs/${runId}/candidates`)
  return data as ProjectCandidate[]
}

export const fetchProjectRunLogsApi = async (runId: string) => {
  const { data } = await api.get(`/project-runs/${runId}/logs`)
  return data as PromptRun[]
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
  if (data?.plan) return data as { plan: ContentPlan; content_projects: ContentProject[] }
  return { plan: data as ContentPlan, content_projects: [] }
}

export const rejectContentPlanApi = async (planId: string, feedbackText?: string) => {
  const { data } = await api.post(`/content-plans/${planId}/reject`, { feedback_text: feedbackText })
  return data as ContentPlan
}

export const regenerateContentPlanApi = async (planId: string, instructions?: string) => {
  const plan = await fetchContentPlanApi(planId)
  if (!plan.project_id) {
    throw new Error('Plan này chưa gắn content project. Hãy tạo project run mới từ nguồn nội dung.')
  }
  return createProjectRunApi({
    profile_id: plan.profile_id,
    project_id: plan.project_id,
    planning_mode: plan.planning_mode || 'SERIES',
    target_duration_seconds: plan.target_duration_seconds || 60,
    preferred_part_count: plan.recommended_part_count || null,
    language: 'vi',
    instructions: instructions || null,
  })
}

export const fetchAllProjectSeriesApi = async () => {
  const { data } = await api.get('/project-series')
  return data as ProjectSeries[]
}

export const fetchProjectSeriesApi = async (profileId: string) => {
  const { data } = await api.get(`/profile/${profileId}/project-series`)
  return data as ProjectSeries[]
}

export const fetchProfileSeriesReviewApi = async (profileId: string) => {
  const { data } = await api.get(`/profile/${profileId}/series-review`)
  return data as ProfileSeriesReview[]
}

export const fetchProjectPartsApi = async (seriesId: string) => {
  const { data } = await api.get(`/project-series/${seriesId}/parts`)
  return data as ProjectPart[]
}

export const regenerateProjectSeriesApi = async (seriesId: string, instructions?: string) => {
  const projects = await fetchContentProjectsApi()
  const project = projects.find((item) => item.series_id === seriesId)
  if (!project) {
    throw new Error('Series này chưa có content project để tạo project run mới.')
  }
  return createProjectRunApi({
    profile_id: project.profile_id,
    project_id: project.id,
    planning_mode: project.planning_mode || 'SERIES',
    target_duration_seconds: 60,
    preferred_part_count: project.parts?.length || null,
    language: 'vi',
    instructions: instructions || null,
  })
}

export const fetchSeriesContextApi = async (seriesId: string) => {
  const { data } = await api.get(`/project-series/${seriesId}/context`)
  return data as SeriesContextResponse
}

export const rebuildSeriesContextApi = async (seriesId: string) => {
  const { data } = await api.post(`/project-series/${seriesId}/context/rebuild`)
  return data as { series_id: string; context_id: string; context_version: number; mongo_document_id?: string | null }
}

export const fetchSeriesConsistencyApi = async (seriesId: string) => {
  const { data } = await api.get(`/project-series/${seriesId}/consistency-check`)
  return data as ConsistencyCheck
}
