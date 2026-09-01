import { useState } from 'react'
import { AlertTriangle, ExternalLink, Pencil, RefreshCw, X } from 'lucide-react'
import type { VideoWorkspaceSummary } from '@/commons/apis/generateVideo'
import { classifyVideoWorkspace } from '../videoKanban'

type RetryWorkflowModalProps = {
  item: VideoWorkspaceSummary | null
  isOpen: boolean
  isSubmitting: boolean
  onClose: () => void
  onOpenEdit: (workflowId: string) => void
  onRegenerateDraft: (workflowId: string) => Promise<void>
  onReRenderVideo: (workflowId: string) => Promise<void>
}

export function RetryWorkflowModal({
  item,
  isOpen,
  isSubmitting,
  onClose,
  onOpenEdit,
  onRegenerateDraft,
  onReRenderVideo,
}: RetryWorkflowModalProps) {
  const [renderRetryMode, setRenderRetryMode] = useState<'render' | 'draft'>('render')

  if (!isOpen || !item) return null

  const columnId = classifyVideoWorkspace(item)
  const isRenderStage = columnId === 'rendering' || columnId === 'review' || (columnId === 'failed' && (item.current_stage?.includes('RENDER') || item.status === 'RENDERING' || item.status === 'FAILED'))
  const isEditStage = columnId === 'editing' || (item.status === 'EDITING' || item.status === 'VOICE_READY' || item.status === 'REVIEWING')

  const handleConfirm = async () => {
    if (isRenderStage) {
      if (renderRetryMode === 'render') {
        await onReRenderVideo(item.id)
      } else {
        await onRegenerateDraft(item.id)
      }
    } else {
      await onRegenerateDraft(item.id)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-500/20">
              <RefreshCw size={18} className={isSubmitting ? 'animate-spin' : ''} />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">Xác nhận thực hiện lại tác vụ</h3>
              <p className="text-[11px] font-semibold text-slate-500 truncate max-w-[240px]">
                {item.title}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-600 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4">
          {isRenderStage ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/60 p-3 text-xs text-amber-800">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
                <span>
                  Video rendering bị lỗi hoặc cần thực hiện lại. Vui lòng chọn phương thức bạn muốn chạy lại:
                </span>
              </div>

              <div className="space-y-2 pt-1">
                {/* Option 1: Re-render (Default) */}
                <label
                  onClick={() => setRenderRetryMode('render')}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-all ${
                    renderRetryMode === 'render'
                      ? 'border-blue-500 bg-blue-50/40 ring-2 ring-blue-500/20'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="retryOption"
                    checked={renderRetryMode === 'render'}
                    onChange={() => setRenderRetryMode('render')}
                    className="mt-0.5 h-4 w-4 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <div className="text-xs font-black text-slate-900">1. Render lại video (Mặc định)</div>
                    <p className="mt-0.5 text-[11px] text-slate-500 leading-normal">
                      Giữ nguyên kịch bản & giọng đọc hiện tại, gửi lại yêu cầu ghép khung hình MP4 mới.
                    </p>
                  </div>
                </label>

                {/* Option 2: Re-generate draft */}
                <label
                  onClick={() => setRenderRetryMode('draft')}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-all ${
                    renderRetryMode === 'draft'
                      ? 'border-blue-500 bg-blue-50/40 ring-2 ring-blue-500/20'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="retryOption"
                    checked={renderRetryMode === 'draft'}
                    onChange={() => setRenderRetryMode('draft')}
                    className="mt-0.5 h-4 w-4 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <div className="text-xs font-black text-slate-900">2. Tạo lại kịch bản mới</div>
                    <p className="mt-0.5 text-[11px] text-slate-500 leading-normal">
                      Xóa bỏ bản thảo cũ và chạy AI viết lại kịch bản hoàn toàn mới từ nguồn bài viết.
                    </p>
                  </div>
                </label>
              </div>
            </div>
          ) : isEditStage ? (
            <div className="space-y-2">
              <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50/60 p-3.5 text-xs text-rose-800">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rose-600" />
                <div className="space-y-1">
                  <p className="font-extrabold text-rose-900">Cảnh báo mất nội dung chỉnh sửa</p>
                  <p className="leading-relaxed">
                    Mọi thay đổi kịch bản & timeline hiện tại sẽ bị xóa hoàn toàn. AI sẽ sinh ra một kịch bản mới từ đầu.
                  </p>
                </div>
              </div>
              <p className="text-xs text-slate-600 pt-1 font-medium">
                Bạn có chắc chắn muốn thực hiện lại việc tạo kịch bản mới không?
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-slate-700 leading-relaxed">
                Bạn có muốn thực hiện lại bước tự động tạo kịch bản mới cho bài viết này không?
              </p>
            </div>
          )}
        </div>

        {/* Modal Actions Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-5 py-3.5">
          {/* Nút Chỉnh sửa (Edit) */}
          <button
            type="button"
            onClick={() => {
              onClose()
              onOpenEdit(item.id)
            }}
            disabled={isSubmitting}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-xs transition-all hover:bg-slate-100 hover:border-slate-300"
          >
            <Pencil size={13} className="text-blue-600" />
            Chỉnh sửa
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-xl px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200/60 transition-colors"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-xs font-extrabold text-white shadow-sm transition-all hover:from-blue-700 hover:to-indigo-700 hover:shadow-md disabled:opacity-50"
            >
              {isSubmitting ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <ExternalLink size={13} />
              )}
              {isRenderStage
                ? renderRetryMode === 'render'
                  ? 'Render lại video'
                  : 'Tạo lại kịch bản'
                : 'Tạo lại kịch bản'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
