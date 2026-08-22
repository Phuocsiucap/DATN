import { useEffect, useMemo, useState, useRef } from 'react'
import ReactPlayer from 'react-player'
import {
  CheckCircle2,
  Database,
  FileText,
  Loader2,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  Square,
} from 'lucide-react'
import { Sheet, SheetContent, SheetTrigger } from '@/commons/component/ui/sheet'
import {
  cancelCrawlJobApi,
  fetchContentDetailApi,
  createCrawlJobApi,
  fetchCrawlJobLogsApi,
  fetchCrawlJobsApi,
  fetchFinalContentViewApi,
  retryCrawlJobApi,
  type ContentItem,
  type ContentDetail,
  type CrawlJob,
  type CrawlLog,
  type FinalContentItem,
  type FinalContentView,
} from '@/commons/apis/module1'
import { fetchSocialProfilesApi } from '@/commons/apis/socialProfiles'

type Module1Tab = 'crawl' | 'crawled_data' | 'profile_match'
type FinalContentTab = 'normal' | 'series'
type SourceType = 'BILIBILI' | 'VNEXPRESS'

const tabs: { id: Module1Tab; label: string; icon: React.ElementType }[] = [
  { id: 'crawl', label: 'Crawl Jobs', icon: Play },
  { id: 'crawled_data', label: 'Kho Dữ liệu Crawl', icon: Database },
  { id: 'profile_match', label: 'Phân tích Khớp Profile', icon: CheckCircle2 },
]

const stageSteps = ['API', 'ORCHESTRATOR', 'CRAWLER', 'RAW', 'NORMALIZE', 'STORY', 'CANONICAL']

const statusTone: Record<string, string> = {
  RUNNING: 'bg-blue-50 text-blue-700 border-blue-200',
  QUEUED: 'bg-slate-50 text-slate-700 border-slate-200',
  PENDING: 'bg-slate-50 text-slate-700 border-slate-200',
  SUCCEEDED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PARTIAL_SUCCESS: 'bg-amber-50 text-amber-700 border-amber-200',
  FAILED: 'bg-red-50 text-red-700 border-red-200',
  CANCELLED: 'bg-zinc-50 text-zinc-700 border-zinc-200',
  READY: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  NEEDS_REVIEW: 'bg-amber-50 text-amber-700 border-amber-200',
}

const formatDate = (value?: string) => value ? new Date(value).toLocaleString('vi-VN') : '-'

const shortId = (value: string) => value.slice(0, 8)

