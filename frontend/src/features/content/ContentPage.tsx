import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  Eye,
  ExternalLink,
  FileText,
  Grid2X2,
  MoreVertical,
  Plus,
  Wand2,
  X,
} from 'lucide-react'
import {
  fetchContentDetailApi,
  fetchFinalContentViewApi,
  type ContentDetail,
  type FinalContentItem,
  type FinalContentView,
  type ProfileContentMatch,
} from '@/commons/apis/module1'
import {
  AppButton,
  AppCard,
  EmptyBlock,
  PageHeader,
  PlatformIcon,
  SearchField,
  SelectControl,
  SocialProfileAvatar,
  StatusPill,
  TabStrip,
  Thumbnail,
} from '@/commons/component/social-ui'
import { SocialPostPreview } from '@/commons/component/social-previews'

type ContentTab = 'all' | 'fit' | 'used' | 'discarded'

const formatDate = (value?: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const formatScore = (value?: number | null) => {
  const score = Number(value)
  return Number.isFinite(score) ? score.toFixed(1) : '-'
}

const formatSimilarity = (value?: number | null) => {
  const score = Number(value)
  return Number.isFinite(score) ? `${(score * 100).toFixed(1)}%` : '-'
}

const isUsedStatus = (status?: string | null) => /used|approved|completed|published/i.test(String(status || ''))
const isDiscardedStatus = (status?: string | null) => /reject|discard|failed/i.test(String(status || ''))
type ContentViewItem = FinalContentItem & Partial<ContentDetail>

const getContentMedia = (item: ContentViewItem) => item.media_jsonb || item.media || []
const countByMediaType = (item: ContentViewItem, pattern: RegExp) => {
  const counts = item.media_counts
  if (pattern.test('IMAGE') && typeof counts?.images === 'number') return counts.images
  if (pattern.test('VIDEO') && typeof counts?.videos === 'number') return counts.videos
  return getContentMedia(item).filter((media) => pattern.test(String(media.media_type || media.mime_type || ''))).length
}
const getSourceUrl = (item: ContentViewItem) => item.source_url || item.canonical_url || item.url || item.normalized?.url || ''
const getContentText = (item: ContentViewItem) => item.content || item.full_text || item.normalized?.content || item.summary || ''
const wordCount = (value?: string | null) => String(value || '').trim().split(/\s+/).filter(Boolean).length
const formatMediaCounts = (item: ContentViewItem) => {
  const images = countByMediaType(item, /image/i)
  const videos = countByMediaType(item, /video/i)
  const parts = [
    images ? `${images} ảnh` : '',
    videos ? `${videos} video` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : '-'
}
const getContentTags = (item: ContentViewItem) => {
  return [...(item.tags || []), item.category, item.language].filter((value): value is string => Boolean(value))
}

export default function ContentPage({ isSystemUser = false, onOpenModule2 }: { isSystemUser?: boolean; onOpenModule2?: (jobId?: string) => void }) {
  const [view, setView] = useState<FinalContentView>({ normal_items: [], series_items: [] })
  const [activeTab, setActiveTab] = useState<ContentTab>('all')
  const [selectedContent, setSelectedContent] = useState<FinalContentItem | null>(null)
  const [contentDetail, setContentDetail] = useState<ContentDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    setLoading(true)
    try {
      const data = await fetchFinalContentViewApi({ content_scope: isSystemUser ? 'GLOBAL' : 'PRIVATE', view: 'list' })
      setView(data)
      setSelectedContent((current) => {
        if (!current) return null
        const next = data.normal_items.find((item) => item.id === current.id) || null
        if (!next) setContentDetail(null)
        return next
      })
    } catch (error) {
      console.error(error)
      setView({ normal_items: [], series_items: [] })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [isSystemUser])

  const openDetail = async (item: FinalContentItem) => {
    setSelectedContent(item)
    setContentDetail(null)
    setDetailLoading(true)
    try {
      const detail = await fetchContentDetailApi(item.id)
      setContentDetail(detail)
    } catch (error) {
      console.error(error)
    } finally {
      setDetailLoading(false)
    }
  }

  const baseItems = view.normal_items
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    return baseItems.filter((item) => {
      const score = Number(item.quality_score || 0)
      if (activeTab === 'fit' && score < 80) return false
      if (activeTab === 'used' && !isUsedStatus(item.status)) return false
      if (activeTab === 'discarded' && !isDiscardedStatus(item.status)) return false
      if (!query) return true
      return [
        item.canonical_title,
        item.summary,
        item.category,
        item.source_type,
        item.status,
      ].some((value) => String(value || '').toLowerCase().includes(query))
    })
  }, [activeTab, baseItems, search])

  const tabs = [
    { value: 'all' as const, label: 'Tất cả', count: baseItems.length },
    { value: 'fit' as const, label: 'Phù hợp', count: baseItems.filter((item) => Number(item.quality_score || 0) >= 80).length },
    { value: 'used' as const, label: 'Đã dùng', count: baseItems.filter((item) => isUsedStatus(item.status)).length },
    { value: 'discarded' as const, label: 'Đổi loại', count: baseItems.filter((item) => isDiscardedStatus(item.status)).length },
  ]

  return (
    <div className="app-page">
      <PageHeader
        title="Bài viết"
        description="Danh sách các bài viết đã được thu thập từ nhiều nguồn"
        actions={<AppButton icon={<Plus size={16} />}>Tạo job crawl</AppButton>}
      />

      <div className="min-h-[calc(100vh-150px)]">
        <AppCard className="min-w-0 overflow-hidden">
          <div className="px-5">
            <TabStrip value={activeTab} onChange={setActiveTab} tabs={tabs} />
          </div>

          <div className="grid gap-3 border-b border-[var(--outline-variant)] p-5 md:grid-cols-[minmax(220px,1fr)_150px_170px_130px_190px_110px_42px]">
            <SearchField value={search} onChange={setSearch} placeholder="Tìm kiếm bài viết..." />
            <SelectControl><option>Tất cả nguồn</option></SelectControl>
            <SelectControl><option>Tất cả chuyên mục</option></SelectControl>
            <SelectControl><option>Trạng thái</option></SelectControl>
            <SelectControl icon={<CalendarDays size={15} />}><option>Tất cả thời gian</option></SelectControl>
            <SelectControl><option>Mới nhất</option></SelectControl>
            <button className="grid h-10 w-10 place-items-center rounded-[8px] border border-[var(--outline-variant)] bg-white text-[#526179]"><Grid2X2 size={16} /></button>
          </div>

          {loading ? (
            <ContentTableSkeleton />
          ) : filteredItems.length === 0 ? (
            <div className="p-5"><EmptyBlock label="Chưa có dữ liệu bài viết." /></div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[920px]">
                <div className="app-table-header grid grid-cols-[34px_minmax(300px,1.8fr)_120px_130px_130px_120px_90px] items-center gap-3 px-5 py-3">
                  <input type="checkbox" className="h-4 w-4 rounded border-[#cbd5e1]" />
                  <span>Bài viết</span>
                  <span>Nguồn</span>
                  <span>Ngày đăng</span>
                  <span>Điểm phù hợp</span>
                  <span>Trạng thái</span>
                  <span>Thao tác</span>
                </div>
                {filteredItems.map((item, index) => (
                  <ContentRow
                    key={item.id}
                    item={item}
                    index={index}
                    active={selectedContent?.id === item.id}
                    onClick={() => void openDetail(item)}
                  />
                ))}
              </div>
            </div>
          )}
        </AppCard>
      </div>

      <ContentDetailSheet
        item={contentDetail}
        loading={detailLoading}
        fallbackTitle={selectedContent?.canonical_title}
        onClose={() => {
          setSelectedContent(null)
          setContentDetail(null)
        }}
        onOpenModule2={onOpenModule2}
      />
    </div>
  )
}

