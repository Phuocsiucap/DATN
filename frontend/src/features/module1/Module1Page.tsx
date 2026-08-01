import { useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  CheckCircle2,
  Database,
  FileText,
  Loader2,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  Send,
  Square,
} from 'lucide-react'
import {
  cancelCrawlJobApi,
  createCrawlJobApi,
  fetchContentsApi,
  fetchCrawlJobLogsApi,
  fetchCrawlJobsApi,
  fetchQualityIssuesApi,
  fetchQualitySummaryApi,
  fetchStoriesApi,
  fetchStoryEpisodesApi,
  regroupStoryApi,
  retryCrawlJobApi,
  type ContentItem,
  type CrawlJob,
  type CrawlLog,
  type Episode,
  type QualitySummary,
  type Story,
} from '@/commons/apis/module1'

type Module1Tab = 'crawl' | 'content' | 'stories' | 'quality'
type SourceType = 'BILIBILI' | 'VNEXPRESS'

const tabs: { id: Module1Tab; label: string; icon: React.ElementType }[] = [
  { id: 'crawl', label: 'Crawl Jobs', icon: Play },
  { id: 'content', label: 'Content Library', icon: Database },
  { id: 'stories', label: 'Story Library', icon: BookOpen },
  { id: 'quality', label: 'Quality & Handoff', icon: CheckCircle2 },
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

export default function Module1Page() {
  const [activeTab, setActiveTab] = useState<Module1Tab>('crawl')
  const [jobs, setJobs] = useState<CrawlJob[]>([])
  const [contents, setContents] = useState<ContentItem[]>([])
  const [stories, setStories] = useState<Story[]>([])
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [selectedJob, setSelectedJob] = useState<CrawlJob | null>(null)
  const [selectedStory, setSelectedStory] = useState<Story | null>(null)
  const [logs, setLogs] = useState<CrawlLog[]>([])
  const [quality, setQuality] = useState<QualitySummary | null>(null)
  const [issues, setIssues] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [sourceType, setSourceType] = useState<SourceType>('BILIBILI')
  const [jobName, setJobName] = useState('Bilibili metadata crawl')
  const [sourceUrl, setSourceUrl] = useState('')
  const [keywords, setKeywords] = useState('truyen ma, short drama')
  const [maxItems, setMaxItems] = useState(20)

  const loadAll = async () => {
    setLoading(true)
    setMessage('')
    try {
      const [nextJobs, nextContents, nextStories, nextQuality, nextIssues] = await Promise.all([
        fetchCrawlJobsApi(),
        fetchContentsApi(),
        fetchStoriesApi(),
        fetchQualitySummaryApi(),
        fetchQualityIssuesApi(),
      ])
      setJobs(nextJobs)
      setContents(nextContents)
      setStories(nextStories)
      setQuality(nextQuality)
      setIssues(nextIssues)
      setSelectedJob((current) => current ? nextJobs.find((job) => job.id === current.id) ?? current : nextJobs[0] ?? null)
      setSelectedStory((current) => current ? nextStories.find((story) => story.id === current.id) ?? current : nextStories[0] ?? null)
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể tải dữ liệu Module 1')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAll()
  }, [])

  useEffect(() => {
    if (!selectedJob) {
      setLogs([])
      return
    }
    fetchCrawlJobLogsApi(selectedJob.id).then(setLogs).catch(() => setLogs([]))
  }, [selectedJob])

  useEffect(() => {
    if (!selectedStory) {
      setEpisodes([])
      return
    }
    fetchStoryEpisodesApi(selectedStory.id).then(setEpisodes).catch(() => setEpisodes([]))
  }, [selectedStory])

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

  return (
    <div className="min-h-[calc(100vh-96px)] -m-6 bg-[#f6f8fa] text-[#111827]">
      <div className="border-b border-[#d9e0ea] bg-white px-6 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-bold">Module 1 Operations</h2>
            <p className="mt-1 text-xs text-[#64748b]">Create, monitor, normalize and validate canonical data before Module 2.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void loadAll()} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0ea] bg-white px-3 text-xs font-semibold">
              <RefreshCcw size={14} /> Refresh
            </button>
            <button onClick={() => setShowCreate(true)} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#2563eb] px-3 text-xs font-semibold text-white">
              <Plus size={14} /> New crawl job
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[220px_1fr]">
        <aside className="hidden min-h-[calc(100vh-169px)] bg-[#0f141f] p-3 md:block">
          <div className="mb-6 px-3 py-2 text-[17px] font-bold text-white">SocialContent</div>
          <nav className="space-y-2">
            {tabs.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-[13px] font-medium ${isActive ? 'bg-[#1c2e47] text-white' : 'text-[#b8c7db] hover:bg-[#162235]'}`}
                >
                  <Icon size={15} />
                  {tab.label}
                </button>
              )
            })}
          </nav>
        </aside>

        <section className="min-w-0 p-6">
          {message && <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{message}</div>}
          {loading && (
            <div className="mb-4 flex items-center gap-2 text-sm text-[#64748b]">
              <Loader2 className="animate-spin" size={16} /> Loading Module 1 data
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
              <JobsTable jobs={jobs} selectedJob={selectedJob} onSelect={setSelectedJob} onAction={jobAction} />
              <JobTrace job={selectedJob} logs={logs} />
            </div>
          )}

          {activeTab === 'content' && <ContentLibrary contents={contents} />}
          {activeTab === 'stories' && <StoryLibrary stories={stories} selectedStory={selectedStory} episodes={episodes} onSelect={setSelectedStory} onRegroup={(story) => regroupStoryApi(story.id).then(loadAll)} />}
          {activeTab === 'quality' && <QualityHandoff quality={quality} issues={issues} />}
        </section>
      </div>

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

function JobsTable({ jobs, selectedJob, onSelect, onAction }: { jobs: CrawlJob[]; selectedJob: CrawlJob | null; onSelect: (job: CrawlJob) => void; onAction: (action: 'cancel' | 'retry', job: CrawlJob) => void }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#d9e0ea] bg-white">
      <TableHeader columns={['Job', 'Status', 'Stage', 'Progress', 'C/N/F/D', 'Actions']} />
      {jobs.length === 0 ? <EmptyState label="No crawl jobs yet" /> : jobs.map((job) => (
        <div key={job.id} onClick={() => onSelect(job)} className={`grid cursor-pointer grid-cols-[1.7fr_1fr_1fr_0.8fr_1fr_1.2fr] items-center gap-3 border-t border-[#eef2f7] px-3 py-3 text-xs ${selectedJob?.id === job.id ? 'bg-blue-50/60' : 'bg-white'}`}>
          <div>
            <div className="font-medium text-[#111827]">{job.name}</div>
            <div className="mt-1 text-[11px] text-[#94a3b8]">{shortId(job.id)} · {formatDate(job.created_at)}</div>
          </div>
          <Badge value={job.status} />
          <div className="text-[#64748b]">{job.current_stage}</div>
          <div className="text-[#64748b]">{Number(job.progress_percent).toFixed(0)}%</div>
          <div className="text-[#64748b]">{job.total_crawled}/{job.total_normalized}/{job.total_failed}/{job.total_duplicates}</div>
          <div className="flex flex-wrap gap-2">
            <button className="text-[#2563eb]" onClick={(event) => { event.stopPropagation(); onSelect(job) }}>View</button>
            <button className="text-[#2563eb]" onClick={(event) => { event.stopPropagation(); onAction('retry', job) }}><RotateCcw size={13} /></button>
            <button className="text-red-600" onClick={(event) => { event.stopPropagation(); onAction('cancel', job) }}><Square size={13} /></button>
          </div>
        </div>
      ))}
    </div>
  )
}

