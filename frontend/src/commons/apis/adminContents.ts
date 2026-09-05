import { api } from './client'

export type AdminContentItem = {
  id: string
  content_type: string
  canonical_title: string
  summary: string | null
  language: string
  content_scope: string
  status: string
  canonical_url: string | null
  quality_score: number
  source_type: string | null
  created_at: string
  updated_at: string | null
}

export type AdminContentFilterParams = {
  search?: string
  status?: string
  content_scope?: string
  content_type?: string
  source_type?: string
  page?: number
  limit?: number
}

export type AdminContentUpdatePayload = {
  canonical_title?: string
  summary?: string | null
  status?: string
  quality_score?: number
}

export const fetchAdminContentsApi = async (
  filters?: AdminContentFilterParams,
): Promise<{ items: AdminContentItem[]; page: number; limit: number; total: number }> => {
  const params: Record<string, string> = {}
  if (filters?.search?.trim()) params.search = filters.search.trim()
  if (filters?.status) params.status = filters.status
  if (filters?.content_scope) params.content_scope = filters.content_scope
  if (filters?.content_type) params.content_type = filters.content_type
  if (filters?.source_type) params.source_type = filters.source_type
  if (filters?.page) params.page = String(filters.page)
  if (filters?.limit) params.limit = String(filters.limit)

  const { data } = await api.get('/admin/contents', { params })
  return data
}

export const updateAdminContentItemApi = async (
  contentId: string,
  payload: AdminContentUpdatePayload,
): Promise<AdminContentItem> => {
  const { data } = await api.patch(`/admin/contents/${contentId}`, payload)
  return data
}
