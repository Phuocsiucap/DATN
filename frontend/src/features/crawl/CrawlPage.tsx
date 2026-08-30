import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CalendarDays, Download, Eye, Loader2, MoreHorizontal, Plus, RefreshCcw, RotateCcw, Square, X } from 'lucide-react'
import {
  cancelCrawlJobApi,
  createCrawlJobApi,
  fetchCrawlJobsApi,
  fetchContentDetailApi,
  fetchVnExpressRssFeedsApi,
  retryCrawlJobApi,
  fetchFinalContentViewApi,
  type ContentDetail,
  type CrawlJob,
  type FinalContentItem,
  type VnExpressRssFeed,
} from '@/commons/apis/module1'
import { ContentDetailSheet } from '@/features/content/ContentPage'
import {
  AppButton,
  AppCard,
  EmptyBlock,
  PageHeader,
  SearchField,
  SelectControl,
  StatusPill,
  Thumbnail,
} from '@/commons/component/social-ui'

const formatDate = (value?: string) => value ? new Date(value).toLocaleString('vi-VN') : '-'
const shortId = (value: string) => value.slice(0, 8)

export default function CrawlPage({ isSystemUser = false, onOpenModule2 }: { isSystemUser?: boolean; onOpenModule2?: (jobId?: string) => void }) {
  const [jobs, setJobs] = useState<CrawlJob[]>([])
  const [selectedJob, setSelectedJob] = useState<CrawlJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  
  // Create Form State
  const [sourceType, setSourceType] = useState<'BILIBILI' | 'VNEXPRESS'>('BILIBILI')
  const [jobName, setJobName] = useState(isSystemUser ? 'Global Bilibili Crawl' : 'Private Bilibili Crawl')
  const [sourceUrl, setSourceUrl] = useState('')
  const [keywords, setKeywords] = useState('truyen ma, short drama')
  const [maxItems, setMaxItems] = useState(20)
  const [vnexpressRssFeeds, setVnexpressRssFeeds] = useState<VnExpressRssFeed[]>([])
  const [selectedVnexpressRssKeys, setSelectedVnexpressRssKeys] = useState<string[]>(['tin-moi-nhat'])

  const updateSourceType = (nextSourceType: 'BILIBILI' | 'VNEXPRESS') => {
    setSourceType(nextSourceType)
    setJobName(isSystemUser
      ? `Global ${nextSourceType === 'VNEXPRESS' ? 'VNExpress' : 'Bilibili'} Crawl`
      : `Private ${nextSourceType === 'VNEXPRESS' ? 'VNExpress' : 'Bilibili'} Crawl`)
    setSourceUrl('')
    setKeywords(nextSourceType === 'VNEXPRESS' ? '' : 'truyen ma, short drama')
    if (nextSourceType === 'VNEXPRESS' && selectedVnexpressRssKeys.length === 0) {
      setSelectedVnexpressRssKeys(['tin-moi-nhat'])
    }
  }

  const loadCrawlData = async () => {
    setLoading(true)
    try {
      const nextJobs = await fetchCrawlJobsApi()
      setJobs(nextJobs)
      setSelectedJob((current) => current ? nextJobs.find((job) => job.id === current.id) ?? current : null)
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể tải dữ liệu Crawl Jobs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadCrawlData()
    fetchVnExpressRssFeedsApi()
      .then((data) => {
        const feeds = data.items || []
        setVnexpressRssFeeds(feeds)
        setSelectedVnexpressRssKeys((current) => {
          if (current.length) return current
          return feeds.some((feed) => feed.key === 'tin-moi-nhat') ? ['tin-moi-nhat'] : feeds.slice(0, 1).map((feed) => feed.key)
        })
      })
      .catch(() => {
        toast.error('Không tải được danh sách RSS VNExpress')
      })
  }, [])

  const metrics = useMemo(() => {
    const running = jobs.filter((job) => ['RUNNING', 'QUEUED', 'PENDING'].includes(job.status)).length
    const succeeded = jobs.filter((job) => job.status === 'SUCCEEDED').length
    const partial = jobs.filter((job) => job.status === 'PARTIAL_SUCCESS').length
    const failed = jobs.filter((job) => job.status === 'FAILED').length
    return { running, succeeded, partial, failed }
  }, [jobs])

  const createJob = async () => {
    setLoading(true)
    try {
      const selectedVnexpressFeeds = sourceType === 'VNEXPRESS'
        ? vnexpressRssFeeds.filter((feed) => selectedVnexpressRssKeys.includes(feed.key))
        : []
      const rssFeedUrls = selectedVnexpressFeeds.map((feed) => feed.url)
      const rssFeedKeys = selectedVnexpressFeeds.map((feed) => feed.key)
      const trimmedSourceUrl = sourceUrl.trim()
      await createCrawlJobApi({
        name: jobName,
        crawl_mode: 'ONE_TIME',
        content_scope: isSystemUser ? 'GLOBAL' : 'PRIVATE',
        created_by_type: isSystemUser ? 'SYSTEM' : 'USER',
        priority: 5,
        sources: [{
          source_type: sourceType,
          source_url: trimmedSourceUrl || null,
          keywords: keywords.split(',').map((item) => item.trim()).filter(Boolean),
          configuration: {
            max_items: maxItems,
            metadata_only: sourceType === 'BILIBILI',
            ...(sourceType === 'VNEXPRESS' ? {
              rss_feed_keys: rssFeedKeys,
              rss_feed_urls: rssFeedUrls,
              rss_feeds: selectedVnexpressFeeds,
            } : {}),
          },
        }],
      })
      toast.success('Đã tạo crawl job thành công!')
      setShowCreate(false)
      await loadCrawlData()
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể tạo crawl job')
    } finally {
      setLoading(false)
    }
  }

  const jobAction = async (action: 'cancel' | 'retry', job: CrawlJob) => {
    setLoading(true)
    try {
      await (action === 'cancel' ? cancelCrawlJobApi(job.id) : retryCrawlJobApi(job.id))
      toast.success(action === 'cancel' ? 'Đã hủy job.' : 'Đã gửi yêu cầu chạy lại job.')
      await loadCrawlData()
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Thao tác job thất bại')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app-page">
      <PageHeader
        title="Thu thập dữ liệu"
        description="Tạo và quản lý các job crawl dữ liệu từ nhiều nguồn khác nhau."
        actions={
          <>
            <AppButton variant="secondary" icon={<RefreshCcw size={15} />} disabled={loading} onClick={() => void loadCrawlData()}>Tải lại</AppButton>
            <AppButton icon={<Plus size={15} />} onClick={() => setShowCreate(true)}>Tạo job crawl</AppButton>
          </>
        }
      />

      <section className="min-w-0">
        {loading && (
          <div className="mb-4 flex items-center gap-2 text-sm text-[#64748b]">
            <Loader2 className="animate-spin" size={16} /> Đang xử lý...
          </div>
        )}

        <div className="space-y-4">
          <MetricGrid items={[
            ['Đang chạy', metrics.running, 'bg-blue-500'],
            ['Thành công', metrics.succeeded, 'bg-emerald-500'],
            ['Xong một phần', metrics.partial, 'bg-amber-500'],
            ['Lỗi', metrics.failed, 'bg-red-500'],
          ]} />

          <div className="min-w-0">
            <AppCard className="mb-4 grid gap-3 p-4 md:grid-cols-[minmax(240px,1fr)_150px_150px_150px_190px]">
              <SearchField placeholder="Tìm kiếm job..." />
              <SelectControl><option>Tất cả nguồn</option></SelectControl>
              <SelectControl><option>Tất cả trạng thái</option></SelectControl>
              <SelectControl><option>Người tạo</option></SelectControl>
              <SelectControl icon={<CalendarDays size={15} />}><option>Chọn khoảng thời gian</option></SelectControl>
            </AppCard>

            <JobsTable
              jobs={jobs}
              selectedJob={selectedJob}
              onOpenDetail={(job) => setSelectedJob(job)}
              onAction={jobAction}
            />
          </div>
        </div>
      </section>

      {showCreate && (
        <CreateDialog
          sourceType={sourceType}
          setSourceType={updateSourceType}
          jobName={jobName}
          setJobName={setJobName}
          sourceUrl={sourceUrl}
          setSourceUrl={setSourceUrl}
          keywords={keywords}
          setKeywords={setKeywords}
          maxItems={maxItems}
          setMaxItems={setMaxItems}
          vnexpressRssFeeds={vnexpressRssFeeds}
          selectedVnexpressRssKeys={selectedVnexpressRssKeys}
          setSelectedVnexpressRssKeys={setSelectedVnexpressRssKeys}
          onClose={() => setShowCreate(false)}
          onSubmit={() => void createJob()}
        />
      )}

      <CrawlJobDetailSheet
        job={selectedJob}
        onClose={() => setSelectedJob(null)}
        onOpenModule2={onOpenModule2}
      />
    </div>
  )
}

function MetricGrid({ items, loading }: { items: [string, number, string][]; loading?: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {loading ? (
        <>
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="bento-card h-[70px] p-3 flex flex-col justify-between">
              <div className="skeleton-loader h-3 w-20" />
              <div className="skeleton-loader h-6 w-12" />
            </div>
          ))}
        </>
      ) : (
        items.map(([label, value, marker]) => (
          <AppCard key={label} className="h-[78px] p-4 flex flex-col justify-between">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-[var(--on-surface-variant)]">
              <span className={`h-2 w-2 rounded-full ${marker}`} />
              {label}
            </div>
            <div className="text-2xl font-extrabold leading-6 text-[var(--on-surface)]">{value.toLocaleString('vi-VN')}</div>
          </AppCard>
        ))
      )}
    </div>
  )
}

