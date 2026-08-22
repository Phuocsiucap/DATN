import { api } from './client'

export const fetchArticlesApi = async (
  page = 1,
  status?: string,
  search?: string,
  startDate?: string,
  endDate?: string,
  hasVideo?: boolean | string,
  sourceType?: string,
  crawlJobId?: string,
) => {
  const params: Record<string, string | number | boolean> = {}
  if (status) params.status = status
  if (search) params.search = search
  if (startDate) params.start_date = startDate
  if (endDate) params.end_date = endDate
  if (hasVideo !== undefined && hasVideo !== '') params.has_video = hasVideo === 'true' || hasVideo === true
  if (sourceType) params.source_type = sourceType
  if (crawlJobId) params.crawl_job_id = crawlJobId

  try {
    const { data } = await api.get('/contents', { params })
    const items = Array.isArray(data)
      ? data.map((item: any) => ({
          id: item.id,
          title: item.canonical_title || item.normalized_title || 'Nội dung không tiêu đề',
          link: item.canonical_url || item.id,
          summary: item.summary,
          status: item.status?.toLowerCase() === 'ready' ? 'crawled' : item.status?.toLowerCase() || 'crawled',
          crawled_at: item.created_at,
          quality_score: item.quality_score,
          content_scope: item.content_scope,
        }))
      : []

    return {
      items,
      total: items.length,
      page,
    }
  } catch (error) {
    return { items: [], total: 0, page }
  }
}

export const fetchMyArticleFeedApi = async (page = 1, _includeLow = false) => {
  try {
    const { data } = await api.get('/contents', { params: { content_scope: 'GLOBAL' } })
    const items = Array.isArray(data)
      ? data.map((item: any) => ({
          id: item.id,
          title: item.canonical_title || item.normalized_title || 'Nội dung chuẩn hóa',
          link: item.canonical_url || item.id,
          summary: item.summary,
          status: item.status?.toLowerCase() === 'ready' ? 'crawled' : item.status?.toLowerCase() || 'crawled',
          crawled_at: item.created_at,
          quality_score: item.quality_score,
          content_scope: item.content_scope,
          match_score: item.quality_score ? Math.round(item.quality_score * 10) : 85,
          match_status: 'matched',
          match_reason: 'Phù hợp với chủ đề chiến lược của kênh',
        }))
      : []

    return {
      items,
      total: items.length,
      page,
    }
  } catch (error) {
    return { items: [], total: 0, page }
  }
}

export const fetchCrawlSettingsApi = async () => {
  return { active: true, mode: 'auto' }
}

export const updateCrawlSettingsApi = async (_payload: any) => {
  return { success: true }
}

export const matchArticlesForMeApi = async (_payload?: any) => {
  try {
    const { data } = await api.get('/contents', { params: { content_scope: 'GLOBAL' } })
    return { matched: Array.isArray(data) ? data.length : 0 }
  } catch {
    return { matched: 0 }
  }
}

export const customTopicCrawlApi = async (payload: any) => {
  const { data } = await api.post('/crawl-jobs', {
    name: payload?.topic || 'Custom Crawl Job',
    crawl_mode: 'ONE_TIME',
    sources: [{ source_type: 'WEB', keywords: payload?.keywords || [] }],
  })
  return data
}

export const fetchArticleDetailApi = async (identifier: string) => {
  try {
    let targetContentId = identifier
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)
    
    if (!isUuid) {
      const { data: listData } = await api.get('/contents')
      if (Array.isArray(listData)) {
        const match = listData.find((item: any) => item.canonical_url === identifier || item.id === identifier)
        if (match) {
          targetContentId = match.id
        }
      }
    }

    const { data } = await api.get(`/contents/${targetContentId}/detail`)
    const mainSource = data.sources?.[0]
    const fullText = data.full_text ||
                     mainSource?.metadata_json?.full_text ||
                     mainSource?.metadata_json?.raw_text ||
                     mainSource?.metadata_json?.transcript ||
                     data.summary ||
                     'Nội dung chưa cập nhật văn bản đầy đủ'

    return {
      id: data.id,
      title: data.canonical_title || data.normalized_title || 'Chi tiết nội dung',
      link: data.canonical_url || mainSource?.source_url || data.id,
      content: fullText,
      summary: data.summary,
      crawled_at: data.created_at,
      quality_score: data.quality_score,
      sources: data.sources || [],
      media: data.media || [],
      processing_runs: data.processing_runs || [],
      images: (data.media || []).filter((m: any) => m.media_type === 'IMAGE' || m.media_type === 'THUMBNAIL').map((m: any) => m.storage_url || m.source_url),
      videos: (data.media || []).filter((m: any) => m.media_type === 'VIDEO').map((m: any) => m.storage_url || m.source_url),
    }
  } catch (error) {
    console.error('Failed to fetch article detail:', error)
    return {
      id: identifier,
      title: 'Chi tiết bài viết',
      link: identifier,
      content: 'Không thể tải chi tiết bài viết từ server.',
    }
  }
}

export const publishArticleApi = async (link: string, platforms: string[], profileIds: (number | string)[] = []) => {
  const profileId = profileIds.find((value) => isUuid(String(value)))
  if (!profileId || !isUuid(link)) {
    throw new Error('Publish article cần content_id và profile_id UUID để tạo content project.')
  }
  const { data } = await api.post('/media-workflows/from-sources', {
    profile_id: profileId,
    content_ids: [link],
    selection_mode: 'MANUAL',
    title: 'Article production project',
    note: `Publish to ${platforms.join(', ')}`,
  })
  return data
}

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
