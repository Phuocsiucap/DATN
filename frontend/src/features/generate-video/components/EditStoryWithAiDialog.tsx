import { Wand2 } from 'lucide-react'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/commons/component/ui/dialog'

export function EditStoryWithAiDialog({
  open,
  prompt,
  submitting,
  onPromptChange,
  onClose,
  onSubmit,
}: {
  open: boolean
  prompt: string
  submitting: boolean
  onPromptChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Chỉnh sửa story bằng AI</DialogTitle>
          <DialogDescription>Nhập yêu cầu chỉnh sửa cho story data hiện tại.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <textarea
            autoFocus
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="Ví dụ: Viết lại subtitle tự nhiên hơn, tăng kịch tính ở 2 scene đầu, vẫn giữ đúng dữ kiện bài gốc."
            className="h-40 w-full resize-y rounded-md border border-[var(--outline-variant)] p-3 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-blue-100"
          />
        </DialogBody>
        <DialogFooter>
          <button onClick={onClose} className="h-9 rounded-md border border-[var(--outline-variant)] bg-white px-4 text-sm font-semibold text-[var(--on-surface-variant)]">Hủy</button>
          <button disabled={!prompt.trim() || submitting} onClick={onSubmit} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:opacity-50"><Wand2 size={14} /> Gửi yêu cầu</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
