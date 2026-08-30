import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Activity,
  AlertCircle,
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
  Search,
  Send,
  UsersRound,
} from 'lucide-react'
import { fetchPublishingQueueApi, fetchPublishingQueueItemApi, fetchSocialProfilesApi, publishPublishingQueueItemApi, refreshPublishingQueueItemPublishStatusApi, updatePublishingQueueItemApi } from '@/commons/apis/api'
import { generateVideoOutputUrl } from '@/commons/apis/generateVideo'
import { MediaAssetPreview } from '@/commons/media'
import { PublishingQueueDetailDialog, type PublishingQueueDetailItem } from '@/features/publishing/PublishingQueueDetailDialog'

type SocialProfile = {
  id: string
  platform: string
  profile_name: string
  username?: string | null
  avatar_url?: string | null
  status: string
  strategy?: {
    schedule_enabled?: boolean
    approval_mode?: string
    auto_publish_enabled?: boolean
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
  published_at?: string | null
  created_at?: string | null
  updated_at?: string | null
  error?: string | null
}

type QueueSummary = {
  total?: number
  total_scheduled?: number
  today?: number
  date_range?: number
  status_counts?: Record<string, number>
}

type CalendarDay = {
  key: string
  label: string
  subLabel: string
  isToday: boolean
}

const baseTimeSlots = [8, 10, 12, 14, 16, 18, 20]

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
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
}

