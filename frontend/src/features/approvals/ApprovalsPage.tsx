import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Edit3,
  MoreHorizontal,
  Plus,
  Send,
  X,
} from 'lucide-react'
import {
  approveAndScheduleQueueItemApi,
  approveAndPublishQueueItemNowApi,
  fetchPublishingQueueApprovalItemApi,
  fetchPublishingQueueApi,
  requestPublishingQueueItemChangesApi,
  updatePublishingQueueItemApi,
} from '@/commons/apis/api'
import {
  AppButton,
  AppCard,
  EmptyBlock,
  LoadingBlock,
  PageHeader,
  SearchField,
  SelectControl,
  SocialProfileAvatar,
  StatusPill,
  TabStrip,
  Thumbnail,
  platformLabel,
} from '@/commons/component/social-ui'
import { SocialPostPreview } from '@/commons/component/social-previews'

type ApprovalQueueItem = {
  id: string
  profile_id: string
  profile_name?: string | null
  profile_username?: string | null
  profile_avatar_url?: string | null
  profile_scopes?: string[]
  content_id?: string | null
  article_link?: string | null
  article_title: string
  platform: string
  generated_content?: string | null
  caption?: string | null
  ai_reason?: string | null
  status: string
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

type ApprovalTab = 'needs_approval' | 'approved' | 'skipped' | 'all'

const tabs: Array<{ value: ApprovalTab; label: string }> = [
  { value: 'needs_approval', label: 'Chờ duyệt' },
  { value: 'approved', label: 'Đã duyệt' },
  { value: 'skipped', label: 'Từ chối' },
  { value: 'all', label: 'Tất cả' },
]

const tabMatches: Record<ApprovalTab, (status: string) => boolean> = {
  needs_approval: (status) => status === 'needs_approval',
  approved: (status) => ['approved', 'queued', 'publishing', 'published'].includes(status),
  skipped: (status) => ['skipped', 'rejected', 'changes_requested'].includes(status),
  all: () => true,
}

const statusLabels: Record<string, string> = {
  needs_approval: 'Chờ duyệt',
  approved: 'Đã duyệt',
  queued: 'Đã lên lịch',
  publishing: 'Đang đăng',
  published: 'Đã đăng',
  skipped: 'Từ chối',
  rejected: 'Từ chối',
  changes_requested: 'Cần chỉnh sửa',
  failed: 'Lỗi',
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

const statusLabel = (value?: string | null) => statusLabels[String(value || '').toLowerCase()] || value || '-'
const isTerminalStatus = (value?: string | null) => ['published', 'skipped', 'rejected'].includes(String(value || '').toLowerCase())
const statusTone = (value?: string | null): 'green' | 'amber' | 'red' | 'gray' => {
  const status = String(value || '').toLowerCase()
  if (['approved', 'queued', 'published'].includes(status)) return 'green'
  if (['needs_approval', 'publishing'].includes(status)) return 'amber'
  if (['skipped', 'rejected', 'failed', 'changes_requested'].includes(status)) return 'red'
  return 'gray'
}

const toDateTimeInputValue = (value?: string | null) => {
  const date = value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => part.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
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
  const [activeTab, setActiveTab] = useState<ApprovalTab>('needs_approval')
  const [selectedItem, setSelectedItem] = useState<ApprovalQueueItem | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [profileFilter, setProfileFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [creatorFilter, setCreatorFilter] = useState('all')
  const [scheduleMode, setScheduleMode] = useState<'ai' | 'manual'>('ai')
  const [manualScheduledAt, setManualScheduledAt] = useState(toDateTimeInputValue())
  const [loading, setLoading] = useState(false)

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

  const profiles = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of items) map.set(item.profile_id, item.profile_name || 'TikTok profile')
    return Array.from(map.entries())
  }, [items])

  const creators = useMemo(() => {
    const values = new Set(items.map((item) => item.creator_name || 'Người dùng'))
    return Array.from(values)
  }, [items])

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    return items.filter((item) => {
      const status = String(item.status || '').toLowerCase()
      if (!tabMatches[activeTab](status)) return false
      if (profileFilter !== 'all' && item.profile_id !== profileFilter) return false
      if (statusFilter !== 'all' && status !== statusFilter) return false
      if (creatorFilter !== 'all' && (item.creator_name || 'Người dùng') !== creatorFilter) return false
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
  }, [activeTab, creatorFilter, items, profileFilter, search, statusFilter])

  useEffect(() => {
    setSelectedItem((current) => {
      if (current && filteredItems.some((item) => item.id === current.id)) return current
      return filteredItems[0] || null
    })
  }, [filteredItems])

  const counts = useMemo(() => ({
    needs_approval: items.filter((item) => tabMatches.needs_approval(String(item.status || '').toLowerCase())).length,
    approved: items.filter((item) => tabMatches.approved(String(item.status || '').toLowerCase())).length,
    skipped: items.filter((item) => tabMatches.skipped(String(item.status || '').toLowerCase())).length,
    all: items.length,
  }), [items])
  const visibleItems = filteredItems.slice(0, 5)

  const openItemDetail = async (item: ApprovalQueueItem) => {
    setSelectedItem(item)
    setManualScheduledAt(toDateTimeInputValue(item.scheduled_at_local || item.scheduled_at))
    setDetailLoading(true)
    try {
      const detail = await fetchPublishingQueueApprovalItemApi(item.id)
      setSelectedItem(detail)
      setManualScheduledAt(toDateTimeInputValue(detail.scheduled_at_local || detail.scheduled_at))
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể tải chi tiết bài cần duyệt')
    } finally {
      setDetailLoading(false)
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
    if (!selectedItem) return
    setLoading(true)
    try {
      const updated = await approveAndScheduleQueueItemApi(selectedItem.id, {
        schedule_mode: scheduleMode,
        scheduled_at: scheduleMode === 'manual' && manualScheduledAt ? new Date(manualScheduledAt).toISOString() : null,
        timezone: 'Asia/Bangkok',
      })
      setSelectedItem(updated)
      setManualScheduledAt(toDateTimeInputValue(updated.scheduled_at_local || updated.scheduled_at))
      toast.success(scheduleMode === 'ai' ? 'Đã duyệt và AI đã chọn giờ đăng.' : 'Đã duyệt và lên lịch theo giờ bạn chọn.')
      await loadQueue()
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể duyệt và lên lịch bài TikTok')
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
      if (result.queue_item) setSelectedItem(result.queue_item)
      toast.success(mode === 'direct' ? 'Đã gửi đăng ngay TikTok.' : 'Đã gửi vào inbox TikTok.')
      await loadQueue()
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không gửi được video lên TikTok')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app-page">
      <AppCard className="overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--outline-variant)] p-7">
          <PageHeader
            title="Duyệt bài"
            description="Xem, duyệt và lên lịch các video TikTok trước khi đăng"
          />
          <div className="flex items-center gap-3">
            <AppButton variant="secondary" icon={<CalendarDays size={16} />} onClick={() => { window.location.href = '/schedule' }}>Xem lịch đăng</AppButton>
            <AppButton icon={<Plus size={16} />}>Tạo bài viết</AppButton>
          </div>
        </div>

        <div className="px-5">
          <TabStrip
            value={activeTab}
            onChange={setActiveTab}
            tabs={tabs.map((tab) => ({ ...tab, count: counts[tab.value] }))}
          />
        </div>

        <div className="grid gap-4 p-5 xl:grid-cols-[500px_minmax(0,1fr)] 2xl:grid-cols-[520px_minmax(0,1fr)]">
          <section className="min-w-0">
            <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <SelectControl value={profileFilter} onChange={setProfileFilter}>
                <option value="all">Tất cả kênh social</option>
                {profiles.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </SelectControl>
              <SelectControl value={statusFilter} onChange={setStatusFilter}>
                <option value="all">Tất cả trạng thái</option>
                {Array.from(new Set(items.map((item) => String(item.status || '').toLowerCase()).filter(Boolean))).map((status) => (
                  <option key={status} value={status}>{statusLabel(status)}</option>
                ))}
              </SelectControl>
              <SelectControl value={creatorFilter} onChange={setCreatorFilter}>
                <option value="all">Tất cả người tạo</option>
                {creators.map((creator) => <option key={creator} value={creator}>{creator}</option>)}
              </SelectControl>
              <SelectControl icon={<CalendarDays size={15} />}><option>Tất cả thời gian</option></SelectControl>
            </div>

            <SearchField value={search} onChange={setSearch} placeholder="Tìm kiếm bài cần duyệt..." className="mb-4" />

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
                    onClick={() => void openItemDetail(item)}
                  />
                ))}
              </div>
            )}

            <div className="mt-5 flex items-center justify-between text-[13px] font-medium text-[#526179]">
              <span>Hiển thị {visibleItems.length ? `1 - ${visibleItems.length} trong` : '0 trong'} {filteredItems.length} bài viết</span>
              <div className="flex items-center gap-2">
                <button className="grid h-8 w-8 place-items-center rounded-[8px] text-[#526179] hover:bg-[#f4f6ff]">‹</button>
                <button className="grid h-8 w-8 place-items-center rounded-[8px] bg-[#2556ea] text-white">1</button>
                <button className="grid h-8 w-8 place-items-center rounded-[8px] text-[#526179] hover:bg-[#f4f6ff]">›</button>
              </div>
            </div>
          </section>

          <ApprovalDetail
            item={selectedItem}
            detailLoading={detailLoading}
            scheduleMode={scheduleMode}
            manualScheduledAt={manualScheduledAt}
            onScheduleModeChange={setScheduleMode}
            onManualScheduledAtChange={setManualScheduledAt}
            onClose={() => setSelectedItem(null)}
            onApproveSchedule={() => void handleApproveSchedule()}
            onRequestChanges={() => void handleRequestChanges()}
            onReject={() => void handleStatus('skipped')}
            onPublish={(mode) => void handlePublish(mode)}
            loading={loading}
          />
        </div>
      </AppCard>
    </div>
  )
}

