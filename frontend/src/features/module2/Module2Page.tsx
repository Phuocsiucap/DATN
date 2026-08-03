import { useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  CheckCircle2,
  Clock3,
  FileText,
  GitBranch,
  Layers3,
  Loader2,
  Plus,
  RefreshCcw,
  Sparkles,
  XCircle,
} from 'lucide-react'
import {
  approveContentPlanApi,
  createAutoModule2HandoffFromCrawlApi,
  createModule3HandoffApi,
  createModule2HandoffApi,
  createPlanningJobApi,
  fetchContentPlansApi,
  fetchContentSeriesApi,
  fetchModule2HandoffsApi,
  fetchPlanningJobsApi,
  fetchSeriesConsistencyApi,
  fetchSeriesContextApi,
  fetchSeriesPartsApi,
  rebuildSeriesContextApi,
  regenerateContentPlanApi,
  regenerateContentSeriesApi,
  rejectContentPlanApi,
  type ConsistencyCheck,
  type ContentPlan,
  type ContentSeries,
  type Module2Handoff,
  type PlanningJob,
  type SeriesPart,
  type SeriesContextResponse,
} from '@/commons/apis/planning'
import { fetchSocialProfilesApi, fetchSocialProfileStrategyApi } from '@/commons/apis/socialProfiles'
import { fetchCrawlJobsApi, fetchFinalContentViewApi, fetchStoriesApi, type CrawlJob, type FinalContentView, type Story } from '@/commons/apis/module1'

type Profile = {
  id: string
  platform: string
  profile_name: string
  username?: string | null
  status: string
}

type Strategy = {
  content_topics?: string
  avoid_topics?: string
  tone?: string
  target_audience?: string
  risk_level?: string
  min_score?: number
}

type Module2Tab = 'jobs' | 'plans' | 'series' | 'context'

const tabs: { id: Module2Tab; label: string; icon: React.ElementType }[] = [
  { id: 'jobs', label: 'Planning Jobs', icon: Sparkles },
  { id: 'plans', label: 'Plan Review', icon: FileText },
  { id: 'series', label: 'Series Builder', icon: GitBranch },
  { id: 'context', label: 'Context Manager', icon: Layers3 },
]

const tone: Record<string, string> = {
  QUEUED: 'border-blue-200 bg-blue-50 text-blue-700',
  RUNNING: 'border-blue-200 bg-blue-50 text-blue-700',
  WAITING_REVIEW: 'border-amber-200 bg-amber-50 text-amber-700',
  SUCCEEDED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  GENERATED: 'border-blue-200 bg-blue-50 text-blue-700',
  DRAFT: 'border-slate-200 bg-slate-50 text-slate-700',
  NEEDS_REVIEW: 'border-amber-200 bg-amber-50 text-amber-700',
  REJECTED: 'border-red-200 bg-red-50 text-red-700',
  FAILED: 'border-red-200 bg-red-50 text-red-700',
}

const formatDate = (value?: string) => value ? new Date(value).toLocaleString('vi-VN') : '-'
const shortId = (value: string) => value.slice(0, 8)