function ContentTableSkeleton() {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[920px]">
        <div className="app-table-header grid grid-cols-[34px_minmax(300px,1.8fr)_120px_130px_130px_120px_90px] items-center gap-3 px-5 py-3">
          <SkeletonLine className="h-4 w-4 rounded" />
          <span>Bài viết</span>
          <span>Nguồn</span>
          <span>Ngày đăng</span>
          <span>Điểm phù hợp</span>
          <span>Trạng thái</span>
          <span>Thao tác</span>
        </div>
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="app-row grid w-full grid-cols-[34px_minmax(300px,1.8fr)_120px_130px_130px_120px_90px] items-center gap-3 px-5 py-3">
            <SkeletonLine className="h-4 w-4 rounded" />
            <div className="flex min-w-0 items-center gap-3">
              <SkeletonLine className="h-[72px] w-[88px] shrink-0 rounded-[8px]" />
              <div className="min-w-0 flex-1 space-y-2">
                <SkeletonLine className="h-4 w-4/5" />
                <SkeletonLine className="h-3 w-2/3" />
                <SkeletonLine className="h-5 w-20 rounded-[5px]" />
              </div>
            </div>
            <SkeletonLine className="h-4 w-20" />
            <SkeletonLine className="h-4 w-24" />
            <SkeletonLine className="h-4 w-16" />
            <SkeletonLine className="h-6 w-16 rounded-[6px]" />
            <SkeletonLine className="h-4 w-12" />
          </div>
        ))}
      </div>
    </div>
  )
}

