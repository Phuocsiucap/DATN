import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CalendarClock, CalendarDays, Eye, Loader2, MoreHorizontal, Plus, RefreshCcw, RotateCcw, Square } from 'lucide-react'
import {
  cancelCrawlJobApi,
  createCrawlJobApi,
  fetchCrawlJobsApi,
  fetchSourceTypesApi,
  fetchCrawlSourceConfigsApi,
  retryCrawlJobApi,
  updateCrawlJobScheduleApi,
  type CrawlJob,
  type CrawlSourceConfig,
  type SourceTypeConfig,
  type VnExpressRssFeed,
} from '@/commons/apis/module1'
import {
  AppButton,
  AppCard,
  PageLayout,
  SearchField,
  SelectControl,
  TableRowActions,
  type TableRowActionItem,
  Thumbnail,
} from '@/commons/component/social-ui'
import { CrawlJobDetailSheet } from './components/CrawlJobDetailSheet'
import { CrawlSourceConfigsTab } from './components/CrawlSourceConfigsTab'
import { CreateCrawlJobDialog, CrawlScheduleDialog } from './components/CrawlJobDialogs'
import {
  type CrawlScheduleForm,
  DEFAULT_SCHEDULE,
  scheduleDaysLabel,
  scheduleValidationMessage,
} from './crawlSchedule'