export default function Module2Page() {
  const [activeTab, setActiveTab] = useState<Module2Tab>('jobs')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [crawlJobs, setCrawlJobs] = useState<CrawlJob[]>([])
  const [stories, setStories] = useState<Story[]>([])
  const [finalContent, setFinalContent] = useState<FinalContentView>({ normal_items: [], series_items: [] })
  const [handoffs, setHandoffs] = useState<Module2Handoff[]>([])
  const [jobs, setJobs] = useState<PlanningJob[]>([])
  const [plans, setPlans] = useState<ContentPlan[]>([])
  const [series, setSeries] = useState<ContentSeries[]>([])
  const [parts, setParts] = useState<SeriesPart[]>([])
  const [seriesContext, setSeriesContext] = useState<SeriesContextResponse | null>(null)
  const [consistency, setConsistency] = useState<ConsistencyCheck | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [selectedCrawlJobId, setSelectedCrawlJobId] = useState('')
  const [selectedStoryIds, setSelectedStoryIds] = useState<string[]>([])
  const [selectedContentIds, setSelectedContentIds] = useState<string[]>([])
  const [selectedPlan, setSelectedPlan] = useState<ContentPlan | null>(null)
  const [selectedSeries, setSelectedSeries] = useState<ContentSeries | null>(null)
  const [strategy, setStrategy] = useState<Strategy | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [showWizard, setShowWizard] = useState(false)
  const [planningMode, setPlanningMode] = useState<'AUTO' | 'SINGLE' | 'SERIES'>('SERIES')
  const [duration, setDuration] = useState(60)
  const [partCount, setPartCount] = useState(8)
  const [instructions, setInstructions] = useState('Kể nhanh, giữ suspense, tránh nội dung quá bạo lực')

  const loadAll = async () => {
    setLoading(true)
    setMessage('')
    try {
      const [nextProfiles, nextCrawlJobs, nextStories, nextHandoffs, nextJobs, nextPlans, nextSeries] = await Promise.all([
        fetchSocialProfilesApi(),
        fetchCrawlJobsApi(),
        fetchStoriesApi(),
        fetchModule2HandoffsApi(),
        fetchPlanningJobsApi(),
        fetchContentPlansApi(),
        fetchContentSeriesApi(),
      ])
      const profileItems = nextProfiles.items || nextProfiles
      const currentCrawlJobId = selectedCrawlJobId || nextCrawlJobs[0]?.id || ''
      const nextFinalContent = await fetchFinalContentViewApi(currentCrawlJobId ? { crawl_job_id: currentCrawlJobId } : undefined)
      setProfiles(profileItems)
      setCrawlJobs(nextCrawlJobs)
      setStories(nextStories)
      setFinalContent(nextFinalContent)
      setHandoffs(nextHandoffs)
      setJobs(nextJobs)
      setPlans(nextPlans)
      setSeries(nextSeries)
      setSelectedProfileId((current) => current || profileItems[0]?.id || '')
      setSelectedCrawlJobId((current) => current || currentCrawlJobId)
      setSelectedPlan((current) => current ? nextPlans.find((plan) => plan.id === current.id) ?? current : nextPlans[0] ?? null)
      setSelectedSeries((current) => current ? nextSeries.find((item) => item.id === current.id) ?? current : nextSeries[0] ?? null)
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể tải dữ liệu Module 2')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAll()
  }, [])

  useEffect(() => {
    if (!selectedCrawlJobId) {
      setFinalContent({ normal_items: [], series_items: [] })
      return
    }
    fetchFinalContentViewApi({ crawl_job_id: selectedCrawlJobId }).then((nextFinalContent) => {
      setFinalContent(nextFinalContent)
      setSelectedContentIds((current) => {
        const validIds = new Set([...nextFinalContent.normal_items, ...nextFinalContent.series_items].map((item) => item.id))
        return current.filter((id) => validIds.has(id))
      })
      setSelectedStoryIds((current) => {
        const validIds = new Set(nextFinalContent.series_items.map((item) => item.series?.id).filter(Boolean))
        return current.filter((id) => validIds.has(id))
      })
    }).catch(() => setFinalContent({ normal_items: [], series_items: [] }))
  }, [selectedCrawlJobId])

  useEffect(() => {
    if (!selectedProfileId) {
      setStrategy(null)
      return
    }
    fetchSocialProfileStrategyApi(selectedProfileId).then(setStrategy).catch(() => setStrategy(null))
  }, [selectedProfileId])

  useEffect(() => {
    if (!selectedSeries) {
      setParts([])
      setSeriesContext(null)
      setConsistency(null)
      return
    }
    Promise.all([
      fetchSeriesPartsApi(selectedSeries.id),
      fetchSeriesContextApi(selectedSeries.id),
      fetchSeriesConsistencyApi(selectedSeries.id),
    ]).then(([nextParts, nextContext, nextConsistency]) => {
      setParts(nextParts)
      setSeriesContext(nextContext)
      setConsistency(nextConsistency)
    }).catch(() => {
      setParts([])
      setSeriesContext(null)
      setConsistency(null)
    })
  }, [selectedSeries])

  const metrics = useMemo(() => {
    return {
      totalPlans: plans.length,
      running: jobs.filter((job) => ['PENDING', 'QUEUED', 'RUNNING'].includes(job.status)).length,
      waitingReview: plans.filter((plan) => ['GENERATED', 'NEEDS_REVIEW'].includes(plan.status)).length,
      approved: plans.filter((plan) => plan.status === 'APPROVED').length,
    }
  }, [jobs, plans])

  const createPlan = async () => {
    if (!selectedProfileId) {
      setMessage('Hãy chọn một social profile trước.')
      return
    }
    setLoading(true)
    setMessage('')
    try {
      if (selectedStoryIds.length > 0 || selectedContentIds.length > 0) {
        const handoff = await createModule2HandoffApi({
          profile_id: selectedProfileId,
          story_ids: selectedStoryIds,
          content_ids: selectedContentIds,
          episode_ids: [],
          crawl_job_id: selectedCrawlJobId || null,
          selection_mode: 'MANUAL',
          candidate_limit: 20,
          handoff_note: 'Manual dataset from Module 2 planning wizard',
          filters: {
            source_crawl_job_id: selectedCrawlJobId || null,
            content_types: ['STORY', 'ARTICLE', 'PLAYLIST'],
            min_quality_score: strategy?.min_score ?? 70,
            languages: ['vi'],
          },
        })
        await createPlanningJobApi({
          profile_id: selectedProfileId,
          handoff_id: handoff.id,
          planning_mode: planningMode,
          target_duration_seconds: duration,
          preferred_part_count: planningMode === 'SERIES' ? partCount : null,
          language: 'vi',
          instructions,
        })
      } else if (selectedCrawlJobId) {
        await createAutoModule2HandoffFromCrawlApi({
          profile_id: selectedProfileId,
          crawl_job_id: selectedCrawlJobId,
          candidate_limit: 20,
          max_related_items_per_primary: 5,
          min_quality_score: strategy?.min_score ?? 70,
          create_planning_job: true,
          planning_mode: planningMode,
          target_duration_seconds: duration,
          preferred_part_count: planningMode === 'SERIES' ? partCount : null,
          language: 'vi',
          instructions,
        })
      } else {
        setMessage('Hãy chọn nội dung thủ công hoặc chọn một crawl job để tạo auto dataset.')
        return
      }
      setShowWizard(false)
      await loadAll()
      setActiveTab('jobs')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể tạo planning job')
    } finally {
      setLoading(false)
    }
  }

  const reviewPlan = async (plan: ContentPlan, action: 'approve' | 'reject') => {
    setLoading(true)
    try {
      await (action === 'approve' ? approveContentPlanApi(plan.id, 'Approved from Module 2 UI') : rejectContentPlanApi(plan.id, 'Rejected from Module 2 UI'))
      await loadAll()
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể cập nhật trạng thái plan')
    } finally {
      setLoading(false)
    }
  }

  const regeneratePlan = async (plan: ContentPlan) => {
    setLoading(true)
    try {
      await regenerateContentPlanApi(plan.id, 'Regenerated from Module 2 UI')
      await loadAll()
      setActiveTab('jobs')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể regenerate plan')
    } finally {
      setLoading(false)
    }
  }

  const regenerateSeries = async (item: ContentSeries) => {
    setLoading(true)
    try {
      await regenerateContentSeriesApi(item.id, 'Regenerated from Module 2 series builder')
      await loadAll()
      setActiveTab('jobs')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể regenerate series')
    } finally {
      setLoading(false)
    }
  }

  const rebuildContext = async (item: ContentSeries) => {
    setLoading(true)
    try {
      await rebuildSeriesContextApi(item.id)
      const [nextContext, nextConsistency] = await Promise.all([
        fetchSeriesContextApi(item.id),
        fetchSeriesConsistencyApi(item.id),
      ])
      setSeriesContext(nextContext)
      setConsistency(nextConsistency)
      await loadAll()
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể rebuild context')
    } finally {
      setLoading(false)
    }
  }

  const handoffToModule3 = async (item: ContentSeries) => {
    setLoading(true)
    try {
      await createModule3HandoffApi({
        content_series_id: item.id,
        part_ids: parts.map((part) => part.id),
        priority: 5,
        handoff_note: 'Created from Module 2 UI',
      })
      await loadAll()
      setMessage('Đã tạo handoff sang Module 3.')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể tạo handoff sang Module 3')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[calc(100vh-96px)] -m-6 bg-[#f6f8fa] text-[#111827]">
      <div className="border-b border-[#d9e0ea] bg-white px-6 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-bold">Module 2 AI Planner</h2>
            <p className="mt-1 text-xs text-[#64748b]">Turn canonical content and profile strategy into structured plans, series parts and context.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void loadAll()} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0ea] bg-white px-3 text-xs font-semibold">
              <RefreshCcw size={14} /> Refresh
            </button>
            <button onClick={() => setShowWizard(true)} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#2563eb] px-3 text-xs font-semibold text-white">
              <Plus size={14} /> Create plan
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[220px_1fr]">
        <aside className="hidden min-h-[calc(100vh-169px)] bg-[#0f141f] p-3 md:block">
          <div className="mb-6 px-3 py-2 text-[17px] font-bold text-white">AI Planning</div>
          <nav className="space-y-2">
            {tabs.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-[13px] font-medium ${isActive ? 'bg-[#1c2e47] text-white' : 'text-[#b8c7db] hover:bg-[#162235]'}`}>
                  <Icon size={15} /> {tab.label}
                </button>
              )
            })}
          </nav>
        </aside>

        <section className="min-w-0 p-6">
          {message && <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{message}</div>}
          {loading && <div className="mb-4 flex items-center gap-2 text-sm text-[#64748b]"><Loader2 className="animate-spin" size={16} /> Loading Module 2 data</div>}

          <MetricGrid items={[
            ['Total plans', metrics.totalPlans, 'bg-blue-500'],
            ['Running jobs', metrics.running, 'bg-sky-500'],
            ['Waiting review', metrics.waitingReview, 'bg-amber-500'],
            ['Approved', metrics.approved, 'bg-emerald-500'],
          ]} />

          <div className="mt-6">
            {activeTab === 'jobs' && <JobsView jobs={jobs} handoffs={handoffs} />}
            {activeTab === 'plans' && <PlansView plans={plans} selectedPlan={selectedPlan} onSelect={setSelectedPlan} onReview={reviewPlan} onRegenerate={regeneratePlan} />}
            {activeTab === 'series' && <SeriesView series={series} selectedSeries={selectedSeries} parts={parts} onSelect={setSelectedSeries} onRegenerate={regenerateSeries} onHandoff={handoffToModule3} />}
            {activeTab === 'context' && <ContextView selectedSeries={selectedSeries} parts={parts} selectedPlan={selectedPlan} context={seriesContext} consistency={consistency} onRebuild={rebuildContext} />}
          </div>
        </section>
      </div>

      {showWizard && (
        <PlanWizard
          profiles={profiles}
          crawlJobs={crawlJobs}
          stories={stories}
          finalContent={finalContent}
          strategy={strategy}
          selectedProfileId={selectedProfileId}
          setSelectedProfileId={setSelectedProfileId}
          selectedCrawlJobId={selectedCrawlJobId}
          setSelectedCrawlJobId={setSelectedCrawlJobId}
          selectedStoryIds={selectedStoryIds}
          setSelectedStoryIds={setSelectedStoryIds}
          selectedContentIds={selectedContentIds}
          setSelectedContentIds={setSelectedContentIds}
          planningMode={planningMode}
          setPlanningMode={setPlanningMode}
          duration={duration}
          setDuration={setDuration}
          partCount={partCount}
          setPartCount={setPartCount}
          instructions={instructions}
          setInstructions={setInstructions}
          onClose={() => setShowWizard(false)}
          onSubmit={() => void createPlan()}
        />
      )}
    </div>
  )
}

function JobsView({ jobs, handoffs }: { jobs: PlanningJob[]; handoffs: Module2Handoff[] }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <Panel title="Planning jobs" subtitle="Pipeline progress from handoff to structured plan">
        <TableHeader columns={['Job', 'Mode', 'Status', 'Stage', 'Progress', 'Created']} />
        {jobs.length === 0 ? <Empty label="No planning jobs yet" /> : jobs.map((job) => (
          <div key={job.id} className="grid grid-cols-[1.2fr_0.7fr_0.9fr_1.4fr_0.7fr_1fr] gap-3 border-t border-[#eef2f7] px-3 py-3 text-xs">
            <div className="font-medium">{shortId(job.id)}<div className="mt-1 text-[11px] text-[#94a3b8]">handoff {shortId(job.handoff_id)}</div></div>
            <div className="text-[#64748b]">{job.planning_mode}</div>
            <Badge value={job.status} />
            <div className="text-[#64748b]">{job.current_stage}</div>
            <div className="text-[#64748b]">{Number(job.progress_percent).toFixed(0)}%</div>
            <div className="text-[#64748b]">{formatDate(job.created_at)}</div>
          </div>
        ))}
      </Panel>
      <Panel title="Recent datasets" subtitle="Profile-scoped handoffs ready for planning">
        <TableHeader columns={['Dataset', 'Source', 'Items']} />
        {handoffs.length === 0 ? <Empty label="No handoffs yet" /> : handoffs.slice(0, 8).map((handoff) => (
          <div key={handoff.id} className="grid grid-cols-[1fr_0.8fr_0.6fr] gap-3 border-t border-[#eef2f7] px-3 py-3 text-xs">
            <div className="font-medium">{shortId(handoff.id)}<div className="mt-1 text-[11px] text-[#94a3b8]">{shortId(handoff.profile_id)}</div></div>
            <Badge value={handoff.selection_mode} />
            <div className="text-[#64748b]">{handoff.eligible_count}/{handoff.rejected_count}</div>
          </div>
        ))}
      </Panel>
    </div>
  )
}

function PlansView({ plans, selectedPlan, onSelect, onReview, onRegenerate }: { plans: ContentPlan[]; selectedPlan: ContentPlan | null; onSelect: (plan: ContentPlan) => void; onReview: (plan: ContentPlan, action: 'approve' | 'reject') => void; onRegenerate: (plan: ContentPlan) => void }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
      <Panel title="Content plans" subtitle="Structured AI output, not free text">
        <TableHeader columns={['Plan', 'Mode', 'Confidence', 'Status', 'Version']} />
        {plans.length === 0 ? <Empty label="No generated plans yet" /> : plans.map((plan) => (
          <div key={plan.id} onClick={() => onSelect(plan)} className={`grid cursor-pointer grid-cols-[2fr_0.8fr_0.8fr_0.9fr_0.6fr] gap-3 border-t border-[#eef2f7] px-3 py-3 text-xs ${selectedPlan?.id === plan.id ? 'bg-blue-50/60' : ''}`}>
            <div className="font-medium">{plan.title}<div className="mt-1 truncate text-[11px] text-[#94a3b8]">{plan.content_angle || shortId(plan.id)}</div></div>
            <div className="text-[#64748b]">{plan.planning_mode}</div>
            <div className="text-[#64748b]">{Number(plan.confidence_score).toFixed(0)}</div>
            <Badge value={plan.status} />
            <div className="text-[#64748b]">v{plan.version}</div>
          </div>
        ))}
      </Panel>
      <div className="rounded-lg border border-[#d9e0ea] bg-white p-5">
        <h3 className="text-base font-bold">Plan review</h3>
        {!selectedPlan ? <Empty label="Select a plan" compact /> : (
          <div className="mt-4 space-y-4 text-sm">
            <div><div className="text-xs font-semibold text-[#64748b]">Title</div><div className="mt-1 font-semibold">{selectedPlan.title}</div></div>
            <div><div className="text-xs font-semibold text-[#64748b]">Angle</div><div className="mt-1 text-[#475569]">{selectedPlan.content_angle || '-'}</div></div>
            <div className="grid grid-cols-2 gap-3">
              <Info label="Audience" value={selectedPlan.target_audience || '-'} />
              <Info label="Tone" value={selectedPlan.tone || '-'} />
              <Info label="Format" value={selectedPlan.format || '-'} />
              <Info label="Parts" value={String(selectedPlan.recommended_part_count ?? '-')} />
            </div>
            <div>
              <div className="text-xs font-semibold text-[#64748b]">AI reasoning</div>
              <ul className="mt-2 space-y-2 text-xs text-[#475569]">
                {(selectedPlan.ai_reasoning || []).slice(0, 4).map((item, index) => <li key={`${item}-${index}`}>• {String(item)}</li>)}
                {selectedPlan.ai_reasoning.length === 0 && <li>No reasoning logged yet.</li>}
              </ul>
            </div>
            <div className="flex gap-2">
              <button onClick={() => onReview(selectedPlan, 'approve')} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#2563eb] px-3 text-xs font-semibold text-white"><CheckCircle2 size={14} /> Approve</button>
              <button onClick={() => onReview(selectedPlan, 'reject')} className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700"><XCircle size={14} /> Reject</button>
              <button onClick={() => onRegenerate(selectedPlan)} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0ea] px-3 text-xs font-semibold"><RefreshCcw size={14} /> Regenerate</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SeriesView({ series, selectedSeries, parts, onSelect, onRegenerate, onHandoff }: { series: ContentSeries[]; selectedSeries: ContentSeries | null; parts: SeriesPart[]; onSelect: (series: ContentSeries) => void; onRegenerate: (series: ContentSeries) => void; onHandoff: (series: ContentSeries) => void }) {
  return (
    <div className="space-y-5">
      <Panel title="Content series" subtitle="Ordered plan groups for Module 3">
        <TableHeader columns={['Series', 'Type', 'Parts', 'Current', 'Status']} />
        {series.length === 0 ? <Empty label="No series generated yet" /> : series.map((item) => (
          <div key={item.id} onClick={() => onSelect(item)} className={`grid cursor-pointer grid-cols-[2fr_0.9fr_0.7fr_0.7fr_0.9fr] gap-3 border-t border-[#eef2f7] px-3 py-3 text-xs ${selectedSeries?.id === item.id ? 'bg-blue-50/60' : ''}`}>
            <div className="font-medium">{item.title}<div className="mt-1 truncate text-[11px] text-[#94a3b8]">{item.description || shortId(item.id)}</div></div>
            <div className="text-[#64748b]">{item.series_type}</div>
            <div className="text-[#64748b]">{item.total_parts}</div>
            <div className="text-[#64748b]">{item.current_part}</div>
            <Badge value={item.status} />
          </div>
        ))}
      </Panel>
      <Panel title="Series parts" subtitle="Part timeline with hook, beats and handoff readiness">
        {selectedSeries && (
          <div className="flex flex-wrap justify-end gap-2 px-4 pb-2">
            <button onClick={() => onRegenerate(selectedSeries)} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0ea] px-3 text-xs font-semibold"><RefreshCcw size={14} /> Regenerate series</button>
            <button onClick={() => onHandoff(selectedSeries)} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#2563eb] px-3 text-xs font-semibold text-white"><Sparkles size={14} /> Handoff Module 3</button>
          </div>
        )}
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
          {parts.length === 0 ? <div className="col-span-full"><Empty label="No parts for selected series" compact /></div> : parts.map((part) => (
            <div key={part.id} className="min-h-[170px] rounded-lg border border-[#d9e0ea] bg-[#fbfcfd] p-4">
              <div className="flex items-center justify-between gap-2"><span className="text-[11px] font-bold text-[#2563eb]">PART {part.part_number}</span><Badge value={part.status} /></div>
              <div className="mt-3 text-sm font-bold">{part.title}</div>
              <p className="mt-2 line-clamp-2 text-xs text-[#64748b]">{part.goal || 'No goal yet'}</p>
              <div className="mt-3 text-[11px] font-semibold text-[#64748b]">Hook</div>
              <p className="mt-1 line-clamp-2 text-xs text-[#475569]">{part.hook_direction || '-'}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}

function ContextView({ selectedSeries, parts, selectedPlan, context, consistency, onRebuild }: { selectedSeries: ContentSeries | null; parts: SeriesPart[]; selectedPlan: ContentPlan | null; context: SeriesContextResponse | null; consistency: ConsistencyCheck | null; onRebuild: (series: ContentSeries) => void }) {
  const covered = parts.filter((part) => part.status !== 'DRAFT').length
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
      <Panel title="Context snapshot" subtitle="Continuity context prepared for Module 3">
        {selectedSeries && (
          <div className="flex justify-end px-4 pb-2">
            <button onClick={() => onRebuild(selectedSeries)} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0ea] px-3 text-xs font-semibold"><RefreshCcw size={14} /> Rebuild context</button>
          </div>
        )}
        <div className="grid gap-3 p-4 md:grid-cols-3">
          <ContextCard label="Story summary" value={selectedPlan?.content_angle || 'Waiting for AI planner output'} />
          <ContextCard label="Context rows" value={`${context?.contexts?.length ?? 0} active context records`} />
          <ContextCard label="Timeline" value={`${covered}/${parts.length} parts have narrative coverage`} />
        </div>
      </Panel>
      <Panel title="Consistency warnings" subtitle="Checks that prevent repeated or out-of-order storytelling">
        <div className="space-y-3 p-4 text-xs text-[#475569]">
          {consistency?.warnings.length ? consistency.warnings.map((warning, index) => (
            <div key={`${warning.type}-${index}`} className="rounded-lg border border-[#d9e0ea] bg-[#fbfcfd] p-3">
              <div className="font-semibold">{warning.type} · {warning.severity}</div>
              <div className="mt-1">{warning.message}</div>
            </div>
          )) : <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-700">No consistency warnings from backend.</div>}
          <div className="rounded-lg border border-[#d9e0ea] bg-[#fbfcfd] p-3">{selectedSeries ? `Active context version: v${selectedSeries.context_version}` : 'Select a series to inspect context.'}</div>
        </div>
      </Panel>
    </div>
  )
}

function PlanWizard(props: {
  profiles: Profile[]
  crawlJobs: CrawlJob[]
  stories: Story[]
  finalContent: FinalContentView
  strategy: Strategy | null
  selectedProfileId: string
  setSelectedProfileId: (value: string) => void
  selectedCrawlJobId: string
  setSelectedCrawlJobId: (value: string) => void
  selectedStoryIds: string[]
  setSelectedStoryIds: (value: string[]) => void
  selectedContentIds: string[]
  setSelectedContentIds: (value: string[]) => void
  planningMode: 'AUTO' | 'SINGLE' | 'SERIES'
  setPlanningMode: (value: 'AUTO' | 'SINGLE' | 'SERIES') => void
  duration: number
  setDuration: (value: number) => void
  partCount: number
  setPartCount: (value: number) => void
  instructions: string
  setInstructions: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}) {
  const [sourceView, setSourceView] = useState<'normal' | 'series'>('normal')
  const module1Items = sourceView === 'normal' ? props.finalContent.normal_items : props.finalContent.series_items
  const availableStoryIds = new Set(props.finalContent.series_items.map((item) => item.series?.id).filter(Boolean))
  const availableStories = props.stories.filter((story) => availableStoryIds.has(story.id))
  const selectedCount = props.selectedContentIds.length + props.selectedStoryIds.length

  const toggleContent = (contentId: string) => {
    props.setSelectedContentIds(props.selectedContentIds.includes(contentId) ? props.selectedContentIds.filter((id) => id !== contentId) : [...props.selectedContentIds, contentId])
  }

  const toggleStory = (storyId: string) => {
    props.setSelectedStoryIds(props.selectedStoryIds.includes(storyId) ? props.selectedStoryIds.filter((id) => id !== storyId) : [...props.selectedStoryIds, storyId])
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[90vh] w-full max-w-[920px] overflow-y-auto rounded-lg border border-[#d9e0ea] bg-white p-6 shadow-xl">
        <h3 className="text-base font-bold">Create content plan</h3>
        <p className="mt-1 text-xs text-[#64748b]">Create a profile-scoped dataset from Module 1, then start the planning job.</p>
        <div className="mt-5 grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="space-y-4">
            <label className="block text-xs font-semibold">Profile
              <select value={props.selectedProfileId} onChange={(event) => props.setSelectedProfileId(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-[#d9e0ea] px-3 text-sm font-normal outline-none">
                {props.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.profile_name} · {profile.platform}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold">Module 1 crawl source
              <select value={props.selectedCrawlJobId} onChange={(event) => props.setSelectedCrawlJobId(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-[#d9e0ea] px-3 text-sm font-normal outline-none">
                {props.crawlJobs.length === 0 ? (
                  <option value="">No crawl jobs</option>
                ) : props.crawlJobs.map((job) => (
                  <option key={job.id} value={job.id}>{job.name} · {job.status} · {shortId(job.id)}</option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] font-normal text-[#64748b]">Nếu không chọn item thủ công, hệ thống sẽ tạo auto dataset từ crawl job này và gộp thêm context liên quan.</span>
            </label>
            <div className="rounded-lg border border-[#d9e0ea] bg-[#fbfcfd] p-4">
              <div className="text-xs font-bold">Strategy snapshot</div>
              <div className="mt-3 space-y-2 text-xs text-[#64748b]">
                <div>Tone: {props.strategy?.tone || '-'}</div>
                <div>Audience: {props.strategy?.target_audience || '-'}</div>
                <div>Risk: {props.strategy?.risk_level || '-'}</div>
                <div>Min score: {props.strategy?.min_score ?? '-'}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['AUTO', 'SINGLE', 'SERIES'] as const).map((mode) => <button key={mode} onClick={() => props.setPlanningMode(mode)} className={`h-9 rounded-md border text-xs font-semibold ${props.planningMode === mode ? 'border-[#2563eb] bg-[#e5f0ff] text-[#2563eb]' : 'border-[#d9e0ea]'}`}>{mode}</button>)}
            </div>
            <label className="block text-xs font-semibold">Duration seconds<input type="number" value={props.duration} onChange={(event) => props.setDuration(Number(event.target.value || 60))} className="mt-1 h-9 w-full rounded-md border border-[#d9e0ea] px-3 text-sm font-normal outline-none" /></label>
            <label className="block text-xs font-semibold">Preferred parts<input type="number" value={props.partCount} onChange={(event) => props.setPartCount(Number(event.target.value || 8))} className="mt-1 h-9 w-full rounded-md border border-[#d9e0ea] px-3 text-sm font-normal outline-none" /></label>
          </div>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold">Manual include from selected crawl</div>
                <span className="text-[11px] font-medium text-[#64748b]">{selectedCount} selected</span>
              </div>
              <div className="mt-2 flex gap-2">
                <button onClick={() => setSourceView('normal')} className={`h-8 rounded-md border px-3 text-xs font-semibold ${sourceView === 'normal' ? 'border-[#2563eb] bg-[#e5f0ff] text-[#2563eb]' : 'border-[#d9e0ea] text-[#64748b]'}`}>Bài thường ({props.finalContent.normal_items.length})</button>
                <button onClick={() => setSourceView('series')} className={`h-8 rounded-md border px-3 text-xs font-semibold ${sourceView === 'series' ? 'border-[#2563eb] bg-[#e5f0ff] text-[#2563eb]' : 'border-[#d9e0ea] text-[#64748b]'}`}>Bài theo series ({props.finalContent.series_items.length})</button>
              </div>
              <div className="mt-2 max-h-[260px] overflow-y-auto rounded-lg border border-[#d9e0ea]">
                {module1Items.length === 0 ? <Empty label={sourceView === 'normal' ? 'No normal content available' : 'No series content available'} compact /> : module1Items.map((item) => (
                  <label key={item.id} className="flex cursor-pointer items-center gap-3 border-t border-[#eef2f7] px-3 py-3 first:border-t-0">
                    <input type="checkbox" checked={props.selectedContentIds.includes(item.id)} onChange={() => toggleContent(item.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{sourceView === 'series' ? item.series?.canonical_name || item.canonical_title : item.canonical_title}</span>
                      <span className="block truncate text-xs text-[#64748b]">
                        {sourceView === 'series'
                          ? `${item.episode_title || item.canonical_title} · part ${item.episode_number ?? item.sequence_order ?? '-'}`
                          : `${item.source_type || item.content_type} · quality ${Number(item.quality_score).toFixed(0)}`}
                      </span>
                    </span>
                    <Badge value={item.status} />
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold">Series groups</div>
              <div className="mt-2 max-h-[180px] overflow-y-auto rounded-lg border border-[#d9e0ea]">
                {availableStories.length === 0 ? <Empty label="No grouped stories for selected crawl job" compact /> : availableStories.map((story) => (
                  <label key={story.id} className="flex cursor-pointer items-center gap-3 border-t border-[#eef2f7] px-3 py-3 first:border-t-0">
                    <input type="checkbox" checked={props.selectedStoryIds.includes(story.id)} onChange={() => toggleStory(story.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{story.canonical_name}</span>
                      <span className="block text-xs text-[#64748b]">{story.total_episodes} episodes · {story.completion_status}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <label className="block text-xs font-semibold">Instructions
              <textarea value={props.instructions} onChange={(event) => props.setInstructions(event.target.value)} className="mt-1 min-h-[110px] w-full rounded-md border border-[#d9e0ea] px-3 py-2 text-sm font-normal outline-none" />
            </label>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={props.onClose} className="h-9 rounded-md border border-[#d9e0ea] px-4 text-xs font-semibold">Cancel</button>
          <button onClick={props.onSubmit} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#2563eb] px-4 text-xs font-semibold text-white"><Sparkles size={14} /> Create dataset and job</button>
        </div>
      </div>
    </div>
  )
}

function MetricGrid({ items }: { items: [string, number, string][] }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{items.map(([label, value, marker]) => <div key={label} className="h-[82px] rounded-lg border border-[#d9e0ea] bg-white p-4"><div className="flex items-center gap-2 text-[11px] font-medium text-[#64748b]"><span className={`h-2 w-2 rounded-full ${marker}`} />{label}</div><div className="mt-2 text-[22px] font-bold leading-[30px]">{value.toLocaleString('vi-VN')}</div></div>)}</div>
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-lg border border-[#d9e0ea] bg-white"><div className="p-5"><h3 className="text-base font-bold">{title}</h3><p className="mt-1 text-xs text-[#64748b]">{subtitle}</p></div>{children}</div>
}

function TableHeader({ columns }: { columns: string[] }) {
  return <div className="grid gap-3 rounded-t-lg bg-[#fbfcfd] px-3 py-3 text-[11px] font-semibold text-[#64748b]" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>{columns.map((column) => <div key={column}>{column}</div>)}</div>
}

function Badge({ value }: { value: string }) {
  return <span className={`inline-flex w-fit items-center rounded-full border px-2 py-1 text-[11px] font-semibold ${tone[value] || 'border-slate-200 bg-slate-50 text-slate-700'}`}>{value}</span>
}

function Empty({ label, compact = false }: { label: string; compact?: boolean }) {
  return <div className={`flex items-center justify-center gap-2 text-sm text-[#94a3b8] ${compact ? 'py-4' : 'py-12'}`}><Clock3 size={16} /> {label}</div>
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-[#d9e0ea] bg-[#fbfcfd] p-3"><div className="text-[11px] font-semibold text-[#64748b]">{label}</div><div className="mt-1 text-xs font-medium">{value}</div></div>
}

function ContextCard({ label, value }: { label: string; value: string }) {
  return <div className="min-h-[120px] rounded-lg border border-[#d9e0ea] bg-[#fbfcfd] p-4"><div className="flex items-center gap-2 text-xs font-bold"><BookOpen size={14} /> {label}</div><p className="mt-3 text-xs leading-5 text-[#64748b]">{value}</p></div>
}
