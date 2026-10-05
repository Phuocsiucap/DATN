import { useCallback, useEffect, useMemo, useState, useRef, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Activity,
  AlertCircle,
  CalendarClock,
  CalendarDays,
  CheckCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  Plus,
  RefreshCw,
  Rocket,
  Send,
  SkipForward,
  Play,
  Pause,
} from 'lucide-react'
import { approveAndScheduleQueueItemApi, createManualPhotoQueueItemApi, createManualPublishingQueueItemApi, fetchPublishingQueueApi, fetchPublishingQueueItemApi, fetchSocialProfilesApi, publishPublishingQueueItemApi, refreshPublishingQueueItemPublishStatusApi, rescheduleQueueItemApi, updatePublishingQueueItemApi } from '@/commons/apis/api'
import { AppButton, PageLayout, SearchField, SelectControl, SocialProfileAvatar, TableRowActions, type TableRowActionItem } from '@/commons/component/social-ui'
import { generateVideoOutputUrl } from '@/commons/apis/generateVideo'
import { SocialProfileFilter } from '@/commons/component/SocialProfileFilter'
import { MediaAssetPreview } from '@/commons/media'
import { PublishingQueueDetailDialog, type PublishingQueueDetailItem } from '@/features/publishing/PublishingQueueDetailDialog'
import { QueueScheduleDialog, type QueueScheduleMode, type QueueScheduleTarget } from './components/QueueScheduleDialog'
import { SkipConfirmDialog } from './components/SkipConfirmDialog'
import { ManualQueuePostDialog, type ManualQueuePostPayload } from './components/ManualQueuePostDialog'


type SocialProfile = {
  id: string
  platform: string
  profile_name: string
  username?: string | null
  avatar_url?: string | null
  status: string
  strategy?: {
    approval_mode?: string
    auto_publish_enabled?: boolean
    schedule_timezone?: string
    schedule_times?: string | null
  } | null
}

type QueueItem = {
  id: string
  profile_id: string
  profile_name?: string | null
  profile_scopes?: string[]
  can_upload_inbox?: boolean
  can_publish_direct?: boolean
  content_id?: string | null
  article_link?: string | null
  article_title: string
  platform: string
  generated_content?: string | null
  ai_reason?: string | null
  status: string
  platform_publish_id?: string | null
  publish_status?: Record<string, unknown>
  scheduled_at?: string | null
  scheduled_at_local?: string | null
  schedule_timezone?: string | null
  published_at?: string | null
  created_at?: string | null
  updated_at?: string | null
  error?: string | null
}

type CalendarDay = {
  key: string
  label: string
  subLabel: string
  isToday: boolean
}

const baseTimeSlots = [8, 10, 12, 14, 16, 18, 20]

const parseScheduleSlotHours = (value?: string | null) => {
  const hours = new Set<number>()
  for (const rawPart of String(value || '').split(',')) {
    const part = rawPart.trim()
    if (!part) continue
    const [startText, endText] = part.split('-', 2).map((text) => text.trim())
    const start = Number(startText.match(/^(\d{1,2})(?::\d{2})?$/)?.[1])
    if (!Number.isFinite(start) || start < 0 || start > 23) continue
    if (!endText) {
      hours.add(start)
      continue
    }
    const end = Number(endText.match(/^(\d{1,2})(?::\d{2})?$/)?.[1])
    if (!Number.isFinite(end) || end < start || end > 23) {
      hours.add(start)
      continue
    }
    for (let hour = start; hour <= end; hour += 2) hours.add(hour)
  }
  return Array.from(hours)
}

const statusMeta: Record<string, { label: string; color: string; dot: string; icon: ReactNode }> = {
  queued: { label: 'Đã lên lịch', color: '#2563eb', dot: '#10b981', icon: <Clock3 size={13} /> },
  approved: { label: 'Đã duyệt', color: '#0f766e', dot: '#10b981', icon: <CheckCircle size={13} /> },
  needs_approval: { label: 'Đang chờ duyệt', color: '#ea580c', dot: '#f97316', icon: <AlertCircle size={13} /> },
  publishing: { label: 'Đang gửi', color: '#7c3aed', dot: '#7c3aed', icon: <Send size={13} /> },
  published: { label: 'Đã đăng', color: '#15803d', dot: '#16a34a', icon: <CheckCircle size={13} /> },
  failed: { label: 'Lỗi', color: '#b91c1c', dot: '#ef4444', icon: <AlertCircle size={13} /> },
  skipped: { label: 'Đã bỏ qua', color: 'var(--on-surface-variant)', dot: '#94a3b8', icon: <AlertCircle size={13} /> },
}