const formatDate = (value?: string) => value ? new Date(value).toLocaleString('vi-VN') : '-'
const shortId = (value: string) => value.slice(0, 8)
const apiErrorMessage = (error: unknown, fallback: string) => {
  if (!error || typeof error !== 'object' || !('response' in error)) return fallback
  const response = (error as { response?: { data?: { detail?: unknown } } }).response
  const detail = response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => item && typeof item === 'object' && 'msg' in item ? String(item.msg) : '')
      .filter(Boolean)
    if (messages.length) return messages.join('. ')
  }
  return fallback
}
export default function CrawlPage({ isSystemUser = false, onOpenModule2 }: { isSystemUser?: boolean; onOpenModule2?: (jobId?: string) => void }) {
  const [jobs, setJobs] = useState<CrawlJob[]>([])
  const [selectedJob, setSelectedJob] = useState<CrawlJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduleForm, setScheduleForm] = useState<CrawlScheduleForm>(DEFAULT_SCHEDULE)
  const [scheduleJob, setScheduleJob] = useState<CrawlJob | null>(null)
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'JOBS' | 'SOURCES'>('JOBS')
  
  // Filter State
  const [searchQuery, setSearchQuery] = useState('')
  const [filterSource, setFilterSource] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 500)
    return () => clearTimeout(timer)
  }, [searchQuery])
  
  // Create Form State
  const [sourceConfigs, setSourceConfigs] = useState<CrawlSourceConfig[]>([])
  const [selectedSourceConfigId, setSelectedSourceConfigId] = useState<string>('')
  const [sourceTypes, setSourceTypes] = useState<SourceTypeConfig[]>([])
  const [sourceType, setSourceType] = useState<string>('VNEXPRESS')
  const [jobName, setJobName] = useState(isSystemUser ? 'Global VNExpress Crawl' : 'Private VNExpress Crawl')
  const [sourceUrl, setSourceUrl] = useState('')
  const [keywords, setKeywords] = useState('')
  const [maxItems, setMaxItems] = useState(20)
  const [vnexpressRssFeeds, setVnexpressRssFeeds] = useState<VnExpressRssFeed[]>([])
  const [selectedVnexpressRssKeys, setSelectedVnexpressRssKeys] = useState<string[]>(['tin-moi-nhat'])

  const updateSourceType = (nextSourceType: string) => {
    setSourceType(nextSourceType)
    setJobName(isSystemUser
      ? `Global ${nextSourceType} Crawl`
      : `Private ${nextSourceType} Crawl`)
    setSourceUrl('')
    setKeywords(nextSourceType === 'VNEXPRESS' ? '' : 'truyen ma, short drama')
    if (nextSourceType === 'VNEXPRESS' && selectedVnexpressRssKeys.length === 0) {
      setSelectedVnexpressRssKeys(['tin-moi-nhat'])
    }
  }

  const loadCrawlData = async () => {
    setLoading(true)
    try {
      const nextJobs = await fetchCrawlJobsApi({
        q: debouncedQuery,
        source_type: filterSource,
        status: filterStatus,
      })
      setJobs(nextJobs)
      setSelectedJob((current) => current ? nextJobs.find((job) => job.id === current.id) ?? current : null)
    } catch (error: unknown) {
      toast.error(apiErrorMessage(error, 'Không thể tải dữ liệu Crawl Jobs'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'JOBS') {
      void loadCrawlData()
    }
  }, [debouncedQuery, filterSource, filterStatus, activeTab])

  useEffect(() => {
    fetchSourceTypesApi()
      .then((data) => {
        setSourceTypes(data)
        const vnexpress = data.find(s => s.type === 'VNEXPRESS')
        if (vnexpress && vnexpress.rss_feeds) {
          const feeds = vnexpress.rss_feeds
          setVnexpressRssFeeds(feeds)
          setSelectedVnexpressRssKeys((current) => {
            if (current.length) return current
            return feeds.some((feed) => feed.key === 'tin-moi-nhat') ? ['tin-moi-nhat'] : feeds.slice(0, 1).map((feed) => feed.key)
          })
        }
      })
      .catch(() => toast.error('Không tải được cấu hình Source Types'))
  }, [])

  useEffect(() => {
    if (showCreate) {
      fetchCrawlSourceConfigsApi()
        .then((data) => setSourceConfigs(data))
        .catch(() => console.error('Failed to load source configs'))
    }
  }, [showCreate])

  const metrics = useMemo(() => {
    const running = jobs.filter((job) => ['RUNNING', 'QUEUED', 'PENDING'].includes(job.status)).length
    const succeeded = jobs.filter((job) => job.status === 'SUCCEEDED').length
    const partial = jobs.filter((job) => job.status === 'PARTIAL_SUCCESS').length
    const failed = jobs.filter((job) => job.status === 'FAILED').length
    return { running, succeeded, partial, failed }
  }, [jobs])

  const createJob = async () => {
    if (!jobName.trim()) {
      toast.error('Vui lòng nhập tên job')
      return
    }
    const scheduleError = scheduleEnabled ? scheduleValidationMessage(scheduleForm) : null
    if (scheduleError) return toast.error(scheduleError)
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
        schedule: scheduleEnabled ? scheduleForm : null,
        sources: [{
          source_type: sourceType,
          source_url: trimmedSourceUrl || null,
          keywords: keywords.split(',').map((item) => item.trim()).filter(Boolean),
          source_config_id: selectedSourceConfigId || null,
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
      setScheduleEnabled(false)
      setScheduleForm(DEFAULT_SCHEDULE)
      setSelectedSourceConfigId('')
      await loadCrawlData()
    } catch (error: unknown) {
      toast.error(apiErrorMessage(error, 'Không thể tạo crawl job'))
    } finally {
      setLoading(false)
    }
  }

  const saveSchedule = async (job: CrawlJob, schedule: CrawlScheduleForm) => {
    const scheduleError = scheduleValidationMessage(schedule)
    if (scheduleError) return toast.error(scheduleError)
    setScheduleSaving(true)
    try {
      await updateCrawlJobScheduleApi(job.id, schedule)
      toast.success(schedule.enabled ? 'Đã cập nhật lịch crawl.' : 'Đã tạm dừng lịch crawl.')
      setScheduleJob(null)
      await loadCrawlData()
    } catch (error: unknown) {
      toast.error(apiErrorMessage(error, 'Không thể cập nhật lịch crawl'))
    } finally {
      setScheduleSaving(false)
    }
  }

  const jobAction = async (action: 'cancel' | 'retry', job: CrawlJob) => {
    setLoading(true)
    try {
      await (action === 'cancel' ? cancelCrawlJobApi(job.id) : retryCrawlJobApi(job.id))
      toast.success(action === 'cancel' ? 'Đã hủy job.' : 'Đã gửi yêu cầu chạy lại job.')
      await loadCrawlData()
    } catch (error: unknown) {
      toast.error(apiErrorMessage(error, 'Thao tác job thất bại'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageLayout
      title="Thu thập dữ liệu"
      description="Tạo và quản lý các job crawl dữ liệu từ nhiều nguồn khác nhau."
      actions={
        <>
          <div className="flex rounded-md border border-[var(--outline-variant)] bg-[var(--surface-container-lowest)] p-1 mr-4">
            <button
              type="button"
              onClick={() => setActiveTab('JOBS')}
              className={`px-4 py-1.5 text-xs font-bold rounded-sm transition ${activeTab === 'JOBS' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-low)]'}`}
            >
              Công việc
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('SOURCES')}
              className={`px-4 py-1.5 text-xs font-bold rounded-sm transition ${activeTab === 'SOURCES' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-low)]'}`}
            >
              Nguồn chung
            </button>
          </div>
          {activeTab === 'JOBS' && (
            <>
              <AppButton variant="secondary" icon={<RefreshCcw size={15} />} disabled={loading} onClick={() => void loadCrawlData()}>Tải lại</AppButton>
              <AppButton icon={<Plus size={15} />} onClick={() => setShowCreate(true)}>Tạo job crawl</AppButton>
            </>
          )}
        </>
      }
    >

      <section className="min-w-0">
        {activeTab === 'SOURCES' ? (
          <CrawlSourceConfigsTab isSystemUser={isSystemUser} sourceTypes={sourceTypes} vnexpressRssFeeds={vnexpressRssFeeds} />
        ) : (
          <>
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
                <AppCard className="grid gap-3 p-4 md:grid-cols-[minmax(240px,1fr)_150px_150px_150px_190px]">
                  <SearchField placeholder="Tìm kiếm job..." value={searchQuery} onChange={(e: any) => setSearchQuery(e.target.value)} />
                  <SelectControl value={filterSource} onChange={(e: any) => setFilterSource(e.target.value)}>
                    <option value="">Tất cả nguồn</option>
                    <option value="VNEXPRESS">VNExpress</option>
                    <option value="BILIBILI">Bilibili</option>
                  </SelectControl>
                  <SelectControl value={filterStatus} onChange={(e: any) => setFilterStatus(e.target.value)}>
                    <option value="">Tất cả trạng thái</option>
                    <option value="PENDING">Pending</option>
                    <option value="RUNNING">Running</option>
                    <option value="SUCCEEDED">Succeeded</option>
                    <option value="FAILED">Failed</option>
                    <option value="PAUSED">Paused</option>
                    <option value="CANCELLED">Cancelled</option>
                  </SelectControl>
                  <SelectControl><option>Người tạo</option></SelectControl>
                  <SelectControl icon={<CalendarDays size={15} />}><option>Chọn khoảng thời gian</option></SelectControl>
                </AppCard>

                <JobsTable
                  jobs={jobs}
                  selectedJob={selectedJob}
                  onOpenDetail={(job) => setSelectedJob(job)}
                  onAction={jobAction}
                  onEditSchedule={(job) => setScheduleJob(job)}
                />
              </div>
            </div>
          </>
        )}
      </section>

      {showCreate && (
        <CreateCrawlJobDialog
          sourceConfigs={sourceConfigs}
          sourceTypes={sourceTypes}
          selectedSourceConfigId={selectedSourceConfigId}
          setSelectedSourceConfigId={setSelectedSourceConfigId}
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
          scheduleEnabled={scheduleEnabled}
          setScheduleEnabled={setScheduleEnabled}
          schedule={scheduleForm}
          setSchedule={setScheduleForm}
          onClose={() => setShowCreate(false)}
          onSubmit={() => void createJob()}
        />
      )}

      <CrawlJobDetailSheet
        key={selectedJob?.id || 'closed-crawl-detail'}
        job={selectedJob}
        onClose={() => setSelectedJob(null)}
        onOpenModule2={onOpenModule2}
      />

      {scheduleJob && (
        <CrawlScheduleDialog
          key={scheduleJob.id}
          job={scheduleJob}
          saving={scheduleSaving}
          onClose={() => setScheduleJob(null)}
          onSave={(schedule) => void saveSchedule(scheduleJob, schedule)}
        />
      )}
    </PageLayout>
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
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--on-surface-variant)]">
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
  onEditSchedule,
}: {
  jobs: CrawlJob[]
  selectedJob: CrawlJob | null
  loading?: boolean
  onOpenDetail: (job: CrawlJob) => void
  onAction: (action: 'cancel' | 'retry', job: CrawlJob) => void
  onEditSchedule: (job: CrawlJob) => void
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
          jobs.map((job) => {
            const canEditSchedule = job.crawl_mode !== 'SCHEDULED_RUN' && !['PENDING', 'QUEUED', 'RUNNING'].includes(job.status)
            return (
            <div key={job.id} onClick={() => onOpenDetail(job)} className={`grid cursor-pointer grid-cols-[1.6fr_0.9fr_1fr_1fr_0.8fr_1fr_1fr_0.9fr] items-center gap-3 border-t border-[var(--outline-variant)] px-4 py-4 text-xs transition-colors ${selectedJob?.id === job.id ? 'app-row-selected' : 'hover:bg-[var(--surface-container-low)]'}`}>
              <div>
                <div className="font-extrabold text-[var(--on-surface)]">{job.name}</div>
                <div className="mt-1 truncate text-xs font-mono text-[var(--on-surface-variant)]">ID: {shortId(job.id)}-...</div>
                {job.schedule && (
                  <div className={`mt-1 text-xs font-bold ${job.schedule.enabled ? 'text-[#2556ea]' : 'text-[#94a3b8]'}`}>
                    {job.schedule.enabled ? `${job.schedule.runs_per_day} lần/ngày · ${scheduleDaysLabel(job.schedule.weekdays)}` : 'Lịch đang tạm dừng'}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[var(--on-surface-variant)]">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[#eef4ff] text-[#2556ea]">◎</span>
                <span className="rounded-[5px] bg-emerald-100 px-1.5 py-0.5 text-xs font-black text-emerald-700">D</span>
              </div>
              <Badge value={job.status} />
              <div>
                <div className="text-[var(--on-surface)] font-bold">{Number(job.progress_percent).toFixed(0)}%</div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#e9edf5]">
                  <div className="h-full rounded-full bg-[#16a34a]" style={{ width: `${Math.max(0, Math.min(100, Number(job.progress_percent || 0)))}%` }} />
                </div>
              </div>
              <div className="font-bold text-[#34415a]">{job.total_normalized || job.total_discovered} bài</div>
              <div className="text-[var(--on-surface-variant)] font-medium">
                {job.schedule?.enabled ? (
                  <><span className="block text-xs font-bold text-[#2556ea]">Lần kế tiếp</span>{formatDate(job.schedule.next_run_at || undefined)}</>
                ) : formatDate(job.created_at)}
              </div>
              <div className="flex items-center gap-2">
                <Thumbnail index={2} className="h-6 w-6 rounded-full" />
                <span className="truncate">{job.creator_name || (job.created_by_type === 'SYSTEM' ? 'Hệ thống' : 'Người dùng')}</span>
              </div>
              <div>
                <TableRowActions
                  actions={([
                    { label: 'Xem chi tiết', icon: <Eye size={14} />, onClick: () => onOpenDetail(job) },
                    canEditSchedule ? { label: 'Thiết lập lịch', icon: <CalendarClock size={14} />, onClick: () => onEditSchedule(job) } : null,
                    job.crawl_mode !== 'SOURCE_CONFIG' ? { label: 'Chạy lại job', icon: <RotateCcw size={14} />, onClick: () => onAction('retry', job) } : null,
                    { label: 'Dừng job', icon: <Square size={14} />, onClick: () => onAction('cancel', job), danger: true },
                  ].filter(Boolean)) as TableRowActionItem[]}
                />
              </div>
            </div>
          )})
        )}
      </div>
    </div>
  )
}

// Helpers
function Badge({ value }: { value: string }) {
  let color = 'bg-slate-100 text-slate-700'
  if (['SUCCEEDED', 'COMPLETED', 'APPROVED'].includes(value)) color = 'bg-emerald-100 text-emerald-800'
  if (['FAILED', 'REJECTED'].includes(value)) color = 'bg-red-100 text-red-800'
  if (['RUNNING', 'PENDING', 'SCHEDULED'].includes(value)) color = 'bg-blue-100 text-blue-800'
  if (['PAUSED', 'CANCELLED'].includes(value)) color = 'bg-amber-100 text-amber-800'
  return <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${color}`}>{value}</span>
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
