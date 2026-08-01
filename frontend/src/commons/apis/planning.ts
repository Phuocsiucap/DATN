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
  created_at: string
  updated_at: string
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

export type SeriesPart = {
  id: string
  series_id: string
  part_number: number
  part_type: string
  title: string
  goal?: string | null
  hook_direction?: string | null
  ending_direction?: string | null
  next_part_tease?: string | null
  target_duration_seconds?: number | null
  status: string
  main_beats: string[]
}

export type SeriesContextResponse = {
  series_id: string
  context_version: number
  contexts: Array<Record<string, unknown>>
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
  content_series_id: string
  content_plan_id: string
  status: string
  handoff_note?: string | null
  created_at: string
}

export const fetchModule2HandoffsApi = async () => {
  const { data } = await api.get('/module2/handoffs')
  return data as Module2Handoff[]
}

export const createModule2HandoffApi = async (payload: Record<string, unknown>) => {
  const { data } = await api.post('/module2/handoffs', payload)
  return data as Module2Handoff
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

export const fetchContentPlansApi = async () => {
  const { data } = await api.get('/content-plans')
  return data as ContentPlan[]
}

export const approveContentPlanApi = async (planId: string, feedbackText?: string) => {
  const { data } = await api.post(`/content-plans/${planId}/approve`, { feedback_text: feedbackText })
  return data as ContentPlan
}

export const rejectContentPlanApi = async (planId: string, feedbackText?: string) => {
  const { data } = await api.post(`/content-plans/${planId}/reject`, { feedback_text: feedbackText })
  return data as ContentPlan
}

export const regenerateContentPlanApi = async (planId: string, instructions?: string) => {
  const { data } = await api.post(`/content-plans/${planId}/regenerate`, { instructions })
  return data as PlanningJob
}

export const fetchContentSeriesApi = async () => {
  const { data } = await api.get('/content-series')
  return data as ContentSeries[]
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
