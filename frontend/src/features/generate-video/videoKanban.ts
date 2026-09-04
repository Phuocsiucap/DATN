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
  { id: 'review', title: 'Video hoàn tất', badgeClass: 'bg-emerald-50 text-emerald-700' },
]

export function isFailedVideoWorkspace(item: Pick<VideoWorkspaceSummary, 'status' | 'task_status'>) {
  return item.status === 'FAILED' || item.task_status === 'FAILED'
}

export function getVideoWorkspaceActivity(item: Pick<VideoWorkspaceSummary, 'status' | 'task_status' | 'current_stage'>): {
  kind: 'draft' | 'voice' | 'rendering'
  queued: boolean
} | null {
  if (isFailedVideoWorkspace(item) || (item.task_status && !hasActiveVideoTask(item))) return null
  if (['RENDERED', 'VIDEO_APPROVED', 'QUEUED_FOR_PUBLISHING', 'PUBLISHED'].includes(item.status)) return null

  const stage = item.current_stage || ''
  const queued = item.task_status === 'PENDING' || stage.startsWith('QUEUED_')

  // Voice jobs run under EDITING (and can be a prerequisite of rendering).
  // Never infer voice generation from the column or workflow status alone.
  if (['QUEUED_VOICE', 'PREPARING_VOICE', 'GENERATING_VOICE', 'ALIGNING_VOICE', 'SAVING_VOICE'].includes(stage)) {
    return { kind: 'voice', queued }
  }
  if (item.status === 'RENDERING') return { kind: 'rendering', queued }
  if (['DRAFT_READY', 'DRAFT_REVIEW_REQUIRED', 'REVIEW_COMPLETE', 'VOICE_READY'].includes(stage)) return null
  if (item.status === 'SCRIPTING' || ['QUEUED_SCRIPT', 'LOADING_SOURCE', 'GENERATING_DRAFT'].includes(stage)) {
    return { kind: 'draft', queued }
  }
  return null
}

export function classifyVideoWorkspace(item: VideoWorkspaceSummary): VideoKanbanColumnId {
  switch (item.status) {
    case 'RENDERED':
      return 'review'
    case 'VIDEO_APPROVED':
      return 'approved'
    case 'QUEUED_FOR_PUBLISHING':
      return 'queued'
    case 'PUBLISHED':
      return 'published'
  }

  if (isFailedVideoWorkspace(item)) return failedStageColumn(item.current_stage)

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
    default:
      return hasActiveVideoTask(item) ? 'rendering' : 'unknown'
  }
}

function failedStageColumn(currentStage?: string | null): VideoKanbanColumnId {
  const stage = String(currentStage || '').trim().toUpperCase()
  if (stage.includes('RENDER') || stage.includes('ENCOD') || stage.includes('EXPORT')) {
    return 'rendering'
  }
  if (
    stage.includes('VOICE')
    || stage.includes('EDIT')
    || stage.includes('REVIEW')
    || stage.includes('APPROV')
  ) {
    return 'editing'
  }
  // Script/draft failures and legacy failures without a recorded stage remain
  // at the first production step instead of moving to a synthetic error column.
  return 'draft'
}

export function buildVideoKanbanColumns(items: VideoWorkspaceSummary[]) {
  const columns = VIDEO_KANBAN_BUCKETS.map<VideoKanbanColumn>((bucket) => ({ ...bucket, items: [] }))
  const byId = new Map(columns.map((column) => [column.id, column]))
  items.forEach((item) => {
    const columnId = classifyVideoWorkspace(item)
    // Publishing states stay at the completed production stage. Failed items
    // stay in the production step reported by current_stage.
    const productionColumn = ['approved', 'queued', 'published'].includes(columnId) ? 'review' : columnId
    byId.get(productionColumn)?.items.push(item)
  })
  return columns
}
