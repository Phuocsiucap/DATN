import type { CrawlJob, CrawlJobScheduleInput } from '@/commons/apis/module1'

export type CrawlScheduleForm = CrawlJobScheduleInput

export const WEEKDAYS = [
  { value: 0, short: 'T2', label: 'Thứ Hai' },
  { value: 1, short: 'T3', label: 'Thứ Ba' },
  { value: 2, short: 'T4', label: 'Thứ Tư' },
  { value: 3, short: 'T5', label: 'Thứ Năm' },
  { value: 4, short: 'T6', label: 'Thứ Sáu' },
  { value: 5, short: 'T7', label: 'Thứ Bảy' },
  { value: 6, short: 'CN', label: 'Chủ Nhật' },
]

export const DEFAULT_SCHEDULE: CrawlScheduleForm = {
  enabled: true,
  runs_per_day: 1,
  window_start: '08:00',
  window_end: '18:00',
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  timezone: 'Asia/Ho_Chi_Minh',
}

export const normalizeClock = (value?: string) => value ? value.slice(0, 5) : ''

export const scheduleFormForJob = (job: CrawlJob): CrawlScheduleForm => job.schedule ? {
  enabled: job.schedule.enabled,
  runs_per_day: job.schedule.runs_per_day,
  window_start: normalizeClock(job.schedule.window_start),
  window_end: normalizeClock(job.schedule.window_end),
  weekdays: [...job.schedule.weekdays],
  timezone: job.schedule.timezone,
} : { ...DEFAULT_SCHEDULE, weekdays: [...DEFAULT_SCHEDULE.weekdays] }

export function scheduleValidationMessage(schedule: CrawlScheduleForm) {
  if (schedule.weekdays.length === 0) return 'Vui lòng chọn ít nhất một ngày chạy'
  const [startHour, startMinute] = schedule.window_start.split(':').map(Number)
  const [endHour, endMinute] = schedule.window_end.split(':').map(Number)
  const start = startHour * 60 + startMinute
  const end = endHour * 60 + endMinute
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 'Giờ kết thúc phải sau hoặc bằng giờ bắt đầu'
  if (schedule.runs_per_day > 1 && end - start < schedule.runs_per_day - 1) return 'Khung giờ quá ngắn cho số lần chạy đã chọn'
  return null
}

export function scheduleDaysLabel(days: number[]) {
  if (days.length === 7) return 'Hằng ngày'
  if (days.length === 5 && [0, 1, 2, 3, 4].every((day) => days.includes(day))) return 'Thứ 2–Thứ 6'
  return WEEKDAYS.filter((day) => days.includes(day.value)).map((day) => day.short).join(', ')
}