function SkeletonLine({ className }: { className: string }) {
  return <div className={`animate-pulse bg-[#eef1f7] ${className}`} />
}

function ContentDetailSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-5 grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
        <SkeletonLine className="h-[110px] rounded-[8px]" />
        <div className="space-y-3">
          <SkeletonLine className="h-5 w-4/5" />
          <SkeletonLine className="h-4 w-full" />
          <SkeletonLine className="h-4 w-2/3" />
          <SkeletonLine className="h-6 w-24 rounded-[6px]" />
        </div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <SkeletonLine key={index} className="h-[58px] rounded-[8px]" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonLine className="h-[220px] rounded-[8px]" />
        <SkeletonLine className="h-[220px] rounded-[8px]" />
      </div>
      <SkeletonLine className="mt-4 h-[180px] rounded-[8px]" />
    </div>
  )
}

function ContentRow({
  item,
  index,
  active,
  onClick,
}: {
  item: FinalContentItem
  index: number
  active: boolean
  onClick: () => void
}) {
  const score = Number(item.quality_score || 0)
  return (
    <button
      onClick={onClick}
      className={`app-row grid w-full grid-cols-[34px_minmax(300px,1.8fr)_120px_130px_130px_120px_90px] items-center gap-3 px-5 py-3 text-left ${active ? 'app-row-selected' : ''}`}
    >
      <input type="checkbox" checked={active} readOnly className="h-4 w-4 rounded border-[#cbd5e1] accent-[#6d5dfc]" />
      <div className="flex min-w-0 items-center gap-3">
        <Thumbnail src={getMediaSrc(item)} index={index} title={item.canonical_title} className="h-[72px] w-[88px] shrink-0" fallback={false} />
        <div className="min-w-0">
          <div className="line-clamp-2 text-[13px] font-extrabold leading-5 text-[#111827]">{item.canonical_title}</div>
          <div className="mt-1 line-clamp-1 text-[12px] font-medium text-[#526179]">{item.summary || item.canonical_url}</div>
          {item.category && <span className="mt-1 inline-flex rounded-[5px] bg-[#f2f0ff] px-2 py-0.5 text-[10px] font-bold text-[#6d5dfc]">{item.category}</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 text-[12px] font-semibold text-[#526179]">
        <PlatformIcon platform={item.source_type || 'source'} size="sm" />
        {item.source_type || '-'}
      </div>
      <span className="text-[12px] font-semibold text-[#34415a]">{formatDate(item.published_at || item.created_at)}</span>
      <span className={`text-[13px] font-extrabold ${score >= 80 ? 'text-[#16a34a]' : score >= 70 ? 'text-[#f59e0b]' : 'text-[#ef233c]'}`}>{formatScore(item.quality_score)}<span className="text-[#64748b]">/100</span></span>
      <StatusPill value={item.status || '-'} />
      <div className="flex items-center gap-1">
        <Eye size={16} className="text-[#526179]" />
        <MoreVertical size={16} className="text-[#526179]" />
      </div>
    </button>
  )
}

export function ContentDetailSheet({
  item,
  loading,
  fallbackTitle,
  onClose,
  onOpenModule2,
}: {
  item: ContentDetail | null
  loading: boolean
  fallbackTitle?: string
  onClose: () => void
  onOpenModule2?: (jobId?: string) => void
}) {
  if (!item && !loading) return null

  if (loading) {
    return (
      <div className="fixed inset-0 z-[80]">
        <button
          type="button"
          aria-label="Đóng chi tiết bài viết"
          onClick={onClose}
          className="absolute inset-0 bg-[#0f172a]/10 backdrop-blur-[1px]"
        />
        <aside className="sheet-slide-in absolute bottom-0 right-0 top-0 flex w-full max-w-[720px] flex-col overflow-hidden border-l border-[var(--outline-variant)] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
          <div className="flex items-center justify-between border-b border-[var(--outline-variant)] p-5">
            <div className="min-w-0 flex-1">
              <h2 className="text-[20px] font-extrabold text-[#111827]">Chi tiết bài viết</h2>
              <p className="mt-1 truncate text-[13px] font-semibold text-[#526179]">{fallbackTitle || 'Đang tải dữ liệu...'}</p>
            </div>
            <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-[8px] text-[#526179] hover:bg-[#f4f6ff]"><X size={18} /></button>
          </div>
          <ContentDetailSkeleton />
        </aside>
      </div>
    )
  }

  if (!item) return null

  const score = Number(item.quality_score)
  const tags = getContentTags(item)
  const contentText = getContentText(item)
  const contentLines = contentText.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 8)
  const mediaItems = getContentMedia(item)
  const imageItems = mediaItems.filter((media) => /image/i.test(String(media.media_type || media.mime_type || '')))
  const sourceUrl = getSourceUrl(item)
  const profileMatches = item.profile_matches || []
  const tiktokMatch = profileMatches.find((match) => String(match.platform || '').toLowerCase() === 'tiktok')

  return (
    <div className="fixed inset-0 z-[80]">
      <button
        type="button"
        aria-label="Đóng chi tiết bài viết"
        onClick={onClose}
        className="absolute inset-0 bg-[#0f172a]/10 backdrop-blur-[1px]"
      />
      <aside className="sheet-slide-in absolute bottom-0 right-0 top-0 flex w-full max-w-[720px] flex-col overflow-hidden border-l border-[var(--outline-variant)] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
      <div className="flex items-center justify-between border-b border-[var(--outline-variant)] p-5">
        <div>
          <h2 className="text-[20px] font-extrabold text-[#111827]">Chi tiết bài viết</h2>
          <div className="mt-2 flex items-center gap-2 text-[13px] font-bold text-[#526179]">
            <PlatformIcon platform={item.source_type || 'source'} size="sm" />
            {item.source_type || '-'}
            {Number.isFinite(score) && <span className="text-[#16a34a]">• {score.toFixed(1)}/100</span>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusPill value={item.status || '-'} />
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-[8px] text-[#526179] hover:bg-[#f4f6ff]"><X size={18} /></button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mb-5 grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
          <Thumbnail src={getMediaSrc(item)} title={item.canonical_title} className="h-[110px]" fallback={false} />
          <div>
            <h3 className="line-clamp-2 text-[17px] font-extrabold leading-6 text-[#111827]">{item.canonical_title}</h3>
            {item.summary && <p className="mt-2 line-clamp-2 text-[13px] font-medium leading-5 text-[#526179]">{item.summary}</p>}
            {item.category && <span className="mt-3 inline-flex rounded-[6px] bg-[#f2f0ff] px-2.5 py-1 text-[12px] font-bold text-[#6d5dfc]">{item.category}</span>}
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 text-[12px] lg:grid-cols-3">
          <MetaCard label="Ngày đăng" value={formatDate(item.published_at || item.created_at)} />
          <MetaCard label="Độ dài" value={contentText ? `${wordCount(contentText).toLocaleString('vi-VN')} từ` : '-'} />
          <MetaCard label="Ngày thu thập" value={formatDate(item.created_at)} />
          <MetaCard label="Nguồn" value={item.source_type || '-'} />
          <MetaCard label="ID" value={item.article_id || item.id.slice(0, 10)} />
          <MetaCard label="Định dạng" value={formatMediaCounts(item)} />
        </div>

        {tags.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 border-y border-[var(--outline-variant)] py-3">
            <span className="text-[13px] font-bold text-[#526179]">Tags:</span>
            {tags.map((tag) => <span key={tag} className="rounded-[6px] bg-[#f2f0ff] px-2 py-0.5 text-[12px] font-bold text-[#6d5dfc]">{tag}</span>)}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-[8px] border border-[var(--outline-variant)] p-4">
            <div className="mb-3 flex items-center gap-2 text-[14px] font-extrabold text-[#111827]">
              <FileText size={16} /> Nội dung bài viết
            </div>
            {contentLines.length > 0 ? (
              <ol className="list-decimal space-y-2 pl-4 text-[13px] leading-6 text-[#34415a]">
                {contentLines.map((line, index) => <li key={`${index}-${line.slice(0, 12)}`}>{line}</li>)}
              </ol>
            ) : (
              <EmptyBlock label="Chưa có nội dung bài viết." />
            )}
          </section>

          <section className="rounded-[8px] border border-[var(--outline-variant)] p-4">
            <div className="mb-3 text-[14px] font-extrabold text-[#111827]">Hình ảnh đính kèm ({imageItems.length})</div>
            {imageItems.length > 0 ? (
              <div className="grid grid-cols-2 gap-3">
                {imageItems.slice(0, 4).map((media, index) => (
                  <Thumbnail
                    key={`${media.source_url || media.storage_url || index}`}
                    src={media.thumbnail_url || media.source_url || media.storage_url}
                    title={media.title || item.canonical_title}
                    className="h-[110px]"
                    fallback={false}
                  />
                ))}
              </div>
            ) : (
              <EmptyBlock label="Chưa có hình ảnh đính kèm." />
            )}
          </section>
        </div>

        <section className="mt-4 rounded-[8px] border border-[var(--outline-variant)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-[15px] font-extrabold text-[#111827]">Phân tích phù hợp theo kênh social</div>
              {item.ai_selection_summary && <p className="mt-1 text-[12px] font-semibold leading-5 text-[#526179]">{item.ai_selection_summary}</p>}
            </div>
          </div>
          {profileMatches.length > 0 ? (
            <div className="divide-y divide-[#edf1f7]">
              {profileMatches.map((match) => (
                <ProfileMatchRow key={match.profile_id} match={match} onOpenModule2={onOpenModule2} />
              ))}
            </div>
          ) : (
            <EmptyBlock label="Chưa có dữ liệu phân tích theo kênh social." />
          )}
        </section>

        <section className="mt-4 rounded-[8px] border border-[var(--outline-variant)] p-4">
          <div className="mb-3 text-[15px] font-extrabold text-[#111827]">TikTok preview</div>
          {tiktokMatch ? (
            <SocialPostPreview
              post={{
                platform: 'tiktok',
                profileName: tiktokMatch.profile_name,
                username: tiktokMatch.username || tiktokMatch.profile_name,
                title: item.canonical_title,
                caption: item.summary || item.canonical_title,
                mediaUrl: getMediaSrc(item),
                status: item.status || '-',
              }}
            />
          ) : (
            <EmptyBlock label="Chưa có kênh social TikTok phù hợp để dựng preview." />
          )}
        </section>
      </div>

      <div className="flex justify-end gap-3 border-t border-[var(--outline-variant)] bg-[#fbfcff] p-5">
        <AppButton variant="secondary" icon={<ExternalLink size={15} />} disabled={!sourceUrl} onClick={() => sourceUrl && window.open(sourceUrl, '_blank', 'noopener,noreferrer')}>Mở bài gốc</AppButton>
        <AppButton icon={<Wand2 size={15} />} onClick={() => onOpenModule2?.()}>Tạo kịch bản</AppButton>
      </div>
      </aside>
    </div>
  )
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-[#edf1f7] bg-[#fbfcff] p-3">
      <div className="text-[11px] font-bold text-[#64748b]">{label}</div>
      <div className="mt-1 truncate text-[12px] font-extrabold text-[#34415a]">{value}</div>
    </div>
  )
}

function ProfileMatchRow({ match, onOpenModule2 }: { match: ProfileContentMatch; onOpenModule2?: (jobId?: string) => void }) {
  const score = Number(match.score || 0)
  const threshold = Number(match.threshold || 70)
  const passedSimilarityGate = typeof match.passed_similarity_gate === 'boolean' ? match.passed_similarity_gate : score >= threshold
  const tone = match.blocked_by_avoid_topics ? 'red' : passedSimilarityGate ? 'green' : 'amber'
  const topics = [...(match.matched_topics || []), match.tone].filter((value): value is string => Boolean(value)).slice(0, 4)
  const topicMatches = (match.topic_matches || []).slice(0, 4)
  const avoidTopicMatches = (match.avoid_topic_matches || []).slice(0, 4)
  const topTopicMatch = match.top_topic_match || topicMatches[0]
  const insights = match.fit_insights || []
  const reason = match.selection_reason || match.ai_decision_reason || match.relation_reason || 'Chưa có lý do lựa chọn từ API.'
  return (
    <div className="py-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_88px_minmax(150px,0.8fr)]">
        <div className="flex min-w-0 gap-3">
          <SocialProfileAvatar
            avatarUrl={match.avatar_url}
            name={match.profile_name}
            platform={match.platform}
            size="lg"
          />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-extrabold text-[#111827]">{match.profile_name} - {match.platform}</div>
            <div className="mt-0.5 truncate text-[11px] font-semibold text-[#64748b]">{match.username ? `@${match.username}` : match.recommendation_status}</div>
            {topics.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {topics.map((tag) => <span key={tag} className="rounded-[5px] bg-[#f2f0ff] px-2 py-0.5 text-[10px] font-bold text-[#6d5dfc]">{tag}</span>)}
              </div>
            )}
          </div>
        </div>
        <div className={match.blocked_by_avoid_topics ? 'text-right text-[18px] font-extrabold text-[#ef233c]' : passedSimilarityGate ? 'text-right text-[18px] font-extrabold text-[#16a34a]' : 'text-right text-[18px] font-extrabold text-[#f59e0b]'}>
          {score.toFixed(1)}<span className="text-[12px]">/100</span>
          {match.embedding_similarity !== undefined && match.embedding_similarity !== null && (
            <div className="mt-0.5 text-[10px] font-bold text-[#64748b]">top cos {formatSimilarity(match.embedding_similarity)}</div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2">
          <StatusPill value={match.recommendation_status} tone={tone} />
          <AppButton className="h-8 px-3" icon={<Wand2 size={14} />} disabled={!match.can_create_script} onClick={() => onOpenModule2?.()}>Tạo kịch bản</AppButton>
        </div>
      </div>
      <p className="mt-3 rounded-[8px] bg-[#fbfcff] px-3 py-2 text-[12px] font-semibold leading-5 text-[#526179]">
        <span className="font-extrabold text-[#111827]">Vì sao phù hợp: </span>{reason}
      </p>
      {(topicMatches.length > 0 || avoidTopicMatches.length > 0 || match.similarity_threshold !== undefined || match.avoid_similarity_threshold !== undefined) && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-[8px] border border-[#dbe7ff] bg-[#f6f9ff] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-extrabold text-[#2556ea]">Topic cosine gate</div>
              <span className={passedSimilarityGate ? 'rounded-[5px] bg-[#eaf8ef] px-2 py-0.5 text-[10px] font-extrabold text-[#16813b]' : 'rounded-[5px] bg-[#fff3d6] px-2 py-0.5 text-[10px] font-extrabold text-[#b76b00]'}>
                {passedSimilarityGate ? 'PASSED' : 'FAILED'}
              </span>
            </div>
            <div className="mt-1 text-[11px] font-semibold text-[#526179]">Cần ≥ {formatSimilarity(match.similarity_threshold)}</div>
            {topTopicMatch && (
              <div className="mt-1 text-[11px] font-semibold text-[#526179]">Cao nhất: {topTopicMatch.topic} {formatSimilarity(topTopicMatch.similarity)}</div>
            )}
            {topicMatches.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {topicMatches.map((item) => (
                  <span
                    key={`${match.profile_id}-topic-${item.topic}`}
                    title={item.description || item.topic_key || item.topic}
                    className={item.matched ? 'rounded-[5px] bg-white px-2 py-0.5 text-[10px] font-bold text-[#16813b]' : 'rounded-[5px] bg-white px-2 py-0.5 text-[10px] font-bold text-[#2556ea]'}
                  >
                    {item.topic} {formatSimilarity(item.similarity)}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className={match.blocked_by_avoid_topics ? 'rounded-[8px] border border-[#ffd5da] bg-[#fff7f8] p-3' : 'rounded-[8px] border border-[#edf1f7] bg-[#fbfcff] p-3'}>
            <div className={match.blocked_by_avoid_topics ? 'text-[11px] font-extrabold text-[#ef233c]' : 'text-[11px] font-extrabold text-[#64748b]'}>Avoid embedding</div>
            <div className="mt-1 text-[11px] font-semibold text-[#526179]">Giới hạn {formatSimilarity(match.avoid_similarity_threshold)}</div>
            {avoidTopicMatches.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {avoidTopicMatches.map((item) => (
                  <span
                    key={`${match.profile_id}-avoid-${item.topic}`}
                    title={item.description || item.topic_key || item.topic}
                    className="rounded-[5px] bg-white px-2 py-0.5 text-[10px] font-bold text-[#ef233c]"
                  >
                    {item.topic} {formatSimilarity(item.similarity)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {insights.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {insights.map((insight) => (
            <MatchInsightCard key={`${match.profile_id}-${insight.label}`} insight={insight} />
          ))}
        </div>
      )}
      {match.suggested_angle && (
        <div className="mt-3 rounded-[8px] border border-[#edf1f7] p-3">
          <div className="text-[11px] font-extrabold text-[#64748b]">Gợi ý góc triển khai</div>
          <div className="mt-1 text-[12px] font-semibold leading-5 text-[#34415a]">{match.suggested_angle}</div>
        </div>
      )}
      {match.risk_notes && match.risk_notes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {match.risk_notes.map((note) => (
            <span key={note} className="rounded-[5px] bg-[#fff3d6] px-2 py-0.5 text-[10px] font-bold text-[#b76b00]">{note}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function MatchInsightCard({ insight }: { insight: NonNullable<ProfileContentMatch['fit_insights']>[number] }) {
  const colors: Record<string, string> = {
    green: 'border-[#d7f2df] bg-[#f4fbf6] text-[#16813b]',
    blue: 'border-[#dbe7ff] bg-[#f6f9ff] text-[#2556ea]',
    amber: 'border-[#ffe4a8] bg-[#fff9ea] text-[#b76b00]',
    red: 'border-[#ffd5da] bg-[#fff7f8] text-[#ef233c]',
    purple: 'border-[#ded8ff] bg-[#f8f6ff] text-[#6d5dfc]',
    gray: 'border-[#edf1f7] bg-[#fbfcff] text-[#526179]',
  }
  const picked = colors[String(insight.tone || 'gray')] || colors.gray
  return (
    <div className={`min-w-0 rounded-[8px] border p-2.5 ${picked}`}>
      <div className="text-[10px] font-extrabold text-[#64748b]">{insight.label}</div>
      <div className="mt-1 line-clamp-2 text-[11px] font-bold leading-4">{insight.value || '-'}</div>
    </div>
  )
}

function getMediaSrc(item: ContentViewItem) {
  const media = (item.media_jsonb || item.media || [])[0]
  return item.thumbnail_url || media?.thumbnail_url || media?.source_url || media?.storage_url || null
}
