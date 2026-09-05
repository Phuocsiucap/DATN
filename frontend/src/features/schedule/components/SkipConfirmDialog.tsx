import { Loader2, SkipForward } from 'lucide-react'
import { AppButton } from '@/commons/component/social-ui'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/commons/component/ui/dialog'

type SkipTarget = {
  id: string
  article_title: string
}

export function SkipConfirmDialog({
  item,
  loading,
  onClose,
  onConfirm,
}: {
  item: SkipTarget | null
  loading: boolean
  onClose: () => void
  onConfirm: (id: string) => void
}) {
  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && !loading && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SkipForward size={18} className="text-amber-500" />
            Bỏ qua queue item?
          </DialogTitle>
          <DialogDescription>
            Hành động này không thể hoàn tác. Thời điểm đã giữ sẽ được giải phóng và item sẽ không được xuất bản.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="text-xs font-bold uppercase tracking-wide text-amber-600">Queue item</div>
            <div className="mt-1 line-clamp-2 text-sm font-extrabold text-[#172033]">{item?.article_title}</div>
          </div>
        </DialogBody>

        <DialogFooter>
          <AppButton variant="secondary" disabled={loading} onClick={onClose}>
            Hủy
          </AppButton>
          <AppButton
            icon={
              loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <SkipForward size={16} />
              )
            }
            disabled={loading}
            onClick={() => item && onConfirm(item.id)}
            className="bg-amber-500 hover:bg-amber-600"
          >
            {loading ? 'Đang xử lý...' : 'Xác nhận bỏ qua'}
          </AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
