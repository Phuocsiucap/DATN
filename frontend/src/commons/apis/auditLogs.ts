import { api, type ApiPagination } from './client'
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

export type AuditLogList = {
  items: AuditLogItem[]
  pagination: ApiPagination
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
  const { data } = await api.get<AuditLogList & {
    page?: number
    limit?: number
    page_size?: number
    total?: number
    total_pages?: number
  }>('/admin/system/audit-logs', {
    params,
    forceRefresh: true,
  })
  // Older API processes return flat paging fields; newer ones nest pagination.
  const page = data?.pagination?.page ?? data?.page ?? params.page ?? 1
  const limit = data?.pagination?.limit ?? data?.limit ?? data?.page_size ?? params.page_size ?? 25
  const total = data?.pagination?.total ?? data?.total
  if (!Array.isArray(data?.items) || !Number.isInteger(page) || page < 1 ||
      !Number.isInteger(limit) || limit < 1 || typeof total !== 'number' || !Number.isInteger(total) || total < 0) {
    throw new Error('Dữ liệu nhật ký hệ thống không đúng định dạng')
  }
  return {
    ...data,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  }
}
