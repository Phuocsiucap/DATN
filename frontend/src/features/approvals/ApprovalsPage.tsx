import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Edit3,
  Send,
  X,
} from 'lucide-react'
import {
  approveAndScheduleQueueItemApi,
  approvePublishingQueueItemApi,
  approveAndPublishQueueItemNowApi,
  fetchPublishingQueueApprovalItemApi,
  fetchPublishingQueueApi,
  fetchSocialProfilesApi,
  type SocialProfile,
  requestPublishingQueueItemChangesApi,
  updatePublishingQueueItemApi,
} from '@/commons/apis/api'
import {
  AppButton,
  AppCard,
  EmptyBlock,
  LoadingBlock,
  PageLayout,
  SearchField,
  SocialProfileAvatar,
  StatusPill,
  TabStrip,
  Thumbnail,
  platformLabel,
} from '@/commons/component/social-ui'
import { SocialPostPreview } from '@/commons/component/social-previews'
import { SocialProfileFilter } from '@/commons/component/SocialProfileFilter'
import { buildApprovalSchedulePayload, toDateTimeInputValue } from './approvalSchedule'
import { approvalBucket, approvalStatusLabel, approvalTabs, type ApprovalTab } from './approvalStatus'

type ApprovalQueueItem = {
  id: string
  profile_id: string
  profile_name?: string | null
  profile_username?: string | null
  profile_avatar_url?: string | null
  profile_scopes?: string[]
  profile_strategy?: {
    approval_mode: string
    auto_queue_enabled: boolean
    auto_publish_enabled: boolean
  } | null
  content_id?: string | null
  article_link?: string | null
  article_title: string
  platform: string
  generated_content?: string | null
  caption?: string | null
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
  video_url?: string | null
  thumbnail_url?: string | null
  source_url?: string | null
  category?: string | null
  tags?: string[]
  quality_score?: number | null
  duration_seconds?: number | null
  creator_name?: string | null
  can_upload_inbox?: boolean
  can_publish_direct?: boolean
}

const formatDate = (value?: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const formatDuration = (seconds?: number | null) => {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value <= 0) return undefined
  const minutes = Math.floor(value / 60)
  const rest = Math.floor(value % 60)
  return `${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`
}

const isTerminalStatus = (value?: string | null) => ['publishing', 'published', 'skipped', 'rejected'].includes(String(value || '').toLowerCase())
const statusTone = (value?: string | null): 'green' | 'amber' | 'red' | 'gray' => {
  const status = String(value || '').toLowerCase()
  if (['approved', 'queued', 'published'].includes(status)) return 'green'
  if (['needs_approval', 'publishing'].includes(status)) return 'amber'
  if (['skipped', 'rejected', 'failed', 'changes_requested'].includes(status)) return 'red'
  return 'gray'
}

