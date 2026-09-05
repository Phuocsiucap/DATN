import { api } from './client'

export type AuditActor = {
  id: string
  email: string
  full_name?: string | null
}

export type AuditLogItem = {
  id: string
  actor_id?: string | null
  actor?: AuditActor | null
  action: string
  target_type?: string | null
  target_id?: string | null
  metadata: Record<string, unknown>
  created_at?: string | null
}

export type AuditLogFilters = {
  actors: AuditActor[]
  actions: string[]
  target_types: string[]
}

export type AuditLogList = {
  items: AuditLogItem[]
  page: number
  page_size: number
  total: number
  total_pages: number
  summary: {
    unique_actors: number
    unique_actions: number
  }
  filters: AuditLogFilters
}

export type AuditLogQuery = {
  page?: number
  page_size?: number
  search?: string
  actor_id?: string
  action?: string
  target_type?: string
  created_from?: string
  created_to?: string
}

export const fetchAdminAuditLogsApi = async (params: AuditLogQuery = {}) => {
  const { data } = await api.get<AuditLogList>('/admin/system/audit-logs', {
    params,
    forceRefresh: true,
  })
  return data
}
