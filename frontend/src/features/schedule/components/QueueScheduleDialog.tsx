import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Loader2 } from 'lucide-react'
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

export type QueueScheduleTarget = {
  id: string
  article_title: string
  profile_name?: string | null
  status: string
  scheduled_at?: string | null
  scheduled_at_local?: string | null
  schedule_timezone?: string | null
}

const inputDateTime = (value?: string | null) => {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
  return match ? `${match[1]}T${match[2]}` : ''
}

const zonedInputDateTime = (date: Date, timezone: string) => {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`
  } catch {
    return zonedInputDateTime(date, 'Asia/Bangkok')
  }
}

export function QueueScheduleDialog({
  item,
  loading,
  onClose,
  onSubmit,
}: {
  item: QueueScheduleTarget | null
  loading: boolean
  onClose: () => void
  onSubmit: (scheduledAtLocal: string, timezone: string) => Promise<boolean>
}) {
  const timezone = item?.schedule_timezone || 'Asia/Bangkok'
  const [scheduledAt, setScheduledAt] = useState('')
  const minimum = useMemo(() => zonedInputDateTime(new Date(Date.now() + 60_000), timezone), [item?.id, timezone])

  useEffect(() => {
    if (!item) return
    setScheduledAt(inputDateTime(item.scheduled_at_local) || zonedInputDateTime(new Date(Date.now() + 15 * 60_000), timezone))
  }, [item, timezone])

  const save = async () => {
    if (!scheduledAt) return
    const saved = await onSubmit(scheduledAt, timezone)
    if (saved) onClose()
  }

  const hasSchedule = Boolean(item?.scheduled_at)
  const title = item?.status === 'needs_approval'
    ? 'Duyệt và xếp lịch'
    : hasSchedule ? 'Thay đổi thời điểm đăng' : 'Xếp lịch xuất bản'

  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && !loading && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Chọn ngày giờ áp dụng cho {item?.profile_name || 'kênh social'}.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="rounded-[8px] border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
            <div className="text-xs font-bold uppercase tracking-wide text-[#64748b]">Queue item</div>
            <div className="mt-1 line-clamp-2 text-sm font-extrabold text-[#172033]">{item?.article_title}</div>
          </div>
          <label className="grid gap-2 text-sm font-bold text-[#34415a]">
            Ngày và giờ đăng
            <div className="flex h-11 items-center gap-2 rounded-[8px] border border-[var(--outline-variant)] bg-white px-3 focus-within:border-[#6d5dfc] focus-within:ring-2 focus-within:ring-[#6d5dfc]/15">
              <CalendarClock size={16} className="shrink-0 text-[#64748b]" />
              <input
                type="datetime-local"
                min={minimum}
                value={scheduledAt}
                disabled={loading}
                onChange={(event) => setScheduledAt(event.target.value)}
                className="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
              />
            </div>
          </label>
          <p className="text-xs leading-5 text-[#64748b]">
            Múi giờ của kênh: <span className="font-extrabold text-[#34415a]">{timezone}</span>. Hệ thống sẽ lưu đúng giờ của kênh, không phụ thuộc múi giờ trên thiết bị hiện tại.
          </p>
        </DialogBody>
        <DialogFooter>
          <AppButton variant="secondary" disabled={loading} onClick={onClose}>Hủy</AppButton>
          <AppButton
            icon={loading ? <Loader2 size={16} className="animate-spin" /> : <CalendarClock size={16} />}
            disabled={loading || !scheduledAt || scheduledAt < minimum}
            onClick={() => void save()}
          >
            {loading ? 'Đang lưu...' : hasSchedule ? 'Lưu thời điểm mới' : 'Xác nhận xếp lịch'}
          </AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