const platformMeta: Record<string, { label: string; short: string; color: string; bg: string; border: string }> = {
  facebook: { label: 'Facebook', short: 'f', color: '#2563eb', bg: '#eff6ff', border: '#93c5fd' },
  instagram: { label: 'Instagram', short: '◎', color: '#db2777', bg: '#fdf2f8', border: '#f9a8d4' },
  tiktok: { label: 'TikTok', short: '♪', color: '#111827', bg: '#f8fafc', border: '#cbd5e1' },
  youtube: { label: 'YouTube', short: '▶', color: '#dc2626', bg: '#fef2f2', border: '#fca5a5' },
  linkedin: { label: 'LinkedIn', short: 'in', color: '#0a66c2', bg: '#eff6ff', border: '#93c5fd' },
}

const normalizePlatform = (value?: string | null) => String(value || '').toLowerCase()

const getPlatformMeta = (platform?: string | null) => {
  const key = normalizePlatform(platform)
  return platformMeta[key] || { label: platform || 'Social', short: (platform || 'S').slice(0, 2), color: '#475569', bg: '#f8fafc', border: '#cbd5e1' }
}

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Chưa xếp lịch'
  const local = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
  if (local) return `${local[4]}:${local[5]} ${local[3]}/${local[2]}/${local[1]}`
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
}

