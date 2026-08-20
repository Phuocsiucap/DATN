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
  createContentProjectFromProjectSeriesApi,
  createContentProjectFromCrawlApi,
  createContentProjectFromSourcesApi,
  createProjectRunApi,
  fetchAllContentPlansApi,
  fetchAllProjectSeriesApi,
  fetchContentProjectsApi,
  fetchProjectRunsApi,
  fetchSeriesConsistencyApi,
  fetchSeriesContextApi,
  fetchProjectPartsApi,
  rebuildSeriesContextApi,
  regenerateContentPlanApi,
  regenerateProjectSeriesApi,
  rejectContentPlanApi,
  type ConsistencyCheck,
  type ContentPlan,
  type ProjectSeries,
  type ContentProject,
  type ProjectRun,
  type ProjectPart,
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

type Module2Tab = 'jobs' | 'plans' | 'series' | 'context' | 'generateVideo'

const tabs: { id: Module2Tab; label: string; icon: React.ElementType }[] = [
  { id: 'jobs', label: 'Project Runs', icon: Sparkles },
  { id: 'plans', label: 'Plan Review', icon: FileText },
  { id: 'series', label: 'Series Builder', icon: GitBranch },
  { id: 'context', label: 'Context Manager', icon: Layers3 },
  { id: 'generateVideo', label: 'Generate Video Prep', icon: Sparkles },
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

const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString('vi-VN') : '-'
const shortId = (value: string) => value.slice(0, 8)

export default function Module2Page({ workspaceMode = 'admin' }: { workspaceMode?: 'admin' | 'user' }) {
  const [activeTab, setActiveTab] = useState<Module2Tab>('jobs')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [crawlJobs, setCrawlJobs] = useState<CrawlJob[]>([])
  const [stories, setStories] = useState<Story[]>([])
  const [finalContent, setFinalContent] = useState<FinalContentView>({ normal_items: [], series_items: [] })
  const [projects, setProjects] = useState<ContentProject[]>([])
  const [jobs, setJobs] = useState<ProjectRun[]>([])
  const [plans, setPlans] = useState<ContentPlan[]>([])
  const [series, setSeries] = useState<ProjectSeries[]>([])
  const [parts, setParts] = useState<ProjectPart[]>([])
  const [seriesContext, setSeriesContext] = useState<SeriesContextResponse | null>(null)
  const [consistency, setConsistency] = useState<ConsistencyCheck | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [selectedCrawlJobId, setSelectedCrawlJobId] = useState('')
  const [selectedStoryIds, setSelectedStoryIds] = useState<string[]>([])
  const [selectedContentIds, setSelectedContentIds] = useState<string[]>([])
  const [selectedPlan, setSelectedPlan] = useState<ContentPlan | null>(null)
  const [selectedSeries, setSelectedSeries] = useState<ProjectSeries | null>(null)
  const [strategy, setStrategy] = useState<Strategy | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [showWizard, setShowWizard] = useState(false)
  const [planningMode, setPlanningMode] = useState<'AUTO' | 'SINGLE' | 'SERIES'>('SINGLE')
  const [duration, setDuration] = useState(60)
  const [partCount, setPartCount] = useState(1)
  const [instructions, setInstructions] = useState('Kể nhanh, giữ suspense, tránh nội dung quá bạo lực')

  const isUserMode = workspaceMode === 'user'

  const loadDashboard = async () => {
    setLoading(true)
    setMessage('')
    try {
      const [nextProjects, nextJobs, nextPlans, nextSeries] = await Promise.all([
        fetchContentProjectsApi(),
        fetchProjectRunsApi(),
        fetchAllContentPlansApi(),
        fetchAllProjectSeriesApi(),
      ])
      setProjects(nextProjects)
      setJobs(nextJobs)
      setPlans(nextPlans)
      setSeries(nextSeries)
      setSelectedPlan((current) => current ? nextPlans.find((plan) => plan.id === current.id) ?? current : nextPlans[0] ?? null)
      setSelectedSeries((current) => current ? nextSeries.find((item) => item.id === current.id) ?? current : nextSeries[0] ?? null)
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể tải dữ liệu Module 2')
    } finally {
      setLoading(false)
    }
  }

  const loadWizard = async () => {
    if (profiles.length > 0 && crawlJobs.length > 0) return // Already loaded
    try {
      const [nextProfiles, nextCrawlJobs, nextStories] = await Promise.all([
        fetchSocialProfilesApi(),
        fetchCrawlJobsApi(),
        fetchStoriesApi(),
      ])
      const profileItems = nextProfiles.items || nextProfiles
      setProfiles(profileItems)
      setCrawlJobs(nextCrawlJobs)
      setStories(nextStories)
      setSelectedProfileId((current) => current || profileItems[0]?.id || '')
      setSelectedCrawlJobId((current) => current || nextCrawlJobs[0]?.id || '')
    } catch (error: any) {
      console.error('Failed to load wizard data:', error)
    }
  }

  const loadAll = async () => {
    await loadDashboard()
    if (showWizard) {
      await loadWizard()
    }
  }

  useEffect(() => {
    void loadDashboard()
  }, [])

  useEffect(() => {
    if (showWizard) {
      void loadWizard()
    }
  }, [showWizard])

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
      fetchProjectPartsApi(selectedSeries.id),
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
        const project = await createContentProjectFromSourcesApi({
          profile_id: selectedProfileId,
          story_ids: selectedStoryIds,
          content_ids: selectedContentIds,
          episode_ids: [],
          crawl_job_id: selectedCrawlJobId || null,
          selection_mode: 'MANUAL',
          candidate_limit: 20,
          note: 'Manual dataset from Module 2 planning wizard',
          filters: {
            source_crawl_job_id: selectedCrawlJobId || null,
            content_types: ['STORY', 'ARTICLE', 'PLAYLIST'],
            min_quality_score: strategy?.min_score ?? 70,
            languages: ['vi'],
          },
        })
        await createProjectRunApi({
          profile_id: selectedProfileId,
          project_id: project.id,
          planning_mode: planningMode,
          target_duration_seconds: duration,
          preferred_part_count: planningMode === 'SERIES' ? partCount : null,
          language: 'vi',
          skip_ai_evaluation: planningMode === 'SINGLE',
          instructions: planningMode === 'SINGLE'
            ? ['manual_direct_script: true. Bỏ qua chấm điểm và tạo kịch bản đơn lẻ từ nội dung người dùng đã chọn.', instructions].filter(Boolean).join('\n')
            : instructions,
        })
      } else if (selectedCrawlJobId) {
        await createContentProjectFromCrawlApi({
          profile_id: selectedProfileId,
          crawl_job_id: selectedCrawlJobId,
          candidate_limit: 20,
          max_related_items_per_primary: 5,
          min_quality_score: strategy?.min_score ?? 70,
          create_project_run: true,
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
      setMessage(error?.response?.data?.detail || 'Không thể tạo project run')
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

  const regenerateSeries = async (item: ProjectSeries) => {
    setLoading(true)
    try {
      await regenerateProjectSeriesApi(item.id, 'Regenerated from Module 2 series builder')
      await loadAll()
      setActiveTab('jobs')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể regenerate series')
    } finally {
      setLoading(false)
    }
  }

  const rebuildContext = async (item: ProjectSeries) => {
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

  const markProjectReadyForGenerateVideo = async (item: ProjectSeries) => {
    setLoading(true)
    try {
      await createContentProjectFromProjectSeriesApi({
        series_id: item.id,
        part_ids: parts.map((part) => part.id),
        priority: 5,
        note: 'Created from Module 2 UI',
      })
      await loadAll()
      setMessage('Đã đánh dấu sẵn sàng cho Generate Video.')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể tạo project sang Generate Video')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header & Horizontal Navigation Tabs */}
      <div className="rounded-xl border border-[#d9e0ea] bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-[#0f172a]">
                {isUserMode ? 'AI Planning & Series Builder' : 'Module 2 — System AI Planning Operations'}
              </h2>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${isUserMode ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
                {isUserMode ? 'USER SCOPE: PRIVATE' : 'SYSTEM SCOPE: GLOBAL'}
              </span>
            </div>
            <p className="mt-1 text-sm text-[#64748b]">
              {isUserMode
                ? 'Lập kế hoạch kịch bản AI, chia tập series và tạo dựng mạch truyện theo chiến lược kênh của bạn.'
                : 'Giám sát tiến trình AI Planning toàn hệ thống, Project Datasets & Context Continuity Manager.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void loadAll()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#d9e0ea] bg-white px-3 text-xs font-semibold text-[#475569] hover:bg-slate-50">
              <RefreshCcw size={14} /> Tải lại
            </button>
            <button onClick={() => setShowWizard(true)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#2563eb] px-4 text-xs font-bold text-white shadow-sm hover:bg-[#1d4ed8]">
              <Plus size={14} /> Tạo Kế Hoạch AI Mới
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
        {loading && <div className="mb-4 flex items-center gap-2 text-sm text-[#64748b]"><Loader2 className="animate-spin" size={16} /> Đang tải dữ liệu AI Planning...</div>}

        <MetricGrid items={[
          ['Tổng bản plan', metrics.totalPlans, 'bg-blue-500'],
          ['Tác vụ đang chạy', metrics.running, 'bg-sky-500'],
          ['Chờ duyệt (Review)', metrics.waitingReview, 'bg-amber-500'],
          ['Đã phê duyệt', metrics.approved, 'bg-emerald-500'],
        ]} />

        <div className="mt-6">
          {activeTab === 'jobs' && <JobsView jobs={jobs} projects={projects} />}
          {activeTab === 'plans' && <PlansView plans={plans} selectedPlan={selectedPlan} onSelect={setSelectedPlan} onReview={reviewPlan} onRegenerate={regeneratePlan} />}
          {activeTab === 'series' && <SeriesView series={series} selectedSeries={selectedSeries} parts={parts} onSelect={setSelectedSeries} onRegenerate={regenerateSeries} />}
          {activeTab === 'context' && <ContextView selectedSeries={selectedSeries} parts={parts} selectedPlan={selectedPlan} context={seriesContext} consistency={consistency} onRebuild={rebuildContext} />}
          {activeTab === 'generateVideo' && <ProductionProjectView series={series} projects={projects} selectedSeries={selectedSeries} parts={parts} onSelect={setSelectedSeries} onMarkReady={markProjectReadyForGenerateVideo} />}
        </div>
      </section>

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

function JobsView({ jobs, projects }: { jobs: ProjectRun[]; projects: ContentProject[] }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <Panel title="Project runs" subtitle="Pipeline progress from project to structured plan">
        <TableHeader columns={['Job', 'Mode', 'Status', 'Stage', 'Progress', 'Created']} />
        {jobs.length === 0 ? <Empty label="No project runs yet" /> : jobs.map((job) => (
          <div key={job.id} className="grid grid-cols-[1.2fr_0.7fr_0.9fr_1.4fr_0.7fr_1fr] gap-3 border-t border-[#eef2f7] px-3 py-3 text-xs">
            <div className="font-medium">{shortId(job.id)}<div className="mt-1 text-[11px] text-[#94a3b8]">project {shortId(job.project_id)}</div></div>
            <div className="text-[#64748b]">{job.planning_mode}</div>
            <Badge value={job.status} />
            <div className="text-[#64748b]">{job.current_stage}</div>
            <div className="text-[#64748b]">{Number(job.progress_percent).toFixed(0)}%</div>
            <div className="text-[#64748b]">{formatDate(job.created_at)}</div>
          </div>
        ))}
      </Panel>
      <Panel title="Recent datasets" subtitle="Profile-scoped projects ready for planning">
        <TableHeader columns={['Dataset', 'Source', 'Items']} />
        {projects.length === 0 ? <Empty label="No projects yet" /> : projects.slice(0, 8).map((project) => (
          <div key={project.id} className="grid grid-cols-[1fr_0.8fr_0.6fr] gap-3 border-t border-[#eef2f7] px-3 py-3 text-xs">
            <div className="font-medium">{shortId(project.id)}<div className="mt-1 text-[11px] text-[#94a3b8]">{shortId(project.profile_id)}</div></div>
            <Badge value={String(project.metadata?.selection_mode || 'MANUAL')} />
            <div className="text-[#64748b]">
              {project.sources?.filter((source) => source.status === 'ACTIVE').length || 0}/{project.sources?.filter((source) => source.status === 'REJECTED').length || 0}
            </div>
          </div>
        ))}
      </Panel>
    </div>
  )
}

function PlansView({ plans, selectedPlan, onSelect, onReview, onRegenerate }: { plans: ContentPlan[]; selectedPlan: ContentPlan | null; onSelect: (plan: ContentPlan) => void; onReview: (plan: ContentPlan, action: 'approve' | 'reject') => void; onRegenerate: (plan: ContentPlan) => void }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_450px]">
      <Panel title="Content plans" subtitle="Structured AI output, ready for review">
        <TableHeader columns={['Plan', 'Mode', 'Confidence', 'Status', 'Version']} />
        {plans.length === 0 ? <Empty label="No generated plans yet" /> : plans.map((plan) => (
          <div key={plan.id} onClick={() => onSelect(plan)} className={`grid cursor-pointer grid-cols-[2fr_0.8fr_0.8fr_0.9fr_0.6fr] gap-3 border-t border-[#eef2f7] px-4 py-4 text-xs transition-colors hover:bg-slate-50 ${selectedPlan?.id === plan.id ? 'bg-blue-50/70 border-l-2 border-l-[#2563eb]' : 'border-l-2 border-l-transparent'}`}>
            <div className="font-bold text-[#0f172a]">{plan.title}<div className="mt-1 truncate text-[11px] font-normal text-[#64748b]">{plan.content_angle || shortId(plan.id)}</div></div>
            <div className="text-[#64748b]">{plan.planning_mode}</div>
            <div className="text-[#64748b]">{Number(plan.confidence_score).toFixed(0)}</div>
            <Badge value={plan.status} />
            <div className="text-[#64748b]">v{plan.version}</div>
          </div>
        ))}
      </Panel>
      
      <div className="rounded-xl border border-[#d9e0ea] bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold text-[#0f172a]">Chi tiết Kế hoạch (Plan Review)</h3>
        {!selectedPlan ? <Empty label="Hãy chọn một bản kế hoạch để kiểm duyệt" compact /> : (
          <div className="mt-5 space-y-6 text-sm">
            {/* Header Block */}
            <div className="rounded-lg bg-[#f8fafc] p-4 border border-[#e2e8f0]">
              <div className="text-xs font-semibold uppercase text-[#64748b] tracking-wider mb-1">Tên Kế Hoạch</div>
              <div className="text-base font-bold text-[#1e293b]">{selectedPlan.title}</div>
              <div className="mt-3 text-xs font-semibold uppercase text-[#64748b] tracking-wider mb-1">Góc Độ Khai Thác (Angle)</div>
              <div className="text-sm text-[#475569] italic">"{selectedPlan.content_angle || 'Không có'}"</div>
            </div>

            {/* Grid Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-[#eef2f7] bg-white p-3 shadow-sm">
                <div className="text-[10px] font-bold uppercase text-[#94a3b8] mb-1">Đối tượng mục tiêu</div>
                <div className="text-xs font-medium text-[#334155]">{selectedPlan.target_audience || '-'}</div>
              </div>
              <div className="rounded-md border border-[#eef2f7] bg-white p-3 shadow-sm">
                <div className="text-[10px] font-bold uppercase text-[#94a3b8] mb-1">Giọng văn (Tone)</div>
                <div className="text-xs font-medium text-[#334155]">{selectedPlan.tone || '-'}</div>
              </div>
              <div className="rounded-md border border-[#eef2f7] bg-white p-3 shadow-sm">
                <div className="text-[10px] font-bold uppercase text-[#94a3b8] mb-1">Format Video</div>
                <div className="text-xs font-medium text-[#334155]">{selectedPlan.format || '-'}</div>
              </div>
              <div className="rounded-md border border-[#eef2f7] bg-white p-3 shadow-sm">
                <div className="text-[10px] font-bold uppercase text-[#94a3b8] mb-1">Số Tập Phân Tách</div>
                <div className="text-xs font-bold text-[#2563eb] text-lg">{String(selectedPlan.recommended_part_count ?? '-')} Tập</div>
              </div>
            </div>

            {/* AI Reasoning */}
            <div>
              <div className="text-xs font-bold uppercase text-[#64748b] tracking-wider mb-3 flex items-center gap-2">
                <Sparkles size={14} className="text-[#8b5cf6]" /> Phân tích từ AI Planner
              </div>
              <div className="space-y-2">
                {(selectedPlan.ai_reasoning || []).slice(0, 4).map((item, index) => (
                  <div key={index} className="rounded-lg bg-[#f3e8ff] border border-[#e9d5ff] px-4 py-2.5 text-xs text-[#581c87]">
                    {String(item)}
                  </div>
                ))}
                {selectedPlan.ai_reasoning.length === 0 && <div className="text-xs text-[#94a3b8] italic">Chưa có đánh giá lý luận từ AI.</div>}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-4 border-t border-[#eef2f7]">
              <button onClick={() => onReview(selectedPlan, 'approve')} className="flex-1 inline-flex h-10 justify-center items-center gap-2 rounded-lg bg-[#16a34a] px-3 text-xs font-bold text-white hover:bg-[#15803d] transition-colors"><CheckCircle2 size={15} /> Phê Duyệt</button>
              <button onClick={() => onReview(selectedPlan, 'reject')} className="flex-1 inline-flex h-10 justify-center items-center gap-2 rounded-lg border border-[#f87171] bg-white px-3 text-xs font-bold text-[#dc2626] hover:bg-red-50 transition-colors"><XCircle size={15} /> Từ Chối</button>
              <button onClick={() => onRegenerate(selectedPlan)} className="inline-flex h-10 justify-center items-center gap-2 rounded-lg border border-[#cbd5e1] bg-white px-3 text-xs font-bold text-[#475569] hover:bg-slate-50 transition-colors"><RefreshCcw size={15} /> Tạo lại</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SeriesView({ series, selectedSeries, parts, onSelect, onRegenerate }: { series: ProjectSeries[]; selectedSeries: ProjectSeries | null; parts: ProjectPart[]; onSelect: (series: ProjectSeries) => void; onRegenerate: (series: ProjectSeries) => void }) {
  return (
    <div className="space-y-6">
      <Panel title="Danh Sách Series & Chuỗi Nội Dung" subtitle="Lựa chọn một series để xem kịch bản chi tiết từng tập">
        <TableHeader columns={['Series Title', 'Type', 'Tập', 'Current', 'Version', 'Status']} />
        {series.length === 0 ? <Empty label="Chưa có series nào được tạo" /> : series.map((item) => (
          <div key={item.id} onClick={() => onSelect(item)} className={`grid cursor-pointer grid-cols-[2.5fr_0.8fr_0.6fr_0.6fr_0.9fr_0.8fr] gap-3 border-t border-[#eef2f7] px-4 py-4 text-xs transition-colors hover:bg-slate-50 ${selectedSeries?.id === item.id ? 'bg-blue-50/70 border-l-2 border-l-[#2563eb]' : 'border-l-2 border-l-transparent'}`}>
            <div className="font-bold text-[#0f172a]">{item.title}<div className="mt-1 truncate text-[11px] font-normal text-[#64748b]">{item.description || shortId(item.id)}</div></div>
            <div className="text-[#64748b] font-medium">{item.series_type}</div>
            <div className="text-[#64748b] font-bold">{item.total_parts}</div>
            <div className="text-[#64748b]">{item.current_part}</div>
            <div className="text-[#2563eb] font-semibold">v{item.context_version}</div>
            <Badge value={item.status} />
          </div>
        ))}
      </Panel>

      <Panel title="Dòng Thời Gian Các Tập (Timeline)" subtitle="Chi tiết kịch bản từng tập (Recap, Hook, Main Beats, Ending)">
        {selectedSeries && (
          <div className="flex flex-wrap justify-end gap-3 px-6 pb-4 border-b border-[#eef2f7]">
            <button onClick={() => onRegenerate(selectedSeries)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#cbd5e1] bg-white px-4 text-xs font-bold text-[#475569] hover:bg-slate-50 transition-colors"><RefreshCcw size={14} /> Làm lại Series</button>
          </div>
        )}
        
        <div className="p-6">
          {parts.length === 0 ? (
            <Empty label="Series hiện chưa có tập nào được phân chia" compact />
          ) : (
            <div className="flex flex-col gap-6 relative">
              {/* Trục dọc nối timeline */}
              <div className="absolute left-8 top-4 bottom-4 w-0.5 bg-[#e2e8f0] z-0"></div>

              {parts.map((part) => (
                <div key={part.id} className="relative z-10 flex gap-5">
                  {/* Cột chỉ số tập */}
                  <div className="flex flex-col items-center shrink-0 w-16">
                    <div className="h-10 w-10 flex items-center justify-center rounded-full bg-[#eff6ff] border-2 border-[#2563eb] shadow-sm font-black text-[#1e40af] text-sm">
                      T{part.part_number}
                    </div>
                  </div>

                  {/* Cột Nội dung kịch bản */}
                  <div className="flex-1 rounded-xl border border-[#cbd5e1] bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                    {/* Card Header */}
                    <div className="bg-[#f8fafc] px-5 py-3 border-b border-[#cbd5e1] flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-[#0f172a]">{part.title}</span>
                        <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">{part.part_type}</span>
                      </div>
                      <Badge value={part.status} />
                    </div>
                    
                    {/* Card Body */}
                    <div className="p-5 space-y-4">
                      {part.goal && (
                        <p className="text-xs font-medium text-[#475569] bg-slate-50 p-2.5 rounded-lg">🎯 Mục tiêu: {part.goal}</p>
                      )}

                      {part.previous_part_recap && (
                        <div className="border-l-4 border-amber-400 bg-amber-50/70 p-3 rounded-r-lg">
                          <span className="font-bold text-amber-900 text-[11px] uppercase tracking-wider block mb-1">⏮ Tóm tắt tập trước (Recap)</span>
                          <span className="text-xs text-amber-800 leading-relaxed">{part.previous_part_recap}</span>
                        </div>
                      )}

                      <div className="grid md:grid-cols-2 gap-4">
                        {part.hook_direction && (
                          <div className="border-l-4 border-blue-500 bg-blue-50/70 p-3 rounded-r-lg">
                            <span className="font-bold text-blue-900 text-[11px] uppercase tracking-wider block mb-1">🪝 Hook (3-5 giây đầu)</span>
                            <span className="text-xs text-blue-800 leading-relaxed">{part.hook_direction}</span>
                          </div>
                        )}
                        {part.ending_direction && (
                          <div className="border-l-4 border-red-500 bg-red-50/70 p-3 rounded-r-lg">
                            <span className="font-bold text-red-900 text-[11px] uppercase tracking-wider block mb-1">🎬 Kết tập / Lật mở (Ending)</span>
                            <span className="text-xs text-red-800 leading-relaxed">{part.ending_direction}</span>
                          </div>
                        )}
                      </div>

                      {part.main_beats && part.main_beats.length > 0 && (
                        <div className="pt-2 border-t border-slate-100">
                          <span className="font-bold text-slate-700 text-[11px] uppercase tracking-wider block mb-2">📋 Diễn biến chính (Main Beats)</span>
                          <ul className="grid gap-2 pl-2">
                            {part.main_beats.map((beat, idx) => (
                              <li key={idx} className="flex gap-2 text-xs text-slate-700">
                                <span className="text-blue-500 font-bold shrink-0">·</span>
                                <span className="leading-relaxed">{beat}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {part.next_part_tease && (
                        <div className="border-l-4 border-purple-500 bg-purple-50/70 p-3 rounded-r-lg mt-2">
                          <span className="font-bold text-purple-900 text-[11px] uppercase tracking-wider block mb-1">🔮 Gợi mở tập sau (Teaser)</span>
                          <span className="text-xs text-purple-800 leading-relaxed">{part.next_part_tease}</span>
                        </div>
                      )}
                    </div>

                    {/* Card Footer */}
                    <div className="bg-slate-50 px-5 py-2.5 border-t border-slate-200 text-right">
                      <span className="text-[11px] font-bold text-slate-500">⏳ Thời lượng ước tính: {part.target_duration_seconds || 60}s</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>
    </div>
  )
}

function ContextView({ selectedSeries, selectedPlan, context, consistency, onRebuild }: { selectedSeries: ProjectSeries | null; parts: ProjectPart[]; selectedPlan: ContentPlan | null; context: SeriesContextResponse | null; consistency: ConsistencyCheck | null; onRebuild: (series: ProjectSeries) => void }) {
  const activeDoc = context?.contexts?.[0]
  const summary = activeDoc?.story_summary
  const characters = activeDoc?.characters || []
  const events = activeDoc?.story_events || []
  const questions = activeDoc?.open_questions || []

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
      <div className="space-y-6">
        <Panel title="Narrative Context (Dữ liệu MongoDB)" subtitle="Quản lý ngữ cảnh nhân vật, sự kiện và mạch truyện xuyên suốt">
          {selectedSeries && (
            <div className="flex justify-end px-6 pb-4 border-b border-[#eef2f7]">
              <button onClick={() => onRebuild(selectedSeries)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#cbd5e1] bg-white px-4 text-xs font-bold text-[#475569] hover:bg-slate-50 transition-colors"><RefreshCcw size={14} /> Rebuild Context</button>
            </div>
          )}

          <div className="space-y-6 p-6 text-xs">
            {/* 1. Tóm tắt cốt truyện */}
            <div className="rounded-xl border border-[#cbd5e1] bg-white shadow-sm overflow-hidden">
              <div className="bg-[#f8fafc] px-4 py-3 border-b border-[#cbd5e1] flex items-center gap-2 text-sm font-bold text-[#1e293b]"><BookOpen size={16} className="text-[#2563eb]" /> Tiền đề & Xây dựng Thế giới</div>
              <div className="p-4 space-y-4 text-[#475569]">
                <div>
                  <span className="font-bold text-[#0f172a] block mb-1">Tiền đề (Premise):</span> 
                  <span className="leading-relaxed">{summary?.premise || selectedPlan?.content_angle || 'Chưa có thông tin tiền đề.'}</span>
                </div>
                {summary?.world_building && (
                  <div className="pt-3 border-t border-slate-100">
                    <span className="font-bold text-[#0f172a] block mb-1">Bối cảnh (World Building):</span>
                    <span className="leading-relaxed">{summary.world_building}</span>
                  </div>
                )}
                {summary?.theme && (
                  <div className="pt-3 border-t border-slate-100">
                    <span className="font-bold text-[#0f172a] block mb-1">Chủ đề chính (Theme):</span>
                    <span className="leading-relaxed">{summary.theme}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 2. Danh sách nhân vật */}
            <div className="rounded-xl border border-[#cbd5e1] bg-white shadow-sm overflow-hidden">
              <div className="bg-[#f8fafc] px-4 py-3 border-b border-[#cbd5e1] flex items-center gap-2 text-sm font-bold text-[#1e293b]">
                <GitBranch size={16} className="text-[#2563eb]" /> Quản lý Nhân Vật ({characters.length})
              </div>
              <div className="p-4 bg-slate-50">
                <div className="grid gap-4 sm:grid-cols-2">
                  {characters.length === 0 ? <Empty label="Chưa có nhân vật nào trong context." compact /> : characters.map((c, idx) => (
                    <div key={idx} className="rounded-lg border border-[#cbd5e1] bg-white p-4 shadow-sm hover:border-[#94a3b8] transition-colors">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className="font-black text-[#0f172a] text-sm">{c.name}</span>
                        {c.role && <span className="rounded bg-[#eff6ff] px-2 py-0.5 text-[10px] font-bold text-[#2563eb] border border-[#bfdbfe]">{c.role}</span>}
                      </div>
                      {c.personality && (
                        <div className="mb-2">
                          <span className="text-[10px] font-bold text-slate-400 uppercase block">Tính cách</span>
                          <span className="text-[11px] text-slate-700 leading-relaxed">{c.personality}</span>
                        </div>
                      )}
                      {c.status && (
                        <div className="pt-2 border-t border-slate-100">
                          <span className="text-[10px] font-bold text-slate-400 uppercase block">Trạng thái</span>
                          <span className="text-[11px] font-semibold text-emerald-600">{c.status}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 3. Tiến trình sự kiện theo tập */}
            <div className="rounded-xl border border-[#cbd5e1] bg-white shadow-sm overflow-hidden">
              <div className="bg-[#f8fafc] px-4 py-3 border-b border-[#cbd5e1] flex items-center gap-2 text-sm font-bold text-[#1e293b]">
                <Layers3 size={16} className="text-[#2563eb]" /> Tuyến Sự Kiện Lịch Sử
              </div>
              <div className="p-5 space-y-5">
                {events.length === 0 ? <Empty label="Chưa ghi nhận tiến trình sự kiện." compact /> : events.map((e, idx) => (
                  <div key={idx} className="relative pl-6 before:absolute before:left-[7px] before:top-2 before:bottom-[-20px] before:w-0.5 before:bg-slate-200 last:before:hidden">
                    <div className="absolute left-0 top-1.5 h-4 w-4 rounded-full border-4 border-white bg-[#2563eb] shadow-sm"></div>
                    <div className="mb-1 text-[11px] font-black text-[#2563eb] uppercase tracking-wider">Tập {e.part_number}</div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="font-semibold text-slate-800 leading-relaxed">{e.summary}</div>
                      {e.key_developments && e.key_developments.length > 0 && (
                        <ul className="mt-2 space-y-1 border-t border-slate-200 pt-2">
                          {e.key_developments.map((dev, dIdx) => (
                            <li key={dIdx} className="flex gap-1.5 text-[11px] text-slate-600">
                              <span className="text-slate-400">·</span>
                              <span>{dev}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 4. Open Questions */}
            {questions.length > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50/50 shadow-sm overflow-hidden">
                <div className="bg-amber-100/50 px-4 py-3 border-b border-amber-200 flex items-center gap-2 text-sm font-bold text-amber-900">
                  ❓ Nút thắt / Câu hỏi chưa giải quyết
                </div>
                <div className="p-4">
                  <ul className="space-y-2">
                    {questions.map((q, idx) => (
                      <li key={idx} className="flex gap-2 text-xs text-amber-900 bg-white p-2.5 rounded-lg border border-amber-200 shadow-sm">
                        <span className="text-amber-500 font-bold shrink-0">?</span>
                        <span className="leading-relaxed font-medium">{q}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div className="space-y-6">
        <Panel title="Cảnh Báo Tính Nhất Quán" subtitle="Phân tích logic kịch bản liên tập">
          <div className="p-5 space-y-4 text-xs text-[#475569]">
            {consistency?.warnings.length ? consistency.warnings.map((warning, index) => (
              <div key={`${warning.type}-${index}`} className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
                <div className="shrink-0 mt-0.5 text-amber-500"><XCircle size={16} /></div>
                <div>
                  <div className="font-bold text-amber-900 mb-1">{warning.type} <span className="opacity-50 mx-1">·</span> <span className="uppercase text-[10px] tracking-wider">{warning.severity}</span></div>
                  <div className="text-amber-800 leading-relaxed">{warning.message}</div>
                </div>
              </div>
            )) : (
              <div className="flex items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 shadow-sm">
                <div className="shrink-0 text-emerald-600"><CheckCircle2 size={18} /></div>
                <div className="font-bold text-emerald-800">Không phát hiện mâu thuẫn kịch bản.<br/><span className="font-normal text-emerald-700">Các tập kết nối mượt mà và logic.</span></div>
              </div>
            )}
            
            <div className="rounded-xl border border-[#cbd5e1] bg-white p-4 shadow-sm mt-6">
              {selectedSeries ? (
                <div className="space-y-3">
                  <div className="text-xs font-bold text-[#0f172a] border-b border-slate-100 pb-2 mb-3">Thông số Kịch Bản</div>
                  <div className="flex justify-between items-center"><span className="text-slate-500">Total parts</span><span className="font-bold">{selectedSeries.total_parts}</span></div>
                  <div className="flex justify-between items-center"><span className="text-slate-500">Current planned</span><span className="font-bold">{selectedSeries.current_part}</span></div>
                  <div className="flex justify-between items-center"><span className="text-slate-500">Context version</span><span className="font-bold text-[#2563eb]">v{selectedSeries.context_version}</span></div>
                  <div className="flex justify-between items-center"><span className="text-slate-500">MongoDB Doc ID</span><span className="font-mono text-[10px] text-slate-400 truncate max-w-[120px]">{activeDoc?._id || 'Standard'}</span></div>
                </div>
              ) : <Empty label="Chọn một series để xem" compact />}
            </div>
          </div>
        </Panel>
      </div>
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
        <p className="mt-1 text-xs text-[#64748b]">Create a profile-scoped dataset from Module 1, then start the project run.</p>
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
            <label className="block text-xs font-semibold">Preferred parts<input type="number" value={props.partCount} onChange={(event) => props.setPartCount(Number(event.target.value || 1))} className="mt-1 h-9 w-full rounded-md border border-[#d9e0ea] px-3 text-sm font-normal outline-none" /></label>
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

function ProductionProjectView({
  series,
  projects,
  selectedSeries,
  parts,
  onSelect,
  onMarkReady
}: {
  series: ProjectSeries[]
  projects: ContentProject[]
  selectedSeries: ProjectSeries | null
  parts: ProjectPart[]
  onSelect: (series: ProjectSeries) => void
  onMarkReady: (series: ProjectSeries) => void
}) {
  const sourceMode = selectedSeries?.title?.toLowerCase().includes('bilibili') || selectedSeries?.title?.toLowerCase().includes('video') ? 'VIDEO_TRANSLATION' : 'AI_GENERATION'

  const projectBySeriesId = new Map(projects.filter((project) => project.series_id).map((project) => [project.series_id, project]))
  const readySeries = series.filter((item) => {
    const project = projectBySeriesId.get(item.id)
    return Boolean(project && ['APPROVED', 'PRODUCTION_READY', 'READY', 'EDITING', 'VOICE_READY', 'RENDERING', 'RENDERED'].includes(project.status))
  })

  return (
    <div className="space-y-6">
      <Panel title="Chuẩn bị Dữ liệu Video" subtitle="Danh sách các Series đã được phê duyệt và sẵn sàng cho Generate Video">
        <div className="grid gap-3 rounded-t-lg bg-[#fbfcfd] px-3 py-3 text-[11px] font-semibold text-[#64748b]" style={{ gridTemplateColumns: `100px 1fr 80px 1.5fr 100px` }}>
          <div>Series ID</div>
          <div>Tên Kịch Bản</div>
          <div>Số Tập</div>
          <div>Format / Mode</div>
          <div>Trạng thái</div>
        </div>
        {readySeries.length === 0 ? <div className="py-12 flex justify-center text-sm text-[#94a3b8]">Chưa có series nào đã có content project sau khi duyệt plan</div> : readySeries.map((item) => (
          <div key={item.id} onClick={() => onSelect(item)} className={`grid cursor-pointer items-center gap-3 border-t border-[#eef2f7] px-3 py-3 text-xs ${selectedSeries?.id === item.id ? 'bg-blue-50/60' : 'bg-white'}`} style={{ gridTemplateColumns: `100px 1fr 80px 1.5fr 100px` }}>
            <div className="font-mono text-[#64748b]">{shortId(item.id)}</div>
            <div className="font-bold text-[#0f172a] truncate">{item.title}</div>
            <div className="text-[#64748b] font-medium">{item.current_part} / {item.total_parts || '?'}</div>
            <div className="text-[#2563eb] font-semibold">{item.title?.toLowerCase().includes('bilibili') || item.title?.toLowerCase().includes('video') ? 'Lồng Tiếng & Dịch' : 'Tạo Sinh AI (AI Generation)'}</div>
            <Badge value={item.status} />
          </div>
        ))}
      </Panel>

      {selectedSeries && (
        <div className="grid gap-5 xl:grid-cols-2">
          {/* Cấu hình & Pipeline dự kiến */}
          <Panel title="Cấu Hình Sản Xuất Video" subtitle="Kiểm tra các thành phần sẽ được gọi qua Generate Video API">
            <div className="p-6 space-y-6">
              {sourceMode === 'VIDEO_TRANSLATION' ? (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-indigo-900 uppercase text-xs tracking-wide">🎞 Mode: Dịch & Lồng Tiếng Video Có Sẵn</span>
                    <span className="rounded bg-indigo-600 px-2 py-1 text-[10px] font-bold text-white">Bilibili Source</span>
                  </div>
                  <div className="text-sm text-indigo-800 leading-relaxed">
                    Hệ thống phát hiện đây là nguồn Video (Bilibili/Douyin). Thay vì tạo sinh video từ đầu, Generate Video API sẽ thực hiện nhánh <strong>Biên Dịch & Lồng Tiếng (Dubbing)</strong>.
                  </div>
                  <div className="space-y-3 pt-3 border-t border-indigo-200/50">
                    <div className="flex items-center gap-3 text-sm text-indigo-900"><CheckCircle2 size={16} className="text-indigo-500" /> Tách Audio gốc & nhận diện giọng (Diarization)</div>
                    <div className="flex items-center gap-3 text-sm text-indigo-900"><CheckCircle2 size={16} className="text-indigo-500" /> Dịch thuật Transcript (Trung ➔ Việt)</div>
                    <div className="flex items-center gap-3 text-sm text-indigo-900"><CheckCircle2 size={16} className="text-indigo-500" /> Clone Voice & Lồng tiếng (TTS) khớp Timing</div>
                    <div className="flex items-center gap-3 text-sm text-indigo-900"><CheckCircle2 size={16} className="text-indigo-500" /> Khớp Hardsub tiếng Việt vào Video gốc</div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-emerald-900 uppercase text-xs tracking-wide">✨ Mode: Tạo Sinh Video AI (Full AI Generation)</span>
                    <span className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white">Text Source</span>
                  </div>
                  <div className="text-sm text-emerald-800 leading-relaxed">
                    Hệ thống phát hiện đây là nguồn Bài Viết (Báo chí/Text). Generate Video API sẽ thực hiện chuỗi <strong>Tạo Sinh Video (AI Generation)</strong> đầy đủ các bước.
                  </div>
                  <div className="space-y-3 pt-3 border-t border-emerald-200/50">
                    <div className="flex items-center gap-3 text-sm text-emerald-900"><CheckCircle2 size={16} className="text-emerald-500" /> Chia Cảnh (Scene Breakdown) theo Timing</div>
                    <div className="flex items-center gap-3 text-sm text-emerald-900"><CheckCircle2 size={16} className="text-emerald-500" /> Sinh Giọng Đọc (TTS Voiceover)</div>
                    <div className="flex items-center gap-3 text-sm text-emerald-900"><CheckCircle2 size={16} className="text-emerald-500" /> Thu thập / Tạo sinh Ảnh (Image/Video Gen) từng Scene</div>
                    <div className="flex items-center gap-3 text-sm text-emerald-900"><CheckCircle2 size={16} className="text-emerald-500" /> Render Video cuối cùng (Voice + Media + Caption)</div>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-4">
                <button onClick={() => onMarkReady(selectedSeries)} className="inline-flex h-12 w-full justify-center items-center gap-2 rounded-lg bg-emerald-600 px-6 text-sm font-bold text-white shadow-lg hover:bg-emerald-700 hover:shadow-emerald-500/20 transition-all">
                  <CheckCircle2 size={18} /> ĐÁNH DẤU SẴN SÀNG CHO MODULE 3 (MARK READY)
                </button>
              </div>
            </div>
          </Panel>

          {/* Dữ liệu Script Đầu Vào */}
          <Panel title="Dữ Liệu Script Đầu Vào" subtitle="Bản tóm tắt Kịch Bản sẽ được nạp vào AI">
            <div className="p-6">
              <div className="max-h-[500px] overflow-y-auto pr-2 space-y-4">
                {parts.length === 0 ? <div className="text-sm text-[#94a3b8] text-center">Chưa có kịch bản (Script) nào được tạo</div> : parts.map((part) => (
                  <div key={part.id} className="rounded-lg border border-slate-200 bg-white shadow-sm p-4 text-xs">
                    <div className="font-bold text-slate-900 mb-2 text-sm">Tập {part.part_number}: {part.title}</div>
                    <div className="space-y-3 text-slate-700">
                      {part.hook_direction && <div><span className="font-semibold text-slate-900 block mb-1">🔗 Hook:</span> {part.hook_direction}</div>}
                      <div>
                         <span className="font-semibold text-slate-900 block mb-1">📖 Main Content ({part.main_beats?.length || 0} beats):</span>
                         <ul className="list-disc pl-4 space-y-1">
                           {part.main_beats?.map((beat, i) => <li key={i}>{beat}</li>)}
                         </ul>
                      </div>
                      {part.ending_direction && <div><span className="font-semibold text-slate-900 block mb-1">🎬 Ending:</span> {part.ending_direction}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>
      )}
    </div>
  )
}
