import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  CalendarDays,
  ChevronDown,
  Send,
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
  EmptyBlock,
  LoadingBlock,
  PageLayout,
  SearchField,
  SocialProfileAvatar,
  StatusPill,
  TabStrip,
  Thumbnail,
} from '@/commons/component/social-ui'
import { SocialProfileFilter } from '@/commons/component/SocialProfileFilter'
import { buildApprovalSchedulePayload, toDateTimeInputValue } from './approvalSchedule'
import { approvalBucket, approvalStatusLabel, approvalTabs, type ApprovalTab } from './approvalStatus'
import type { ApprovalQueueItem } from './approvalTypes'
import { ApprovalDetail } from './components/ApprovalDetail'

const formatDate = (value?: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const statusTone = (value?: string | null): 'green' | 'amber' | 'red' | 'gray' => {
  const status = String(value || '').toLowerCase()
  if (['approved', 'queued', 'published'].includes(status)) return 'green'
  if (['needs_approval', 'publishing'].includes(status)) return 'amber'
  if (['skipped', 'rejected', 'failed', 'changes_requested'].includes(status)) return 'red'
  return 'gray'
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

      <SocialProfileFilter profiles={profiles} value={profileFilter} onChange={setProfileFilter} allOption loading={loadingProfiles} disabled={loading} emptyLabel={profileError || 'Chưa có kênh TikTok để duyệt video.'} />
      <TabStrip
        value={activeTab}
        onChange={setActiveTab}
        tabs={approvalTabs.map((tab) => ({ ...tab, count: counts[tab.value] }))}
      />

      <div className="grid gap-4 xl:grid-cols-[500px_minmax(0,1fr)] 2xl:grid-cols-[520px_minmax(0,1fr)]">
          <section className="min-w-0">
            <SearchField value={search} onChange={setSearch} placeholder="Tìm video, kênh hoặc nội dung..." className="mb-3" />

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

            <div className="mt-5 flex items-center justify-between text-sm font-medium text-[#526179]">
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
            <h3 className="line-clamp-1 text-sm font-extrabold text-[#111827]">{item.article_title}</h3>
            <p className="mt-1 line-clamp-1 text-sm font-medium text-[#64748b]">{item.caption || item.generated_content || item.ai_reason || item.article_title}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-semibold text-[#64748b]">
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