export default function Module1Page({ workspaceMode = 'admin' }: { workspaceMode?: 'admin' | 'user' }) {
  const [activeTab, setActiveTab] = useState<Module1Tab>('crawl')
  const [finalContentTab, setFinalContentTab] = useState<FinalContentTab>('normal')
  const [jobs, setJobs] = useState<CrawlJob[]>([])
  const [profiles, setProfiles] = useState<any[]>([])
  const [finalContent, setFinalContent] = useState<FinalContentView>({ normal_items: [], series_items: [] })
  const [selectedContent, setSelectedContent] = useState<ContentItem | null>(null)
  const [contentDetail, setContentDetail] = useState<ContentDetail | null>(null)
  const [selectedJob, setSelectedJob] = useState<CrawlJob | null>(null)
  const [logSheetJob, setLogSheetJob] = useState<CrawlJob | null>(null)
  const [logSheetOpen, setLogSheetOpen] = useState(false)
  const [logs, setLogs] = useState<CrawlLog[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [sourceType, setSourceType] = useState<SourceType>('BILIBILI')
  const [jobName, setJobName] = useState(workspaceMode === 'admin' ? 'Global Bilibili Crawl' : 'Private Bilibili Crawl')
  const [sourceUrl, setSourceUrl] = useState('')
  const [keywords, setKeywords] = useState('truyen ma, short drama')
  const [maxItems, setMaxItems] = useState(20)

  const loadCrawlData = async () => {
    setLoading(true)
    setMessage('')
    try {
      const nextJobs = await fetchCrawlJobsApi()
      setJobs(nextJobs)
      setSelectedJob((current) => current ? nextJobs.find((job) => job.id === current.id) ?? current : nextJobs[0] ?? null)
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể tải dữ liệu Crawl Jobs')
    } finally {
      setLoading(false)
    }
  }

  const loadFinalContentData = async () => {
    try {
      const nextFinalContent = await fetchFinalContentViewApi()
      const nextContents = [...nextFinalContent.normal_items, ...nextFinalContent.series_items]
      setFinalContent(nextFinalContent)
      setSelectedContent((current) => current ? nextContents.find((content) => content.id === current.id) ?? current : nextContents[0] ?? null)
    } catch (e) {
      console.error(e)
    }
  }

  const loadProfileData = async () => {
    try {
      const nextProfiles = await fetchSocialProfilesApi()
      setProfiles(nextProfiles.items || nextProfiles)
    } catch (e) {
      console.error(e)
    }
  }

  const loadAll = async () => {
    if (activeTab === 'crawl') {
      await loadCrawlData()
    } else if (activeTab === 'crawled_data') {
      await loadFinalContentData()
    } else if (activeTab === 'profile_match') {
      await Promise.all([loadFinalContentData(), loadProfileData()])
    }
  }

  const loadedRefs = useRef({ crawl: false, content: false, profiles: false })

  useEffect(() => {
    if (activeTab === 'crawl' && !loadedRefs.current.crawl) {
      loadedRefs.current.crawl = true
      void loadCrawlData()
    } else if (activeTab === 'crawled_data' && !loadedRefs.current.content) {
      loadedRefs.current.content = true
      void loadFinalContentData()
    } else if (activeTab === 'profile_match') {
      if (!loadedRefs.current.profiles) {
        loadedRefs.current.profiles = true
        void loadProfileData()
      }
      if (!loadedRefs.current.content) {
        loadedRefs.current.content = true
        void loadFinalContentData()
      }
    }
  }, [activeTab])

  useEffect(() => {
    if (!logSheetOpen || !logSheetJob) {
      setLogs([])
      return
    }
    fetchCrawlJobLogsApi(logSheetJob.id).then(setLogs).catch(() => setLogs([]))
  }, [logSheetJob, logSheetOpen])

  useEffect(() => {
    if (!selectedContent) {
      setContentDetail(null)
      return
    }
    fetchContentDetailApi(selectedContent.id).then(setContentDetail).catch(() => setContentDetail(null))
  }, [selectedContent])

  const metrics = useMemo(() => {
    const running = jobs.filter((job) => ['RUNNING', 'QUEUED', 'PENDING'].includes(job.status)).length
    const succeeded = jobs.filter((job) => job.status === 'SUCCEEDED').length
    const partial = jobs.filter((job) => job.status === 'PARTIAL_SUCCESS').length
    const failed = jobs.filter((job) => job.status === 'FAILED').length
    return { running, succeeded, partial, failed }
  }, [jobs])

  const createJob = async () => {
    setLoading(true)
    setMessage('')
    try {
      await createCrawlJobApi({
        name: jobName,
        crawl_mode: 'ONE_TIME',
        content_scope: isUserMode ? 'PRIVATE' : 'GLOBAL',
        created_by_type: isUserMode ? 'USER' : 'SYSTEM',
        priority: 5,
        sources: [{
          source_type: sourceType,
          source_url: sourceUrl || null,
          keywords: keywords.split(',').map((item) => item.trim()).filter(Boolean),
          configuration: {
            max_items: maxItems,
            metadata_only: sourceType === 'BILIBILI',
          },
        }],
      })
      setShowCreate(false)
      await loadAll()
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể tạo crawl job')
    } finally {
      setLoading(false)
    }
  }

  const jobAction = async (action: 'cancel' | 'retry', job: CrawlJob) => {
    setLoading(true)
    try {
      await (action === 'cancel' ? cancelCrawlJobApi(job.id) : retryCrawlJobApi(job.id))
      await loadAll()
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Thao tác job thất bại')
    } finally {
      setLoading(false)
    }
  }

  const isUserMode = workspaceMode === 'user'

  return (
    <div className="space-y-6">
      {/* Header & Horizontal Tabs */}
      <div className="rounded-xl border border-[#d9e0ea] bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-[#0f172a]">
                {isUserMode ? 'Private Crawl Workspace' : 'Module 1 — System Global Crawl Operations'}
              </h2>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${isUserMode ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
                {isUserMode ? 'USER SCOPE: PRIVATE' : 'SYSTEM SCOPE: GLOBAL'}
              </span>
            </div>
            <p className="mt-1 text-sm text-[#64748b]">
              {isUserMode
                ? 'Tạo các tác vụ thu thập dữ liệu riêng cho kênh cá nhân của bạn.'
                : 'Quản lý crawler toàn hệ thống, chuẩn hóa canonical content & phân phối tới các kênh eligible.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void loadAll()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#d9e0ea] bg-white px-3 text-xs font-semibold text-[#475569] hover:bg-slate-50">
              <RefreshCcw size={14} /> Tải lại
            </button>
            <button onClick={() => setShowCreate(true)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#2563eb] px-4 text-xs font-bold text-white shadow-sm hover:bg-[#1d4ed8]">
              <Plus size={14} /> {isUserMode ? 'Tạo Private Crawl' : 'Tạo Global Crawl'}
            </button>
          </div>
        </div>

        {/* Top Horizontal Navigation Tabs */}
        <div className="mt-6 flex gap-2 border-t border-[#eef2f7] pt-4 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
                  isActive
                    ? 'bg-[#2563eb] text-white shadow-sm'
                    : 'bg-[#f8fafc] text-[#64748b] border border-[#e2e8f0] hover:bg-[#f1f5f9] hover:text-[#0f172a]'
                }`}
              >
                <Icon size={15} />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      <section className="min-w-0">
        {message && <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{message}</div>}
        {loading && (
          <div className="mb-4 flex items-center gap-2 text-sm text-[#64748b]">
            <Loader2 className="animate-spin" size={16} /> Đang tải dữ liệu Crawl...
          </div>
        )}

          {activeTab === 'crawl' && (
            <div className="space-y-6">
              <MetricGrid items={[
                ['Running', metrics.running, 'bg-blue-500'],
                ['Succeeded', metrics.succeeded, 'bg-emerald-500'],
                ['Partial', metrics.partial, 'bg-amber-500'],
                ['Failed', metrics.failed, 'bg-red-500'],
              ]} />
              <Flow />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {['Source: All', 'Status: Running', 'Stage', 'Date range'].map((pill) => <FilterPill key={pill}>{pill}</FilterPill>)}
                </div>
                <button onClick={() => setShowCreate(true)} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#2563eb] px-4 text-xs font-semibold text-white">
                  <Plus size={14} /> New crawl job
                </button>
              </div>
              <JobsTable
                jobs={jobs}
                selectedJob={selectedJob}
                onViewLogs={(job) => {
                  setSelectedJob(job)
                  setLogSheetJob(job)
                  setLogSheetOpen(true)
                }}
                onAction={jobAction}
              />
            </div>
          )}

          {activeTab === 'crawled_data' && (
            <CrawledDataLibrary
              view={finalContent}
              activeView={finalContentTab}
              selectedContent={selectedContent}
              detail={contentDetail}
              onViewChange={setFinalContentTab}
              onSelect={setSelectedContent}
            />
          )}

          {activeTab === 'profile_match' && (
            <ProfileMatchLibrary
              view={finalContent}
              profiles={profiles}
              selectedContent={selectedContent}
              detail={contentDetail}
              onSelect={setSelectedContent}
            />
          )}
        </section>

      {showCreate && (
        <CreateDialog
          sourceType={sourceType}
          setSourceType={setSourceType}
          jobName={jobName}
          setJobName={setJobName}
          sourceUrl={sourceUrl}
          setSourceUrl={setSourceUrl}
          keywords={keywords}
          setKeywords={setKeywords}
          maxItems={maxItems}
          setMaxItems={setMaxItems}
          onClose={() => setShowCreate(false)}
          onSubmit={() => void createJob()}
        />
      )}

      <JobLogsSheet
        job={logSheetJob}
        logs={logs}
        open={logSheetOpen}
        onOpenChange={setLogSheetOpen}
      />
    </div>
  )
}

function MetricGrid({ items }: { items: [string, number, string][] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map(([label, value, marker]) => (
        <div key={label} className="h-[82px] rounded-lg border border-[#d9e0ea] bg-white p-4">
          <div className="flex items-center gap-2 text-[11px] font-medium text-[#64748b]"><span className={`h-2 w-2 rounded-full ${marker}`} />{label}</div>
          <div className="mt-2 text-[22px] font-bold leading-[30px]">{value.toLocaleString('vi-VN')}</div>
        </div>
      ))}
    </div>
  )
}

function FilterPill({ children }: { children: React.ReactNode }) {
  return <button className="h-6 rounded-full border border-[#64748b] bg-white px-3 text-[11px] font-semibold text-[#64748b]">{children}</button>
}

function MetricMini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-[#eef2f7] bg-[#f8fafc] px-3 py-2">
      <div className="text-[10px] font-semibold uppercase text-[#94a3b8]">{label}</div>
      <div className="mt-1 font-bold text-[#111827]">{value.toLocaleString('vi-VN')}</div>
    </div>
  )
}

function Flow() {
  return (
    <div className="rounded-lg border border-[#d9e0ea] bg-white p-5">
      <h3 className="text-base font-bold">Module 1 pipeline</h3>
      <p className="mt-1 text-xs text-[#64748b]">Job to task to raw document to normalized document to canonical content.</p>
      <div className="mt-5 grid gap-3 md:grid-cols-7">
        {stageSteps.map((step, index) => (
          <div key={step} className="rounded-lg border border-[#d9e0ea] bg-[#fbfcfd] p-3">
            <div className="text-[11px] font-bold text-[#2563eb]">{String(index + 1).padStart(2, '0')}</div>
            <div className="mt-3 text-[11px] font-semibold">{step}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function JobsTable({
  jobs,
  selectedJob,
  onViewLogs,
  onAction,
}: {
  jobs: CrawlJob[]
  selectedJob: CrawlJob | null
  onViewLogs: (job: CrawlJob) => void
  onAction: (action: 'cancel' | 'retry', job: CrawlJob) => void
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#d9e0ea] bg-white">
      <TableHeader columns={['Job', 'Status', 'Stage', 'Progress', 'C/N/F/D', 'Actions']} />
      {jobs.length === 0 ? <EmptyState label="No crawl jobs yet" /> : jobs.map((job) => (
        <div key={job.id} onClick={() => onViewLogs(job)} className={`grid cursor-pointer grid-cols-[1.7fr_1fr_1fr_0.8fr_1fr_1.2fr] items-center gap-3 border-t border-[#eef2f7] px-3 py-3 text-xs ${selectedJob?.id === job.id ? 'bg-blue-50/60' : 'bg-white'}`}>
          <div>
            <div className="font-medium text-[#111827]">{job.name}</div>
            <div className="mt-1 text-[11px] text-[#94a3b8]">{shortId(job.id)} · {formatDate(job.created_at)}</div>
          </div>
          <Badge value={job.status} />
          <div className="text-[#64748b]">{job.current_stage}</div>
          <div className="text-[#64748b]">{Number(job.progress_percent).toFixed(0)}%</div>
          <div className="text-[#64748b]">{job.total_crawled}/{job.total_normalized}/{job.total_failed}/{job.total_duplicates}</div>
          <div className="flex flex-wrap gap-2">
            <button className="text-[#2563eb]" onClick={(event) => { event.stopPropagation(); onAction('retry', job) }}><RotateCcw size={13} /></button>
            <button className="text-red-600" onClick={(event) => { event.stopPropagation(); onAction('cancel', job) }}><Square size={13} /></button>
          </div>
        </div>
      ))}
    </div>
  )
}

function JobLogsSheet({
  job,
  logs,
  open,
  onOpenChange,
}: {
  job: CrawlJob | null
  logs: CrawlLog[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <span className="hidden" />
      </SheetTrigger>
      <SheetContent side="right" className="max-w-[920px]">
        <div className="flex h-full flex-col">
          <div className="border-b border-[#d9e0ea] px-6 py-5 pr-16">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#2563eb]">Notification Panel</div>
            <div>
              <h3 className="text-xl font-bold text-[#111827]">Crawl job logs</h3>
              <p className="mt-1 text-xs text-[#64748b]">
                {job ? `${job.name} · ${logs.length} log entries · ${shortId(job.id)}` : 'Select a job to view logs'}
              </p>
            </div>
            {job && <div className="mt-4 flex flex-wrap items-center gap-2"><Badge value={job.status} /><FilterPill>{job.current_stage}</FilterPill><FilterPill>{Number(job.progress_percent).toFixed(0)}%</FilterPill></div>}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {job && (
              <div className="space-y-4 border-b border-[#d9e0ea] bg-[#fbfcfd] p-5">
                <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
                  <div className="rounded-lg border border-[#d9e0ea] bg-white p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-semibold uppercase text-[#94a3b8]">Job detail</div>
                        <h4 className="mt-1 text-sm font-bold text-[#111827]">{job.name}</h4>
                      </div>
                      <Badge value={job.status} />
                    </div>
                    <InfoGrid rows={[
                      ['Job ID', job.id],
                      ['Mode', job.crawl_mode],
                      ['Current stage', job.current_stage || '-'],
                      ['Priority', String(job.priority)],
                      ['Created', formatDate(job.created_at)],
                      ['Updated', formatDate(job.updated_at)],
                    ]} />
                  </div>

                  <div className="rounded-lg border border-[#d9e0ea] bg-white p-4">
                    <div className="text-[11px] font-semibold uppercase text-[#94a3b8]">Progress</div>
                    <div className="mt-2 text-2xl font-bold text-[#111827]">{Number(job.progress_percent).toFixed(0)}%</div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#e2e8f0]">
                      <div
                        className="h-full rounded-full bg-[#2563eb]"
                        style={{ width: `${Math.min(100, Math.max(0, Number(job.progress_percent) || 0))}%` }}
                      />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                      <MetricMini label="Discovered" value={job.total_discovered} />
                      <MetricMini label="Crawled" value={job.total_crawled} />
                      <MetricMini label="Normalized" value={job.total_normalized} />
                      <MetricMini label="Failed" value={job.total_failed} />
                      <MetricMini label="Duplicates" value={job.total_duplicates} />
                    </div>
                  </div>
                </div>
              </div>
            )}
            <TableHeader columns={['Time', 'Stage', 'Level', 'Message', 'Source / Task', 'Metadata']} />
            {!job ? (
              <EmptyState label="Select a crawl job" />
            ) : logs.length === 0 ? (
              <EmptyState label="No logs for selected job" />
            ) : logs.map((log) => (
              <div key={log.id} className="grid grid-cols-[1.1fr_0.8fr_0.7fr_2fr_1.2fr_1.4fr] gap-3 border-t border-[#eef2f7] px-4 py-3 text-xs">
                <div className="text-[#64748b]">{formatDate(log.created_at)}</div>
                <div className="font-semibold text-[#334155]">{log.stage}</div>
                <div><Badge value={log.level} /></div>
                <div className="min-w-0 break-words text-[#334155]">{log.message}</div>
                <div className="min-w-0 text-[#64748b]">
                  <div>{log.source_type || '-'}</div>
                  <div className="mt-1 truncate text-[11px] text-[#94a3b8]">{log.task_id ? shortId(log.task_id) : '-'}</div>
                </div>
                <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[#f8fafc] p-2 text-[11px] text-[#64748b]">
                  {Object.keys(log.metadata_json || {}).length ? JSON.stringify(log.metadata_json, null, 2) : '-'}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function CrawledDataLibrary({
  view,
  activeView,
  selectedContent,
  detail,
  onViewChange,
  onSelect,
}: {
  view: FinalContentView
  activeView: FinalContentTab
  selectedContent: ContentItem | null
  detail: ContentDetail | null
  profiles?: any[]
  onViewChange: (view: FinalContentTab) => void
  onSelect: (content: FinalContentItem) => void
}) {
  const contents = activeView === 'normal' ? view.normal_items : view.series_items
  const primarySource = detail?.sources[0]

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_440px]">
      <Panel title="Dữ liệu Crawl & Kết quả Phân loại" subtitle="Theo dõi kết quả crawl và phân nhóm series">
        <div className="flex gap-2 border-t border-[#eef2f7] px-3 py-3">
          <button onClick={() => onViewChange('normal')} className={`h-8 rounded-md border px-3 text-xs font-semibold ${activeView === 'normal' ? 'border-[#2563eb] bg-[#e5f0ff] text-[#2563eb]' : 'border-[#d9e0ea] bg-white text-[#64748b]'}`}>Bài thường / Đơn lẻ ({view.normal_items.length})</button>
          <button onClick={() => onViewChange('series')} className={`h-8 rounded-md border px-3 text-xs font-semibold ${activeView === 'series' ? 'border-[#2563eb] bg-[#e5f0ff] text-[#2563eb]' : 'border-[#d9e0ea] bg-white text-[#64748b]'}`}>Bài ghép theo Series ({view.series_items.length})</button>
        </div>
        <TableHeader columns={activeView === 'normal' ? ['Preview', 'Title & Summary', 'Nguồn', 'Trạng thái', 'Ngày Crawl'] : ['Preview', 'Tên Series', 'Tập số', 'Trạng thái', 'Độ tin cậy', 'Ngày Crawl']} />
        {contents.length === 0 ? <EmptyState label={activeView === 'normal' ? 'Chưa có nội dung bài thường' : 'Chưa có nội dung ghép series'} /> : contents.map((item) => {
          return (
            <div key={item.id} onClick={() => onSelect(item)} className={`grid cursor-pointer grid-cols-[96px_2fr_0.8fr_0.9fr_1fr] items-center gap-3 border-t border-[#eef2f7] px-3 py-3 text-xs ${selectedContent?.id === item.id ? 'bg-blue-50/60' : 'bg-white'}`}>
              <MediaPreview media={item.media} compact />
              <div className="min-w-0">
                <div className="truncate font-bold text-[#0f172a]">{activeView === 'series' ? item.series?.canonical_name || item.canonical_title : item.canonical_title}</div>
                <div className="truncate text-[11px] text-[#64748b]">{activeView === 'series' ? (item.episode_title || item.canonical_title) : (item.summary || item.canonical_url || shortId(item.id))}</div>
              </div>
              <div className="text-[#64748b]">{activeView === 'series' ? item.source_type || 'SERIES' : item.source_type || item.content_type}</div>
              <Badge value={item.status} />
              <div className="text-[#64748b]">{formatDate(item.created_at)}</div>
            </div>
          )
        })}
      </Panel>

      <div className="rounded-lg border border-[#d9e0ea] bg-white p-5">
        <h3 className="text-base font-bold text-[#0f172a]">Chi tiết & Đánh giá Tương thích</h3>
        {!selectedContent ? (
          <EmptyState label="Chọn một nội dung để xem chi tiết kết quả match" compact />
        ) : !detail ? (
          <div className="mt-4 flex items-center gap-2 text-xs text-[#64748b]"><Loader2 className="animate-spin" size={14} /> Đang tải chi tiết...</div>
        ) : (
          <div className="mt-4 space-y-5 text-xs">
            {/* Tiêu đề & Tóm tắt */}
            <div>
              <div className="text-[11px] font-semibold uppercase text-[#94a3b8]">Nội dung Chuẩn hóa (Canonical)</div>
              <h4 className="mt-2 text-sm font-bold leading-5 text-[#0f172a]">{detail.canonical_title}</h4>
              <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/60 p-3">
                <div className="text-[10px] font-bold uppercase text-blue-800 mb-1">Tóm tắt (Summary)</div>
                <p className="leading-5 text-[#334155]">{detail.summary || 'Chưa có tóm tắt nội dung'}</p>
              </div>
              {detail.full_text && detail.full_text !== detail.summary && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] font-bold uppercase text-slate-600 mb-1">Văn bản đầy đủ (Full Text)</div>
                  <p className="leading-5 text-[#475569] max-h-40 overflow-y-auto whitespace-pre-wrap">{detail.full_text}</p>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2"><Badge value={detail.status} /><FilterPill>{detail.content_type}</FilterPill><FilterPill>Điểm chất lượng: {Number(detail.quality_score).toFixed(1)}/10</FilterPill></div>
            </div>

            <InfoGrid rows={[
              ['Content ID', shortId(detail.id)],
              ['Nguồn Crawl', primarySource?.source_type || '-'],
              ['ID Nguồn ngoài', primarySource?.source_external_id || '-'],
              ['Tác giả', primarySource?.source_author || '-'],
              ['Ngày xuất bản', formatDate(detail.published_at || primarySource?.source_published_at || undefined)],
              ['Ngày thu thập', formatDate(detail.created_at)],
            ]} />

            {detail.canonical_url && <a href={detail.canonical_url} target="_blank" rel="noreferrer" className="block truncate rounded-md border border-[#d9e0ea] px-3 py-2 font-medium text-[#2563eb] hover:bg-blue-50">{detail.canonical_url}</a>}

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase text-[#94a3b8]">Media & Hình ảnh Crawl được</div>
              {detail.media.length === 0 ? <div className="text-[#94a3b8]">Không có media kèm theo</div> : <div className="grid gap-3"><MediaGallery media={detail.media.slice(0, 6)} /></div>}
            </div>

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase text-[#94a3b8]">Tiến trình Xử lý (Processing Pipeline)</div>
              {detail.processing_runs.length === 0 ? <div className="text-[#94a3b8]">Chưa có thông tin processing run</div> : detail.processing_runs.slice(0, 3).map((run) => (
                <div key={run.id} className="mb-2 grid grid-cols-[1fr_auto] gap-3 rounded-md border border-[#eef2f7] px-3 py-2">
                  <div><div className="font-semibold text-[#1e293b]">{run.processing_type}</div><div className="mt-1 text-[#64748b]">{run.processor_version || 'v1.0'}</div></div>
                  <Badge value={run.status} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ProfileMatchLibrary({
  view,
  profiles = [],
  selectedContent,
  detail,
  onSelect,
}: {
  view: FinalContentView
  profiles?: any[]
  selectedContent: ContentItem | null
  detail: ContentDetail | null
  onSelect: (content: FinalContentItem) => void
}) {
  const [selectedProfileId, setSelectedProfileId] = useState(profiles[0]?.id || '')
  
  useEffect(() => {
    if (!selectedProfileId && profiles.length > 0) {
      setSelectedProfileId(profiles[0].id)
    }
  }, [profiles])

  const selectedProfile = useMemo(() => profiles.find((p) => p.id === selectedProfileId), [profiles, selectedProfileId])
  
  // Combine all items
  const allItems = useMemo(() => [...view.normal_items, ...view.series_items], [view])
  
  // Fake "matching algorithm" for UI demonstration based on the profile
  const matchedItems = useMemo(() => {
    if (!selectedProfile) return []
    return allItems.map((item) => {
      // Create a pseudo match score based on existing quality score
      const baseScore = item.quality_score || 8.0
      const isPlatformMatch = (selectedProfile.platform === 'YOUTUBE' && item.source_type === 'BILIBILI') || 
                              (selectedProfile.platform === 'TIKTOK' && item.source_type === 'VNEXPRESS')
      
      const matchScore = Math.min(99, Math.max(60, Math.round((baseScore * 10) + (isPlatformMatch ? 15 : -5))))
      return { ...item, matchScore }
    }).sort((a, b) => b.matchScore - a.matchScore)
  }, [allItems, selectedProfile])

  const matchedItem = selectedContent as (FinalContentItem & { matchScore?: number }) | null
  const currentMatchScore = matchedItem ? (matchedItems.find(i => i.id === matchedItem.id)?.matchScore || 0) : 0
  const matchedSeries = matchedItem?.series

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_440px]">
      <Panel title="Phân tích Khớp Profile" subtitle="Các nội dung phù hợp với chiến lược của Profile được chọn">
        {/* Profile Tabs */}
        <div className="flex gap-2 border-b border-[#eef2f7] px-4 py-3 overflow-x-auto">
          {profiles.length === 0 ? <div className="text-xs text-[#64748b]">Chưa có Profile nào</div> : profiles.map((p) => (
            <button 
              key={p.id} 
              onClick={() => setSelectedProfileId(p.id)}
              className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${selectedProfileId === p.id ? 'bg-[#2563eb] text-white shadow-sm' : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'}`}
            >
              {p.profile_name} ({p.platform})
            </button>
          ))}
        </div>

        <TableHeader columns={['Preview', 'Nội dung', 'Nguồn', 'Độ phù hợp']} />
        {matchedItems.length === 0 ? <EmptyState label="Không có dữ liệu phù hợp" /> : (
          <div className="max-h-[600px] overflow-y-auto">
            {matchedItems.map((item) => (
              <div key={item.id} onClick={() => onSelect(item)} className={`grid cursor-pointer grid-cols-[96px_2fr_1fr_1fr] items-center gap-3 border-b border-[#eef2f7] px-4 py-3 text-xs ${selectedContent?.id === item.id ? 'bg-blue-50/60' : 'bg-white'}`}>
                <MediaPreview media={item.media} compact />
                <div className="min-w-0">
                  <div className="truncate font-bold text-[#0f172a]">{item.series?.canonical_name || item.canonical_title}</div>
                  <div className="truncate text-[11px] text-[#64748b] mt-0.5">{item.series ? 'Bài Series' : 'Bài Đơn lẻ'}</div>
                </div>
                <div className="text-[#64748b]"><Badge value={item.source_type || 'Unknown'} /></div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-16 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                      <div className={`h-full ${item.matchScore >= 90 ? 'bg-emerald-500' : item.matchScore >= 75 ? 'bg-blue-500' : 'bg-amber-500'}`} style={{ width: `${item.matchScore}%` }}></div>
                    </div>
                    <span className={`font-bold text-[11px] ${item.matchScore >= 90 ? 'text-emerald-700' : item.matchScore >= 75 ? 'text-blue-700' : 'text-amber-700'}`}>{item.matchScore}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="rounded-lg border border-[#d9e0ea] bg-white p-5">
        <h3 className="text-base font-bold text-[#0f172a]">Chi tiết Khớp Profile</h3>
        {!selectedContent || !matchedItem || !currentMatchScore ? (
          <EmptyState label="Chọn một nội dung bên trái để xem phân tích chi tiết" compact />
        ) : (
          <div className="mt-4 space-y-5 text-xs">
            <div className={`rounded-xl border p-4 space-y-3 ${currentMatchScore >= 90 ? 'border-emerald-200 bg-emerald-50/60' : currentMatchScore >= 75 ? 'border-blue-200 bg-blue-50/60' : 'border-amber-200 bg-amber-50/60'}`}>
              <div className="flex items-center justify-between">
                <span className={`font-black uppercase text-[11px] tracking-wide ${currentMatchScore >= 90 ? 'text-emerald-800' : currentMatchScore >= 75 ? 'text-blue-800' : 'text-amber-800'}`}>
                  🎯 Đánh giá Mức độ Phù hợp
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${currentMatchScore >= 90 ? 'bg-emerald-600' : currentMatchScore >= 75 ? 'bg-blue-600' : 'bg-amber-600'}`}>
                  SCORE: {currentMatchScore}%
                </span>
              </div>

              <div className={`space-y-2 border-t pt-2 ${currentMatchScore >= 90 ? 'border-emerald-200/80 text-emerald-900' : currentMatchScore >= 75 ? 'border-blue-200/80 text-blue-900' : 'border-amber-200/80 text-amber-900'}`}>
                <div><span className="font-semibold">Nội dung:</span> {matchedSeries ? matchedSeries.canonical_name : matchedItem.canonical_title}</div>
                <div><span className="font-semibold">Target Profile:</span> {selectedProfile?.profile_name}</div>
                <div className="pt-1 mt-1 border-t border-white/40">
                  <span className="font-semibold block mb-1">💡 AI Reasoning (Lập luận):</span>
                  <ul className="list-disc pl-4 space-y-1 text-[11px] opacity-90 leading-relaxed">
                    {currentMatchScore >= 90 ? (
                      <>
                        <li>Nội dung này <strong>rất phù hợp</strong> với định hướng chiến lược (Strategy) của {selectedProfile?.profile_name}.</li>
                        <li>Chủ đề và Tone giọng hoàn toàn trùng khớp với tệp khán giả mục tiêu ({selectedProfile?.strategy?.target_audience || 'đã chọn'}).</li>
                        <li>Chất lượng dữ liệu ({matchedItem.quality_score}/10) đạt tiêu chuẩn cao để Module 2 tự động lên kịch bản.</li>
                      </>
                    ) : currentMatchScore >= 75 ? (
                      <>
                        <li>Nội dung này <strong>khá phù hợp</strong> với kênh {selectedProfile?.profile_name}.</li>
                        <li>Có thể cần Module 2 tinh chỉnh lại một số yếu tố kịch bản (Tone: {selectedProfile?.strategy?.tone || 'đã chọn'}) để khớp hoàn toàn.</li>
                      </>
                    ) : (
                      <>
                        <li>Nội dung <strong>ít liên quan</strong> hoặc lệch định hướng kênh {selectedProfile?.profile_name}.</li>
                        <li>Chỉ nên sử dụng nếu muốn đa dạng hóa tuyến nội dung phụ.</li>
                      </>
                    )}
                  </ul>
                </div>
              </div>
            </div>

            {/* Profile Strategy Snapshot */}
            {selectedProfile?.strategy && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="font-bold text-slate-800 mb-3 border-b border-slate-200 pb-2">Chiến lược kênh (Strategy)</div>
                <div className="space-y-2 text-[#475569]">
                  <div><span className="font-semibold">Tone giọng:</span> {selectedProfile.strategy.tone || '-'}</div>
                  <div><span className="font-semibold">Khán giả mục tiêu:</span> {selectedProfile.strategy.target_audience || '-'}</div>
                  <div><span className="font-semibold">Định dạng khuyên dùng:</span> {selectedProfile.strategy.preferred_formats?.join(', ') || '-'}</div>
                </div>
              </div>
            )}
            
            {/* Quick Preview */}
            <div className="rounded-lg border border-slate-200 p-4">
               <div className="font-bold text-slate-800 mb-2">Bản xem trước dữ liệu (Canonical)</div>
               <div className="text-[11px] font-semibold text-[#2563eb] mb-1">{matchedItem.content_type}</div>
               <div className="font-semibold text-[#0f172a] leading-tight mb-2">{matchedItem.canonical_title}</div>
               <div className="text-[#64748b] leading-relaxed line-clamp-4">{detail?.summary || matchedItem.summary || 'Đang tải tóm tắt...'}</div>
               {detail?.canonical_url && <a href={detail.canonical_url} target="_blank" rel="noreferrer" className="block mt-3 truncate rounded-md border border-[#d9e0ea] px-3 py-1.5 text-center font-medium text-[#2563eb] hover:bg-blue-50">Xem nguồn gốc</a>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function mediaUrl(item: { source_url?: string | null; storage_url?: string | null; thumbnail_url?: string | null }) {
  return item.storage_url || item.source_url || item.thumbnail_url || ''
}

function isVideo(item: { media_type: string; source_url?: string | null; storage_url?: string | null }) {
  const url = mediaUrl(item).toLowerCase()
  return item.media_type.toUpperCase().includes('VIDEO') || url.endsWith('.mp4') || url.includes('.m3u8')
}

function proxiedMediaUrl(url: string) {
  const isVnExpress = url.includes('vnexpress') || url.includes('vnecdn')
  const isIframe = url.includes('video-iframe') || url.includes('embed') || url.includes('youtube.com')
  if (!isVnExpress || isIframe) return url
  const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1'
  return `${baseUrl}/media-proxy?url=${encodeURIComponent(url)}`
}

function isEmbeddableVideo(url: string) {
  return url.includes('video-iframe') || url.includes('embed') || url.includes('youtube.com')
}

function MediaPreview({ media, compact = false }: { media?: { media_type: string; source_url?: string | null; storage_url?: string | null; thumbnail_url?: string | null }[]; compact?: boolean }) {
  const first = media?.[0]
  if (!first) {
    return <div className={`${compact ? 'h-14 w-20' : 'h-32 w-full'} rounded-md border border-dashed border-[#d9e0ea] bg-[#fbfcfd] text-[11px] text-[#94a3b8] flex items-center justify-center`}>No media</div>
  }
  const url = mediaUrl(first)
  if (!url) {
    return <div className={`${compact ? 'h-14 w-20' : 'h-32 w-full'} rounded-md border border-dashed border-[#d9e0ea] bg-[#fbfcfd] text-[11px] text-[#94a3b8] flex items-center justify-center`}>No media</div>
  }
  if (isVideo(first)) {
    const poster = first.thumbnail_url || undefined
    const finalUrl = proxiedMediaUrl(url)
    const isM3u8 = url.toLowerCase().includes('.m3u8')
    if (isEmbeddableVideo(url)) {
      return (
        <div className={`${compact ? 'h-14 w-20' : 'h-48 w-full'} overflow-hidden rounded-md border border-[#d9e0ea] bg-black`}>
          {compact ? (
            poster ? <img src={poster} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-[11px] text-white">Video</div>
          ) : (
            <iframe src={url} className="h-full w-full border-0" allowFullScreen />
          )}
        </div>
      )
    }
    if (compact) {
      return poster
        ? <img src={poster} alt="" loading="lazy" className="h-14 w-20 rounded-md border border-[#d9e0ea] bg-[#fbfcfd] object-cover" />
        : <div className="flex h-14 w-20 items-center justify-center rounded-md border border-[#d9e0ea] bg-black text-[11px] text-white">Video</div>
    }
    return (
      <div className="relative h-48 w-full overflow-hidden rounded-md border border-[#d9e0ea] bg-black">
        <ReactPlayer
          src={finalUrl}
          controls
          width="100%"
          height="100%"
          className="absolute inset-0"
          config={{ file: { forceHLS: isM3u8, attributes: { crossOrigin: 'anonymous', poster } } } as any}
        />
      </div>
    )
  }
  return <img src={proxiedMediaUrl(url)} alt="" loading="lazy" className={`${compact ? 'h-14 w-20' : 'h-48 w-full'} rounded-md border border-[#d9e0ea] bg-[#fbfcfd] object-cover`} />
}

function MediaGallery({ media }: { media: { id?: string; media_type: string; source_url?: string | null; storage_url?: string | null; thumbnail_url?: string | null }[] }) {
  return (
    <div className="grid gap-3">
      {media.map((item, index) => (
        <div key={item.id || `${mediaUrl(item)}-${index}`} className="rounded-md border border-[#eef2f7] bg-[#fbfcfd] p-2">
          <MediaPreview media={[item]} />
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
            <span className="font-semibold text-[#334155]">{item.media_type}</span>
            <a href={mediaUrl(item)} target="_blank" rel="noreferrer" className="truncate text-[#2563eb]">Open source</a>
          </div>
        </div>
      ))}
    </div>
  )
}

function InfoGrid({ rows }: { rows: [string, string][] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-md border border-[#eef2f7] bg-[#fbfcfd] px-3 py-2">
          <div className="text-[10px] font-semibold uppercase text-[#94a3b8]">{label}</div>
          <div className="mt-1 break-words font-medium text-[#334155]">{value}</div>
        </div>
      ))}
    </div>
  )
}



function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-lg border border-[#d9e0ea] bg-white"><div className="p-5"><h3 className="text-base font-bold">{title}</h3><p className="mt-1 text-xs text-[#64748b]">{subtitle}</p></div>{children}</div>
}

function TableHeader({ columns }: { columns: string[] }) {
  return <div className={`grid gap-3 rounded-t-lg bg-[#fbfcfd] px-3 py-3 text-[11px] font-semibold text-[#64748b]`} style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>{columns.map((column) => <div key={column}>{column}</div>)}</div>
}

function Badge({ value }: { value: string }) {
  return <span className={`inline-flex w-fit items-center rounded-full border px-2 py-1 text-[11px] font-semibold ${statusTone[value] || 'border-slate-200 bg-slate-50 text-slate-700'}`}>{value}</span>
}

function EmptyState({ label, compact = false }: { label: string; compact?: boolean }) {
  return <div className={`flex items-center justify-center gap-2 text-sm text-[#94a3b8] ${compact ? 'py-4' : 'py-12'}`}><Search size={16} /> {label}</div>
}

function CreateDialog(props: {
  sourceType: SourceType
  setSourceType: (value: SourceType) => void
  jobName: string
  setJobName: (value: string) => void
  sourceUrl: string
  setSourceUrl: (value: string) => void
  keywords: string
  setKeywords: (value: string) => void
  maxItems: number
  setMaxItems: (value: number) => void
  onClose: () => void
  onSubmit: () => void
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-4">
      <div className="w-full max-w-[520px] rounded-lg border border-[#d9e0ea] bg-white p-6 shadow-xl">
        <h3 className="text-base font-bold">Create crawl job</h3>
        <p className="mt-1 text-xs text-[#64748b]">Wizard: source, input, config and payload confirmation.</p>
        <div className="mt-5 grid grid-cols-4 gap-2">
          {['Source', 'Input', 'Config', 'Confirm'].map((step, index) => <div key={step} className={`rounded-lg border p-3 ${index <= 1 ? 'border-[#2563eb] bg-[#e5f0ff]' : 'border-[#d9e0ea] bg-white'}`}><div className="text-[11px] font-bold text-[#2563eb]">{String(index + 1).padStart(2, '0')}</div><div className="mt-3 text-[11px] font-semibold">{step}</div></div>)}
        </div>
        <div className="mt-5 space-y-3">
          <label className="block text-xs font-semibold">Job name<input value={props.jobName} onChange={(event) => props.setJobName(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-[#d9e0ea] px-3 text-sm font-normal outline-none" /></label>
          <div className="grid grid-cols-2 gap-2">
            {(['BILIBILI', 'VNEXPRESS'] as SourceType[]).map((source) => <button key={source} onClick={() => props.setSourceType(source)} className={`h-9 rounded-md border text-xs font-semibold ${props.sourceType === source ? 'border-[#2563eb] bg-[#e5f0ff] text-[#2563eb]' : 'border-[#d9e0ea] bg-white'}`}>{source}</button>)}
          </div>
          <label className="block text-xs font-semibold">Source URL<input value={props.sourceUrl} onChange={(event) => props.setSourceUrl(event.target.value)} placeholder="https://..." className="mt-1 h-9 w-full rounded-md border border-[#d9e0ea] px-3 text-sm font-normal outline-none" /></label>
          <label className="block text-xs font-semibold">Keywords<input value={props.keywords} onChange={(event) => props.setKeywords(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-[#d9e0ea] px-3 text-sm font-normal outline-none" /></label>
          <label className="block text-xs font-semibold">max_items<input type="number" min={1} max={200} value={props.maxItems} onChange={(event) => props.setMaxItems(Number(event.target.value || 20))} className="mt-1 h-9 w-full rounded-md border border-[#d9e0ea] px-3 text-sm font-normal outline-none" /></label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={props.onClose} className="h-9 rounded-md border border-[#d9e0ea] px-4 text-xs font-semibold">Cancel</button>
          <button onClick={props.onSubmit} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#2563eb] px-4 text-xs font-semibold text-white"><FileText size={14} /> Create job</button>
        </div>
      </div>
    </div>
  )
}