const formatTime = (value?: string | null) => {
  if (!value) return '--:--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--'
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

const scheduledValue = (item: QueueItem) => item.scheduled_at_local || item.scheduled_at

const formatDateKey = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const dateKey = (value?: string | null) => {
  if (!value) return ''
  return formatDateKey(new Date(value))
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

const makeWeekDays = (start: Date): CalendarDay[] => {
  const todayKey = formatDateKey(startOfDay(new Date()))
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
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return false
  const hour = date.getHours()
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
  const [summary, setSummary] = useState<QueueSummary>({})
  const [loading, setLoading] = useState(false)
  const [quickItem, setQuickItem] = useState<QueueItem | null>(null)
  const [modalItem, setModalItem] = useState<QueueItem | null>(null)

  const mergeQueueItem = useCallback((updated: QueueItem) => {
    setItems((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item))
    setQuickItem((current) => current?.id === updated.id ? { ...current, ...updated } : current)
    setModalItem((current) => current?.id === updated.id ? { ...current, ...updated } : current)
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [profileData, queueData] = await Promise.all([
        fetchSocialProfilesApi(),
        fetchPublishingQueueApi({
          profile_id: selectedProfileId !== 'all' ? selectedProfileId : undefined,
          platform: selectedPlatform !== 'all' ? selectedPlatform : undefined,
          queue_status: selectedStatus !== 'all' ? selectedStatus : undefined,
          start_date: formatDateKey(weekStart),
          end_date: formatDateKey(addDays(weekStart, 6)),
          q: searchQuery.trim() || undefined,
          view: 'schedule',
          timezone: 'Asia/Bangkok',
        }),
      ])
      const nextProfiles = profileData.items || []
      const nextItems = queueData.items || []
      setProfiles(nextProfiles)
      setItems(nextItems)
      setSummary(queueData.summary || {})
      setQuickItem((current) => current ? (nextItems.find((item: QueueItem) => item.id === current.id) || current) : null)
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
    if (quickItem && normalizePlatform(quickItem.platform) === 'tiktok' && quickItem.status === 'publishing') ids.add(quickItem.id)
    if (modalItem && normalizePlatform(modalItem.platform) === 'tiktok' && modalItem.status === 'publishing') ids.add(modalItem.id)
    return Array.from(ids).sort().join(',')
  }, [items, quickItem, modalItem])

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

  const handleOpenDetail = async (item: QueueItem) => {
    setLoading(true)
    try {
      const detail = await fetchPublishingQueueItemApi(item.id)
      setModalItem(detail)
    } catch (error: any) {
      setModalItem(item)
      toast.error(error?.response?.data?.detail || 'Không tải được chi tiết bài, đang hiển thị dữ liệu lịch.')
    } finally {
      setLoading(false)
    }
  }

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart])
  const weekDays = useMemo(() => makeWeekDays(weekStart), [weekStart])
  const todayKey = formatDateKey(startOfDay(new Date()))

  const profilesById = useMemo(() => {
    return new Map(profiles.map((profile) => [String(profile.id), profile]))
  }, [profiles])

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
    return filteredItems.filter((item) => {
      const value = scheduledValue(item)
      if (!value) return false
      const time = new Date(value).getTime()
      return time >= weekStart.getTime() && time < weekEnd.getTime()
    }).sort((a, b) => {
      const leftValue = scheduledValue(a)
      const rightValue = scheduledValue(b)
      const left = leftValue ? new Date(leftValue).getTime() : Number.MAX_SAFE_INTEGER
      const right = rightValue ? new Date(rightValue).getTime() : Number.MAX_SAFE_INTEGER
      return left - right
    })
  }, [filteredItems, weekEnd, weekStart])

  const todayItems = useMemo(() => {
    return weekItems.filter((item) => dateKey(scheduledValue(item)) === todayKey)
  }, [todayKey, weekItems])

  const calendarSlots = useMemo(() => {
    const slots = new Set(baseTimeSlots)
    weekItems.forEach((item) => {
      const value = scheduledValue(item)
      if (!value) return
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return
      slots.add(Math.floor(date.getHours() / 2) * 2)
    })
    return Array.from(slots).sort((a, b) => a - b)
  }, [weekItems])

  useEffect(() => {
    setQuickItem((current) => {
      if (current && weekItems.some((item) => item.id === current.id)) return current
      return todayItems[0] || weekItems[0] || null
    })
  }, [todayItems, weekItems])

  const activeProfiles = profiles.filter((profile) => String(profile.status || '').toLowerCase() === 'active').length
  const weekRangeLabel = `${weekDays[0]?.subLabel || ''} - ${weekDays[6]?.subLabel || ''}`
  const totalScheduled = summary.total_scheduled ?? items.filter((item) => scheduledValue(item)).length
  const todayCount = summary.today ?? todayItems.length
  const thisWeekCount = summary.date_range ?? weekItems.length

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--on-surface)' }}>Lịch đăng bài</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--on-surface-variant)' }}>
            Quản lý lịch xuất bản theo kênh social, nền tảng và video đã render.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex h-10 min-w-[280px] items-center gap-2 rounded-md border bg-white px-3" style={{ borderColor: 'var(--outline-variant)' }}>
            <Search size={16} style={{ color: 'var(--on-surface-variant)' }} />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Tìm kiếm bài viết, nội dung, kênh social..."
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <button
            onClick={() => void loadData()}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border bg-white px-3 text-sm font-semibold disabled:opacity-50"
            style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface)' }}
          >
            <RefreshCw size={16} />
            Tải lại
          </button>
          <select
            value={selectedStatus}
            onChange={(event) => setSelectedStatus(event.target.value)}
            className="h-10 rounded-md border bg-white px-3 text-sm font-semibold outline-none"
            style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface)' }}
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="upcoming">Sắp đăng</option>
            <option value="queued">Đã lên lịch</option>
            <option value="needs_approval">Chờ duyệt</option>
            <option value="approved">Đã duyệt</option>
            <option value="publishing">Đang gửi</option>
            <option value="published">Đã đăng</option>
            <option value="failed">Lỗi</option>
          </select>
        </div>
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-bold" style={{ color: 'var(--on-surface)' }}>Kênh social đã kết nối</h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <AccountCard
            active={selectedProfileId === 'all'}
            title="Tất cả kênh social"
            subtitle={`${profiles.length} profile`}
            platform="all"
            statusText={`${activeProfiles}/${profiles.length || 0} đang hoạt động`}
            onClick={() => setSelectedProfileId('all')}
          />
          {profiles.map((profile) => (
            <AccountCard
              key={profile.id}
              active={selectedProfileId === String(profile.id)}
              title={profile.profile_name}
              subtitle={profile.username ? `@${profile.username}` : getPlatformMeta(profile.platform).label}
              platform={profile.platform}
              avatarUrl={profile.avatar_url}
              statusText={String(profile.status || '').toLowerCase() === 'active' ? 'Đã kết nối' : profile.status}
              onClick={() => setSelectedProfileId(String(profile.id))}
            />
          ))}
          <button
            className="flex min-h-[86px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-white text-sm font-semibold"
            style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface-variant)' }}
          >
            <Plus size={22} />
            Kết nối thêm
          </button>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<CalendarDays size={18} />} tint="#7c3aed" label="Tổng bài đã lên lịch" value={String(totalScheduled)} helper="Toàn bộ hàng đợi" />
        <StatCard icon={<Clock3 size={18} />} tint="#2563eb" label="Hôm nay" value={String(todayCount)} helper="Theo bộ lọc hiện tại" />
        <StatCard icon={<Activity size={18} />} tint="#16a34a" label="Tuần này" value={String(thisWeekCount)} helper="Trong 7 ngày đang xem" />
        <StatCard icon={<UsersRound size={18} />} tint="#ea580c" label="Kênh social hoạt động" value={`${activeProfiles}/${profiles.length || 0}`} helper="Profile đang active" />
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

          <div className="overflow-hidden rounded-lg border bg-white shadow-sm" style={{ borderColor: 'var(--outline-variant)' }}>
            <div className="flex items-center justify-center gap-4 border-b px-4 py-3" style={{ borderColor: 'var(--outline-variant)' }}>
              <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="icon-button">
                <ChevronLeft size={17} />
              </button>
              <div className="text-base font-bold" style={{ color: 'var(--on-surface)' }}>{weekRangeLabel}</div>
              <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="icon-button">
                <ChevronRight size={17} />
              </button>
            </div>

            <div className="table-scroll">
              <div className="min-w-[1020px]">
                <div className="grid grid-cols-[64px_repeat(7,minmax(128px,1fr))] border-b" style={{ borderColor: 'var(--outline-variant)' }}>
                  <div className="px-3 py-3 text-xs font-semibold" style={{ color: 'var(--on-surface-variant)' }}>Cả ngày</div>
                  {weekDays.map((day) => (
                    <div
                      key={day.key}
                      className="border-l px-3 py-3 text-center"
                      style={{
                        borderColor: 'var(--outline-variant)',
                        backgroundColor: day.isToday ? 'rgba(37, 99, 235, 0.06)' : 'transparent',
                      }}
                    >
                      <div className="text-sm font-semibold" style={{ color: 'var(--on-surface)' }}>{day.label}</div>
                      <div className={`mx-auto mt-1 flex h-6 w-fit min-w-6 items-center justify-center rounded-full px-2 text-xs font-bold ${day.isToday ? 'bg-blue-600 text-white' : ''}`}>
                        {day.subLabel}
                      </div>
                    </div>
                  ))}
                </div>

                {calendarSlots.map((slot) => (
                  <div key={slot} className="grid min-h-[92px] grid-cols-[64px_repeat(7,minmax(128px,1fr))] border-b last:border-b-0" style={{ borderColor: 'var(--outline-variant)' }}>
                    <div className="px-3 py-3 text-xs font-medium" style={{ color: 'var(--on-surface-variant)' }}>
                      {String(slot).padStart(2, '0')}:00
                    </div>
                    {weekDays.map((day) => {
                      const dayItems = weekItems.filter((item) => dateKey(scheduledValue(item)) === day.key && isItemInSlot(item, slot, calendarSlots))
                      return (
                        <div
                          key={`${day.key}-${slot}`}
                          className="border-l p-1.5"
                          style={{
                            borderColor: 'var(--outline-variant)',
                            backgroundColor: day.isToday ? 'rgba(37, 99, 235, 0.035)' : 'transparent',
                          }}
                        >
                          <div className="space-y-1.5">
                            {dayItems.map((item) => (
                              <ScheduleEventCard
                                key={item.id}
                                item={item}
                                profile={profilesById.get(String(item.profile_id))}
                                active={quickItem?.id === item.id}
                                onSelect={() => setQuickItem(item)}
                                onOpen={() => void handleOpenDetail(item)}
                                onApprove={() => void handleApprove(item.id)}
                                onPublish={() => void handlePublishNow(item)}
                                loading={loading}
                              />
                            ))}
                            {dayItems.length === 0 && slot === 14 && day.isToday && (
                              <button
                                className="flex h-12 w-full items-center justify-center rounded-md border border-dashed"
                                style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface-variant)' }}
                              >
                                <Plus size={17} />
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>

        <aside className="w-full shrink-0 space-y-3 xl:w-[320px]">
          <div className="rounded-lg border bg-white p-4 shadow-sm" style={{ borderColor: 'var(--outline-variant)' }}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold" style={{ color: 'var(--on-surface)' }}>Lịch hôm nay</h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold" style={{ color: 'var(--on-surface-variant)' }}>{todayItems.length}</span>
              </div>
              <button className="text-xs font-semibold" style={{ color: 'var(--secondary)' }} onClick={() => setSelectedProfileId('all')}>
                Xem tất cả
              </button>
            </div>
            <div className="space-y-2.5">
              {todayItems.length === 0 && (
                <div className="empty-state">Không có bài sắp đăng hôm nay.</div>
              )}
              {todayItems.map((item) => (
                <TodayItem
                  key={item.id}
                  item={item}
                  profile={profilesById.get(String(item.profile_id))}
                  active={quickItem?.id === item.id}
                  onClick={() => setQuickItem(item)}
                />
              ))}
            </div>
          </div>

          <QuickDetailCard
            item={quickItem}
            profile={quickItem ? profilesById.get(String(quickItem.profile_id)) : undefined}
            onClose={() => setQuickItem(null)}
            onOpen={() => quickItem && void handleOpenDetail(quickItem)}
          />
        </aside>
      </div>

      <PublishingQueueDetailDialog
        item={modalItem}
        loading={loading}
        onClose={() => setModalItem(null)}
        onApprove={(queueItemId) => void handleApprove(queueItemId)}
        onPublish={handlePublishItem}
      />
    </div>
  )
}

function AccountCard({
  active,
  title,
  subtitle,
  platform,
  statusText,
  avatarUrl,
  onClick,
}: {
  active: boolean
  title: string
  subtitle: string
  platform: string
  statusText: string
  avatarUrl?: string | null
  onClick: () => void
}) {
  const meta = getPlatformMeta(platform)
  return (
    <button
      onClick={onClick}
      className="flex min-h-[86px] items-center gap-3 rounded-lg border bg-white p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
      style={{ borderColor: active ? meta.border : 'var(--outline-variant)' }}
    >
      <div className="relative shrink-0">
        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border bg-slate-50" style={{ borderColor: 'var(--outline-variant)' }}>
          {avatarUrl ? (
            <img src={avatarUrl} alt={title} className="h-full w-full object-cover" />
          ) : (
            <span className="text-sm font-bold" style={{ color: meta.color }}>{title.slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <span className="absolute -left-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-black text-white" style={{ backgroundColor: meta.color }}>
          {meta.short}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold" style={{ color: 'var(--on-surface)' }}>{title}</div>
        <div className="truncate text-xs" style={{ color: 'var(--on-surface-variant)' }}>{subtitle}</div>
        <div className="mt-1 flex items-center gap-1 text-xs font-medium text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {statusText}
        </div>
      </div>
    </button>
  )
}

function StatCard({ icon, tint, label, value, helper }: { icon: ReactNode; tint: string; label: string; value: string; helper: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-white p-4 shadow-sm" style={{ borderColor: 'var(--outline-variant)' }}>
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg" style={{ color: tint, backgroundColor: `${tint}14` }}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>{label}</div>
        <div className="text-xl font-bold" style={{ color: 'var(--on-surface)' }}>{value}</div>
        <div className="text-xs font-semibold text-emerald-600">{helper}</div>
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
      {short && <span className="flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] font-black text-white" style={{ backgroundColor: color }}>{short}</span>}
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
  onPublish,
  loading,
}: {
  item: QueueItem
  profile?: SocialProfile
  active: boolean
  onSelect: () => void
  onOpen: () => void
  onApprove: () => void
  onPublish: () => void
  loading: boolean
}) {
  const platform = getPlatformMeta(item.platform)
  const status = statusMeta[item.status] || statusMeta.queued
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect()
      }}
      className="rounded-md border p-2 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
      style={{ borderColor: active ? platform.color : platform.border, backgroundColor: platform.bg }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-xs font-black" style={{ color: platform.color }}>
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full text-[9px] text-white" style={{ backgroundColor: platform.color }}>{platform.short}</span>
          {formatTime(scheduledValue(item))}
        </div>
        <button
          onClick={(event) => {
            event.stopPropagation()
            onOpen()
          }}
          className="flex h-6 w-6 items-center justify-center rounded-md bg-white/80"
          style={{ color: 'var(--on-surface-variant)' }}
        >
          <Eye size={12} />
        </button>
      </div>
      <div className="line-clamp-2 text-xs font-bold leading-snug" style={{ color: 'var(--on-surface)' }}>{item.article_title}</div>
      <div className="mt-1 truncate text-[10px]" style={{ color: 'var(--on-surface-variant)' }}>
        {profile?.profile_name || item.profile_name || `Profile #${item.profile_id}`}
      </div>
      <div className="mt-1 flex items-center gap-1 text-[10px] font-semibold" style={{ color: status.color }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.dot }} />
        {status.label}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {item.status === 'needs_approval' && (
          <button
            onClick={(event) => {
              event.stopPropagation()
              onApprove()
            }}
            disabled={loading}
            className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: '#4f46e5' }}
          >
            <CheckCircle2 size={11} />
            Duyệt
          </button>
        )}
        {['queued', 'needs_approval', 'approved', 'failed'].includes(item.status) && item.platform === 'tiktok' && (hasTikTokScope(item, 'video.publish') || hasTikTokScope(item, 'video.upload')) && (
          <button
            onClick={(event) => {
              event.stopPropagation()
              onPublish()
            }}
            disabled={loading}
            className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: '#0f766e' }}
          >
            {hasTikTokScope(item, 'video.publish') ? <Rocket size={11} /> : <Send size={11} />}
            {hasTikTokScope(item, 'video.publish') ? 'Đăng' : 'Inbox'}
          </button>
        )}
      </div>
    </div>
  )
}

function TodayItem({ item, profile, active, onClick }: { item: QueueItem; profile?: SocialProfile; active: boolean; onClick: () => void }) {
  const platform = getPlatformMeta(item.platform)
  const status = statusMeta[item.status] || statusMeta.queued
  const videoUrl = item.article_link ? generateVideoOutputUrl(item.article_link) : ''
  return (
    <button
      onClick={onClick}
      className="flex w-full gap-3 rounded-md border p-2 text-left transition-colors"
      style={{ borderColor: active ? platform.border : 'transparent', backgroundColor: active ? platform.bg : 'transparent' }}
    >
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-slate-100">
        {videoUrl ? (
          <MediaAssetPreview item={{ media_type: 'VIDEO', source_url: videoUrl, thumbnail_url: profile?.avatar_url || undefined }} compact />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs font-black text-white" style={{ backgroundColor: platform.color }}>{platform.short}</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: 'var(--on-surface-variant)' }}>
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full text-[8px] text-white" style={{ backgroundColor: platform.color }}>{platform.short}</span>
          {profile?.profile_name || item.profile_name || platform.label}
        </div>
        <div className="line-clamp-2 text-sm font-semibold" style={{ color: 'var(--on-surface)' }}>{item.article_title}</div>
        <div className="mt-1 flex items-center gap-1 text-[10px] font-semibold" style={{ color: status.color }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.dot }} />
          {status.label}
        </div>
      </div>
    </button>
  )
}

function QuickDetailCard({ item, profile, onClose, onOpen }: { item: QueueItem | null; profile?: SocialProfile; onClose: () => void; onOpen: () => void }) {
  if (!item) {
    return (
      <div className="rounded-lg border bg-white p-4 shadow-sm" style={{ borderColor: 'var(--outline-variant)' }}>
        <div className="empty-state">Chọn một bài trong lịch để xem chi tiết nhanh.</div>
      </div>
    )
  }

  const platform = getPlatformMeta(item.platform)
  const status = statusMeta[item.status] || statusMeta.queued
  const videoUrl = item.article_link ? generateVideoOutputUrl(item.article_link) : ''

  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm" style={{ borderColor: 'var(--outline-variant)' }}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-bold" style={{ color: 'var(--on-surface)' }}>Chi tiết bài đăng</h3>
        <button onClick={onClose} className="icon-button" style={{ color: 'var(--on-surface-variant)' }}>×</button>
      </div>
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--on-surface)' }}>
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] text-white" style={{ backgroundColor: platform.color }}>{platform.short}</span>
        {item.article_title}
      </div>
      <div className="mb-3 overflow-hidden rounded-lg border bg-slate-950" style={{ borderColor: 'var(--outline-variant)' }}>
        {videoUrl ? (
          <MediaAssetPreview
            item={{ media_type: 'VIDEO', source_url: videoUrl, thumbnail_url: profile?.avatar_url || undefined }}
            controls
            className="aspect-[9/16] max-h-[360px] w-full"
          />
        ) : (
          <div className="flex h-[220px] w-full items-center justify-center text-xs font-semibold text-white/70">
            Chưa có video
          </div>
        )}
      </div>
      <div className="space-y-2 text-xs" style={{ color: 'var(--on-surface-variant)' }}>
        <div>
          <div className="font-bold" style={{ color: 'var(--on-surface)' }}>Thời gian đăng</div>
          {formatDateTime(scheduledValue(item))}
        </div>
        <div>
          <div className="font-bold" style={{ color: 'var(--on-surface)' }}>Kênh social</div>
          {profile?.profile_name || item.profile_name || `Profile #${item.profile_id}`}
        </div>
        <div>
          <div className="font-bold" style={{ color: 'var(--on-surface)' }}>Nội dung</div>
          <p className="line-clamp-4">{item.generated_content || item.ai_reason || 'Chưa có caption.'}</p>
        </div>
        <div className="flex items-center gap-1 font-semibold" style={{ color: status.color }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.dot }} />
          {status.label}
        </div>
      </div>
      <button
        onClick={onOpen}
        className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md px-3 text-sm font-bold text-white"
        style={{ backgroundColor: '#635bff' }}
      >
        <Eye size={15} />
        Xem chi tiết bài viết
      </button>
    </div>
  )
}
