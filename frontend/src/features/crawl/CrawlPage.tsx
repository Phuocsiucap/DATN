import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, RefreshCcw, RotateCcw, Square } from 'lucide-react'
import { Sheet, SheetContent, SheetTrigger } from '@/commons/component/ui/sheet'
import {
  cancelCrawlJobApi,
  createCrawlJobApi,
  fetchCrawlJobLogsApi,
  fetchCrawlJobsApi,
  retryCrawlJobApi,
  fetchFinalContentViewApi,
  type CrawlJob,
  type CrawlLog,
} from '@/commons/apis/module1'
import { ContentDetailDialog } from '@/features/content/ContentDetailDialog'

const stageSteps = ['API', 'ORCHESTRATOR', 'CRAWLER', 'RAW', 'NORMALIZE', 'STORY', 'CANONICAL']

const formatDate = (value?: string) => value ? new Date(value).toLocaleString('vi-VN') : '-'
const shortId = (value: string) => value.slice(0, 8)

export default function CrawlPage({ isSystemUser = false, onOpenModule2 }: { isSystemUser?: boolean; onOpenModule2?: (jobId?: string) => void }) {
  const [jobs, setJobs] = useState<CrawlJob[]>([])
  const [selectedJob, setSelectedJob] = useState<CrawlJob | null>(null)
  const [logSheetJob, setLogSheetJob] = useState<CrawlJob | null>(null)
  const [logSheetOpen, setLogSheetOpen] = useState(false)
  const [logs, setLogs] = useState<CrawlLog[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  
  // Create Form State
  const [sourceType, setSourceType] = useState<'BILIBILI' | 'VNEXPRESS'>('BILIBILI')
  const [jobName, setJobName] = useState(isSystemUser ? 'Global Bilibili Crawl' : 'Private Bilibili Crawl')
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

  useEffect(() => {
    void loadCrawlData()
  }, [])

  useEffect(() => {
    if (!logSheetOpen || !logSheetJob) {
      setLogs([])
      return
    }
    fetchCrawlJobLogsApi(logSheetJob.id).then(setLogs).catch(() => setLogs([]))
  }, [logSheetJob, logSheetOpen])

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
        content_scope: isSystemUser ? 'GLOBAL' : 'PRIVATE',
        created_by_type: isSystemUser ? 'SYSTEM' : 'USER',
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
      await loadCrawlData()
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
      await loadCrawlData()
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Thao tác job thất bại')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="workspace-page">
      <div className="workspace-header">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="workspace-title">Thu Thập Dữ Liệu</h2>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${!isSystemUser ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
                {!isSystemUser ? 'PRIVATE CRAWL' : 'GLOBAL CRAWL'}
              </span>
            </div>
            <p className="workspace-subtitle">
              {!isSystemUser
                ? 'Tạo các tác vụ thu thập dữ liệu riêng cho kênh cá nhân của bạn.'
                : 'Quản lý crawler toàn hệ thống, chuẩn hóa canonical content & phân phối tới các kênh eligible.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void loadCrawlData()} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--outline-variant)] bg-white px-3 text-xs font-semibold text-[var(--on-surface)] hover:bg-[var(--surface-container-low)]">
              <RefreshCcw size={14} /> Tải lại
            </button>
            <button onClick={() => setShowCreate(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-xs font-semibold text-white transition-colors hover:bg-[var(--accent-strong)]">
              <Plus size={14} /> Tạo Job Crawl
            </button>
          </div>
        </div>
      </div>

      <section className="min-w-0">
        {message && <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{message}</div>}
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
          
          <Flow />
          
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
          <div key={label} className="bento-card h-[70px] p-3 flex flex-col justify-between">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-[var(--on-surface-variant)]">
              <span className={`h-2 w-2 rounded-full ${marker}`} />
              {label}
            </div>
            <div className="text-xl font-bold leading-6 text-[var(--on-surface)]">{value.toLocaleString('vi-VN')}</div>
          </div>
        ))
      )}
    </div>
  )
}

