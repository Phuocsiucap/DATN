export type ApprovalTab = 'needs_approval' | 'approved' | 'attention'

type ApprovalState = { status: string; scheduled_at?: string | null }

export function approvalBucket(item: ApprovalState): ApprovalTab | 'scheduled' | 'published' {
  const status = item.status.toLowerCase()
  if (status === 'published') return 'published'
  if (status === 'publishing') return 'scheduled'
  if (status === 'approved' || status === 'queued') return item.scheduled_at ? 'scheduled' : 'approved'
  if (status === 'needs_approval') return 'needs_approval'
  return 'attention'
}

export function approvalStatusLabel(item: ApprovalState): string {
  const status = item.status.toLowerCase()
  if (status === 'publishing') return 'Đang đăng'
  if (status === 'changes_requested') return 'Cần chỉnh sửa'
  if (status === 'skipped' || status === 'rejected') return 'Từ chối'
  if (status === 'failed') return 'Đăng thất bại'
  const labels = { needs_approval: 'Chờ duyệt', approved: 'Đã duyệt · chưa lên lịch', scheduled: 'Đã lên lịch', published: 'Đã đăng', attention: 'Cần xử lý' }
  return labels[approvalBucket(item)]
}

export const approvalTabs: Array<{ value: ApprovalTab; label: string }> = [
  { value: 'needs_approval', label: 'Chờ duyệt' },
  { value: 'approved', label: 'Đã duyệt · chưa lên lịch' },
  { value: 'attention', label: 'Cần xử lý' },
]
