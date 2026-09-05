import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Loader2, Sparkles } from 'lucide-react'
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

export type QueueScheduleMode = 'manual' | 'ai'

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
  /** Called with (scheduledAtLocal, timezone, mode). Return true to close. */
  onSubmit: (scheduledAtLocal: string, timezone: string, mode: QueueScheduleMode) => Promise<boolean>
}) {
  const timezone = item?.schedule_timezone || 'Asia/Bangkok'
  const [mode, setMode] = useState<QueueScheduleMode>('manual')
  const [scheduledAt, setScheduledAt] = useState('')
  const minimum = useMemo(() => zonedInputDateTime(new Date(Date.now() + 60_000), timezone), [item?.id, timezone])

  // Reset state whenever a new item is opened
  useEffect(() => {
    if (!item) return
    setMode('manual')
    setScheduledAt(inputDateTime(item.scheduled_at_local) || zonedInputDateTime(new Date(Date.now() + 15 * 60_000), timezone))
  }, [item?.id, timezone])

  const save = async () => {
    // For AI mode we pass an empty string; the backend ignores scheduled_at
    const saved = await onSubmit(mode === 'ai' ? '' : scheduledAt, timezone, mode)
    if (saved) onClose()
  }

  const hasSchedule = Boolean(item?.scheduled_at)
  const isApprovalFlow = item?.status === 'needs_approval'
  const title = isApprovalFlow
    ? 'Duyệt và xếp lịch'
    : hasSchedule
      ? 'Thay đổi thời điểm đăng'
      : 'Xếp lịch xuất bản'

  const canSave = mode === 'ai' || (Boolean(scheduledAt) && scheduledAt >= minimum)

  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && !loading && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Chọn ngày giờ hoặc để AI chọn khung giờ tối ưu cho{' '}
            {item?.profile_name || 'kênh social'}.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {/* Queue item label */}
          <div className="rounded-[8px] border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
            <div className="text-xs font-bold uppercase tracking-wide text-[#64748b]">Queue item</div>
            <div className="mt-1 line-clamp-2 text-sm font-extrabold text-[#172033]">{item?.article_title}</div>
          </div>

          {/* Mode toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode('manual')}
              className="flex items-center justify-center gap-2 rounded-[8px] border px-3 py-2.5 text-sm font-bold transition-all"
              style={{
                borderColor: mode === 'manual' ? '#6d5dfc' : '#e2e8f0',
                backgroundColor: mode === 'manual' ? '#ede9fe' : '#fff',
                color: mode === 'manual' ? '#4f46e5' : '#64748b',
              }}
            >
              <CalendarClock size={15} />
              Chọn thủ công
            </button>
            <button
              type="button"
              onClick={() => setMode('ai')}
              className="flex items-center justify-center gap-2 rounded-[8px] border px-3 py-2.5 text-sm font-bold transition-all"
              style={{
                borderColor: mode === 'ai' ? '#7c3aed' : '#e2e8f0',
                backgroundColor: mode === 'ai' ? '#f5f3ff' : '#fff',
                color: mode === 'ai' ? '#7c3aed' : '#64748b',
              }}
            >
              <Sparkles size={15} />
              AI tự chọn
            </button>
          </div>

          {/* Manual datetime picker */}
          {mode === 'manual' && (
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
          )}

          {/* AI mode description */}
          {mode === 'ai' && (
            <div className="flex items-start gap-3 rounded-[8px] border border-[#ede9fe] bg-[#f5f3ff] p-4">
              <Sparkles size={16} className="mt-0.5 shrink-0 text-[#7c3aed]" />
              <p className="text-xs leading-5 text-[#4c1d95]">
                AI sẽ phân tích lịch hiện có, chiến lược kênh và khung giờ còn trống để chọn
                thời điểm xuất bản tối ưu theo{' '}
                <span className="font-extrabold">{timezone}</span>.
              </p>
            </div>
          )}

          {/* Timezone note */}
          <p className="text-xs leading-5 text-[#64748b]">
            Múi giờ của kênh:{' '}
            <span className="font-extrabold text-[#34415a]">{timezone}</span>. Hệ thống lưu
            đúng giờ của kênh, không phụ thuộc múi giờ thiết bị.
          </p>
        </DialogBody>

        <DialogFooter>
          <AppButton variant="secondary" disabled={loading} onClick={onClose}>
            Hủy
          </AppButton>
          <AppButton
            icon={
              loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : mode === 'ai' ? (
                <Sparkles size={16} />
              ) : (
                <CalendarClock size={16} />
              )
            }
            disabled={loading || !canSave}
            onClick={() => void save()}
          >
            {loading
              ? mode === 'ai'
                ? 'AI đang chọn...'
                : 'Đang lưu...'
              : mode === 'ai'
                ? 'Để AI chọn giờ'
                : hasSchedule
                  ? 'Lưu thời điểm mới'
                  : 'Xác nhận xếp lịch'}
          </AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