const itemTags = (item: ApprovalQueueItem) => {
  const captionTags = String(item.caption || item.generated_content || '').match(/#[\p{L}\p{N}_]+/gu) || []
  return [...(item.tags || []), item.category, ...captionTags.map((tag) => tag.replace(/^#/, ''))]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, array) => array.findIndex((other) => other.toLowerCase() === value.toLowerCase()) === index)
    .slice(0, 5)
}

export default function ApprovalsPage() {
  const [items, setItems] = useState<ApprovalQueueItem[]>([])
  const [profiles, setProfiles] = useState<SocialProfile[]>([])
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [profileError, setProfileError] = useState('')
  const [activeTab, setActiveTab] = useState<ApprovalTab>('needs_approval')
  const [selectedItem, setSelectedItem] = useState<ApprovalQueueItem | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [profileFilter, setProfileFilter] = useState(() => new URLSearchParams(window.location.search).get('profile_id') || 'all')
  const [page, setPage] = useState(1)
  const [scheduleTargetId, setScheduleTargetId] = useState<string | null>(null)
  const [scheduleMode, setScheduleMode] = useState<'ai' | 'manual'>('manual')
  const [manualScheduledAt, setManualScheduledAt] = useState('')
  const [loading, setLoading] = useState(false)

  const mergeQueueItem = useCallback((updated: ApprovalQueueItem) => {
    setItems((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item))
    setSelectedItem((current) => current?.id === updated.id ? { ...current, ...updated } : current)
  }, [])

  const loadQueue = async () => {
    setLoading(true)
    try {
      const data = await fetchPublishingQueueApi({ platform: 'tiktok', view: 'approval', timezone: 'Asia/Bangkok' })
      const nextItems = [...(data.items || [])].sort((a, b) => {
        const left = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER
        const right = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER
        return left - right
      })
      setItems(nextItems)
    } catch (error: any) {
      setItems([])
      toast.error(error?.response?.data?.detail || 'Không thể tải danh sách cần duyệt TikTok')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadQueue()
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchSocialProfilesApi('tiktok').then((data) => {
      if (cancelled) return
      setProfiles(data.items)
      setProfileFilter((current) => current === 'all' || data.items.some(profile => profile.id === current) ? current : 'all')
    }).catch(() => {
      if (!cancelled) setProfileError('Không tải được danh sách kênh. Vui lòng tải lại trang.')
    }).finally(() => { if (!cancelled) setLoadingProfiles(false) })
    return () => { cancelled = true }
  }, [])

  const matchingItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    return items.filter((item) => {
      if (profileFilter !== 'all' && item.profile_id !== profileFilter) return false
      if (!query) return true
      return [
        item.article_title,
        item.profile_name,
        item.profile_username,
        item.generated_content,
        item.caption,
        item.ai_reason,
        item.category,
        ...(item.tags || []),
      ].some((value) => String(value || '').toLowerCase().includes(query))
    })
  }, [items, profileFilter, search])

  const filteredItems = useMemo(() => matchingItems.filter((item) => approvalBucket(item) === activeTab), [matchingItems, activeTab])
  const counts = useMemo(() => Object.fromEntries(approvalTabs.map((tab) => [
    tab.value, matchingItems.filter((item) => approvalBucket(item) === tab.value).length,
  ])), [matchingItems])
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / 5))
  const currentPage = Math.min(page, pageCount)
  const pageStart = (currentPage - 1) * 5
  const visibleItems = useMemo(() => filteredItems.slice(pageStart, pageStart + 5), [filteredItems, pageStart])

  useEffect(() => { setPage(1); setScheduleTargetId(null) }, [activeTab, profileFilter, search])

  useEffect(() => {
    setSelectedItem((current) => {
      const match = visibleItems.find((item) => item.id === current?.id)
      return match ? { ...current, ...match } : visibleItems[0] || null
    })
  }, [visibleItems])

  const selectedItemId = selectedItem?.id
  useEffect(() => {
    if (!selectedItemId) return
    let cancelled = false
    setScheduleMode('manual')
    setManualScheduledAt('')
    setDetailLoading(true)
    fetchPublishingQueueApprovalItemApi(selectedItemId)
      .then((detail) => {
        if (cancelled) return
        mergeQueueItem(detail)
        setManualScheduledAt(toDateTimeInputValue(detail.scheduled_at))
      })
      .catch((error) => {
        if (!cancelled) toast.error(error?.response?.data?.detail || 'Không thể tải chi tiết bài cần duyệt')
      })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [selectedItemId, mergeQueueItem])

  const handleApprove = async () => {
    if (!selectedItem) return
    setLoading(true)
    try {
      const updated = await approvePublishingQueueItemApi(selectedItem.id)
      mergeQueueItem(updated)
      setManualScheduledAt('')
      setActiveTab('approved')
      toast.success('Đã duyệt video. Chưa lên lịch và chưa gửi lên TikTok.')
      await loadQueue()
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể duyệt video')
    } finally {
      setLoading(false)
    }
  }

  const handleStatus = async (nextStatus: string) => {
    if (!selectedItem) return
    setLoading(true)
    try {
      await updatePublishingQueueItemApi(selectedItem.id, nextStatus)
      toast.success(nextStatus === 'approved' ? 'Đã duyệt bài TikTok.' : 'Đã cập nhật trạng thái bài TikTok.')
      await loadQueue()
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể cập nhật bài')
    } finally {
      setLoading(false)
    }
  }

  const handleApproveSchedule = async () => {
    if (!selectedItem) return false
    try {
      const payload = buildApprovalSchedulePayload(scheduleMode, manualScheduledAt, Intl.DateTimeFormat().resolvedOptions().timeZone)
      setLoading(true)
      const updated = await approveAndScheduleQueueItemApi(selectedItem.id, payload)
      mergeQueueItem(updated)
      setScheduleTargetId(null)
      toast.success(scheduleMode === 'ai' ? 'Đã lên lịch bằng khung giờ còn trống. Xem tại trang Lịch đăng.' : 'Đã lên lịch theo đúng giờ bạn chọn. Xem tại trang Lịch đăng.')
      await loadQueue()
      return true
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || 'Không thể duyệt và lên lịch bài TikTok')
      return false
    } finally {
      setLoading(false)
    }
  }

  const handleRequestChanges = async () => {
    if (!selectedItem) return
    setLoading(true)
    try {
      const updated = await requestPublishingQueueItemChangesApi(selectedItem.id, 'Reviewer yêu cầu chỉnh sửa nội dung/video trước khi duyệt.')
      setSelectedItem(updated)
      toast.success('Đã gửi yêu cầu chỉnh sửa.')
      await loadQueue()
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không gửi được yêu cầu chỉnh sửa')
    } finally {
      setLoading(false)
    }
  }

  const handlePublish = async (mode: 'inbox' | 'direct') => {
    if (!selectedItem) return
    setLoading(true)
    try {
      const result = await approveAndPublishQueueItemNowApi(selectedItem.id, {
        mode,
        privacy_level: mode === 'direct' ? 'SELF_ONLY' : undefined,
        is_aigc: true,
      })
      if (result.queue_item) mergeQueueItem(result.queue_item)
      toast.success(mode === 'direct' ? 'Đã gửi đăng ngay TikTok.' : 'Đã gửi vào inbox TikTok.')
      await loadQueue()
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không gửi được video lên TikTok')
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageLayout
      title="Duyệt bài"
      description="Duyệt video và chọn lịch. Bài đã có lịch được quản lý tại Lịch đăng, bài đã đăng ở trang riêng."
      actions={
        <>
          <AppButton variant="secondary" icon={<CalendarDays size={16} />} onClick={() => { window.location.href = '/schedule' }}>Xem lịch đăng</AppButton>
          <AppButton variant="ghost" icon={<Send size={16} />} onClick={() => { window.location.href = '/published-posts' }}>Video đã đăng</AppButton>
        </>
      }
    >

      <SocialProfileFilter profiles={profiles} value={profileFilter} onChange={setProfileFilter} allOption loading={loadingProfiles} disabled={loading} className="mb-3" emptyLabel={profileError || 'Chưa có kênh TikTok để duyệt video.'} />
      <TabStrip
        value={activeTab}
        onChange={setActiveTab}
        tabs={approvalTabs.map((tab) => ({ ...tab, count: counts[tab.value] }))}
        className="mb-4"
      />

      <div className="grid gap-4 xl:grid-cols-[500px_minmax(0,1fr)] 2xl:grid-cols-[520px_minmax(0,1fr)]">
          <section className="min-w-0">
            <SearchField value={search} onChange={setSearch} placeholder="Tìm video, kênh hoặc nội dung..." className="mb-4" />

            {loading && filteredItems.length === 0 ? (
              <LoadingBlock />
            ) : filteredItems.length === 0 ? (
              <EmptyBlock label="Không có video TikTok nào trong danh sách này." />
            ) : (
              <div className="space-y-3">
                {visibleItems.map((item, index) => (
                  <ApprovalListCard
                    key={item.id}
                    item={item}
                    index={index}
                    active={selectedItem?.id === item.id}
                    disabled={loading}
                    onClick={() => { setSelectedItem(item); setScheduleTargetId(null) }}
                    onSchedule={() => { setSelectedItem(item); setScheduleTargetId(item.id) }}
                  />
                ))}
              </div>
            )}

            <div className="mt-5 flex items-center justify-between text-[13px] font-medium text-[#526179]">
              <span>Hiển thị {visibleItems.length ? `${pageStart + 1} - ${pageStart + visibleItems.length} trong` : '0 trong'} {filteredItems.length} video</span>
              <div className="flex items-center gap-2">
                <button aria-label="Trang trước" disabled={loading || currentPage === 1} onClick={() => { setPage(currentPage - 1); setScheduleTargetId(null) }} className="grid h-8 w-8 place-items-center rounded-[8px] hover:bg-[#f4f6ff] disabled:opacity-40">‹</button>
                <span>{currentPage}/{pageCount}</span>
                <button aria-label="Trang sau" disabled={loading || currentPage === pageCount} onClick={() => { setPage(currentPage + 1); setScheduleTargetId(null) }} className="grid h-8 w-8 place-items-center rounded-[8px] hover:bg-[#f4f6ff] disabled:opacity-40">›</button>
              </div>
            </div>
          </section>

          <ApprovalDetail
            key={selectedItem?.id || 'empty'}
            item={selectedItem}
            detailLoading={detailLoading}
            scheduleMode={scheduleMode}
            manualScheduledAt={manualScheduledAt}
            scheduleOpen={scheduleTargetId === selectedItem?.id}
            onOpenSchedule={() => setScheduleTargetId(selectedItem?.id || null)}
            onCloseSchedule={() => setScheduleTargetId(null)}
            onScheduleModeChange={setScheduleMode}
            onManualScheduledAtChange={setManualScheduledAt}
            onClose={() => setSelectedItem(null)}
            onApprove={() => void handleApprove()}
            onApproveSchedule={handleApproveSchedule}
            onRequestChanges={() => void handleRequestChanges()}
            onReject={() => void handleStatus('skipped')}
            onPublish={(mode) => void handlePublish(mode)}
            loading={loading}
          />
        </div>
    </PageLayout>
  )
}

export function ApprovalListCard({
  item,
  index,
  active,
  onClick,
  onSchedule,
  disabled,
}: {
  item: ApprovalQueueItem
  index: number
  active: boolean
  onClick: () => void
  onSchedule: () => void
  disabled: boolean
}) {
  return (
    <article
      aria-label={item.article_title}
      className={`rounded-[8px] border transition ${active ? 'border-[#2556ea] bg-[#fbfbff] shadow-[0_0_0_2px_rgba(37,86,234,0.08)]' : 'border-[var(--outline-variant)] bg-white hover:border-[#cbd5e1]'}`}
    >
    <button onClick={onClick} disabled={disabled} className="flex w-full gap-3 p-3 text-left disabled:opacity-60" aria-pressed={active}>
      <Thumbnail src={item.thumbnail_url} title={item.article_title} index={index} className="h-[86px] w-[96px] shrink-0" fallback={false} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2.5">
          <SocialProfileAvatar
            avatarUrl={item.profile_avatar_url}
            name={item.profile_name}
            platform={item.platform || 'tiktok'}
            size="md"
          />
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-1 text-[14px] font-extrabold text-[#111827]">{item.article_title}</h3>
            <p className="mt-1 line-clamp-1 text-[13px] font-medium text-[#64748b]">{item.caption || item.generated_content || item.ai_reason || item.article_title}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] font-semibold text-[#64748b]">
          <span>Người tạo: {item.creator_name || 'Người dùng'}</span>
          <span className="text-[#2556ea]">{item.scheduled_at ? formatDate(item.scheduled_at_local || item.scheduled_at) : 'Chưa lên lịch'}</span>
        </div>
      </div>
      <ChevronDown size={16} className="mt-8 text-[#718096]" />
    </button>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
      <StatusPill value={approvalStatusLabel(item)} tone={statusTone(item.status)} />
      {approvalBucket(item) === 'approved' && <AppButton variant="secondary" icon={<CalendarDays size={14} />} disabled={disabled} onClick={onSchedule}>Lên lịch</AppButton>}
    </div>
    </article>
  )
}

export function ApprovalDetail({
  item,
  detailLoading,
  scheduleMode,
  manualScheduledAt,
  scheduleOpen = false,
  onOpenSchedule,
  onCloseSchedule,
  onScheduleModeChange,
  onManualScheduledAtChange,
  onClose,
  onApprove,
  onApproveSchedule,
  onRequestChanges,
  onReject,
  onPublish,
  loading,
}: {
  item: ApprovalQueueItem | null
  detailLoading: boolean
  scheduleMode: 'ai' | 'manual'
  manualScheduledAt: string
  scheduleOpen?: boolean
  onOpenSchedule: () => void
  onCloseSchedule: () => void
  onScheduleModeChange: (value: 'ai' | 'manual') => void
  onManualScheduledAtChange: (value: string) => void
  onClose: () => void
  onApprove: () => void
  onApproveSchedule: () => Promise<boolean>
  onRequestChanges: () => void
  onReject: () => void
  onPublish: (mode: 'inbox' | 'direct') => void
  loading: boolean
}) {
  if (!item) return <EmptyBlock label="Chọn một video TikTok để xem chi tiết." />

  const tags = itemTags(item)
  const canDirect = Boolean(item.can_publish_direct)
  const canInbox = Boolean(item.can_upload_inbox)
  const mediaUrl = item.video_url || item.thumbnail_url || item.article_link
  const terminal = isTerminalStatus(item.status)
  const alreadyApproved = ['approved', 'queued'].includes(item.status)
  const actionDisabled = loading || detailLoading || terminal

  return (
    <section className="flex min-h-[620px] flex-col overflow-hidden rounded-[8px] border border-[var(--outline-variant)] bg-white">
      <div className="flex items-center justify-between border-b border-[var(--outline-variant)] p-5">
        <div className="flex items-center gap-3">
          <SocialProfileAvatar
            avatarUrl={item.profile_avatar_url}
            name={item.profile_name}
            platform={item.platform || 'tiktok'}
            size="lg"
          />
          <div>
            <div className="flex items-center gap-2 text-[14px] font-extrabold text-[#111827]">
              {item.profile_name || 'TikTok profile'} ({platformLabel('tiktok')})
              <ChevronDown size={15} />
            </div>
            <div className="mt-0.5 text-[12px] font-medium text-[#64748b]">{item.profile_username ? `@${item.profile_username}` : formatDate(item.scheduled_at_local || item.scheduled_at)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill value={approvalStatusLabel(item)} tone={statusTone(item.status)} />
          <button aria-label="Đóng chi tiết" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-[8px] text-[#526179] hover:bg-[#f4f6ff]"><X size={17} /></button>
        </div>
      </div>

      <div className="grid flex-1 gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          <section>
            <div className="mb-2 text-[13px] font-bold text-[#526179]">Thời gian dự kiến đăng</div>
            <div className="flex items-center gap-3 text-[14px] font-semibold text-[#34415a]">
              <CalendarDays size={17} className="text-[#526179]" />
              {item.scheduled_at ? formatDate(item.scheduled_at_local || item.scheduled_at) : 'Chưa lên lịch'}
            </div>
          </section>

          <div className="space-y-2 rounded-lg border border-blue-100 bg-blue-50/60 p-3 text-xs leading-5 text-slate-600">
            <p>{item.status === 'published' ? 'Video đã đăng thành công. Không cần duyệt hoặc lên lịch lại.'
              : item.status === 'publishing' ? 'Video đang được gửi lên TikTok. Không thể đổi lịch trong lúc đăng.'
              : approvalBucket(item) === 'approved'
              ? 'Video đã được duyệt. Chưa có lịch nên scheduler chưa đăng video này. Chọn Lên lịch để đặt giờ, không cần duyệt lại.'
              : approvalBucket(item) === 'scheduled'
                ? 'Video đã được duyệt và có lịch đăng. Bạn có thể đổi lịch trước khi hệ thống bắt đầu đăng.'
                : 'Nút Duyệt chỉ xác nhận video, không đặt lịch và không đăng TikTok. Duyệt & lên lịch mở bước chọn giờ để bạn xác nhận.'}</p>
            {item.profile_strategy && <div className="border-t border-blue-100 pt-2">
              <p className="font-bold">Cấu hình strategy hiện tại của kênh</p>
              <p>Duyệt video: {item.profile_strategy.approval_mode === 'auto' ? 'Tự động' : 'Thủ công'} · Tự lên lịch sau tự duyệt: {item.profile_strategy.auto_queue_enabled ? 'Bật' : 'Tắt'}</p>
              <p>Tự động đăng theo lịch: <strong>{item.profile_strategy.auto_publish_enabled ? 'Bật' : 'Tắt — có lịch vẫn chưa tự gửi lên TikTok'}</strong></p>
            </div>}
          </div>
          {scheduleOpen && <section aria-label="Chọn lịch đăng" className="rounded-[8px] border border-indigo-200 bg-[#fbfcff] p-4">
            <div className="mb-3 text-[13px] font-bold text-[#526179]">Chọn cách lên lịch</div>
            <div className="mb-3 flex flex-wrap gap-2">
              {(['manual', 'ai'] as const).map((mode) => (
                <button key={mode} type="button" disabled={actionDisabled} aria-pressed={scheduleMode === mode} onClick={() => onScheduleModeChange(mode)} className={`min-h-10 rounded-lg border px-3 text-xs font-bold disabled:opacity-50 ${scheduleMode === mode ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
                  {mode === 'manual' ? 'Chọn giờ thủ công' : 'AI chọn giờ'}
                </button>
              ))}
            </div>
            <div className="grid gap-3">
              {scheduleMode === 'manual' ? (
                <label className="grid gap-2 text-[12px] font-semibold text-slate-600">
                  Ngày và giờ đăng
                  <div className="relative flex h-10 items-center gap-2 rounded-[8px] border border-[var(--outline-variant)] bg-white px-3 transition focus-within:border-[#6d5dfc] focus-within:ring-2 focus-within:ring-[#6d5dfc]/15">
                    <CalendarDays size={15} className="pointer-events-none shrink-0 text-[#718096]" />
                    <input
                      type="datetime-local"
                      aria-label="Ngày và giờ đăng"
                      autoFocus
                      required
                      disabled={actionDisabled}
                      min={toDateTimeInputValue(new Date(Date.now() + 60000).toISOString())}
                      value={manualScheduledAt}
                      onInput={(event) => onManualScheduledAtChange(event.currentTarget.value)}
                      onChange={(event) => onManualScheduledAtChange(event.target.value)}
                      className="h-full min-w-0 flex-1 cursor-pointer bg-transparent p-0 text-[13px] font-semibold text-[#172033] outline-none"
                    />
                  </div>
                  <span className="font-normal">Múi giờ trên thiết bị: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Hệ thống lưu đúng giờ bạn chọn.</span>
                </label>
              ) : (
                <div className="flex min-h-10 items-center rounded-[8px] border border-[#edf1f7] bg-white px-3 text-[12px] font-semibold leading-5 text-[#526179]">
                  DeepSeek chọn giờ dựa trên thời gian hiện tại, múi giờ tài khoản, các bài đã trong hàng đợi và giới hạn bài/ngày. Nếu AI không khả dụng, hệ thống chọn giờ trống gần nhất theo quy tắc; các bài cách nhau ít nhất 30 phút.
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <AppButton variant="secondary" disabled={loading} onClick={onCloseSchedule}>Hủy chọn lịch</AppButton>
              <AppButton icon={<CalendarDays size={15} />} disabled={actionDisabled || (scheduleMode === 'manual' && !manualScheduledAt)} onClick={() => { void onApproveSchedule().then((saved) => { if (saved) onCloseSchedule() }) }}>
                {scheduleMode === 'manual' ? 'Xác nhận lịch đăng' : 'Xác nhận để AI chọn lịch'}
              </AppButton>
            </div>
          </section>}

          <section>
            <div className="mb-2 text-[13px] font-bold text-[#526179]">Nội dung bài viết</div>
            <div className="rounded-[8px] border border-[var(--outline-variant)] bg-white p-4 text-[14px] leading-7 text-[#34415a]">
              <p className="font-bold text-[#111827]">{item.article_title}</p>
              <p className="mt-3">{item.caption || item.generated_content || item.article_title}</p>
              {tags.length > 0 && <p className="mt-3 font-semibold text-[#2556ea]">{tags.map((tag) => `#${tag.replace(/^#/, '')}`).join(' ')}</p>}
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <Thumbnail src={item.thumbnail_url} title={item.article_title} className="h-[150px]" fallback={false} />
            <div className="grid h-[150px] place-items-center rounded-[8px] border border-dashed border-[#cbd5e1] bg-[#fbfcff] text-center text-[13px] font-semibold text-[#64748b]">
              <span>{item.video_url ? 'Video TikTok đã render' : 'Chưa có video render'}</span>
            </div>
          </div>

          <section className="grid gap-3 text-[13px] text-[#526179] sm:grid-cols-2">
            <InfoRow label="Người tạo" value={item.creator_name || 'Người dùng'} />
            <InfoRow label="Ngày tạo" value={formatDate(item.created_at)} />
            <InfoRow label="Điểm phù hợp" value={typeof item.quality_score === 'number' ? `${item.quality_score.toFixed(1)}/100` : '-'} />
            <InfoRow label="Ghi chú" value={item.error || item.ai_reason || '-'} />
          </section>
        </div>

        <SocialPostPreview
          post={{
            platform: 'tiktok',
            profileName: item.profile_name || 'SocialContentHub',
            username: item.profile_username || item.profile_name || 'socialcontenthub',
            avatarUrl: item.profile_avatar_url,
            title: item.article_title,
            caption: item.caption || item.generated_content || item.article_title,
            mediaUrl,
            status: approvalStatusLabel(item),
            duration: formatDuration(item.duration_seconds),
          }}
        />
      </div>

      <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--outline-variant)] bg-[#fbfcff] p-5">
        <AppButton variant="danger" icon={<X size={16} />} disabled={loading || detailLoading || terminal} onClick={onReject}>Từ chối</AppButton>
        <AppButton variant="secondary" icon={<Edit3 size={16} />} disabled={loading || detailLoading || terminal} onClick={onRequestChanges}>Yêu cầu chỉnh sửa</AppButton>
        {!alreadyApproved && !terminal && <AppButton icon={<CheckCircle2 size={16} />} disabled={actionDisabled} onClick={onApprove}>Duyệt</AppButton>}
        {!terminal && <AppButton variant={alreadyApproved ? 'primary' : 'secondary'} icon={<CalendarDays size={16} />} disabled={actionDisabled} onClick={onOpenSchedule}>
          {alreadyApproved ? (item.scheduled_at ? 'Đổi lịch đăng' : 'Lên lịch đăng') : 'Duyệt & lên lịch'}
        </AppButton>}
        {(canDirect || canInbox) && !terminal && (
          <AppButton icon={<Send size={16} />} disabled={loading || detailLoading} onClick={() => onPublish(canDirect ? 'direct' : 'inbox')}>
            {canDirect ? (alreadyApproved ? 'Đăng ngay' : 'Duyệt & đăng ngay') : 'Gửi inbox TikTok'}
          </AppButton>
        )}
      </div>
    </section>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 font-semibold text-[#64748b]">{label}</div>
      <div className="min-w-0 flex-1 truncate font-semibold text-[#172033]">{value}</div>
    </div>
  )
}
