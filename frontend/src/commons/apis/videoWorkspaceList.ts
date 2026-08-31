export type WorkspaceProfile = { name: string; platform: string; avatar?: string | null }
export type WorkspaceSeries = { title?: string | null }

export type VideoWorkspaceCardData = {
  id: string
  profile_id: string
  series_id?: string | null
  title?: string | null
  thumbnail_url?: string | null
  category?: string | null
  status: string
  current_stage?: string | null
  progress_percent: number
  task_status?: string | null
  updated_at: string
}

export type VideoWorkspaceListResponse = {
  schema_version: 2
  items: VideoWorkspaceCardData[]
  profiles: Record<string, WorkspaceProfile>
  series: Record<string, WorkspaceSeries>
  total: number
  limit: number
  offset: number
}

export type VideoWorkspaceSummary = Omit<VideoWorkspaceCardData, 'title'> & {
  title: string
  profile: WorkspaceProfile & { id: string }
  series: (WorkspaceSeries & { id: string }) | null
}

// Accept the previous server response during a rolling frontend/API update.
type LegacyWorkspace = Omit<VideoWorkspaceCardData, 'profile_id'> & {
  profile: WorkspaceProfile & { id: string }
  series?: (WorkspaceSeries & { id: string }) | null
  primary_content?: { thumbnail_url?: string | null; thumbnailUrl?: string | null; image_url?: string | null; category?: string | null } | null
  latest_task?: { status: string } | null
}
type LegacyList = { schema_version?: undefined; items: LegacyWorkspace[]; total: number; limit: number; offset: number }

export function normalizeVideoWorkspaceList(data: VideoWorkspaceListResponse | LegacyList) {
  if (data.schema_version !== undefined && data.schema_version !== 2) throw new Error('Phiên bản danh sách workflow không được hỗ trợ')
  const items: VideoWorkspaceSummary[] = data.schema_version === 2
    ? data.items.map(item => {
      const profile = data.profiles[item.profile_id]
      const series = item.series_id ? data.series[item.series_id] : null
      if (!profile || (item.series_id && !series)) throw new Error('Thiếu dữ liệu tham chiếu workflow')
      return { ...item, title: item.title || '', profile: { id: item.profile_id, ...profile },
        series: item.series_id && series ? { id: item.series_id, ...series } : null }
    })
    : data.items.map(item => ({
      id: item.id, profile_id: item.profile.id, series_id: item.series?.id,
      title: item.title || '', profile: item.profile, series: item.series || null,
      thumbnail_url: item.primary_content?.thumbnail_url || item.primary_content?.thumbnailUrl || item.primary_content?.image_url,
      category: item.primary_content?.category, status: item.status,
      current_stage: item.current_stage, progress_percent: item.progress_percent,
      task_status: item.latest_task?.status, updated_at: item.updated_at,
    }))
  return { items, total: data.total, limit: data.limit, offset: data.offset }
}

export function hasActiveVideoTask(item: Pick<VideoWorkspaceSummary, 'task_status'>) {
  return ['PENDING', 'RUNNING', 'PROCESSING'].includes(item.task_status || '')
}

export function videoWorkspaceSeriesKey(items: Pick<VideoWorkspaceSummary, 'series'>[]) {
  const titles = new Map(items.filter(item => item.series).map(item => [item.series!.id, item.series!.title]))
  return JSON.stringify([...titles.entries()].sort(([a], [b]) => a.localeCompare(b)))
}
