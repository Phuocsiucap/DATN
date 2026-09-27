import { PaginatedList } from '@/commons/component/ui/paginated-list'
import { Table, TableHeader as ShadcnTableHeader, TableBody, TableRow, TableHead, TableCell } from '@/commons/component/ui/table'
import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  Eye,
  Grid2X2,
  Loader2,
  Plus,
  Wand2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  fetchContentDetailApi,
  fetchFinalContentViewApi,
  fetchSourceTypesApi,
  queueBilibiliOcrApi,
  type ContentDetail,
  type FinalContentItem,
  type FinalContentView,
  type SourceType,
} from '@/commons/apis/module1'
import {
  AppButton,
  AppCard,
  EmptyBlock,
  PageLayout,
  PlatformIcon,
  SearchField,
  SelectControl,
  StatusPill,
  TableRowActions,
  Thumbnail,
} from '@/commons/component/social-ui'
import { ContentDetailSheet } from './components/ContentDetailSheet'
import { CreateWorkflowModal } from './components/CreateWorkflowModal'
import { ManualContentModal } from './components/ManualContentModal'

// ContentTab removed - always show all content

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

export default function ContentPage({ isSystemUser = false, onOpenModule2 }: { isSystemUser?: boolean; onOpenModule2?: (jobId?: string) => void }) {
  const [view, setView] = useState<FinalContentView>({ normal_items: [], series_items: [] })
  const [selectedContent, setSelectedContent] = useState<FinalContentItem | null>(null)
  const [contentDetail, setContentDetail] = useState<ContentDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [loading, setLoading] = useState(true)

  // Source types from API
  const [sourceTypes, setSourceTypes] = useState<SourceType[]>([])

  // Filter states
  const [search, setSearch] = useState('')
  const [sourceTypeFilter, setSourceTypeFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateRangeFilter, setDateRangeFilter] = useState('')
  const [sortBy, setSortBy] = useState('created_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [selectedContentIds, setSelectedContentIds] = useState<string[]>([])
  const [contentTab, setContentTab] = useState<'articles' | 'videos'>('articles')
  const [ocrQueueing, setOcrQueueing] = useState(false)

  // Creation modals
  const [showManualModal, setShowManualModal] = useState(false)
  const [showWorkflowModal, setShowWorkflowModal] = useState(false)

  // Load source types
  useEffect(() => {
    const loadSourceTypes = async () => {
      try {
        const types = await fetchSourceTypesApi()
        setSourceTypes(types)
      } catch (error) {
        console.error('Failed to load source types:', error)
      }
    }
    void loadSourceTypes()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      // Build filter params
      const params: Record<string, string> = {
        content_scope: isSystemUser ? 'GLOBAL' : 'INBOX',
        view: 'list',
        sort_by: sortBy,
        sort_order: sortOrder,
      }

      if (categoryFilter) params.category = categoryFilter
      if (statusFilter) params.status = statusFilter

      // Date range logic
      if (dateRangeFilter) {
        const now = new Date()
        if (dateRangeFilter === 'today') {
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
          params.created_after = today.toISOString()
        } else if (dateRangeFilter === 'week') {
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          params.created_after = weekAgo.toISOString()
        } else if (dateRangeFilter === 'month') {
          const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          params.created_after = monthAgo.toISOString()
        }
      }

      const data = await fetchFinalContentViewApi(params)
      setView(data)
      const allItems = [...data.normal_items, ...data.series_items]
      const availableIds = new Set(allItems.map((item) => item.id))
      setSelectedContentIds((current) => current.filter((id) => availableIds.has(id)))
      setSelectedContent((current) => {
        if (!current) return null
        const next = allItems.find((item) => item.id === current.id) || null
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
  }, [isSystemUser, statusFilter, dateRangeFilter, sortBy, sortOrder])

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

  const allContentItems = useMemo(() => [...view.normal_items, ...view.series_items], [view.normal_items, view.series_items])
  const articleItems = useMemo(() => allContentItems.filter((item) => !isVideoContent(item)), [allContentItems])
  const videoItems = useMemo(() => allContentItems.filter((item) => isVideoContent(item)), [allContentItems])
  const baseItems = contentTab === 'videos' ? videoItems : articleItems
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    return baseItems.filter((item) => {
      // Apply source type filter
      if (sourceTypeFilter && item.source_type !== sourceTypeFilter) return false

      if (!query) return true
      return [
        item.canonical_title,
        item.summary,
        item.category,
        item.source_type,
        item.status,
      ].some((value) => String(value || '').toLowerCase().includes(query))
    })
  }, [baseItems, search, sourceTypeFilter])

  const toggleVisibleSelection = (visibleItems: FinalContentItem[]) => {
    const visibleIds = visibleItems.map((item) => item.id)
    const allFilteredSelected = visibleItems.length > 0 && visibleItems.every((item) => selectedContentIds.includes(item.id))
    setSelectedContentIds((current) => allFilteredSelected
      ? current.filter((id) => !visibleIds.includes(id))
      : [...new Set([...current, ...visibleIds])].slice(0, 20))
  }

  const toggleContentSelection = (contentId: string) => {
    setSelectedContentIds((current) => current.includes(contentId)
      ? current.filter((id) => id !== contentId)
      : [...current, contentId].slice(0, 20))
  }

  const queueSelectedBilibiliOcr = async () => {
    const selected = filteredItems.filter((item) => selectedContentIds.includes(item.id))
    const bilibiliItems = selected.filter((item) => isBilibiliContent(item))
    if (bilibiliItems.length === 0) {
      toast.error('Hãy chọn ít nhất một video Bilibili để đưa vào hàng đợi OCR.')
      return
    }
    setOcrQueueing(true)
    try {
      let queued = 0
      let reused = 0
      for (const item of bilibiliItems) {
        const result = await queueBilibiliOcrApi(item.id)
        queued += result.queued
        reused += result.reused
      }
      toast.success(`Đã đưa ${queued} tập vào hàng đợi OCR${reused ? `, ${reused} tập đã có trong hàng đợi` : ''}.`)
      setSelectedContentIds((current) => current.filter((id) => !bilibiliItems.some((item) => item.id === id)))
      void loadData()
    } catch (error: unknown) {
      const candidate = error as { response?: { data?: { detail?: string } }; message?: string }
      toast.error(candidate.response?.data?.detail || candidate.message || 'Không thể đưa video vào hàng đợi OCR.')
    } finally {
      setOcrQueueing(false)
    }
  }

  return (
    <PageLayout
      title="Bài viết"
      description={isSystemUser
        ? 'Danh sách bài viết trong kho Global'
        : 'Bài riêng và bài Global được phân cho creator theo strategy của kênh'}
      actions={
        <>
          {!isSystemUser && contentTab === 'articles' && (
            <AppButton
              variant="secondary"
              icon={<Wand2 size={16} />}
              onClick={() => setShowWorkflowModal(true)}
            >
              Tạo workflow{selectedContentIds.length > 0 ? ` (${selectedContentIds.length})` : ''}
            </AppButton>
          )}
          {!isSystemUser && contentTab === 'videos' && (
            <>
              <AppButton
                variant="secondary"
                icon={ocrQueueing ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                disabled={ocrQueueing || selectedContentIds.length === 0}
                onClick={() => void queueSelectedBilibiliOcr()}
              >
                {ocrQueueing ? 'Đang đưa vào OCR...' : `Đưa vào hàng đợi OCR${selectedContentIds.length > 0 ? ` (${selectedContentIds.length})` : ''}`}
              </AppButton>
              <AppButton
                variant="secondary"
                icon={<Wand2 size={16} />}
                onClick={() => setShowWorkflowModal(true)}
              >
                Tạo workflow{selectedContentIds.length > 0 ? ` (${selectedContentIds.length})` : ''}
              </AppButton>
            </>
          )}
          <AppButton
            icon={<Plus size={16} />}
            onClick={() => setShowManualModal(true)}
          >
            Thêm nội dung
          </AppButton>
        </>
      }
    >
      <div className="flex min-h-0 flex-1">
        <AppCard className="app-table-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--outline-variant)] px-5 py-3">
            {[
              { key: 'articles' as const, label: 'Bài báo', count: articleItems.length },
              { key: 'videos' as const, label: 'Video', count: videoItems.length },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setContentTab(tab.key)
                  setSelectedContentIds([])
                  setSelectedContent(null)
                  setContentDetail(null)
                }}
                className={`h-9 rounded-md px-3 text-sm font-extrabold transition ${contentTab === tab.key ? 'bg-[var(--accent)] text-white shadow-sm' : 'bg-[var(--surface-container-low)] text-[var(--on-surface-variant)] hover:bg-[var(--surface-container)]'}`}
              >
                {tab.label}
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${contentTab === tab.key ? 'bg-white/20 text-white' : 'bg-white text-[var(--on-surface-variant)]'}`}>{tab.count}</span>
              </button>
            ))}
          </div>
          <div className="grid gap-3 border-b border-[var(--outline-variant)] p-5 md:grid-cols-[minmax(220px,1fr)_150px_170px_130px_190px_110px_42px]">
            <SearchField value={search} onChange={setSearch} placeholder={contentTab === 'videos' ? 'Tìm kiếm video...' : 'Tìm kiếm bài viết...'} />
            <SelectControl value={sourceTypeFilter} onChange={setSourceTypeFilter}>
              <option value="">Tất cả nguồn</option>
              {sourceTypes.map((type) => (
                <option key={type.type} value={type.type}>
                  {type.type}
                </option>
              ))}
            </SelectControl>
            <SelectControl value={categoryFilter} onChange={setCategoryFilter}>
              <option value="">Tất cả chuyên mục</option>
              <option value="Thời sự">Thời sự</option>
              <option value="Giải trí">Giải trí</option>
              <option value="Thể thao">Thể thao</option>
              <option value="Khoa học">Khoa học</option>
              <option value="Kinh doanh">Kinh doanh</option>
            </SelectControl>
            <SelectControl value={statusFilter} onChange={setStatusFilter}>
              <option value="">Tất cả trạng thái</option>
              <option value="AVAILABLE">Sẵn sàng</option>
              <option value="NEEDS_REVIEW">Cần duyệt</option>
              <option value="IN_USE">Đang dùng</option>
              <option value="REJECTED">Đã loại</option>
            </SelectControl>
            <SelectControl icon={<CalendarDays size={15} />} value={dateRangeFilter} onChange={setDateRangeFilter}>
              <option value="">Tất cả thời gian</option>
              <option value="today">Hôm nay</option>
              <option value="week">7 ngày qua</option>
              <option value="month">30 ngày qua</option>
            </SelectControl>
            <SelectControl value={`${sortBy}-${sortOrder}`} onChange={(value) => {
              const [newSortBy, newSortOrder] = value.split('-')
              setSortBy(newSortBy)
              setSortOrder(newSortOrder as 'asc' | 'desc')
            }}>
              <option value="created_at-desc">Mới nhất</option>
              <option value="created_at-asc">Cũ nhất</option>
              <option value="quality_score-desc">Điểm cao nhất</option>
              <option value="quality_score-asc">Điểm thấp nhất</option>
              <option value="published_at-desc">Xuất bản mới nhất</option>
            </SelectControl>
            <button className="grid h-10 w-10 place-items-center rounded-[8px] border border-[var(--outline-variant)] bg-white text-[#526179]"><Grid2X2 size={16} /></button>
          </div>

          <PaginatedList items={filteredItems} loading={loading} resetKey={JSON.stringify([contentTab, search, sourceTypeFilter, categoryFilter, statusFilter, dateRangeFilter, sortBy, sortOrder])}>{(visibleItems) => (
loading ? (
            <ContentTableSkeleton />
          ) : filteredItems.length === 0 ? (
            <div className="p-5"><EmptyBlock label={contentTab === 'videos' ? 'Chưa có dữ liệu video.' : 'Chưa có dữ liệu bài viết.'} /></div>
          ) : (
            <div className="min-h-0 flex-1">
                  <Table className="min-w-[960px] table-fixed">
                    <colgroup>
                      <col style={{ width: '48px' }} />
                      <col style={{ width: '34%' }} />
                      <col style={{ width: '110px' }} />
                      <col style={{ width: '130px' }} />
                      <col style={{ width: '110px' }} />
                      <col style={{ width: '110px' }} />
                      <col style={{ width: '90px' }} />
                    </colgroup>
                    <ShadcnTableHeader>
                      <TableRow className="bg-slate-50/80">
                        <TableHead className="px-4 py-3 w-12"><input
                          type="checkbox"
                          checked={visibleItems.length > 0 && visibleItems.every((item) => selectedContentIds.includes(item.id))}
                          onChange={() => toggleVisibleSelection(visibleItems)}
                          aria-label="Chọn tất cả nội dung đang hiển thị"
                          className="h-4 w-4 rounded border-[#cbd5e1] accent-[#6d5dfc]"
                        /></TableHead>
                        <TableHead className="px-4 py-3"><span>{contentTab === 'videos' ? 'Video' : 'Bài viết'}</span></TableHead>
                        <TableHead className="px-4 py-3"><span>Nguồn</span></TableHead>
                        <TableHead className="px-4 py-3"><span>Ngày đăng</span></TableHead>
                        <TableHead className="px-4 py-3"><span>Điểm phù hợp</span></TableHead>
                        <TableHead className="px-4 py-3"><span>Trạng thái</span></TableHead>
                        <TableHead className="px-4 py-3"><span>Thao tác</span></TableHead>
                      </TableRow>
                    </ShadcnTableHeader>
                    <TableBody>
                      {visibleItems.map((item, index) => (
                        <ContentRow
                          key={item.id}
                          item={item}
                          index={index}
                          active={selectedContent?.id === item.id}
                          selected={selectedContentIds.includes(item.id)}
                          onToggle={() => toggleContentSelection(item.id)}
                          onClick={() => void openDetail(item)}
                        />
                      ))}
                    </TableBody>
                  </Table>
            </div>
          )
)}</PaginatedList>
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

      <CreateWorkflowModal
        open={showWorkflowModal}
        contents={allContentItems}
        initialContentIds={selectedContentIds}
        onClose={() => setShowWorkflowModal(false)}
        onCreated={(workflowId) => {
          setSelectedContentIds([])
          onOpenModule2?.(workflowId)
        }}
      />

      <ManualContentModal
        open={showManualModal}
        onClose={() => setShowManualModal(false)}
        onSuccess={() => {
          void loadData() // Reload content list after successful creation
        }}
        isSystemUser={isSystemUser}
      />
    </PageLayout>
  )
}

function ContentTableSkeleton() {
  return (
    <div>
      <Table className="min-w-[960px] table-fixed">
        <colgroup>
          <col style={{ width: '48px' }} />
          <col style={{ width: '34%' }} />
          <col style={{ width: '110px' }} />
          <col style={{ width: '130px' }} />
          <col style={{ width: '110px' }} />
          <col style={{ width: '110px' }} />
          <col style={{ width: '90px' }} />
        </colgroup>
        <ShadcnTableHeader>
          <TableRow className="bg-slate-50/80">
            <TableHead className="px-4 py-3 w-12"><SkeletonLine className="h-4 w-4 rounded" /></TableHead>
            <TableHead className="px-4 py-3"><span>Bài viết</span></TableHead>
            <TableHead className="px-4 py-3"><span>Nguồn</span></TableHead>
            <TableHead className="px-4 py-3"><span>Ngày đăng</span></TableHead>
            <TableHead className="px-4 py-3"><span>Điểm phù hợp</span></TableHead>
            <TableHead className="px-4 py-3"><span>Trạng thái</span></TableHead>
            <TableHead className="px-4 py-3"><span>Thao tác</span></TableHead>
          </TableRow>
        </ShadcnTableHeader>
        <TableBody>
          {Array.from({ length: 8 }).map((_, index) => (
            <TableRow key={index} className=" w-full ">
              <TableCell className="px-4 py-3 w-12"><SkeletonLine className="h-4 w-4 rounded" /></TableCell>
              <TableCell className="px-4 py-3"><div className="flex min-w-0 items-center gap-3">
                <SkeletonLine className="h-[72px] w-[88px] shrink-0 rounded-[8px]" />
                <div className="min-w-0 flex-1 space-y-2">
                  <SkeletonLine className="h-4 w-4/5" />
                  <SkeletonLine className="h-3 w-2/3" />
                  <SkeletonLine className="h-5 w-20 rounded-[5px]" />
                </div>
              </div></TableCell>
              <TableCell className="px-4 py-3"><SkeletonLine className="h-4 w-20" /></TableCell>
              <TableCell className="px-4 py-3"><SkeletonLine className="h-4 w-24" /></TableCell>
              <TableCell className="px-4 py-3"><SkeletonLine className="h-4 w-16" /></TableCell>
              <TableCell className="px-4 py-3"><SkeletonLine className="h-6 w-16 rounded-[6px]" /></TableCell>
              <TableCell className="px-4 py-3"><SkeletonLine className="h-4 w-12" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
  selected,
  onToggle,
  onClick,
}: {
  item: FinalContentItem
  index: number
  active: boolean
  selected: boolean
  onToggle: () => void
  onClick: () => void
}) {
  const score = Number(item.quality_score || 0)
  return (
    <TableRow
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if(event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onClick()
        }
      }}
      className={` w-full text-left ${active ? 'app-row-selected' : ''}`}
    >
      <TableCell className="px-4 py-3 w-12"><input
        type="checkbox"
        checked={selected}
        onClick={(event) => event.stopPropagation()}
        onChange={onToggle}
        aria-label={`Chọn ${item.canonical_title} để tạo workflow`}
        className="h-4 w-4 rounded border-[#cbd5e1] accent-[#6d5dfc]"
      /></TableCell>
      <TableCell className="px-4 py-3"><div className="flex min-w-0 items-center gap-3">
        <Thumbnail src={getMediaSrc(item)} index={index} title={item.canonical_title} className="h-[72px] w-[88px] shrink-0" fallback={false} />
        <div className="min-w-0">
          <div className="line-clamp-2 text-sm font-extrabold leading-5 text-[#111827]">{item.canonical_title}</div>
          <div className="mt-1 line-clamp-1 text-xs font-medium text-[#526179]">{item.summary || item.canonical_url}</div>
          {item.category && <span className="mt-1 inline-flex rounded-[5px] bg-[#f2f0ff] px-2 py-0.5 text-xs font-bold text-[#6d5dfc]">{item.category}</span>}
        </div>
      </div></TableCell>
      <TableCell className="px-4 py-3"><div className="flex items-center gap-2 text-xs font-semibold text-[#526179]">
        <PlatformIcon platform={item.source_type || 'source'} size="sm" />
        {item.source_type || '-'}
      </div></TableCell>
      <TableCell className="px-4 py-3"><span className="text-xs font-semibold text-[#34415a]">{formatDate(item.published_at || item.created_at)}</span></TableCell>
      <TableCell className="px-4 py-3"><span className={`text-sm font-extrabold ${score >= 80 ? 'text-[#16a34a]' : score >= 70 ? 'text-[#f59e0b]' : 'text-[#ef233c]'}`}>{formatScore(item.quality_score)}<span className="text-[#64748b]">/100</span></span></TableCell>
      <TableCell className="px-4 py-3"><StatusPill value={item.status || '-'} /></TableCell>
      <TableCell className="px-4 py-3"><div onClick={(event) => event.stopPropagation()}>
        <TableRowActions
          actions={[
            { label: 'Xem chi tiết bài viết', icon: <Eye size={14} />, onClick },
          ]}
        />
      </div></TableCell>
    </TableRow>
  )
}

function getMediaSrc(item: FinalContentItem) {
  const media = (item.media_jsonb || item.media || [])[0]
  return item.thumbnail_url || media?.thumbnail_url || media?.source_url || media?.storage_url || null
}

function isVideoContent(item: FinalContentItem) {
  const type = (item.content_type || '').toUpperCase()
  if (['VIDEO', 'PLAYLIST'].includes(type)) return true
  const media = item.media_jsonb || item.media || []
  return media.some((entry) => (entry.media_type || '').toUpperCase().includes('VIDEO'))
}

function isBilibiliContent(item: FinalContentItem) {
  return String(item.source_type || '').toUpperCase() === 'BILIBILI'
}
