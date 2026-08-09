import { useEffect, useMemo, useState } from 'react'
import { Loader2, Play, Plus, RefreshCcw, RotateCcw, Square } from 'lucide-react'
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

export default function CrawlPage({ isSystemUser = false }: { isSystemUser?: boolean }) {
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
    <div className="space-y-6">
      <div className="rounded-xl border border-[#d9e0ea] bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-[#0f172a]">Thu Thập Dữ Liệu</h2>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${!isSystemUser ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
                {!isSystemUser ? 'PRIVATE CRAWL' : 'GLOBAL CRAWL'}
              </span>
            </div>
            <p className="mt-1 text-sm text-[#64748b]">
              {!isSystemUser
                ? 'Tạo các tác vụ thu thập dữ liệu riêng cho kênh cá nhân của bạn.'
                : 'Quản lý crawler toàn hệ thống, chuẩn hóa canonical content & phân phối tới các kênh eligible.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void loadCrawlData()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#d9e0ea] bg-white px-3 text-xs font-semibold text-[#475569] hover:bg-slate-50">
              <RefreshCcw size={14} /> Tải lại
            </button>
            <button onClick={() => setShowCreate(true)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#091426] px-4 text-xs font-bold text-white shadow-sm hover:bg-[#1e293b] transition-colors">
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

        <div className="space-y-6">
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

function Flow() {
  return (
    <div className="rounded-lg border border-[#d9e0ea] bg-white p-5">
      <h3 className="text-base font-bold">Data Pipeline</h3>
      <div className="mt-4 grid gap-3 md:grid-cols-7">
        {stageSteps.map((step, index) => (
          <div key={step} className="rounded-lg border border-[#d9e0ea] bg-[#fbfcfd] p-3 text-center md:text-left">
            <div className="text-[11px] font-bold text-[#091426]">{String(index + 1).padStart(2, '0')}</div>
            <div className="mt-2 text-[10px] sm:text-[11px] font-semibold">{step}</div>
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
      <TableHeader columns={['Job', 'Trạng thái', 'Stage', 'Tiến độ', 'Khám phá/Tải/Lỗi/Trùng', 'Hành động']} />
      {jobs.length === 0 ? <EmptyState label="Chưa có crawl jobs nào" /> : jobs.map((job) => (
        <div key={job.id} onClick={() => onViewLogs(job)} className={`grid cursor-pointer grid-cols-[1.7fr_1fr_1fr_0.8fr_1fr_1.2fr] items-center gap-3 border-t border-[#eef2f7] px-3 py-3 text-xs ${selectedJob?.id === job.id ? 'bg-blue-50/60' : 'bg-white hover:bg-slate-50'}`}>
          <div>
            <div className="font-medium text-[#111827]">{job.name}</div>
            <div className="mt-1 text-[11px] text-[#94a3b8]">{shortId(job.id)} · {formatDate(job.created_at)}</div>
          </div>
          <Badge value={job.status} />
          <div className="text-[#64748b]">{job.current_stage}</div>
          <div className="text-[#64748b] font-medium">{Number(job.progress_percent).toFixed(0)}%</div>
          <div className="text-[#64748b]">{job.total_discovered}/{job.total_normalized}/{job.total_failed}/{job.total_duplicates}</div>
          <div className="flex flex-wrap gap-2">
            <button className="text-[#3525cd] p-1.5 hover:bg-blue-50 rounded" onClick={(event) => { event.stopPropagation(); onAction('retry', job) }}><RotateCcw size={14} /></button>
            <button className="text-red-600 p-1.5 hover:bg-red-50 rounded" onClick={(event) => { event.stopPropagation(); onAction('cancel', job) }}><Square size={14} /></button>
          </div>
        </div>
      ))}
    </div>
  )
}

function CreateDialog(props: any) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6" style={{ backgroundColor: 'rgba(9,20,38,0.5)' }}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-xl font-bold text-[#0f172a] mb-6">Tạo Crawl Job</h3>
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
        <div className="mt-8 flex justify-end gap-3">
          <button onClick={props.onClose} className="px-4 py-2 rounded-lg border text-sm font-medium">Hủy</button>
          <button onClick={props.onSubmit} className="px-4 py-2 rounded-lg bg-[#3525cd] text-white text-sm font-bold shadow-sm hover:bg-[#4f46e5]">Tạo mới</button>
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
        <SheetContent side="right" className="max-w-[800px] sm:w-[800px] w-full p-0">
          <div className="h-full flex flex-col bg-white">
            <div className="p-6 border-b">
              <h3 className="text-xl font-bold">Chi tiết Job - {props.job?.name}</h3>
              <p className="text-sm text-slate-500 mt-1">{props.job ? `ID: ${props.job.id}` : ''}</p>
              
              <div className="mt-4 flex gap-2">
                <button 
                  onClick={() => setActiveTab('logs')} 
                  className={`h-8 rounded-lg border px-4 text-xs font-semibold transition-colors ${activeTab === 'logs' ? 'border-[#091426] bg-[#f8f9ff] text-[#091426]' : 'border-[#d9e0ea] bg-white text-[#64748b]'}`}
                >
                  Logs Hệ thống
                </button>
                <button 
                  onClick={() => setActiveTab('contents')} 
                  className={`h-8 rounded-lg border px-4 text-xs font-semibold transition-colors ${activeTab === 'contents' ? 'border-[#091426] bg-[#f8f9ff] text-[#091426]' : 'border-[#d9e0ea] bg-white text-[#64748b]'}`}
                >
                  Nội dung Crawl được
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-6">
              {activeTab === 'logs' ? (
                <div className="space-y-3">
                  {props.logs.map((log: any) => (
                    <div key={log.id} className="text-xs p-3 rounded bg-slate-50 border font-mono">
                      <div className="text-slate-500 mb-1">{formatDate(log.created_at)} - {log.stage} [{log.level}]</div>
                      <div>{log.message}</div>
                    </div>
                  ))}
                  {props.logs.length === 0 && <div className="text-sm text-slate-500 text-center py-10">Chưa có log nào</div>}
                </div>
              ) : (
                <div>
                  {loadingContents ? (
                    <div className="flex items-center justify-center py-10 text-slate-500"><Loader2 className="animate-spin mr-2" size={16}/> Đang tải nội dung...</div>
                  ) : contents.length === 0 ? (
                    <div className="text-sm text-slate-500 text-center py-10">Chưa có bài nào được crawl thành công</div>
                  ) : (
                    <div className="grid gap-3">
                      {contents.map((item: any) => (
                        <div key={item.id} onClick={() => setSelectedContentId(item.id)} className="cursor-pointer border rounded-lg p-3 hover:bg-slate-50 transition-colors flex gap-4">
                          <div className="w-20 h-14 bg-black rounded shrink-0 overflow-hidden">
                            {item.media?.[0] ? (
                              <img src={item.media[0].storage_url || item.media[0].thumbnail_url || item.media[0].source_url} className="w-full h-full object-cover" alt="Preview"/>
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[10px] text-white/50">No media</div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-sm text-[#0f172a] truncate">{item.canonical_title}</div>
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
  return <div className="p-8 text-center text-sm text-slate-500">{label}</div>
}
