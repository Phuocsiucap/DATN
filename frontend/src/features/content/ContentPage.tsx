import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  Eye,
  Grid2X2,
  MoreVertical,
  Plus,
} from 'lucide-react'
import {
  fetchContentDetailApi,
  fetchFinalContentViewApi,
  type ContentDetail,
  type FinalContentItem,
  type FinalContentView,
} from '@/commons/apis/module1'
import {
  AppButton,
  AppCard,
  EmptyBlock,
  PageHeader,
  PlatformIcon,
  SearchField,
  SelectControl,
  StatusPill,
  TabStrip,
  Thumbnail,
} from '@/commons/component/social-ui'
import { ContentDetailSheet } from './components/ContentDetailSheet'

type ContentTab = 'all' | 'fit' | 'used' | 'discarded'

const formatDate = (value?: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const formatScore = (value?: number | null) => {
  if (value == null) return '-'
  const score = Number(value)
  return Number.isFinite(score) ? score.toFixed(1) : '-'
}

const isUsedStatus = (status?: string | null) => /used|approved|completed|published/i.test(String(status || ''))
const isDiscardedStatus = (status?: string | null) => /reject|discard|failed/i.test(String(status || ''))

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
      const data = await fetchFinalContentViewApi({ content_scope: isSystemUser ? 'GLOBAL' : 'INBOX', view: 'list' })
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
        description={isSystemUser
          ? 'Danh sách bài viết trong kho Global'
          : 'Bài riêng và bài Global được phân cho creator theo strategy của kênh'}
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
          <div className="line-clamp-2 text-sm font-extrabold leading-5 text-[#111827]">{item.canonical_title}</div>
          <div className="mt-1 line-clamp-1 text-xs font-medium text-[#526179]">{item.summary || item.canonical_url}</div>
          {item.category && <span className="mt-1 inline-flex rounded-[5px] bg-[#f2f0ff] px-2 py-0.5 text-xs font-bold text-[#6d5dfc]">{item.category}</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs font-semibold text-[#526179]">
        <PlatformIcon platform={item.source_type || 'source'} size="sm" />
        {item.source_type || '-'}
      </div>
      <span className="text-xs font-semibold text-[#34415a]">{formatDate(item.published_at || item.created_at)}</span>
      <span className={`text-sm font-extrabold ${score >= 80 ? 'text-[#16a34a]' : score >= 70 ? 'text-[#f59e0b]' : 'text-[#ef233c]'}`}>{formatScore(item.quality_score)}<span className="text-[#64748b]">/100</span></span>
      <StatusPill value={item.status || '-'} />
      <div className="flex items-center gap-1">
        <Eye size={16} className="text-[#526179]" />
        <MoreVertical size={16} className="text-[#526179]" />
      </div>
    </button>
  )
}

function getMediaSrc(item: FinalContentItem) {
  const media = (item.media_jsonb || item.media || [])[0]
  return item.thumbnail_url || media?.thumbnail_url || media?.source_url || media?.storage_url || null
}
