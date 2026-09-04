import { useState } from 'react'
import { CalendarDays, CheckCircle2, ChevronDown, Edit3, Send, X } from 'lucide-react'
import { AppButton, EmptyBlock, SocialProfileAvatar, StatusPill, Thumbnail, platformLabel } from '@/commons/component/social-ui'
import { SocialPostPreview } from '@/commons/component/social-previews'
import { toDateTimeInputValue } from '../approvalSchedule'
import { approvalBucket, approvalStatusLabel } from '../approvalStatus'
import type { ApprovalQueueItem } from '../approvalTypes'

const formatDate = (value?: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
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
  const [minimumScheduledAt] = useState(() => toDateTimeInputValue(new Date(Date.now() + 60000).toISOString()))
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
            <div className="flex items-center gap-2 text-sm font-extrabold text-[#111827]">
              {item.profile_name || 'TikTok profile'} ({platformLabel('tiktok')})
              <ChevronDown size={15} />
            </div>
            <div className="mt-0.5 text-xs font-medium text-[#64748b]">{item.profile_username ? `@${item.profile_username}` : formatDate(item.scheduled_at_local || item.scheduled_at)}</div>
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
            <div className="mb-2 text-sm font-bold text-[#526179]">Thời gian dự kiến đăng</div>
            <div className="flex items-center gap-3 text-sm font-semibold text-[#34415a]">
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
            <div className="mb-3 text-sm font-bold text-[#526179]">Chọn cách lên lịch</div>
            <div className="mb-3 flex flex-wrap gap-2">
              {(['manual', 'ai'] as const).map((mode) => (
                <button key={mode} type="button" disabled={actionDisabled} aria-pressed={scheduleMode === mode} onClick={() => onScheduleModeChange(mode)} className={`min-h-10 rounded-lg border px-3 text-xs font-bold disabled:opacity-50 ${scheduleMode === mode ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
                  {mode === 'manual' ? 'Chọn giờ thủ công' : 'Hệ thống chọn giờ'}
                </button>
              ))}
            </div>
            <div className="grid gap-3">
              {scheduleMode === 'manual' ? (
                <label className="grid gap-2 text-xs font-semibold text-slate-600">
                  Ngày và giờ đăng
                  <div className="relative flex h-10 items-center gap-2 rounded-[8px] border border-[var(--outline-variant)] bg-white px-3 transition focus-within:border-[#6d5dfc] focus-within:ring-2 focus-within:ring-[#6d5dfc]/15">
                    <CalendarDays size={15} className="pointer-events-none shrink-0 text-[#718096]" />
                    <input
                      type="datetime-local"
                      aria-label="Ngày và giờ đăng"
                      autoFocus
                      required
                      disabled={actionDisabled}
                      min={minimumScheduledAt}
                      value={manualScheduledAt}
                      onInput={(event) => onManualScheduledAtChange(event.currentTarget.value)}
                      onChange={(event) => onManualScheduledAtChange(event.target.value)}
                      className="h-full min-w-0 flex-1 cursor-pointer bg-transparent p-0 text-sm font-semibold text-[#172033] outline-none"
                    />
                  </div>
                  <span className="font-normal">Múi giờ trên thiết bị: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Hệ thống lưu đúng giờ bạn chọn.</span>
                </label>
              ) : (
                <div className="flex min-h-10 items-center rounded-[8px] border border-[#edf1f7] bg-white px-3 text-xs font-semibold leading-5 text-[#526179]">
                  Hệ thống chọn giờ dựa trên thời gian hiện tại, múi giờ tài khoản, các bài đã trong hàng đợi và giới hạn bài/ngày. Nếu dịch vụ tự động không khả dụng, hệ thống chọn giờ trống gần nhất theo quy tắc; các bài cách nhau ít nhất 30 phút.
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <AppButton variant="secondary" disabled={loading} onClick={onCloseSchedule}>Hủy chọn lịch</AppButton>
              <AppButton icon={<CalendarDays size={15} />} disabled={actionDisabled || (scheduleMode === 'manual' && !manualScheduledAt)} onClick={() => { void onApproveSchedule().then((saved) => { if (saved) onCloseSchedule() }) }}>
                {scheduleMode === 'manual' ? 'Xác nhận lịch đăng' : 'Xác nhận để hệ thống chọn lịch'}
              </AppButton>
            </div>
          </section>}

          <section>
            <div className="mb-2 text-sm font-bold text-[#526179]">Nội dung bài viết</div>
            <div className="rounded-[8px] border border-[var(--outline-variant)] bg-white p-4 text-sm leading-7 text-[#34415a]">
              <p className="font-bold text-[#111827]">{item.article_title}</p>
              <p className="mt-3">{item.caption || item.generated_content || item.article_title}</p>
              {tags.length > 0 && <p className="mt-3 font-semibold text-[#2556ea]">{tags.map((tag) => `#${tag.replace(/^#/, '')}`).join(' ')}</p>}
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <Thumbnail src={item.thumbnail_url} title={item.article_title} className="h-[150px]" fallback={false} />
            <div className="grid h-[150px] place-items-center rounded-[8px] border border-dashed border-[#cbd5e1] bg-[#fbfcff] text-center text-sm font-semibold text-[#64748b]">
              <span>{item.video_url ? 'Video TikTok đã render' : 'Chưa có video render'}</span>
            </div>
          </div>

          <section className="grid gap-3 text-sm text-[#526179] sm:grid-cols-2">
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
