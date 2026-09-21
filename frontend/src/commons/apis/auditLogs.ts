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
  const query = new URLSearchParams()
  if (params.page !== undefined) query.append('page', params.page.toString())
  if (params.page_size !== undefined) query.append('page_size', params.page_size.toString())
  if (params.search) query.append('search', params.search)
  if (params.actor_id) query.append('actor_id', params.actor_id)
  if (params.action) query.append('action', params.action)
  if (params.target_type) query.append('target_type', params.target_type)
  if (params.created_from) query.append('created_from', params.created_from)
  if (params.created_to) query.append('created_to', params.created_to)

  const url = `/admin/system/audit-logs${query.toString() ? `?${query.toString()}` : ''}`

  const { data } = await api.get<AuditLogList & {
    page?: number
    limit?: number
    page_size?: number
    total?: number
    total_pages?: number
  }>(url, {
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
