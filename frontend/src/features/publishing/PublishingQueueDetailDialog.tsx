import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  Rocket,
  Send,
  SkipForward,
  UserRound,
  Video,
  X,
} from 'lucide-react'
import { fetchContentDetailApi, type ContentDetail } from '@/commons/apis/module1'
import { generateVideoOutputUrl } from '@/commons/apis/generateVideo'
import { MediaAssetPreview } from '@/commons/media'

export type PublishingQueueDetailItem = {
  id: string
  profile_id: string
  profile_name?: string | null
  profile_scopes?: string[]
  content_id?: string | null
  article_link?: string | null
  article_title: string
  platform: string
  generated_content?: string | null
  ai_reason?: string | null
  status: string
  scheduled_at?: string | null
  published_at?: string | null
  error?: string | null
  created_at?: string | null
  updated_at?: string | null
}

type PublishingQueueDetailDialogProps = {
  item: PublishingQueueDetailItem | null
  loading?: boolean
  onClose: () => void
  onApprove?: (queueItemId: string) => void
  onSkip?: (queueItemId: string) => void
  onPublish?: (item: PublishingQueueDetailItem, mode: 'inbox' | 'direct') => void
}

const formatDateTime = (value?: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN')
}

const hasTikTokScope = (item: PublishingQueueDetailItem, scope: string) => {
  return (item.profile_scopes || []).includes(scope)
}

const canPublish = (item: PublishingQueueDetailItem) => {
  return ['queued', 'needs_approval', 'approved', 'failed'].includes(item.status) && item.platform === 'tiktok'
}