function JobTrace({ job, logs }: { job: CrawlJob | null; logs: CrawlLog[] }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
      <div className="rounded-lg border border-[#d9e0ea] bg-white p-5">
        <h3 className="text-base font-bold">Raw to canonical trace</h3>
        <div className="mt-4 overflow-hidden rounded-lg border border-[#d9e0ea]">
          <TableHeader columns={['Layer', 'Store', 'Important fields']} />
          {[
            ['Raw', 'MongoDB', 'metadata_only, raw JSON, source payload, crawler timestamp'],
            ['Processed', 'MongoDB', 'normalized title, quality score, validation warnings'],
            ['Canonical', 'PostgreSQL', 'content_items, content_sources, stories, episodes, media'],
          ].map((row) => <div key={row[0]} className="grid grid-cols-[160px_170px_1fr] border-t border-[#eef2f7] px-3 py-3 text-xs"><span className="font-medium">{row[0]}</span><span className="text-[#64748b]">{row[1]}</span><span className="text-[#64748b]">{row[2]}</span></div>)}
        </div>
      </div>
      <div className="rounded-lg border border-[#d9e0ea] bg-white p-5">
        <h3 className="text-base font-bold">Recent logs</h3>
        <p className="mt-1 text-xs text-[#64748b]">{job ? job.name : 'Select a job'}</p>
        <div className="mt-4 space-y-3 text-xs">
          {logs.length === 0 ? <EmptyState label="No logs for selected job" compact /> : logs.slice(0, 6).map((log) => (
            <div key={log.id} className="border-l-2 border-[#2563eb] pl-3">
              <div className="font-semibold">{log.stage} · {log.level}</div>
              <div className="mt-1 text-[#64748b]">{log.message}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ContentLibrary({ contents }: { contents: ContentItem[] }) {
  return (
    <Panel title="Content library" subtitle="Canonical content_items from Module 1">
      <TableHeader columns={['Title', 'Type', 'Status', 'Language', 'Quality', 'Created']} />
      {contents.length === 0 ? <EmptyState label="No canonical content yet" /> : contents.map((item) => (
        <div key={item.id} className="grid grid-cols-[2fr_0.8fr_1fr_0.7fr_0.7fr_1fr] gap-3 border-t border-[#eef2f7] px-3 py-3 text-xs">
          <div className="min-w-0"><div className="truncate font-medium">{item.canonical_title}</div><div className="truncate text-[#94a3b8]">{item.summary || item.canonical_url || shortId(item.id)}</div></div>
          <div className="text-[#64748b]">{item.content_type}</div>
          <Badge value={item.status} />
          <div className="text-[#64748b]">{item.language}</div>
          <div className="text-[#64748b]">{Number(item.quality_score).toFixed(0)}</div>
          <div className="text-[#64748b]">{formatDate(item.created_at)}</div>
        </div>
      ))}
    </Panel>
  )
}

function StoryLibrary({ stories, selectedStory, episodes, onSelect, onRegroup }: { stories: Story[]; selectedStory: Story | null; episodes: Episode[]; onSelect: (story: Story) => void; onRegroup: (story: Story) => void }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-5 xl:grid-cols-[1fr_376px]">
        <Panel title="Story library" subtitle="Canonical stories and completion state">
          <TableHeader columns={['Story', 'Episodes', 'Status', 'Confidence', 'Ready']} />
          {stories.length === 0 ? <EmptyState label="No stories yet" /> : stories.map((story) => (
            <div key={story.id} onClick={() => onSelect(story)} className={`grid cursor-pointer grid-cols-[2fr_0.7fr_1.2fr_0.8fr_0.7fr] gap-3 border-t border-[#eef2f7] px-3 py-3 text-xs ${selectedStory?.id === story.id ? 'bg-blue-50/60' : ''}`}>
              <div className="font-medium">{story.canonical_name}</div>
              <div className="text-[#64748b]">{story.total_episodes}</div>
              <Badge value={story.completion_status} />
              <div className="text-[#64748b]">{Number(story.grouping_confidence).toFixed(0)}</div>
              <div className="text-[#64748b]">{story.completion_status === 'COMPLETE' ? 'Yes' : 'Review'}</div>
            </div>
          ))}
        </Panel>
        <div className="rounded-lg border border-[#d9e0ea] bg-white p-5">
          <h3 className="text-xl font-bold">{selectedStory?.canonical_name || 'Story detail'}</h3>
          <p className="mt-1 text-xs text-[#64748b]">{selectedStory ? `${selectedStory.language} · ${shortId(selectedStory.id)}` : 'Select a story'}</p>
          {selectedStory && <div className="mt-4 flex flex-wrap gap-2"><Badge value={selectedStory.completion_status} /><FilterPill>{selectedStory.total_episodes} episodes</FilterPill></div>}
          <p className="mt-5 text-sm leading-6 text-[#64748b]">Episode list stays structured so Module 2 can plan series without parsing free-form text.</p>
          {selectedStory && <button onClick={() => onRegroup(selectedStory)} className="mt-5 inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0ea] px-3 text-xs font-semibold"><RefreshCcw size={14} /> Regroup</button>}
        </div>
      </div>
      <Panel title="Episodes" subtitle="Ordered episode metadata">
        <TableHeader columns={['No', 'Episode title', 'Duration', 'State']} />
        {episodes.length === 0 ? <EmptyState label="No episodes for selected story" /> : episodes.map((episode, index) => (
          <div key={episode.id} className="grid grid-cols-[80px_1fr_120px_160px] gap-3 border-t border-[#eef2f7] px-3 py-3 text-xs">
            <div>{episode.episode_number ?? episode.sequence_order ?? index + 1}</div>
            <div className="font-medium">{episode.episode_title || 'Untitled episode'}</div>
            <div className="text-[#64748b]">{episode.duration_seconds ? `${episode.duration_seconds}s` : '-'}</div>
            <div className="text-[#64748b]">{episode.is_missing ? 'Missing detected' : 'Found'}</div>
          </div>
        ))}
      </Panel>
    </div>
  )
}

function QualityHandoff({ quality, issues }: { quality: QualitySummary | null; issues: any }) {
  const lowQualityCount = issues?.low_quality_content?.length ?? 0
  return (
    <div className="space-y-6">
      <MetricGrid items={[
        ['Ready stories', quality?.ready ?? 0, 'bg-emerald-500'],
        ['Needs review', quality?.needs_review ?? 0, 'bg-amber-500'],
        ['Failed tasks', quality?.failed_tasks ?? 0, 'bg-red-500'],
        ['Low quality', lowQualityCount, 'bg-slate-500'],
      ]} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Quality issues" subtitle="Review before planner handoff">
          <TableHeader columns={['Issue', 'Source', 'Count', 'Action']} />
          {[
            ['Low quality content', 'CANONICAL', lowQualityCount, 'Review'],
            ['Failed crawl tasks', 'PIPELINE', quality?.failed_tasks ?? 0, 'Retry job'],
            ['Needs review', 'CANONICAL', quality?.needs_review ?? 0, 'Fix metadata'],
          ].map((row) => <div key={row[0]} className="grid grid-cols-[1.4fr_1fr_0.6fr_1fr] gap-3 border-t border-[#eef2f7] px-3 py-3 text-xs"><span className="font-medium">{row[0]}</span><span className="text-[#64748b]">{row[1]}</span><span className="text-[#64748b]">{row[2]}</span><span className="text-[#2563eb]">{row[3]}</span></div>)}
        </Panel>
        <Panel title="Module 2 handoff" subtitle="Final checkpoint before AI planning">
          <TableHeader columns={['Check', 'State', 'Reason']} />
          {[
            ['Job terminal', 'Passed', 'No RUNNING or QUEUED tasks in selected dataset'],
            ['Canonical content exists', 'Passed', 'content_items, content_sources, stories, episodes available'],
            ['Quality threshold', 'Review', 'Low score items must be fixed or excluded'],
            ['Module 1 boundary', 'Passed', 'No script or video generation in this module'],
          ].map((row) => <div key={row[0]} className="grid grid-cols-[1fr_0.7fr_2fr] gap-3 border-t border-[#eef2f7] px-3 py-3 text-xs"><span className="font-medium">{row[0]}</span><span className="text-[#64748b]">{row[1]}</span><span className="text-[#64748b]">{row[2]}</span></div>)}
          <button className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-[#2563eb] px-4 text-xs font-semibold text-white" disabled>
            <Send size={14} /> Send to Module 2
          </button>
        </Panel>
      </div>
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
