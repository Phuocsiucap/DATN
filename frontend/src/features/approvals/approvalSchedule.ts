export type ApprovalScheduleMode = 'manual' | 'ai'

export function buildApprovalSchedulePayload(
  mode: ApprovalScheduleMode,
  localDateTime: string,
  timezone: string,
  now = Date.now(),
) {
  if (mode === 'ai') return { schedule_mode: 'ai' as const }
  if (!localDateTime) throw new Error('Vui lòng chọn ngày và giờ đăng.')
  const selected = new Date(localDateTime)
  if (!Number.isFinite(selected.getTime())) throw new Error('Ngày giờ đăng không hợp lệ.')
  if (toDateTimeInputValue(selected.toISOString()) !== localDateTime.slice(0, 16)) throw new Error('Ngày giờ này không tồn tại trong múi giờ trên thiết bị.')
  if (selected.getTime() <= now) throw new Error('Giờ đăng phải nằm trong tương lai.')
  return { schedule_mode: 'manual' as const, scheduled_at: selected.toISOString(), timezone }
}

export function toDateTimeInputValue(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (part: number) => part.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
