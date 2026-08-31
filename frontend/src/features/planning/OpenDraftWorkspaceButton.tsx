import { FileText } from 'lucide-react'

// Navigation only: approving a workflow is not the same as approving a draft.
// The editor must save and approve the exact script version the user reviewed.
export function OpenDraftWorkspaceButton({ workflowId, onOpenWorkflow, reviewRequired, rejected = false }: {
  workflowId: string
  onOpenWorkflow?: (id: string) => void
  reviewRequired?: boolean
  rejected?: boolean
}) {
  return <button
    type="button"
    disabled={!onOpenWorkflow}
    title={onOpenWorkflow ? 'Mở kịch bản đầy đủ; thao tác này chưa phê duyệt hay chạy sản xuất.' : 'Chưa có điều hướng tới trình sửa kịch bản.'}
    onClick={event => { event.stopPropagation(); onOpenWorkflow?.(workflowId) }}
    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-800 disabled:opacity-50"
  >
    <FileText size={15} />
    {rejected ? 'Xem workflow bị từ chối' : reviewRequired ? 'Mở để duyệt draft' : reviewRequired === false ? 'Mở workflow' : 'Mở / duyệt draft'}
  </button>
}
