import { Loader2, RefreshCcw } from 'lucide-react'
import type { ContentPlan } from '@/commons/apis/planning'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/commons/component/ui/sheet'

export function RegeneratePlanSheet({
  plan,
  instructions,
  submitting,
  onInstructionsChange,
  onClose,
  onSubmit,
}: {
  plan: ContentPlan | null
  instructions: string
  submitting: boolean
  onInstructionsChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}) {
  if (!plan) return null

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="max-w-[560px]">
        <div className="detail-shell">
          <SheetHeader>
            <div className="mb-2 inline-flex rounded-md bg-blue-100 px-2 py-0.5 text-xs font-black uppercase text-blue-800">Regenerate bài</div>
            <SheetTitle>{plan.title || 'Viết lại bài'}</SheetTitle>
            <SheetDescription>Nhập yêu cầu cụ thể để hệ thống viết lại đúng bài này.</SheetDescription>
          </SheetHeader>
          <SheetBody>
            <label className="block">
              <span className="detail-label mb-2 block">Yêu cầu viết lại</span>
              <textarea
                value={instructions}
                onChange={(event) => onInstructionsChange(event.target.value)}
                className="min-h-[180px] w-full resize-none rounded-md border border-[var(--outline-variant)] bg-white px-3 py-2 text-sm leading-6 text-[var(--on-surface)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-blue-100"
                placeholder="Ví dụ: viết hook mạnh hơn, giọng căng hơn, chia thành nhiều scene ngắn hơn..."
              />
            </label>
          </SheetBody>
          <SheetFooter>
            <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-md border border-[var(--outline-variant)] bg-white px-4 text-sm font-semibold text-[var(--on-surface-variant)] hover:bg-slate-50">Hủy</button>
            <button type="button" onClick={onSubmit} disabled={submitting} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60">
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />} Gửi viết lại
            </button>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  )
}