const formatTime = (value?: string | null) => {
  if (!value) return '--:--'
  const local = value.match(/^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/)
  if (local) return `${local[1]}:${local[2]}`
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--'
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

const scheduledValue = (item: QueueItem) => item.scheduled_at_local || item.scheduled_at

const zonedDateTimeValue = (value: string, timezone: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`
  } catch {
    return zonedDateTimeValue(value, 'Asia/Bangkok')
  }
}

const decorateQueueItem = (item: QueueItem, profile?: SocialProfile): QueueItem => {
  const timezone = item.schedule_timezone || profile?.strategy?.schedule_timezone || 'Asia/Bangkok'
  return {
    ...item,
    schedule_timezone: timezone,
    scheduled_at_local: item.scheduled_at ? zonedDateTimeValue(item.scheduled_at, timezone) : null,
  }
}

const formatDateKey = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const dateKey = (value?: string | null) => {
  if (!value) return ''
  const local = value.match(/^(\d{4}-\d{2}-\d{2})/)
  if (local) return local[1]
  return formatDateKey(new Date(value))
}

const localHour = (value?: string | null) => {
  if (!value) return Number.NaN
  const local = value.match(/^\d{4}-\d{2}-\d{2}[T ](\d{2})/)
  if (local) return Number(local[1])
  return new Date(value).getHours()
}

const startOfDay = (date: Date) => {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

const addDays = (date: Date, days: number) => {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

const makeWeekDays = (start: Date, todayKey: string): CalendarDay[] => {
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index)
    const key = formatDateKey(date)
    return {
      key,
      label: date.toLocaleDateString('vi-VN', { weekday: 'short' }),
      subLabel: date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
      isToday: key === todayKey,
    }
  })
}

const hasTikTokScope = (item: QueueItem, scope: string) => {
  if (scope === 'video.publish' && item.can_publish_direct) return true
  if (scope === 'video.upload' && item.can_upload_inbox) return true
  return (item.profile_scopes || []).includes(scope)
}

const isItemInSlot = (item: QueueItem, slotHour: number, slots: number[]) => {
  const value = scheduledValue(item)
  if (!value) return false
  const hour = localHour(value)
  if (!Number.isFinite(hour)) return false
  const slotIndex = slots.indexOf(slotHour)
  const nextSlot = slots[slotIndex + 1] ?? 24
  return hour >= slotHour && hour < nextSlot
}

export default function SchedulePage() {
  const [profiles, setProfiles] = useState<SocialProfile[]>([])
  const [items, setItems] = useState<QueueItem[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState('all')
  const [selectedPlatform, setSelectedPlatform] = useState('all')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [weekStart, setWeekStart] = useState(() => startOfDay(new Date()))
  const [totalScheduledCount, setTotalScheduledCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [modalItem, setModalItem] = useState<QueueItem | null>(null)
  const [scheduleItem, setScheduleItem] = useState<QueueScheduleTarget | null>(null)
  const [skipTarget, setSkipTarget] = useState<QueueItem | null>(null)
  const [manualDialogOpen, setManualDialogOpen] = useState(false)
  const [manualDateKey, setManualDateKey] = useState<string | null>(null)

  const mergeQueueItem = useCallback((updated: QueueItem) => {
    const profile = profiles.find((candidate) => String(candidate.id) === String(updated.profile_id))
    const normalized = decorateQueueItem(updated, profile)
    setItems((current) => current.map((item) => item.id === normalized.id ? { ...item, ...normalized } : item))
    setModalItem((current) => current?.id === normalized.id ? { ...current, ...normalized } : current)
  }, [profiles])

  const loadData = async () => {
    setLoading(true)
    try {
      const [profileData, queueData] = await Promise.all([
        fetchSocialProfilesApi(),
        fetchPublishingQueueApi({
          profile_id: selectedProfileId !== 'all' ? selectedProfileId : undefined,
          platform: selectedPlatform !== 'all' ? selectedPlatform : undefined,
          queue_status: selectedStatus !== 'all' ? selectedStatus : undefined,
          start_date: formatDateKey(addDays(weekStart, -1)),
          end_date: formatDateKey(addDays(weekStart, 7)),
          q: searchQuery.trim() || undefined,
          view: 'schedule',
          timezone: 'Asia/Bangkok',
          include_unscheduled: true,
        }),
      ])
      const nextProfiles = profileData.items || []
      const nextProfilesById = new Map(nextProfiles.map((profile: SocialProfile) => [String(profile.id), profile]))
      const nextItems = (queueData.items || []).map((item: QueueItem) => decorateQueueItem(item, nextProfilesById.get(String(item.profile_id))))
      setProfiles(nextProfiles)
      setItems(nextItems)
      setTotalScheduledCount(Number(queueData.summary?.total_scheduled || 0))
      setModalItem((current) => {
        if (!current) return null
        const nextItem = nextItems.find((item: QueueItem) => item.id === current.id)
        return nextItem ? { ...current, ...nextItem } : current
      })
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể tải lịch xuất bản')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [selectedProfileId, selectedPlatform, selectedStatus, searchQuery, weekStart])

  const publishingItemIds = useMemo(() => {
    const ids = new Set<string>()
    for (const item of items) {
      if (normalizePlatform(item.platform) === 'tiktok' && item.status === 'publishing') ids.add(item.id)
    }
    if (modalItem && normalizePlatform(modalItem.platform) === 'tiktok' && modalItem.status === 'publishing') ids.add(modalItem.id)
    return Array.from(ids).sort().join(',')
  }, [items, modalItem])

  useEffect(() => {
    if (!publishingItemIds) return
    let cancelled = false
    const ids = publishingItemIds.split(',').filter(Boolean)
    const refreshPublishingItems = async () => {
      const results = await Promise.allSettled(
        ids.map((id) => refreshPublishingQueueItemPublishStatusApi(id, { view: 'schedule', timezone: 'Asia/Bangkok' })),
      )
      if (cancelled) return
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value?.queue_item) {
          mergeQueueItem(result.value.queue_item)
        }
      }
    }
    void refreshPublishingItems()
    const timer = window.setInterval(() => void refreshPublishingItems(), 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [publishingItemIds, mergeQueueItem])

  const handleApprove = async (queueItemId: string) => {
    setLoading(true)
    try {
      await updatePublishingQueueItemApi(queueItemId, 'approved')
      await loadData()
      toast.success('Đã duyệt bài trong lịch.')
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không duyệt được bài')
    } finally {
      setLoading(false)
    }
  }

  const handleSchedule = async (scheduledAtLocal: string, timezone: string, mode: QueueScheduleMode) => {
    if (!scheduleItem) return false
    const wasScheduled = Boolean(scheduleItem.scheduled_at)
    const isApprovalFlow = scheduleItem.status === 'needs_approval'
    setLoading(true)
    try {
      let updated: QueueItem
      if (isApprovalFlow) {
        // TikTok approval flow: keeps the approve-schedule endpoint
        updated = await approveAndScheduleQueueItemApi(scheduleItem.id, {
          schedule_mode: mode,
          scheduled_at: mode === 'manual' ? scheduledAtLocal : undefined,
          timezone,
        })
      } else {
        // Creator reschedule flow: works for all platforms
        updated = await rescheduleQueueItemApi(scheduleItem.id, {
          schedule_mode: mode,
          scheduled_at: mode === 'manual' ? scheduledAtLocal : undefined,
          timezone,
        })
      }
      mergeQueueItem(updated)
      await loadData()
      if (mode === 'ai') {
        toast.success('AI đã chọn khung giờ xuất bản tối ưu.')
      } else {
        toast.success(wasScheduled ? 'Đã thay đổi thời điểm xuất bản.' : 'Đã xếp lịch xuất bản cho queue item.')
      }
      return true
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể lưu lịch xuất bản')
      return false
    } finally {
      setLoading(false)
    }
  }

  const handleSkip = (queueItemId: string) => {
    const item = items.find((candidate) => candidate.id === queueItemId)
      || (modalItem?.id === queueItemId ? modalItem : null)
    setSkipTarget(item ?? ({ id: queueItemId, article_title: queueItemId } as QueueItem))
  }

  const confirmSkip = async (queueItemId: string) => {
    setSkipTarget(null)
    setLoading(true)
    try {
      await updatePublishingQueueItemApi(queueItemId, 'skipped')
      if (modalItem?.id === queueItemId) setModalItem(null)
      if (scheduleItem?.id === queueItemId) setScheduleItem(null)
      await loadData()
      toast.success('Đã bỏ qua queue item và giải phóng thời điểm xuất bản.')
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể bỏ qua queue item')
    } finally {
      setLoading(false)
    }
  }

  const handlePublishNow = async (item: QueueItem, requestedMode?: 'inbox' | 'direct') => {
    setLoading(true)
    const mode = requestedMode || (hasTikTokScope(item, 'video.publish') ? 'direct' : 'inbox')
    try {
      const result = await publishPublishingQueueItemApi(item.id, {
        mode,
        privacy_level: mode === 'direct' ? 'SELF_ONLY' : undefined,
        is_aigc: true,
      })
      if (result.queue_item) mergeQueueItem(result.queue_item)
      await loadData()
      toast.success(mode === 'direct' ? 'Đã gửi Direct Post lên TikTok.' : 'Đã gửi video vào inbox TikTok.')
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không đăng được video lên TikTok')
      await loadData()
    } finally {
      setLoading(false)
    }
  }

  const handlePublishItem = (item: PublishingQueueDetailItem, mode: 'inbox' | 'direct') => {
    void handlePublishNow(item, mode)
  }

  const openManualDialog = (targetDateKey?: string | null) => {
    setManualDateKey(targetDateKey || null)
    setManualDialogOpen(true)
  }

  const handleCreateManualPost = async (payload: ManualQueuePostPayload) => {
    setLoading(true)
    try {
      if (payload.type === 'photo') {
        const created = await createManualPhotoQueueItemApi({
          profile_id: payload.profileId,
          photo_urls: payload.photoUrls,
          photo_cover_index: payload.photoCoverIndex,
          title: payload.title,
          caption: payload.caption,
          auto_add_music: payload.autoAddMusic,
          post_mode: payload.postMode,
          scheduled_at: payload.scheduledAt,
          timezone: payload.timezone,
          is_aigc: payload.isAigc,
          privacy_level: payload.privacyLevel,
        })
        mergeQueueItem(created)
      } else {
        const created = await createManualPublishingQueueItemApi({
          profile_id: payload.profileId,
          video: payload.video,
          caption: payload.caption,
          scheduled_at: payload.scheduledAt,
          timezone: payload.timezone,
        })
        mergeQueueItem(created)
      }
      await loadData()
      toast.success('Đã thêm bài đăng thủ công vào lịch.')
      return true
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { detail?: string } } }
      toast.error(apiError?.response?.data?.detail || 'Không thể thêm bài đăng thủ công')
      return false
    } finally {
      setLoading(false)
    }
  }

  const handleOpenDetail = async (item: QueueItem) => {
    setLoading(true)
    try {
      const detail = await fetchPublishingQueueItemApi(item.id)
      const profile = profiles.find((candidate) => String(candidate.id) === String(detail.profile_id))
      setModalItem(decorateQueueItem(detail, profile))
    } catch (error: any) {
      setModalItem(item)
      toast.error(error?.response?.data?.detail || 'Không tải được chi tiết bài, đang hiển thị dữ liệu lịch.')
    } finally {
      setLoading(false)
    }
  }

  const profilesById = useMemo(() => {
    return new Map(profiles.map((profile) => [String(profile.id), profile]))
  }, [profiles])

  const calendarTimezone = selectedProfileId !== 'all'
    ? profilesById.get(selectedProfileId)?.strategy?.schedule_timezone || 'Asia/Bangkok'
    : Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok'
  const todayKey = dateKey(zonedDateTimeValue(new Date().toISOString(), calendarTimezone))
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart])
  const weekDays = useMemo(() => makeWeekDays(weekStart, todayKey), [todayKey, weekStart])

  const platforms = useMemo(() => {
    const values = new Set<string>()
    profiles.forEach((profile) => values.add(normalizePlatform(profile.platform)))
    items.forEach((item) => values.add(normalizePlatform(item.platform)))
    return Array.from(values).filter(Boolean)
  }, [items, profiles])

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return items.filter((item) => {
      const profile = profilesById.get(String(item.profile_id))
      if (selectedProfileId !== 'all' && String(item.profile_id) !== selectedProfileId) return false
      if (selectedPlatform !== 'all' && normalizePlatform(item.platform) !== selectedPlatform) return false
      if (!query) return true
      return [
        item.article_title,
        item.generated_content,
        item.profile_name,
        profile?.profile_name,
        profile?.username,
        item.platform,
      ].some((value) => String(value || '').toLowerCase().includes(query))
    })
  }, [items, profilesById, searchQuery, selectedPlatform, selectedProfileId])

  const weekItems = useMemo(() => {
    const weekStartKey = formatDateKey(weekStart)
    const weekEndKey = formatDateKey(weekEnd)
    return filteredItems.filter((item) => {
      const value = scheduledValue(item)
      if (!value || item.status === 'skipped') return false
      const key = dateKey(value)
      return key >= weekStartKey && key < weekEndKey
    }).sort((a, b) => {
      return String(scheduledValue(a) || '').localeCompare(String(scheduledValue(b) || ''))
    })
  }, [filteredItems, weekEnd, weekStart])

  const todayItems = useMemo(() => {
    return weekItems.filter((item) => dateKey(scheduledValue(item)) === todayKey)
  }, [todayKey, weekItems])

  const calendarSlots = useMemo(() => {
    const configuredHours = selectedProfileId !== 'all'
      ? parseScheduleSlotHours(profilesById.get(selectedProfileId)?.strategy?.schedule_times)
      : profiles.flatMap((profile) => parseScheduleSlotHours(profile.strategy?.schedule_times))
    const slots = new Set(configuredHours.length ? configuredHours : baseTimeSlots)
    weekItems.forEach((item) => {
      const value = scheduledValue(item)
      if (!value) return
      const hour = localHour(value)
      if (!Number.isFinite(hour)) return
      slots.add(hour)
    })
    return Array.from(slots).sort((a, b) => a - b)
  }, [profiles, profilesById, selectedProfileId, weekItems])




  const scheduledItems = useMemo(() => filteredItems.filter((item) => (
    Boolean(scheduledValue(item)) && item.status !== 'skipped'
  )), [filteredItems])

  const weekRangeLabel = `${weekDays[0]?.subLabel || ''} - ${weekDays[6]?.subLabel || ''}`
  const totalScheduled = totalScheduledCount || scheduledItems.length
  const todayCount = scheduledItems.filter((item) => {
    const itemToday = dateKey(zonedDateTimeValue(new Date().toISOString(), item.schedule_timezone || 'Asia/Bangkok'))
    return dateKey(scheduledValue(item)) === itemToday
  }).length
  const thisWeekCount = weekItems.length

  return (
    <PageLayout
      title="Lịch đăng bài"
      description="Quản lý lịch xuất bản theo kênh social, nền tảng và video đã render."
      actions={
        <>
          <SearchField
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Tìm kiếm bài viết, kênh..."
            className="w-full sm:w-[260px]"
          />
          <AppButton
            icon={<Plus size={15} />}
            onClick={() => openManualDialog(todayKey)}
            disabled={loading || profiles.length === 0}
          >
            Thêm bài thủ công
          </AppButton>
          <SelectControl
            value={selectedStatus}
            onChange={setSelectedStatus}
            className="w-full sm:w-[180px]"
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="upcoming">Sắp đăng</option>
            <option value="queued">Đã lên lịch</option>
            <option value="needs_approval">Chờ duyệt</option>
            <option value="approved">Đã duyệt</option>
            <option value="publishing">Đang gửi</option>
            <option value="published">Đã đăng</option>
            <option value="failed">Lỗi</option>
          </SelectControl>
          <AppButton
            variant="secondary"
            icon={<RefreshCw size={15} className={loading ? 'animate-spin' : ''} />}
            onClick={() => void loadData()}
            disabled={loading}
          >
            Tải lại
          </AppButton>
        </>
      }
    >

      <SocialProfileFilter profiles={profiles} value={selectedProfileId} onChange={setSelectedProfileId} allOption loading={loading} />

      <section className="grid gap-3 md:grid-cols-3">
        <StatCard icon={<CalendarDays size={18} />} tint="#7c3aed" label="Tổng bài đã lên lịch" value={String(totalScheduled)} helper="Toàn bộ hàng đợi" />
        <StatCard icon={<Clock3 size={18} />} tint="#2563eb" label="Hôm nay" value={String(todayCount)} helper="Theo bộ lọc hiện tại" />
        <StatCard icon={<Activity size={18} />} tint="#16a34a" label="Tuần này" value={String(thisWeekCount)} helper="Trong 7 ngày đang xem" />
      </section>

      <div className="flex flex-col gap-3 xl:flex-row">
        <main className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex gap-2 overflow-x-auto pb-1">
              <FilterChip active={selectedPlatform === 'all'} label="Tất cả" onClick={() => setSelectedPlatform('all')} />
              {platforms.map((platform) => {
                const meta = getPlatformMeta(platform)
                return (
                  <FilterChip
                    key={platform}
                    active={selectedPlatform === platform}
                    label={meta.label}
                    short={meta.short}
                    color={meta.color}
                    onClick={() => setSelectedPlatform(platform)}
                  />
                )
              })}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setWeekStart(addDays(weekStart, -7))}
                className="icon-button border bg-white"
                style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface)' }}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setWeekStart(startOfDay(new Date()))}
                className="h-9 rounded-md border bg-white px-4 text-sm font-semibold"
                style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface)' }}
              >
                Hôm nay
              </button>
              <button
                onClick={() => setWeekStart(addDays(weekStart, 7))}
                className="icon-button border bg-white"
                style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface)' }}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm ring-1 ring-slate-900/5" style={{ zoom: 0.75 }}>
            <div className="flex items-center justify-center gap-4 border-b border-slate-100 bg-slate-50/50 px-4 py-3">
              <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="grid h-8 w-8 place-items-center rounded-[8px] border border-slate-200 bg-white text-slate-500 shadow-xs transition hover:bg-slate-50 hover:text-slate-800">
                <ChevronLeft size={16} />
              </button>
              <div className="min-w-[140px] text-center text-sm font-black text-slate-800">{weekRangeLabel}</div>
              <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="grid h-8 w-8 place-items-center rounded-[8px] border border-slate-200 bg-white text-slate-500 shadow-xs transition hover:bg-slate-50 hover:text-slate-800">
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="table-scroll">
              <div className="min-w-[1020px]">
                <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/30">
                  {weekDays.map((day, index) => (
                    <div
                      key={day.key}
                      className={`px-3 py-4 text-center border-slate-100 ${day.isToday ? 'bg-blue-50/40' : ''} ${index > 0 ? 'border-l' : ''}`}
                    >
                      <div className="text-xs font-black uppercase tracking-wider text-slate-500">{day.label}</div>
                      <div className={`mx-auto mt-2 flex h-8 min-w-[32px] w-fit items-center justify-center rounded-full px-2.5 text-sm font-black transition-all ${day.isToday ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' : 'text-slate-700'}`}>
                        {day.subLabel}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7">
                  {weekDays.map((day, index) => {
                    const dayItems = weekItems.filter((item) => dateKey(scheduledValue(item)) === day.key)
                    return (
                      <div
                        key={day.key}
                        className={`min-h-[120px] p-2 border-slate-100 ${day.isToday ? 'bg-blue-50/10' : 'hover:bg-slate-50/50'} ${index > 0 ? 'border-l' : ''}`}
                      >
                        <div className="space-y-3">
                          {dayItems.map((item) => (
                            <ScheduleEventCard
                              key={item.id}
                              item={item}
                              profile={profilesById.get(String(item.profile_id))}
                              active={modalItem?.id === item.id}
                              onSelect={() => void handleOpenDetail(item)}
                              onOpen={() => void handleOpenDetail(item)}
                              onApprove={() => void handleApprove(item.id)}
                              onSchedule={() => setScheduleItem(item)}
                              onSkip={() => void handleSkip(item.id)}
                              onPublish={() => void handlePublishNow(item)}
                              loading={loading}
                            />
                          ))}
                          <button
                            type="button"
                            onClick={() => openManualDialog(day.key)}
                            className="flex h-12 w-full items-center justify-center rounded-md border border-dashed hover:bg-slate-50 transition-colors"
                            style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface-variant)' }}
                            title="Thêm bài thủ công vào ngày này"
                          >
                            <Plus size={17} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </main>


      </div>

      <PublishingQueueDetailDialog
        item={modalItem}
        loading={loading}
        onClose={() => setModalItem(null)}
        onApprove={(queueItemId) => void handleApprove(queueItemId)}
        onSchedule={(item) => setScheduleItem(item)}
        onSkip={(queueItemId) => void handleSkip(queueItemId)}
        onPublish={handlePublishItem}
      />

      <QueueScheduleDialog
        item={scheduleItem}
        loading={loading}
        onClose={() => setScheduleItem(null)}
        onSubmit={handleSchedule}
      />

      <ManualQueuePostDialog
        open={manualDialogOpen}
        profiles={profiles}
        initialProfileId={selectedProfileId}
        initialDateKey={manualDateKey}
        loading={loading}
        onClose={() => setManualDialogOpen(false)}
        onSubmit={handleCreateManualPost}
      />

      <SkipConfirmDialog
        item={skipTarget}
        loading={loading}
        onClose={() => setSkipTarget(null)}
        onConfirm={(id: string) => void confirmSkip(id)}
      />
    </PageLayout>
  )
}

function StatCard({ icon, tint, label, value, helper }: { icon: ReactNode; tint: string; label: string; value: string; helper: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs ring-1 ring-slate-900/5 transition hover:shadow-sm">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl" style={{ color: tint, backgroundColor: `${tint}14` }}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</div>
        <div className="text-2xl font-black text-slate-900">{value}</div>
        <div className="mt-0.5 text-xs font-semibold text-emerald-600">{helper}</div>
      </div>
    </div>
  )
}

function FilterChip({ active, label, short, color, onClick }: { active: boolean; label: string; short?: string; color?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border bg-white px-4 text-sm font-semibold transition-colors"
      style={{
        borderColor: active ? '#818cf8' : 'var(--outline-variant)',
        color: active ? '#4f46e5' : 'var(--on-surface-variant)',
        backgroundColor: active ? '#eef2ff' : '#fff',
      }}
    >
      {short && <span className="flex h-5 min-w-5 items-center justify-center rounded-full text-xs font-black text-white" style={{ backgroundColor: color }}>{short}</span>}
      {label}
    </button>
  )
}

function ScheduleEventCard({
  item,
  profile,
  active,
  onSelect,
  onOpen,
  onApprove,
  onSchedule,
  onSkip,
  onPublish,
  loading,
}: {
  item: QueueItem
  profile?: SocialProfile
  active: boolean
  onSelect: () => void
  onOpen: () => void
  onApprove: () => void
  onSchedule: () => void
  onSkip: () => void
  onPublish: () => void
  loading: boolean
}) {
  const platform = getPlatformMeta(item.platform)
  const bgColors: Record<string, string> = {
    needs_approval: '#ffedd5', // orange-50
    approved: '#f0fdf4', // green-50
    publishing: '#f3e8ff', // purple-50
    published: '#ffffff', // white
    failed: '#fef2f2', // red-50
    queued: '#ffffff', // white
  }
  const borderColors: Record<string, string> = {
    needs_approval: '#fdba74', // orange-300
    approved: '#bbf7d0', // green-300
    publishing: '#d8b4fe', // purple-300
    published: '#e2e8f0', // slate-200
    failed: '#fca5a5', // red-300
    queued: '#e2e8f0', // slate-200
  }
  const bgColor = bgColors[item.status] || '#ffffff'
  const borderColor = active ? platform.color : (borderColors[item.status] || '#e2e8f0')

  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  const handleToggleVideo = (e: React.MouseEvent) => {
    e.stopPropagation()
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      video.play().catch(console.error)
    } else {
      video.pause()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect()
      }}
      className="group relative z-0 hover:z-50 focus-within:z-50 flex flex-col min-h-[64px] gap-2 rounded-lg border p-2 text-left shadow-sm transition-all hover:-translate-y-[1px] hover:shadow-md"
      style={{ borderColor, backgroundColor: bgColor }}
    >
      <div className="flex flex-1 flex-col min-w-0 h-full w-full">
        <div className="mb-2 flex items-start justify-between gap-1">
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
            {item.status !== 'skipped' && scheduledValue(item) && (
              <div className="flex items-center text-[11px] font-extrabold text-slate-600">
                <Clock3 size={11} className="mr-1" />
                {formatTime(scheduledValue(item))}
              </div>
            )}
            {item.status === 'needs_approval' && (
              <span className="inline-block rounded-full bg-orange-500 px-2 py-[2px] text-[10px] font-black text-white shadow-xs">
                Chờ duyệt
              </span>
            )}
            {item.status === 'approved' && (
              <span className="inline-block rounded-full bg-green-500 px-2 py-[2px] text-[10px] font-black text-white shadow-xs">
                Đã duyệt
              </span>
            )}
            {item.status === 'published' && (
              <span className="inline-block rounded-full bg-slate-500 px-2 py-[2px] text-[10px] font-black text-white shadow-xs">
                Đã đăng
              </span>
            )}
            {item.status === 'publishing' && (
              <span className="inline-block rounded-full bg-purple-500 px-2 py-[2px] text-[10px] font-black text-white shadow-xs">
                Đang gửi
              </span>
            )}
            {item.status === 'failed' && (
              <span className="inline-block rounded-full bg-red-500 px-2 py-[2px] text-[10px] font-black text-white shadow-xs">
                Lỗi
              </span>
            )}
          </div>
          
          <div className="-mr-1 -mt-1 shrink-0 z-10">
            <TableRowActions
              actions={([
                { label: 'Xem chi tiết', icon: <Eye size={13} />, onClick: onOpen },
                item.status === 'needs_approval' ? {
                  label: 'Duyệt bài',
                  icon: <CheckCircle2 size={13} />,
                  onClick: onApprove,
                  disabled: loading,
                } : null,
                ['queued', 'needs_approval', 'approved', 'failed'].includes(item.status) ? {
                  label: item.scheduled_at ? 'Đổi thời điểm đăng' : 'Xếp lịch đăng',
                  icon: <CalendarClock size={13} />,
                  onClick: onSchedule,
                  disabled: loading,
                } : null,
                !['published', 'skipped', 'publishing'].includes(item.status) ? {
                  label: 'Bỏ qua queue item',
                  icon: <SkipForward size={13} />,
                  onClick: onSkip,
                  disabled: loading,
                } : null,
                ['queued', 'needs_approval', 'approved', 'failed'].includes(item.status) && item.platform === 'tiktok' && (hasTikTokScope(item, 'video.publish') || hasTikTokScope(item, 'video.upload')) ? {
                  label: hasTikTokScope(item, 'video.publish') ? 'Đăng TikTok ngay' : 'Gửi vào Inbox TikTok',
                  icon: hasTikTokScope(item, 'video.publish') ? <Rocket size={13} /> : <Send size={13} />,
                  onClick: onPublish,
                  disabled: loading,
                } : null,
              ].filter(Boolean)) as TableRowActionItem[]}
            />
          </div>
        </div>

        <div className="mb-2 line-clamp-2 text-xs font-bold leading-snug text-slate-800">
          {item.article_title}
        </div>
        
        <div 
          className="group/video relative mb-2 w-full h-[120px] shrink-0 cursor-pointer overflow-hidden rounded-[6px] bg-slate-900 shadow-inner ring-1 ring-black/10"
          onClick={handleToggleVideo}
        >
          {item.article_link ? (
            <>
              <video
                ref={videoRef}
                src={`${generateVideoOutputUrl(item.article_link)}#t=0.1`}
                preload="metadata"
                loop
                playsInline
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                className="h-full w-full object-cover"
              />
              {!isPlaying && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 transition-all group-hover/video:bg-black/30">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-sm backdrop-blur-sm transition-transform group-hover/video:scale-110">
                    <Play size={18} fill="currentColor" className="ml-1" />
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs font-black text-white opacity-80" style={{ backgroundColor: platform.color }}>{platform.short}</div>
          )}
        </div>

        <div className="mt-auto flex items-center gap-2 pt-0.5">
          <SocialProfileAvatar avatarUrl={profile?.avatar_url} name={profile?.profile_name || item.profile_name} platform={item.platform} size="sm" />
          <span className="truncate text-[11px] font-bold text-slate-600">{profile?.profile_name || item.profile_name || `Profile #${item.profile_id}`}</span>
        </div>
      </div>
    </div>
  )
}