function Flow() {
  return (
    <div className="bento-card p-4">
      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--on-surface-variant)] mb-3">Data Pipeline Topology</h3>
      <div className="grid gap-2 md:grid-cols-7">
        {stageSteps.map((step, index) => (
          <div key={step} className="rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-lowest)] p-2.5 text-center transition-all hover:border-[var(--accent)]">
            <div className="text-[10px] font-bold font-mono text-[var(--accent)]">{String(index + 1).padStart(2, '0')}</div>
            <div className="mt-1 text-[11px] font-bold text-[var(--on-surface)]">{step}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function JobsTable({
  jobs,
  selectedJob,
  loading,
  onViewLogs,
  onAction,
}: {
  jobs: CrawlJob[]
  selectedJob: CrawlJob | null
  loading?: boolean
  onViewLogs: (job: CrawlJob) => void
  onAction: (action: 'cancel' | 'retry', job: CrawlJob) => void
}) {
  return (
    <div className="bento-card table-scroll overflow-hidden">
      <div className="data-grid-lg">
        <TableHeader columns={['Job', 'Trạng thái', 'Stage', 'Tiến độ', 'Khám phá/Tải/Lỗi/Trùng', 'Hành động']} />
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
            <div key={job.id} onClick={() => onViewLogs(job)} className={`grid cursor-pointer grid-cols-[1.7fr_1fr_1fr_0.8fr_1fr_1.2fr] items-center gap-3 border-t border-[var(--outline-variant)] px-4 py-3 text-xs transition-colors ${selectedJob?.id === job.id ? 'bg-[var(--secondary-container)]/30' : 'hover:bg-[var(--surface-container-low)]'}`}>
              <div>
                <div className="font-semibold text-[var(--on-surface)]">{job.name}</div>
                <div className="mt-1 text-[11px] font-mono text-[var(--on-surface-variant)]">{shortId(job.id)} · {formatDate(job.created_at)}</div>
              </div>
              <Badge value={job.status} />
              <div className="text-[var(--on-surface-variant)] font-medium">{job.current_stage}</div>
              <div className="text-[var(--on-surface)] font-bold">{Number(job.progress_percent).toFixed(0)}%</div>
              <div className="text-[var(--on-surface-variant)] font-mono">{job.total_discovered}/{job.total_normalized}/{job.total_failed}/{job.total_duplicates}</div>
              <div className="flex flex-wrap gap-1">
                <button className="icon-button text-[var(--accent)] hover:bg-[var(--surface-container-low)]" title="Chạy lại" onClick={(event) => { event.stopPropagation(); onAction('retry', job) }}><RotateCcw size={14} /></button>
                <button className="icon-button text-red-600 hover:bg-red-50" title="Dừng job" onClick={(event) => { event.stopPropagation(); onAction('cancel', job) }}><Square size={14} /></button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function CreateDialog(props: any) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6" style={{ backgroundColor: 'rgba(9,20,38,0.5)' }}>
      <div className="w-full max-w-lg rounded-lg border border-[var(--outline-variant)] bg-white p-5 shadow-xl">
        <h3 className="text-lg font-bold text-[#0f172a] mb-5">Tạo Crawl Job</h3>
        <div className="space-y-4">
          <label className="block text-sm font-medium">
            Tên Job
            <input type="text" className="mt-1 w-full rounded-md border p-2 text-sm outline-none" value={props.jobName} onChange={e => props.setJobName(e.target.value)} />
          </label>
          <label className="block text-sm font-medium">
            Nguồn
            <select className="mt-1 w-full rounded-md border p-2 text-sm outline-none" value={props.sourceType} onChange={e => props.setSourceType(e.target.value)}>
              <option value="BILIBILI">Bilibili</option>
              <option value="VNEXPRESS">VNExpress</option>
            </select>
          </label>
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

function JobLogsSheet(props: any) {
  const [activeTab, setActiveTab] = useState<'logs' | 'contents'>('logs')
  const [contents, setContents] = useState<any[]>([])
  const [loadingContents, setLoadingContents] = useState(false)
  
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null)

  useEffect(() => {
    if (!props.open) {
      setActiveTab('logs')
      setContents([])
      setSelectedContentId(null)
    }
  }, [props.open])

  useEffect(() => {
    if (activeTab === 'contents' && props.job) {
      setLoadingContents(true)
      fetchFinalContentViewApi({ crawl_job_id: props.job.id })
        .then((res: any) => {
          setContents(res.normal_items || [])
        })
        .catch(console.error)
        .finally(() => setLoadingContents(false))
    }
  }, [activeTab, props.job])

  return (
    <>
      <Sheet open={props.open} onOpenChange={props.onOpenChange}>
        <SheetTrigger asChild><span className="hidden" /></SheetTrigger>
        <SheetContent side="right" className="w-[calc(100vw-1rem)] max-w-[800px] p-0">
          <div className="detail-shell">
            <div className="detail-header">
              <h3 className="text-base font-bold">Chi tiết Job - {props.job?.name}</h3>
              <p className="mt-1 font-mono text-xs text-slate-500">{props.job ? `ID: ${props.job.id}` : ''}</p>
              
              <div className="mt-3 flex flex-wrap gap-2">
                <button 
                  onClick={() => setActiveTab('logs')} 
                  className={`h-8 rounded-md border px-3 text-xs font-semibold transition-colors ${activeTab === 'logs' ? 'border-[var(--accent)] bg-[var(--secondary-container)] text-[var(--accent-strong)]' : 'border-[#d9e0ea] bg-white text-[#64748b]'}`}
                >
                  Logs Hệ thống
                </button>
                <button 
                  onClick={() => setActiveTab('contents')} 
                  className={`h-8 rounded-md border px-3 text-xs font-semibold transition-colors ${activeTab === 'contents' ? 'border-[var(--accent)] bg-[var(--secondary-container)] text-[var(--accent-strong)]' : 'border-[#d9e0ea] bg-white text-[#64748b]'}`}
                >
                  Nội dung Crawl được
                </button>
              </div>
            </div>

            <div className="detail-body">
              {activeTab === 'logs' ? (
                <div className="space-y-3">
                  {props.logs.map((log: any) => (
                    <div key={log.id} className="rounded-md border bg-white p-3 font-mono text-xs">
                      <div className="text-slate-500 mb-1">{formatDate(log.created_at)} - {log.stage} [{log.level}]</div>
                      <div>{log.message}</div>
                    </div>
                  ))}
                  {props.logs.length === 0 && <div className="empty-state">Chưa có log nào</div>}
                </div>
              ) : (
                <div>
                  {loadingContents ? (
                    <div className="loading-state"><Loader2 className="animate-spin" size={16}/> Đang tải nội dung...</div>
                  ) : contents.length === 0 ? (
                    <div className="empty-state">Chưa có bài nào được crawl thành công</div>
                  ) : (
                    <div className="grid gap-2">
                      {contents.map((item: any) => (
                        <div key={item.id} onClick={() => setSelectedContentId(item.id)} className="flex cursor-pointer gap-3 rounded-md border bg-white p-3 transition-colors hover:bg-slate-50">
                          <div className="h-12 w-[72px] shrink-0 overflow-hidden rounded bg-black">
                            {item.media?.[0] ? (
                              <img src={item.media[0].storage_url || item.media[0].thumbnail_url || item.media[0].source_url} className="w-full h-full object-cover" alt="Preview"/>
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[10px] text-white/50">No media</div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold text-[#0f172a]">{item.canonical_title}</div>
                            <div className="text-xs text-slate-500 mt-1 truncate">{item.summary || item.canonical_url || shortId(item.id)}</div>
                            <div className="mt-2"><Badge value={item.status} /></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ContentDetailDialog 
        contentId={selectedContentId} 
        onClose={() => setSelectedContentId(null)} 
        onOpenModule2={props.onOpenModule2}
      />
    </>
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
    <div className={`grid grid-cols-[1.7fr_1fr_1fr_0.8fr_1fr_1.2fr] gap-3 bg-[#f8fafc] px-3 py-3 text-[11px] font-bold uppercase tracking-wider text-[#64748b]`}>
      {columns.map(c => <div key={c}>{c}</div>)}
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return <div className="empty-state m-3">{label}</div>
}
