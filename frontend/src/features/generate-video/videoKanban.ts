import type { VideoWorkspaceSummary } from '@/commons/apis/generateVideo'
import { hasActiveVideoTask } from '@/commons/apis/videoWorkspaceList'

export type VideoKanbanColumnId =
  | 'draft'
  | 'editing'
  | 'rendering'
  | 'review'
  | 'approved'
  | 'queued'
  | 'published'
  | 'failed'
  | 'unknown'

export type VideoKanbanBucket = {
  id: VideoKanbanColumnId
  title: string
  badgeClass: string
}

export type VideoKanbanColumn = VideoKanbanBucket & {
  items: VideoWorkspaceSummary[]
}

export const VIDEO_KANBAN_BUCKETS: VideoKanbanBucket[] = [
  { id: 'draft', title: 'Draft kịch bản', badgeClass: 'bg-[#f2f0ff] text-[#6d5dfc]' },
  { id: 'editing', title: 'Biên tập & Voice', badgeClass: 'bg-[#eef4ff] text-[#2556ea]' },
  { id: 'rendering', title: 'Render MP4', badgeClass: 'bg-[#fff3d6] text-[#f59e0b]' },
  { id: 'review', title: 'Chờ duyệt video', badgeClass: 'bg-[#fff3d6] text-[#b76b00]' },
  { id: 'approved', title: 'Đã duyệt', badgeClass: 'bg-emerald-50 text-emerald-700' },
  { id: 'queued', title: 'Chờ đăng', badgeClass: 'bg-sky-50 text-sky-700' },
  { id: 'published', title: 'Đã đăng', badgeClass: 'bg-slate-100 text-slate-700' },
  { id: 'failed', title: 'Thất bại', badgeClass: 'bg-rose-50 text-rose-700' },
]

const UNKNOWN_BUCKET: VideoKanbanBucket = {
  id: 'unknown',
  title: 'Khác',
  badgeClass: 'bg-slate-100 text-slate-500',
}

export function isFailedVideoWorkspace(item: Pick<VideoWorkspaceSummary, 'status' | 'task_status'>) {
  return item.status === 'FAILED' || item.task_status === 'FAILED'
}

export function classifyVideoWorkspace(item: VideoWorkspaceSummary): VideoKanbanColumnId {
  if (isFailedVideoWorkspace(item)) return 'failed'

  switch (item.status) {
    case 'SCRIPTING':
    case 'READY':
    case 'DRAFT_READY':
      return 'draft'
    case 'EDITING':
    case 'REVIEWING':
    case 'VOICE_READY':
      return 'editing'
    case 'RENDERING':
      return 'rendering'
    case 'RENDERED':
      return 'review'
    case 'VIDEO_APPROVED':
      return 'approved'
    case 'QUEUED_FOR_PUBLISHING':
      return 'queued'
    case 'PUBLISHED':
      return 'published'
    default:
      return hasActiveVideoTask(item) ? 'rendering' : 'unknown'
  }
}

export function buildVideoKanbanColumns(items: VideoWorkspaceSummary[]) {
  const columns = VIDEO_KANBAN_BUCKETS.map<VideoKanbanColumn>((bucket) => ({ ...bucket, items: [] }))
  const byId = new Map(columns.map((column) => [column.id, column]))
  const unknownColumn: VideoKanbanColumn = { ...UNKNOWN_BUCKET, items: [] }

  items.forEach((item) => {
    const columnId = classifyVideoWorkspace(item)
    ;(byId.get(columnId) || unknownColumn).items.push(item)
  })

  return unknownColumn.items.length > 0 ? [...columns, unknownColumn] : columns
}
