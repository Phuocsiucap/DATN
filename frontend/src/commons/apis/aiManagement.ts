import { api } from './client'

export type AiManagementConfig = {
  profile_id: string
  ai_management_enabled: boolean
  ai_management_frequency_days: number
  ai_management_last_analysis_at?: string | null
}

export type AiDecision = {
  id: string
  analysis_run_id: string
  profile_id: string
  decision_type: string
  title: string
  target_audience?: string | null
  recommended_topics: Array<Record<string, any>>
  recommended_posting_times: Array<Record<string, any>>
  growth_insights: Array<Record<string, any>>
  content_warnings: Array<Record<string, any>>
  summary?: string | null
  confidence_score: number
  metadata: Record<string, any>
  created_at: string
}

export type AiAnalysisRun = {
  id: string
  profile_id: string
  trigger_type: string
  status: string
  data_range_start?: string | null
  data_range_end?: string | null
  summary?: string | null
  input: Record<string, any>
  output: Record<string, any>
  error_message?: string | null
  started_at?: string | null
  finished_at?: string | null
  created_at: string
  decisions?: AiDecision[]
}

export type AiManagementReport = {
  profile_id: string
  config: AiManagementConfig
  latest_run?: AiAnalysisRun | null
  history: AiAnalysisRun[]
}

export const fetchAiManagementConfigApi = async (profileId: string): Promise<AiManagementConfig> => {
  const { data } = await api.get('/ai-management/config', { params: { profile_id: profileId } })
  return data
}

export const updateAiManagementConfigApi = async (payload: {
  profile_id: string
  ai_management_enabled?: boolean
  ai_management_frequency_days?: number
}): Promise<AiManagementConfig> => {
  const { data } = await api.put('/ai-management/config', payload)
  return data
}

export const runAiManagementAnalysisApi = async (payload: {
  profile_id: string
  days?: number
}): Promise<AiAnalysisRun> => {
  const { data } = await api.post('/ai-management/analyze', payload)
  return data
}

export const fetchAiManagementReportApi = async (params: {
  profile_id: string
  limit?: number
}): Promise<AiManagementReport> => {
  const { data } = await api.get('/ai-management/reports', { params })
  return data
}