function ApprovalListCard({
  item,
  index,
  active,
  onClick,
}: {
  item: ApprovalQueueItem
  index: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full gap-3 rounded-[8px] border p-3 text-left transition ${active ? 'border-[#2556ea] bg-[#fbfbff] shadow-[0_0_0_2px_rgba(37,86,234,0.08)]' : 'border-[var(--outline-variant)] bg-white hover:border-[#cbd5e1]'}`}
    >
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
          <StatusPill value={statusLabel(item.status)} tone={statusTone(item.status)} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] font-semibold text-[#64748b]">
          <span>Người tạo: {item.creator_name || 'Người dùng'}</span>
          <span className="text-[#2556ea]">{formatDate(item.scheduled_at_local || item.scheduled_at)}</span>
        </div>
      </div>
      <ChevronDown size={16} className="mt-8 text-[#718096]" />
    </button>
  )
}

function ApprovalDetail({
  item,
  detailLoading,
  scheduleMode,
  manualScheduledAt,
  onScheduleModeChange,
  onManualScheduledAtChange,
  onClose,
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
  onScheduleModeChange: (value: 'ai' | 'manual') => void
  onManualScheduledAtChange: (value: string) => void
  onClose: () => void
  onApproveSchedule: () => void
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
          <StatusPill value={statusLabel(item.status)} tone={statusTone(item.status)} />
          <button className="grid h-8 w-8 place-items-center rounded-[8px] text-[#526179] hover:bg-[#f4f6ff]"><MoreHorizontal size={17} /></button>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-[8px] text-[#526179] hover:bg-[#f4f6ff]"><X size={17} /></button>
        </div>
      </div>

      <div className="grid flex-1 gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          <section>
            <div className="mb-2 text-[13px] font-bold text-[#526179]">Thời gian dự kiến đăng</div>
            <div className="flex items-center gap-3 text-[14px] font-semibold text-[#34415a]">
              <CalendarDays size={17} className="text-[#526179]" />
              {formatDate(item.scheduled_at_local || item.scheduled_at)}
              <Edit3 size={15} className="text-[#718096]" />
            </div>
          </section>

          <section className="rounded-[8px] border border-[var(--outline-variant)] bg-[#fbfcff] p-4">
            <div className="mb-3 text-[13px] font-bold text-[#526179]">Cơ chế lên lịch</div>
            <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
              <SelectControl value={scheduleMode} onChange={(value) => onScheduleModeChange(value as 'ai' | 'manual')}>
                <option value="ai">AI chọn giờ</option>
                <option value="manual">Chọn thủ công</option>
              </SelectControl>
              {scheduleMode === 'manual' ? (
                <input
                  type="datetime-local"
                  value={manualScheduledAt}
                  onChange={(event) => onManualScheduledAtChange(event.target.value)}
                  className="h-10 rounded-[8px] border border-[var(--outline-variant)] bg-white px-3 text-[13px] font-semibold text-[#172033] outline-none focus:border-[#6d5dfc] focus:ring-2 focus:ring-[#6d5dfc]/15"
                />
              ) : (
                <div className="flex min-h-10 items-center rounded-[8px] border border-[#edf1f7] bg-white px-3 text-[12px] font-semibold leading-5 text-[#526179]">
                  AI chọn slot tiếp theo dựa trên ngày đăng, giờ đăng và timezone trong cấu hình profile.
                </div>
              )}
            </div>
          </section>

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
            status: statusLabel(item.status),
            duration: formatDuration(item.duration_seconds),
          }}
        />
      </div>

      <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--outline-variant)] bg-[#fbfcff] p-5">
        <AppButton variant="danger" icon={<X size={16} />} disabled={loading || detailLoading || terminal} onClick={onReject}>Từ chối</AppButton>
        <AppButton variant="secondary" icon={<Edit3 size={16} />} disabled={loading || detailLoading || terminal} onClick={onRequestChanges}>Yêu cầu chỉnh sửa</AppButton>
        <AppButton icon={<CheckCircle2 size={16} />} disabled={loading || detailLoading || terminal} onClick={onApproveSchedule}>Duyệt & lên lịch</AppButton>
        {(canDirect || canInbox) && !terminal && (
          <AppButton icon={<Send size={16} />} disabled={loading || detailLoading} onClick={() => onPublish(canDirect ? 'direct' : 'inbox')}>
            {canDirect ? 'Duyệt & đăng ngay' : 'Gửi inbox TikTok'}
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