export function PublishingQueueDetailDialog({
  item,
  loading = false,
  onClose,
  onApprove,
  onSkip,
  onPublish,
}: PublishingQueueDetailDialogProps) {
  const [contentDetail, setContentDetail] = useState<ContentDetail | null>(null)
  const [sourceLoading, setSourceLoading] = useState(false)
  const [sourceError, setSourceError] = useState('')

  useEffect(() => {
    setContentDetail(null)
    setSourceError('')
    if (!item?.content_id) return

    setSourceLoading(true)
    fetchContentDetailApi(item.content_id)
      .then(setContentDetail)
      .catch((error: any) => {
        setSourceError(error?.response?.data?.detail || 'Không tải được bài nguồn cũ')
      })
      .finally(() => setSourceLoading(false))
  }, [item?.content_id])

  const renderedVideoUrl = useMemo(() => {
    if (!item?.article_link) return ''
    return generateVideoOutputUrl(item.article_link)
  }, [item?.article_link])

  const article = useMemo(() => {
    const normalized = contentDetail?.normalized
    return {
      title: normalized?.title || contentDetail?.canonical_title || item?.article_title || '',
      lead: normalized?.lead || contentDetail?.summary || '',
      content: normalized?.content || contentDetail?.full_text || contentDetail?.content || '',
      url: normalized?.url || contentDetail?.source_url || contentDetail?.canonical_url || '',
      sourceType: contentDetail?.source_type || '',
      publishedAt: normalized?.publishedAt || contentDetail?.source_published_at || contentDetail?.published_at || '',
    }
  }, [contentDetail, item?.article_title])

  const paragraphs = useMemo(() => {
    const raw = String(article.content || '').trim()
    if (!raw) return []
    const list = raw.includes('\n')
      ? raw.split(/\n+/).map((line) => line.trim()).filter(Boolean)
      : raw.replace(/(\.|"|\”)\s+([A-Z\u00C0-\u024F])/g, '$1\n\n$2').split(/\n+/).map((line) => line.trim()).filter(Boolean)
    const lead = String(article.lead || '').trim()
    if (lead && list[0]?.startsWith(lead)) return list.slice(1)
    return list
  }, [article.content, article.lead])

  if (!item) return null

  const dialogContent = (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-xs sm:p-6">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border bg-white shadow-2xl" style={{ borderColor: 'var(--outline-variant)' }}>
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4" style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-low)' }}>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase" style={{ color: 'var(--on-surface-variant)' }}>
              <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5">
                <UserRound size={11} />
                {item.profile_name || `Profile #${item.profile_id}`}
              </span>
              <span className="rounded-md bg-white px-2 py-0.5">{item.platform}</span>
              <span className="rounded-md bg-white px-2 py-0.5">{item.status}</span>
            </div>
            <h2 className="line-clamp-2 text-lg font-bold" style={{ color: 'var(--on-surface)' }}>
              {item.article_title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-white"
            style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface)' }}
          >
            <X size={17} />
          </button>
        </div>

        <div className="grid flex-1 min-h-0 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
          <section className="space-y-4 border-b p-5 lg:border-b-0 lg:border-r" style={{ borderColor: 'var(--outline-variant)' }}>
            <div className="flex items-center gap-2 text-xs font-bold uppercase" style={{ color: 'var(--on-surface-variant)' }}>
              <Video size={15} />
              Video đã render
            </div>
            {renderedVideoUrl ? (
              <div className="overflow-hidden rounded-lg border bg-black" style={{ borderColor: 'var(--outline-variant)' }}>
                <MediaAssetPreview
                  item={{
                    media_type: 'VIDEO',
                    source_url: renderedVideoUrl,
                    storage_url: renderedVideoUrl,
                    title: item.article_title,
                  }}
                  controls
                  className="aspect-[9/16] max-h-[66vh] w-full bg-black"
                />
              </div>
            ) : (
              <div className="empty-state">Queue item này chưa có video render.</div>
            )}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <InfoTile icon={<CalendarClock size={13} />} label="Lịch xuất bản" value={formatDateTime(item.scheduled_at)} />
              <InfoTile icon={<CheckCircle2 size={13} />} label="Đã đăng" value={formatDateTime(item.published_at)} />
            </div>

            {item.generated_content && (
              <div className="rounded-lg border p-3" style={{ borderColor: 'var(--outline-variant)' }}>
                <div className="mb-2 text-xs font-bold uppercase" style={{ color: 'var(--on-surface-variant)' }}>Caption sẽ đăng</div>
                <p className="whitespace-pre-line text-sm leading-relaxed" style={{ color: 'var(--on-surface)' }}>
                  {item.generated_content}
                </p>
              </div>
            )}

            {item.ai_reason && (
              <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface-variant)' }}>
                {item.ai_reason}
              </div>
            )}

            {item.error && (
              <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                {item.error}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {item.status === 'needs_approval' && onApprove && (
                <button
                  onClick={() => onApprove(item.id)}
                  disabled={loading}
                  className="inline-flex h-8 items-center gap-1 rounded-md px-3 text-xs font-semibold disabled:opacity-50"
                  style={{ backgroundColor: 'var(--secondary)', color: 'var(--on-secondary)' }}
                >
                  <CheckCircle2 size={14} />
                  Duyệt
                </button>
              )}
              {canPublish(item) && onPublish && hasTikTokScope(item, 'video.publish') && (
                <button
                  onClick={() => onPublish(item, 'direct')}
                  disabled={loading}
                  className="inline-flex h-8 items-center gap-1 rounded-md px-3 text-xs font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: '#0f766e' }}
                >
                  <Rocket size={14} />
                  Đăng luôn TikTok
                </button>
              )}
              {canPublish(item) && onPublish && hasTikTokScope(item, 'video.upload') && (
                <button
                  onClick={() => onPublish(item, 'inbox')}
                  disabled={loading}
                  className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-semibold disabled:opacity-50"
                  style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface)' }}
                >
                  <Send size={14} />
                  Gửi inbox
                </button>
              )}
              {onSkip && !['published', 'skipped', 'publishing'].includes(item.status) && (
                <button
                  onClick={() => onSkip(item.id)}
                  disabled={loading}
                  className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-semibold disabled:opacity-50"
                  style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface)' }}
                >
                  <SkipForward size={14} />
                  Bỏ qua
                </button>
              )}
            </div>
          </section>

          <section className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase" style={{ color: 'var(--on-surface-variant)' }}>
                <FileText size={15} />
                Bài nguồn cũ
              </div>
              {article.url && (
                <a
                  href={article.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-semibold"
                  style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface)' }}
                >
                  <ExternalLink size={13} />
                  Mở nguồn
                </a>
              )}
            </div>

            {sourceLoading && (
              <div className="loading-state">
                <Loader2 size={16} className="animate-spin" />
                Đang tải bài nguồn...
              </div>
            )}

            {!sourceLoading && sourceError && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {sourceError}
              </div>
            )}

            {!sourceLoading && !item.content_id && (
              <div className="empty-state">
                Queue item này chưa gắn bài nguồn cũ.
              </div>
            )}

            {!sourceLoading && contentDetail && (
              <>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase" style={{ color: 'var(--on-surface-variant)' }}>
                    {article.sourceType && <span className="rounded-md bg-slate-100 px-2 py-0.5">{article.sourceType}</span>}
                    <span className="rounded-md bg-slate-100 px-2 py-0.5">{formatDateTime(article.publishedAt)}</span>
                    <span className="rounded-md bg-slate-100 px-2 py-0.5">Quality {Number(contentDetail.quality_score || 0).toFixed(1)}</span>
                  </div>
                  <h3 className="text-base font-bold leading-snug" style={{ color: 'var(--on-surface)' }}>
                    {article.title}
                  </h3>
                  {article.lead && (
                    <p className="rounded-lg border bg-slate-50 p-3 text-sm leading-relaxed" style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface-variant)' }}>
                      {article.lead}
                    </p>
                  )}
                </div>

                <div className="max-h-[46vh] overflow-y-auto rounded-lg border bg-slate-50 p-4" style={{ borderColor: 'var(--outline-variant)' }}>
                  {paragraphs.length > 0 ? (
                    <div className="space-y-3 text-sm leading-relaxed" style={{ color: 'var(--on-surface)' }}>
                      {paragraphs.map((paragraph, index) => (
                        <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">Không có nội dung văn bản để hiển thị.</div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )

  return createPortal(dialogContent, document.body)
}

function InfoTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--outline-variant)' }}>
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase" style={{ color: 'var(--on-surface-variant)' }}>
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold" style={{ color: 'var(--on-surface)' }}>
        {value}
      </div>
    </div>
  )
}