function JobsTable({
  jobs,
  selectedJob,
  loading,
  onOpenDetail,
  onAction,
}: {
  jobs: CrawlJob[]
  selectedJob: CrawlJob | null
  loading?: boolean
  onOpenDetail: (job: CrawlJob) => void
  onAction: (action: 'cancel' | 'retry', job: CrawlJob) => void
}) {
  return (
    <div className="app-card table-scroll overflow-hidden">
      <div className="data-grid-lg">
        <TableHeader columns={['Job', 'Nguồn', 'Trạng thái', 'Tiến độ', 'Kết quả', 'Thời gian', 'Người tạo', 'Hành động']} />
        {loading && jobs.length === 0 ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="flex items-center gap-4">
                <div className="skeleton-loader h-5 w-48" />
                <div className="skeleton-loader h-5 w-24" />
                <div className="skeleton-loader h-5 w-20" />
                <div className="skeleton-loader h-5 w-16" />
              </div>
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState label="Chưa có crawl jobs nào" />
        ) : (
          jobs.map((job) => (
            <div key={job.id} onClick={() => onOpenDetail(job)} className={`grid cursor-pointer grid-cols-[1.6fr_0.9fr_1fr_1fr_0.8fr_1fr_1fr_0.9fr] items-center gap-3 border-t border-[var(--outline-variant)] px-4 py-4 text-xs transition-colors ${selectedJob?.id === job.id ? 'app-row-selected' : 'hover:bg-[var(--surface-container-low)]'}`}>
              <div>
                <div className="font-extrabold text-[var(--on-surface)]">{job.name}</div>
                <div className="mt-1 truncate text-[11px] font-mono text-[var(--on-surface-variant)]">ID: {shortId(job.id)}-...</div>
              </div>
              <div className="flex items-center gap-1.5 text-[var(--on-surface-variant)]">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[#eef4ff] text-[#2556ea]">◎</span>
                <span className="rounded-[5px] bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black text-emerald-700">D</span>
              </div>
              <Badge value={job.status} />
              <div>
                <div className="text-[var(--on-surface)] font-bold">{Number(job.progress_percent).toFixed(0)}%</div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#e9edf5]">
                  <div className="h-full rounded-full bg-[#16a34a]" style={{ width: `${Math.max(0, Math.min(100, Number(job.progress_percent || 0)))}%` }} />
                </div>
              </div>
              <div className="font-bold text-[#34415a]">{job.total_normalized || job.total_discovered} bài</div>
              <div className="text-[var(--on-surface-variant)] font-medium">{formatDate(job.created_at)}</div>
              <div className="flex items-center gap-2">
                <Thumbnail index={2} className="h-6 w-6 rounded-full" />
                <span className="truncate">{job.creator_name || (job.created_by_type === 'SYSTEM' ? 'Hệ thống' : 'Người dùng')}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                <button className="icon-button text-[var(--accent)] hover:bg-[var(--surface-container-low)]" title="Xem chi tiết" onClick={(event) => { event.stopPropagation(); onOpenDetail(job) }}><Eye size={14} /></button>
                <button className="icon-button text-[var(--accent)] hover:bg-[var(--surface-container-low)]" title="Chạy lại" onClick={(event) => { event.stopPropagation(); onAction('retry', job) }}><RotateCcw size={14} /></button>
                <button className="icon-button text-red-600 hover:bg-red-50" title="Dừng job" onClick={(event) => { event.stopPropagation(); onAction('cancel', job) }}><Square size={14} /></button>
                <button className="icon-button text-[#526179] hover:bg-[var(--surface-container-low)]" title="Khác"><MoreHorizontal size={14} /></button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function CreateDialog(props: {
  sourceType: 'BILIBILI' | 'VNEXPRESS'
  setSourceType: (value: 'BILIBILI' | 'VNEXPRESS') => void
  jobName: string
  setJobName: (value: string) => void
  sourceUrl: string
  setSourceUrl: (value: string) => void
  keywords: string
  setKeywords: (value: string) => void
  maxItems: number
  setMaxItems: (value: number) => void
  vnexpressRssFeeds: VnExpressRssFeed[]
  selectedVnexpressRssKeys: string[]
  setSelectedVnexpressRssKeys: (value: string[]) => void
  onClose: () => void
  onSubmit: () => void
}) {
  const toggleRssFeed = (key: string) => {
    props.setSelectedVnexpressRssKeys(
      props.selectedVnexpressRssKeys.includes(key)
        ? props.selectedVnexpressRssKeys.filter((item) => item !== key)
        : [...props.selectedVnexpressRssKeys, key],
    )
  }

  const selectAllRssFeeds = () => {
    props.setSelectedVnexpressRssKeys(props.vnexpressRssFeeds.map((feed) => feed.key))
  }

  const clearRssFeeds = () => {
    props.setSelectedVnexpressRssKeys([])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6" style={{ backgroundColor: 'rgba(9,20,38,0.5)' }}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-[var(--outline-variant)] bg-white p-5 shadow-xl">
        <h3 className="text-lg font-bold text-[#0f172a] mb-5">Tạo Crawl Job</h3>
        <div className="space-y-4">
          <label className="block text-sm font-medium">
            Tên Job
            <input type="text" className="mt-1 w-full rounded-md border p-2 text-sm outline-none" value={props.jobName} onChange={e => props.setJobName(e.target.value)} />
          </label>
          <label className="block text-sm font-medium">
            Nguồn
            <select className="mt-1 w-full rounded-md border p-2 text-sm outline-none" value={props.sourceType} onChange={e => props.setSourceType(e.target.value as 'BILIBILI' | 'VNEXPRESS')}>
              <option value="BILIBILI">Bilibili</option>
              <option value="VNEXPRESS">VNExpress</option>
            </select>
          </label>
          {props.sourceType === 'VNEXPRESS' && (
            <>
              <label className="block text-sm font-medium">
                URL VNExpress
                <input
                  type="url"
                  className="mt-1 w-full rounded-md border p-2 text-sm outline-none"
                  placeholder="https://vnexpress.net/rss/tin-moi-nhat.rss"
                  value={props.sourceUrl}
                  onChange={e => props.setSourceUrl(e.target.value)}
                />
              </label>
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">Chuyên mục RSS VNExpress</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={selectAllRssFeeds} className="h-7 rounded-md border px-2 text-[11px] font-bold">Chọn tất cả</button>
                    <button type="button" onClick={clearRssFeeds} className="h-7 rounded-md border px-2 text-[11px] font-bold">Bỏ chọn</button>
                  </div>
                </div>
                <div className="grid max-h-[260px] gap-2 overflow-y-auto rounded-[8px] border border-[var(--outline-variant)] bg-[#fbfcff] p-3 sm:grid-cols-2 lg:grid-cols-3">
                  {props.vnexpressRssFeeds.length === 0 ? (
                    <div className="col-span-full text-xs font-semibold text-[#64748b]">Đang tải danh sách RSS...</div>
                  ) : props.vnexpressRssFeeds.map((feed) => {
                    const checked = props.selectedVnexpressRssKeys.includes(feed.key)
                    return (
                      <label key={feed.key} className={`flex min-h-[54px] cursor-pointer items-start gap-2 rounded-[8px] border p-2 text-xs transition ${checked ? 'border-[#2556ea] bg-[#f2f6ff]' : 'border-[#edf1f7] bg-white hover:bg-[#f8faff]'}`}>
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={checked}
                          onChange={() => toggleRssFeed(feed.key)}
                        />
                        <span className="min-w-0">
                          <span className="block font-extrabold text-[#111827]">{feed.label}</span>
                          <span className="mt-0.5 block truncate font-mono text-[10px] text-[#64748b]">{feed.url.replace('https://vnexpress.net/rss/', '')}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            </>
          )}
          <label className="block text-sm font-medium">
            Keywords
            <input type="text" className="mt-1 w-full rounded-md border p-2 text-sm outline-none" value={props.keywords} onChange={e => props.setKeywords(e.target.value)} />
          </label>
          <label className="block text-sm font-medium">
            Số lượng max
            <input type="number" className="mt-1 w-full rounded-md border p-2 text-sm outline-none" value={props.maxItems} onChange={e => props.setMaxItems(Number(e.target.value))} />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={props.onClose} className="h-8 rounded-md border px-3 text-xs font-semibold">Hủy</button>
          <button onClick={props.onSubmit} className="h-8 rounded-md bg-[var(--accent)] px-3 text-xs font-semibold text-white hover:bg-[var(--accent-strong)]">Tạo mới</button>
        </div>
      </div>
    </div>
  )
}

function CrawlJobDetailSheet({
  job,
  onClose,
  onOpenModule2,
}: {
  job: CrawlJob | null
  onClose: () => void
  onOpenModule2?: (jobId?: string) => void
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'contents'>('contents')
  const [contents, setContents] = useState<FinalContentItem[]>([])
  const [loadingContents, setLoadingContents] = useState(false)
  const [selectedContent, setSelectedContent] = useState<FinalContentItem | null>(null)
  const [contentDetail, setContentDetail] = useState<ContentDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    if (!job) {
      setActiveTab('contents')
      setContents([])
      setSelectedContent(null)
      setContentDetail(null)
      setDetailLoading(false)
    }
  }, [job])

  useEffect(() => {
    if (!job || activeTab !== 'contents') {
      return
    }
    setLoadingContents(true)
    fetchFinalContentViewApi({ crawl_job_id: job.id, view: 'list' })
      .then((res) => setContents(res.normal_items || []))
      .catch(() => setContents([]))
      .finally(() => setLoadingContents(false))
  }, [activeTab, job])

  if (!job) return null

  const totalContents = contents.length || job.total_normalized || 0
  const openContentDetail = async (item: FinalContentItem) => {
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

  return (
    <>
      <div className="fixed inset-0 z-[80]">
        <button
          type="button"
          aria-label="Đóng chi tiết job"
          onClick={onClose}
          className="absolute inset-0 bg-[#0f172a]/10 backdrop-blur-[1px]"
        />
        <aside className="sheet-slide-in absolute bottom-0 right-0 top-0 flex w-full max-w-[720px] flex-col overflow-hidden border-l border-[var(--outline-variant)] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
          <div className="border-b border-[var(--outline-variant)] p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-[20px] font-extrabold text-[#111827]">Chi tiết Job - {job.name}</h2>
                <p className="mt-1 truncate text-[12px] font-mono text-[#64748b]">ID: {job.id}</p>
              </div>
              <div className="flex items-center gap-3">
                <StatusPill value={job.status === 'SUCCEEDED' ? 'Hoàn thành' : job.status} />
                <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-[8px] text-[#526179] hover:bg-[#f4f6ff]"><X size={18} /></button>
              </div>
            </div>
            <div className="mt-4 flex gap-6 border-b border-[var(--outline-variant)]">
              {[
                { key: 'overview' as const, label: 'Tổng quan' },
                { key: 'contents' as const, label: 'Nội dung Crawl được', count: totalContents },
              ].map((tab) => (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`relative h-10 text-[13px] font-bold ${activeTab === tab.key ? 'text-[#2556ea]' : 'text-[#526179]'}`}>
                  {tab.label}
                  {typeof tab.count === 'number' && <span className="ml-1 rounded-full bg-[#2556ea] px-2 py-0.5 text-[10px] text-white">{tab.count}</span>}
                  {activeTab === tab.key && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[#2556ea]" />}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {activeTab === 'overview' && (
              <div className="space-y-4 p-5">
                <div className="grid grid-cols-2 gap-3">
                  <JobMetric label="Đã phát hiện" value={job.total_discovered} />
                  <JobMetric label="Đã crawl" value={job.total_crawled} />
                  <JobMetric label="Đã chuẩn hóa" value={job.total_normalized} />
                  <JobMetric label="Lỗi" value={job.total_failed} tone="red" />
                </div>
                <div>
                  <div className="mb-2 text-[13px] font-extrabold text-[#111827]">Tiến độ</div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#e9edf5]">
                    <div className="h-full rounded-full bg-[#16a34a]" style={{ width: `${Math.max(0, Math.min(100, Number(job.progress_percent || 0)))}%` }} />
                  </div>
                  <div className="mt-2 text-[12px] font-semibold text-[#526179]">{Number(job.progress_percent || 0).toFixed(0)}% hoàn thành</div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-[12px]">
                  <MetaInfo label="Chế độ" value={job.crawl_mode} />
                  <MetaInfo label="Stage" value={job.current_stage} />
                  <MetaInfo label="Tạo lúc" value={formatDate(job.created_at)} />
                  <MetaInfo label="Cập nhật" value={formatDate(job.updated_at)} />
                </div>
              </div>
            )}

            {activeTab === 'contents' && (
              <>
                <div className="flex items-center justify-between border-b border-[var(--outline-variant)] px-5 py-3">
                  <span className="text-[13px] font-medium text-[#526179]">Hiển thị {contents.length ? `1 đến ${Math.min(20, contents.length)} trong` : '0 trong'} {totalContents} bài</span>
                  <AppButton variant="secondary" className="h-9 px-3" icon={<Download size={15} />}>Xuất dữ liệu</AppButton>
                </div>
                <div className="p-4">
                  {loadingContents ? (
                    <div className="loading-state"><Loader2 className="animate-spin" size={16}/> Đang tải nội dung...</div>
                  ) : contents.length === 0 ? (
                    <EmptyBlock label="Chưa có bài nào được crawl thành công." />
                  ) : (
                    <div className="space-y-3">
                      {contents.map((item, index) => (
                        <button
                          key={item.id}
                          onClick={() => void openContentDetail(item)}
                          className="grid w-full grid-cols-[112px_minmax(0,1fr)_58px] gap-3 rounded-[8px] p-2 text-left transition hover:bg-[#f8faff]"
                        >
                          <Thumbnail src={getContentMediaSrc(item)} index={index} className="h-[76px] w-[112px]" fallback={false} />
                          <div className="min-w-0">
                            <div className="line-clamp-2 text-[13px] font-extrabold leading-5 text-[#111827]">{item.canonical_title}</div>
                            <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-5 text-[#526179]">{item.summary || item.canonical_url || shortId(item.id)}</p>
                          </div>
                          <StatusPill value={item.status || 'READY'} tone="green" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {activeTab === 'contents' && contents.length > 0 && (
            <div className="flex items-center justify-between border-t border-[var(--outline-variant)] p-4">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[#526179]">
                <button className="grid h-8 w-8 place-items-center rounded-[8px] text-[#718096]">‹</button>
                <button className="grid h-8 w-8 place-items-center rounded-[8px] bg-[#2556ea] text-white">1</button>
                <button className="grid h-8 w-8 place-items-center rounded-[8px] text-[#526179]">›</button>
              </div>
              <SelectControl className="w-28"><option>20 / trang</option></SelectControl>
            </div>
          )}
        </aside>
      </div>

      <ContentDetailSheet
        item={contentDetail}
        loading={detailLoading}
        fallbackTitle={selectedContent?.canonical_title}
        onClose={() => {
          setSelectedContent(null)
          setContentDetail(null)
          setDetailLoading(false)
        }}
        onOpenModule2={onOpenModule2}
      />
    </>
  )
}

function JobMetric({ label, value, tone = 'green' }: { label: string; value: number; tone?: 'green' | 'red' }) {
  return (
    <div className="rounded-[8px] border border-[#edf1f7] bg-[#fbfcff] p-3">
      <div className="text-[11px] font-bold text-[#64748b]">{label}</div>
      <div className={`mt-1 text-[22px] font-extrabold ${tone === 'red' ? 'text-[#ef233c]' : 'text-[#16a34a]'}`}>{Number(value || 0).toLocaleString('vi-VN')}</div>
    </div>
  )
}

function MetaInfo({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="rounded-[8px] border border-[#edf1f7] bg-white p-3">
      <div className="text-[11px] font-bold text-[#64748b]">{label}</div>
      <div className="mt-1 truncate text-[12px] font-extrabold text-[#34415a]">{value || '-'}</div>
    </div>
  )
}

// Helpers
function Badge({ value }: { value: string }) {
  let color = 'bg-slate-100 text-slate-700'
  if (['SUCCEEDED', 'COMPLETED', 'APPROVED'].includes(value)) color = 'bg-emerald-100 text-emerald-800'
  if (['FAILED', 'REJECTED'].includes(value)) color = 'bg-red-100 text-red-800'
  if (['RUNNING', 'PENDING'].includes(value)) color = 'bg-blue-100 text-blue-800'
  return <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${color}`}>{value}</span>
}

function TableHeader({ columns }: { columns: string[] }) {
  return (
    <div className="app-table-header grid grid-cols-[1.6fr_0.9fr_1fr_1fr_0.8fr_1fr_1fr_0.9fr] gap-3 px-4 py-3">
      {columns.map(c => <div key={c}>{c}</div>)}
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return <div className="empty-state m-3">{label}</div>
}

function getContentMediaSrc(item: any) {
  if (!item) return null
  if (item.thumbnail_url) return item.thumbnail_url
  const media = (item.media_jsonb || item.media || [])[0]
  if (media?.thumbnail_url || media?.source_url || media?.storage_url) {
    return media.thumbnail_url || media.source_url || media.storage_url
  }
  if (item.normalized?.images?.[0]?.src) {
    return item.normalized.images[0].src
  }
  return null
}
