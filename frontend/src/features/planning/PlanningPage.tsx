import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  AlertTriangle,
  ArrowRightLeft,
  ChevronRight,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Settings2,
  Trash2,
  XCircle,
} from 'lucide-react'

import {
  restoreContentPlanApi,
  createContentSeriesApi,
  deleteContentSeriesApi,
  fetchPlanningRunDetailApi,
  fetchPlanningRunsApi,
  fetchProfileSeriesReviewApi,
  regenerateContentPlanApi,
  rejectContentPlanApi,
  updateContentSeriesApi,
  type ContentPlan,
  type ContentSeries,
  type PlanningProfile,
  type PlanningRun,
  type PlanningRunDetail,
  type PlanningCandidateReviewResult,
  type ProfileSeriesReview,
  type ReviewSourceContent,
} from '@/commons/apis/planning'
import { updateVideoWorkspaceApi } from '@/commons/apis/generateVideo'
import { fetchSocialProfilesApi } from '@/commons/apis/socialProfiles'
import { SocialProfileAvatar, TableRowActions, type TableRowActionItem, platformLabel } from '@/commons/component/social-ui'
import { SocialProfileFilter } from '@/commons/component/SocialProfileFilter'
import { SeriesModal, TransferSeriesModal, type SeriesFormData } from '@/features/generate-video/components/SeriesModal'
import { PlanningRunDetailSheet } from './PlanningRunDetailSheet'
import { OpenDraftWorkspaceButton } from './OpenDraftWorkspaceButton'
import {
  ArticleReviewSheet,
  ContentItemPreview,
  PlanningStatusBadge,
  SourceContentSheet,
} from './components/PlanningReviewSheets'
import { RegeneratePlanSheet } from './components/RegeneratePlanSheet'
import { getArticleStoryData, sourceCategoryId } from './planningReviewUtils'

const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString('vi-VN') : '-'
const shortId = (value: string) => value.slice(0, 8)

function planningRunTitle(job: PlanningRun) {
  if (job.crawl_job?.name) return job.crawl_job.name
  if (job.trigger === 'profile_strategy_updated') return 'Chấm lại strategy profile'
  if (job.selected_count > 0) return `Đã chọn ${job.selected_count} nội dung cho ${job.profile.profile_name}`
  if (job.eligible_count > 0) return `${job.eligible_count} nội dung đủ điều kiện chờ duyệt`
  if (job.candidate_count > 0) return `Chưa có nội dung phù hợp (crawl id: ${shortId(job.crawl_job?.id || 'unknown')})`
  return `Không có nội dung mới (crawl id: ${shortId(job.crawl_job?.id || 'unknown')})`
}

function planningRunOutcome(job: PlanningRun) {
  if (job.status === 'FAILED') return job.error_message || 'Planning thất bại, cần kiểm tra cấu hình.'
  if (job.selected_count > 0) return `Tạo ${job.selected_count} workflow từ ${job.eligible_count} nội dung đạt chuẩn.`
  if (job.eligible_count > 0) return `${job.eligible_count}/${job.candidate_count} nội dung đạt ngưỡng, chưa tạo workflow.`
  return `${job.candidate_count} nội dung đã được chấm, chưa có bài vượt ngưỡng.`
}

function triggerLabel(value: string) {
  const key = value.toLowerCase()
  if (key === 'crawl_job_completed') return 'Sau crawl'
  if (key === 'global_crawl_completed') return 'Bài Global mới'
  if (key === 'private_crawl_completed') return 'Bài Private mới'
  if (key === 'profile_strategy_updated') return 'Chấm lại strategy'
  return value.replace(/_/g, ' ')
}

function stageLabel(value?: string | null) {
  const key = String(value || '').toUpperCase()
  if (key === 'COMPLETED') return 'Hoàn tất'
  if (key === 'SELECTING_CANDIDATES') return 'Đang chọn bài'
  return value || 'Đang xử lý'
}

function humanPlanningReason(reason: string, job: PlanningRun) {
  return reason
    .replace(`profile ${job.profile.profile_id}`, `profile ${job.profile.profile_name}`)
    .replace(/Evaluated (\d+) (?:GLOBAL )?candidate items/i, 'Đã đánh giá $1 nội dung Global')
    .replace(/with topic cosine threshold scoring\./i, 'bằng ngưỡng cosine theo chủ đề.')
    .replace(/against strategy embedding vector\./i, 'theo vector chiến lược.')
    .replace(/(\d+) candidates passed similarity threshold and avoid-topic filters\./i, '$1 nội dung vượt ngưỡng similarity và bộ lọc chủ đề tránh.')
    .replace(/(\d+) candidates passed similarity threshold and topic filters\./i, '$1 nội dung vượt ngưỡng similarity và bộ lọc chủ đề.')
}

type PipelineStep = 'jobs' | 'plans' | 'series'
type VisiblePipelineStep = Exclude<PipelineStep, 'series'>

const visiblePipelineStep = (step: PipelineStep): VisiblePipelineStep => step === 'series' ? 'plans' : step

const isTopicConfigError = (job: PlanningRun) =>
  job.status === 'FAILED' &&
  !!job.error_message &&
  (job.error_message.includes('Content Topics') || job.error_message.includes('content_topics') || job.error_message.includes('chu de') || job.error_message.includes('Chua cau hinh'))

export default function PlanningPage({
  initialStep = 'jobs',
  isSystemUser = false,
  onOpenProfileSettings,
  onOpenGenerateVideo,
}: {
  initialStep?: PipelineStep
  isSystemUser?: boolean
  onOpenProfileSettings?: (profileId: string) => void
  onOpenGenerateVideo?: (workflowId?: string) => void
}) {
  const initialVisibleStep = visiblePipelineStep(initialStep)
  const [activeStep, setActiveStep] = useState<VisiblePipelineStep>(initialVisibleStep)
  const activeStepRef = useRef<VisiblePipelineStep>(initialVisibleStep)
  const [jobs, setJobs] = useState<PlanningRun[]>([])
  const [selectedRun, setSelectedRun] = useState<PlanningRun | null>(null)
  const [runDetail, setRunDetail] = useState<PlanningRunDetail | null>(null)
  const [runDetailLoading, setRunDetailLoading] = useState(false)
  const runDetailRequest = useRef(0)
  const [reviewSeries, setReviewSeries] = useState<ProfileSeriesReview[]>([])
  const [profiles, setProfiles] = useState<PlanningProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string>(visiblePipelineStep(initialStep) === 'jobs' ? 'all' : '')
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const runsRequest = useRef(0)
  const currentRunFilter = useRef(selectedProfileId)
  useEffect(() => { currentRunFilter.current = selectedProfileId }, [selectedProfileId])

  const handleStepChange = (nextStep: VisiblePipelineStep) => {
    activeStepRef.current = nextStep
    setActiveStep(nextStep)
    setSelectedProfileId(current => {
      if (nextStep === 'jobs') return current || 'all'
      if (current !== 'all' && profiles.some(profile => profile.id === current)) return current
      return profiles[0]?.id || ''
    })
  }

  const loadRuns = useCallback(async () => {
    const profileId = currentRunFilter.current
    const request = ++runsRequest.current
    const response = await fetchPlanningRunsApi({ profile_id: profileId === 'all' ? undefined : profileId || undefined })
    if (request === runsRequest.current && profileId === currentRunFilter.current) setJobs(response.items)
  }, [])

  const [selectedReviewArticle, setSelectedReviewArticle] = useState<{
    article: ProfileSeriesReview['articles'][number]
    seriesTitle: string
  } | null>(null)
  const [selectedSourceContent, setSelectedSourceContent] = useState<ReviewSourceContent | null>(null)
  const [regeneratePlan, setRegeneratePlan] = useState<ContentPlan | null>(null)
  const [regenerateInstructions, setRegenerateInstructions] = useState('')
  const [regenerateSubmitting, setRegenerateSubmitting] = useState(false)
  const restoringWorkflow = useRef(false)
  const [restoreSubmitting, setRestoreSubmitting] = useState(false)

  const restoreRejectedPlan = async (plan: ContentPlan) => {
    if (plan.status !== 'REJECTED' || restoringWorkflow.current) return
    restoringWorkflow.current = true
    setRestoreSubmitting(true)
    try {
      await restoreContentPlanApi(plan.workflow_id || plan.id)
      toast.success('Đã khôi phục workflow. Draft auto vẫn cần được duyệt trong trình sửa trước khi sản xuất.')
      if (selectedProfileId) void loadProfilePlanning(selectedProfileId)
    } catch (error: unknown) {
      const failure = error as { response?: { data?: { detail?: string } } }
      toast.error(failure.response?.data?.detail || 'Không khôi phục được workflow.')
    } finally {
      restoringWorkflow.current = false
      setRestoreSubmitting(false)
    }
  }

  const [editingSeries, setEditingSeries] = useState<ContentSeries | null>(null)
  const [seriesModalOpen, setSeriesModalOpen] = useState(false)
  const [seriesSubmitting, setSeriesSubmitting] = useState(false)

  const [transferringArticle, setTransferringArticle] = useState<{
    workflowId: string
    title: string
    currentSeriesId?: string | null
  } | null>(null)
  const [transferSubmitting, setTransferSubmitting] = useState(false)

  const handleSaveSeries = async (formData: SeriesFormData) => {
    setSeriesSubmitting(true)
    try {
      if (editingSeries) {
        await updateContentSeriesApi(editingSeries.id, formData)
        toast.success('Đã cập nhật series thành công!')
      } else {
        await createContentSeriesApi({ ...formData, profile_id: selectedProfileId || formData.profile_id })
        toast.success('Đã tạo series mới!')
      }
      setSeriesModalOpen(false)
      setEditingSeries(null)
      if (selectedProfileId) void loadProfilePlanning(selectedProfileId)
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Lỗi khi lưu series!')
    } finally {
      setSeriesSubmitting(false)
    }
  }

  const handleDeleteSeries = async (seriesItem: ContentSeries) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa series "${seriesItem.title}"?`)) return
    try {
      await deleteContentSeriesApi(seriesItem.id)
      toast.success(`Đã xóa series "${seriesItem.title}"`)
      if (selectedProfileId) void loadProfilePlanning(selectedProfileId)
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Lỗi khi xóa series!')
    }
  }

  const handleTransferArticleSeries = async (targetSeriesId: string | null) => {
    if (!transferringArticle) return
    setTransferSubmitting(true)
    try {
      await updateVideoWorkspaceApi(transferringArticle.workflowId, { series_id: targetSeriesId })
      toast.success('Đã chuyển bài qua series mới!')
      setTransferringArticle(null)
      if (selectedProfileId) void loadProfilePlanning(selectedProfileId)
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Lỗi khi chuyển series cho bài viết!')
    } finally {
      setTransferSubmitting(false)
    }
  }

  const handleOpenRunDetail = async (run: PlanningRun) => {
    const request = ++runDetailRequest.current
    setSelectedRun(run)
    setRunDetail(null)
    setRunDetailLoading(true)
    try {
      const detail = await fetchPlanningRunDetailApi(run.id)
      if (request === runDetailRequest.current) setRunDetail(detail)
    } catch (error: any) {
      if (request === runDetailRequest.current) toast.error(error?.response?.data?.detail || error?.message || 'Không thể tải chi tiết Planning Run')
    } finally {
      if (request === runDetailRequest.current) setRunDetailLoading(false)
    }
  }

  const handleCandidateChanged = async (result?: PlanningCandidateReviewResult) => {
    if (!selectedRun) return
    const request = runDetailRequest.current
    if (result) setRunDetail(current => {
      if (current?.id !== selectedRun.id) return current
      const applyReview = <T extends { id: string; workflow_id?: string | null }>(candidate: T) => candidate.id === result.candidate_id
        ? { ...candidate, review: result.review, workflow_id: result.workflow_id || candidate.workflow_id } : candidate
      return current.schema_version === 3
        ? { ...current, candidates: current.candidates.map(applyReview) }
        : { ...current, candidates: current.candidates.map(applyReview) }
    })
    const [detail] = await Promise.all([fetchPlanningRunDetailApi(selectedRun.id), loadRuns()])
    if (request === runDetailRequest.current) {
      setRunDetail(detail)
    }
  }

  const hasPendingCandidate = runDetail?.id === selectedRun?.id && runDetail?.candidates.some(candidate => candidate.review?.status === 'QUEUED')
  useEffect(() => {
    if (!selectedRun || !hasPendingCandidate) return
    const runId = selectedRun.id
    const request = runDetailRequest.current
    let cancelled = false
    let fetching = false
    const timer = setInterval(async () => {
      if (fetching) return
      fetching = true
      try {
        const [detail] = await Promise.all([fetchPlanningRunDetailApi(runId), loadRuns()])
        if (!cancelled && request === runDetailRequest.current) {
          setRunDetail(detail)
        }
      } catch { /* Keep the current result; the next poll can recover. */ }
      finally { fetching = false }
    }, 3000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [selectedRun, hasPendingCandidate, loadRuns])

  const [loading, setLoading] = useState(true)
  const [plansLoading, setPlansLoading] = useState(false)

  const selectedProfile = useMemo(
    () => profiles.find(profile => profile.id === selectedProfileId),
    [profiles, selectedProfileId],
  )

  const loadProfilePlanning = async (profileId: string) => {
    setPlansLoading(true)
    try {
      const nextReviewSeries = await fetchProfileSeriesReviewApi(profileId)
      setReviewSeries(nextReviewSeries)
    } catch (error: any) {
      setReviewSeries([])
      toast.error(error?.response?.data?.detail || 'Không thể tải kế hoạch theo profile')
    } finally {
      setPlansLoading(false)
    }
  }

  const loadProfiles = async () => {
    setLoadingProfiles(true)
    try {
      const profileResponse = await fetchSocialProfilesApi()
      const nextProfiles = profileResponse.items || []
      setProfiles(nextProfiles)
      setSelectedProfileId(current => {
        const currentStep = activeStepRef.current
        if (currentStep === 'jobs' && current === 'all') return current
        if (nextProfiles.some(profile => profile.id === current)) return current
        return currentStep === 'jobs' ? 'all' : nextProfiles[0]?.id || ''
      })
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể tải kênh social')
    } finally {
      setLoadingProfiles(false)
    }
  }

  useEffect(() => {
    void loadProfiles()
  }, [])

  useEffect(() => {
    if (activeStep !== 'jobs') { setLoading(false); return }
    let cancelled = false
    setJobs([])
    setLoading(true)
    loadRuns().catch((error) => {
      if (!cancelled) toast.error(error?.response?.data?.detail || 'Không thể tải dữ liệu Lập kế hoạch hệ thống')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; runsRequest.current += 1 }
  }, [activeStep, selectedProfileId, loadRuns])

  useEffect(() => {
    if (activeStep !== 'plans') return
    if (!selectedProfileId || selectedProfileId === 'all') {
      setReviewSeries([])
      return
    }
    void loadProfilePlanning(selectedProfileId)
  }, [activeStep, selectedProfileId])

  useEffect(() => {
    if (activeStep !== 'jobs') return
    const interval = setInterval(() => {
      const hasRunningJobs = jobs.some((job) => !['COMPLETED', 'FAILED', 'SUCCEEDED'].includes(job.status))
      if (hasRunningJobs) {
        loadRuns().catch(() => {})
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [activeStep, jobs, loadRuns])

  useEffect(() => {
    if (!selectedReviewArticle) return
    const selectedPlanId = selectedReviewArticle.article.plan?.id
    const stillExists = reviewSeries.some(item => item.articles.some(article => {
      if (selectedPlanId && article.plan?.id === selectedPlanId) return true
      return false
    }))
    if (stillExists) return
    setSelectedReviewArticle(null)
  }, [reviewSeries, selectedReviewArticle])

  const pageTitle = activeStep === 'jobs'
    ? 'Lịch Sử Auto Planning'
    : 'Duyệt Plan & Series'
  const pageDescription = activeStep === 'jobs'
    ? 'Theo dõi đầu vào, kết quả chọn content và lý do của mỗi lần auto planning sau crawl.'
    : 'Duyệt kế hoạch theo từng social profile, nhóm theo series và xem từng bài trong series.'

  const handleRefresh = () => {
    if (activeStep === 'plans' && selectedProfileId && selectedProfileId !== 'all') {
      void loadProfilePlanning(selectedProfileId)
      return
    }
    void Promise.all([loadProfiles(), loadRuns()]).catch((error) => toast.error(error?.response?.data?.detail || 'Không thể tải dữ liệu Lập kế hoạch hệ thống'))
  }

  const openRegenerateArticle = (plan: ContentPlan) => {
    setRegeneratePlan(plan)
    setRegenerateInstructions('')
  }

  const submitRegenerateArticle = async () => {
    if (!regeneratePlan) return
    setRegenerateSubmitting(true)
    try {
      await regenerateContentPlanApi(regeneratePlan.id, regenerateInstructions.trim() || undefined)
      toast.success('Đã gửi yêu cầu viết lại bài. Job mới sẽ xuất hiện ở trang Tiến Trình Job.')
      setRegeneratePlan(null)
      setRegenerateInstructions('')
      if (selectedProfileId) void loadProfilePlanning(selectedProfileId)
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể gửi yêu cầu viết lại bài')
    } finally {
      setRegenerateSubmitting(false)
    }
  }

  return (
    <div className="workspace-page">
      <div className="workspace-header">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="workspace-title">{pageTitle}</h2>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${!isSystemUser ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
                {!isSystemUser ? 'CREATOR WORKSPACE' : 'SYSTEM OVERVIEW'}
              </span>
            </div>
            <p className="workspace-subtitle">{pageDescription}</p>
          </div>
          <button onClick={handleRefresh} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0ea] bg-white px-3 text-xs font-semibold text-[#475569] hover:bg-slate-50 transition-colors">
            <RefreshCcw size={15} /> Tải lại
          </button>
        </div>
      </div>

      <div className="inline-flex w-fit rounded-lg border border-[#d9e0ea] bg-white p-1 shadow-sm" role="tablist" aria-label="Chế độ quản lý planning">
        <button
          type="button"
          role="tab"
          aria-selected={activeStep === 'jobs'}
          onClick={() => handleStepChange('jobs')}
          className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-bold transition-colors ${activeStep === 'jobs' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          <FileText size={14} /> Lịch sử Auto Planning
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeStep === 'plans'}
          onClick={() => handleStepChange('plans')}
          className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-bold transition-colors ${activeStep === 'plans' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          <ArrowRightLeft size={14} /> Duyệt plan & Series
        </button>
      </div>

      <SocialProfileFilter profiles={profiles} value={selectedProfileId} onChange={setSelectedProfileId} allOption={activeStep === 'jobs'} loading={loadingProfiles} />

      {loading ? (
        <div className="flex items-center justify-center p-12 text-[#64748b]">
          <Loader2 className="animate-spin mr-2" size={24} /> Đang xử lý...
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          {activeStep === 'jobs' && (
            <div className="space-y-4">
              {jobs.length === 0 ? <div className="workspace-card"><Empty label="Chưa có lần Auto Planning nào cho kênh đã chọn" /></div> : jobs.map((job) => (
                <div
                  key={job.id}
                  onClick={() => handleOpenRunDetail(job)}
                  title={`Planning run ${job.id}`}
                  className="workspace-card relative overflow-hidden p-0 hover:shadow-md transition-shadow cursor-pointer group"
                >
                  <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 flex-1 gap-3">
                      <SocialProfileAvatar
                        avatarUrl={job.profile.profile_avatar_url}
                        name={job.profile.profile_name}
                        platform={job.profile.profile_platform || 'tiktok'}
                        size="xl"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                        <PlanningStatusBadge value={job.status} />
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold uppercase text-slate-600">{job.planning_mode}</span>
                          {job.trigger && <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-bold uppercase text-blue-700">{triggerLabel(job.trigger)}</span>}
                        </div>
                        <h3 className="mt-2 line-clamp-2 text-base font-black leading-6 text-slate-900 group-hover:text-[var(--accent)]">
                          {planningRunTitle(job)}
                        </h3>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-slate-500">
                          <span className="truncate">
                            {job.profile.profile_name}
                            {job.profile.profile_username ? ` (@${job.profile.profile_username})` : ''}
                            {job.profile.profile_platform ? ` · ${platformLabel(job.profile.profile_platform)}` : ''}
                          </span>
                        </div>
                        <div className="mt-3 text-sm font-bold text-slate-700">
                          {planningRunOutcome(job)}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-start justify-between gap-3 lg:min-w-[190px] lg:flex-col lg:items-end">
                      <div className="text-right">
                        <div className="text-lg font-black text-slate-800">{Number(job.progress_percent).toFixed(0)}%</div>
                        <div className="text-xs uppercase font-bold text-slate-400 tracking-wider">{stageLabel(job.current_stage)}</div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleOpenRunDetail(job)
                        }}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-[#d9e0ea] bg-white px-2.5 text-xs font-bold text-slate-700 transition-colors shadow-sm hover:bg-slate-50"
                      >
                        <FileText size={12} className="text-[#3525cd]" /> Chi tiết
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 border-t border-slate-100 bg-slate-50/50 px-4 py-3 sm:grid-cols-3">
                    <RunMetric label="Content đầu vào" value={job.candidate_count} />
                    <RunMetric label="Đủ điều kiện" value={job.eligible_count} />
                    <RunMetric label="Đã tạo workflow" value={job.selected_count} accent />
                  </div>
                  {(job.selection_reasons || []).length > 0 && (
                    <div className="border-t border-slate-100 px-4 py-3">
                      <div className="text-xs font-black uppercase text-slate-400">Tóm tắt xử lý</div>
                      {(job.selection_reasons || []).slice(0, 2).map((reason) => (
                        <div key={reason} className="mt-1 text-xs leading-5 text-slate-600">{humanPlanningReason(reason, job)}</div>
                      ))}
                    </div>
                  )}
                  {isTopicConfigError(job) && (
                    <div
                      className="mx-4 mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
                      <div className="flex-1">
                        <p className="font-bold text-amber-800">Chưa cấu hình chủ đề nội dung</p>
                        <p className="mt-0.5 text-amber-700">Profile này chưa có <strong>Content Topics</strong>. Auto Planning cần ít nhất 1 chủ đề để chọn bài phù hợp.</p>
                      </div>
                      <button
                        onClick={() => onOpenProfileSettings?.(job.profile.profile_id)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 transition-colors"
                      >
                        <Settings2 size={13} /> Cấu hình ngay
                      </button>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-400">
                    <span>Bắt đầu {formatDate(job.started_at || job.created_at)}</span>
                    <span>Hoàn tất {formatDate(job.completed_at)}</span>
                    <span className="inline-flex items-center gap-1">
                      Mở chi tiết
                      <ChevronRight size={13} className="transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeStep === 'plans' && (
            <div className="space-y-5">
              <div className="rounded-xl border border-[#d9e0ea] bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-[#eef2f7] bg-[#f8fafc] px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-sm font-bold text-[#0f172a]">Duyệt theo social profile</div>
                    <div className="text-xs text-[#64748b]">
                      {selectedProfile ? `${selectedProfile.profile_name}${selectedProfile.username ? ` (@${selectedProfile.username})` : ''}` : 'Chọn account để xem kế hoạch riêng'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setEditingSeries(null); setSeriesModalOpen(true) }}
                      className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-blue-700"
                    >
                      <Plus size={15} /> Tạo series mới
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                {plansLoading ? (
                  <div className="loading-state">
                    <Loader2 className="mr-2 animate-spin" size={18} /> Đang tải series của profile...
                  </div>
                ) : reviewSeries.length === 0 ? (
                  <div className="workspace-card"><Empty label="Profile này chưa có series nào để duyệt" /></div>
                ) : reviewSeries.map((item) => (
                  <section key={item.series.id} className="rounded-xl border border-[#d9e0ea] bg-white p-5 shadow-sm">
                    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <PlanningStatusBadge value={item.series.status} />
                          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold uppercase tracking-wider text-slate-600">{item.series.series_type}</span>
                          <span className="text-xs font-semibold text-slate-500">{item.articles.length} bài</span>
                        </div>
                        <h3 className="text-xl font-black text-[#0f172a]">{item.series.title}</h3>
                        <p className="mt-1 line-clamp-2 max-w-3xl text-sm leading-6 text-slate-600">{item.series.description || 'Các bài trong series này được nhóm theo nguồn content và mỗi bài có story_data riêng.'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setEditingSeries(item.series); setSeriesModalOpen(true) }}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-xs transition-colors hover:bg-slate-50"
                        >
                          <Pencil size={13} /> Sửa series
                        </button>
                        <button
                          onClick={() => void handleDeleteSeries(item.series)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 text-xs font-bold text-rose-700 transition-colors hover:bg-rose-100"
                        >
                          <Trash2 size={13} /> Xóa
                        </button>
                      </div>
                    </div>

                    <div className="table-scroll rounded-lg border border-[#eef2f7] bg-white">
                      <div className="data-grid-lg">
                        <div className="grid grid-cols-[96px_2fr_0.75fr_0.85fr_0.7fr_0.8fr_1.35fr] gap-3 bg-[#f8fafc] px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#64748b]">
                          <div>Preview</div>
                          <div>Bài báo gốc</div>
                          <div>Nguồn</div>
                          <div>Category ID</div>
                          <div>Quality</div>
                          <div>Kịch bản</div>
                          <div className="text-right">Thao tác</div>
                        </div>
                      {item.articles.length === 0 ? (
                        <div className="w-full rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Series này chưa có bài.</div>
                      ) : item.articles.map((article, articleIndex) => (
                        <div
                          key={article.plan?.id || `${item.series.id}-${articleIndex}`}
                          onClick={() => setSelectedReviewArticle({ article, seriesTitle: item.series.title })}
                          className="grid cursor-pointer grid-cols-[96px_2fr_0.75fr_0.85fr_0.7fr_0.8fr_1.35fr] items-center gap-3 border-t border-[#eef2f7] px-4 py-3 text-sm transition-colors hover:bg-slate-50"
                        >
                          <ContentItemPreview media={article.source_content?.media} />
                          <div className="min-w-0">
                            <div className="truncate font-bold text-[#0f172a]">
                              {article.source_content?.canonical_title || article.plan?.title || 'Bài chưa liên kết nguồn'}
                            </div>
                            <div className="mt-0.5 truncate text-xs text-[#64748b]">
                              {article.source_content?.summary || article.source_content?.canonical_url || article.plan?.content_angle || shortId(article.plan?.id || item.series.id)}
                            </div>
                          </div>
                          <div className="font-medium text-[#64748b]">{article.source_content?.source_type || article.source_content?.content_type || '-'}</div>
                          <div className="truncate font-mono text-xs font-bold text-[#475569]">{sourceCategoryId(article.source_content) || '-'}</div>
                          <div className="font-bold text-[#0f172a]">{article.source_content ? Number(article.source_content.quality_score || 0).toFixed(1) : '-'}</div>
                          <div className="flex items-center gap-2">
                            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold uppercase tracking-wider text-slate-600">{getArticleStoryData(article).length} scene</span>
                          </div>
                          <div className="flex justify-end">
                            <TableRowActions
                              actions={([
                                article.source_content ? {
                                  label: 'View full bài gốc',
                                  icon: <FileText size={14} />,
                                  onClick: () => setSelectedReviewArticle({ article, seriesTitle: item.series.title }),
                                } : null,
                                {
                                  label: 'Chuyển series',
                                  icon: <ArrowRightLeft size={14} />,
                                  onClick: () => {
                                    const workflowId = article.plan?.workflow_id || article.plan?.id
                                    if (workflowId) {
                                      setTransferringArticle({
                                        workflowId,
                                        title: article.plan?.title || article.source_content?.canonical_title || 'Bài viết',
                                        currentSeriesId: item.series.id,
                                      })
                                    } else {
                                      toast.error('Bài này chưa tạo workflow kịch bản để chuyển series')
                                    }
                                  },
                                },
                                article.plan ? {
                                  label: 'Mở Studio Editor',
                                  icon: <FileText size={14} />,
                                  onClick: () => onOpenGenerateVideo?.(article.plan!.workflow_id || article.plan!.id),
                                } : null,
                                article.plan ? {
                                  label: 'Viết lại kịch bản',
                                  icon: <RefreshCcw size={14} />,
                                  onClick: () => openRegenerateArticle(article.plan!),
                                } : null,
                                article.plan?.status === 'REJECTED' ? {
                                  label: 'Khôi phục workflow',
                                  icon: <RefreshCcw size={14} />,
                                  onClick: () => void restoreRejectedPlan(article.plan!),
                                } : null,
                                article.plan ? {
                                  label: 'Từ chối kịch bản',
                                  icon: <XCircle size={14} />,
                                  onClick: async () => {
                                    try {
                                      await rejectContentPlanApi(article.plan!.workflow_id || article.plan!.id, 'Không đạt yêu cầu')
                                      toast.success('Đã từ chối kịch bản.')
                                      if (selectedProfileId) void loadProfilePlanning(selectedProfileId)
                                    } catch (err: any) {
                                      toast.error(err?.response?.data?.detail || 'Lỗi từ chối!')
                                    }
                                  },
                                  danger: true,
                                } : null,
                              ].filter(Boolean)) as TableRowActionItem[]}
                            />
                          </div>
                        </div>
                      ))}
                      </div>
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {seriesModalOpen && (
        <SeriesModal
          key={editingSeries?.id || 'new-series-planning'}
          seriesToEdit={editingSeries}
          profiles={profiles}
          isSubmitting={seriesSubmitting}
          onClose={() => { setSeriesModalOpen(false); setEditingSeries(null) }}
          onSubmit={(data) => void handleSaveSeries(data)}
        />
      )}

      {transferringArticle && (
        <TransferSeriesModal
          itemTitle={transferringArticle.title}
          currentSeriesId={transferringArticle.currentSeriesId}
          seriesList={reviewSeries.map((item) => item.series)}
          isSubmitting={transferSubmitting}
          onClose={() => setTransferringArticle(null)}
          onSubmit={(targetSeriesId) => void handleTransferArticleSeries(targetSeriesId)}
          onCreateNewSeries={() => {
            setTransferringArticle(null)
            setEditingSeries(null)
            setSeriesModalOpen(true)
          }}
        />
      )}

      <ArticleReviewSheet
        selection={selectedReviewArticle}
        open={!!selectedReviewArticle}
        onOpenChange={(open) => !open && setSelectedReviewArticle(null)}
        onOpenSource={(source) => setSelectedSourceContent(source)}
        onOpenWorkflow={onOpenGenerateVideo}
      />

      <SourceContentSheet
        source={selectedSourceContent}
        open={!!selectedSourceContent}
        onOpenChange={(open) => !open && setSelectedSourceContent(null)}
      />

      <RegeneratePlanSheet
        plan={regeneratePlan}
        instructions={regenerateInstructions}
        submitting={regenerateSubmitting}
        onInstructionsChange={setRegenerateInstructions}
        onClose={() => setRegeneratePlan(null)}
        onSubmit={() => void submitRegenerateArticle()}
      />
      <PlanningRunDetailSheet
        onCandidateChanged={handleCandidateChanged}
        onOpenWorkflow={onOpenGenerateVideo}
        run={selectedRun}
        detail={runDetail}
        loading={runDetailLoading}
        onClose={() => {
          runDetailRequest.current += 1
          setSelectedRun(null)
          setRunDetail(null)
          setRunDetailLoading(false)
        }}
        onOpenProfileSettings={onOpenProfileSettings}
      />
    </div>
  )
}

function RunMetric({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${accent ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-slate-50'}`}>
      <div className="text-xs font-black uppercase text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-black tabular-nums ${accent ? 'text-blue-700' : 'text-slate-800'}`}>{value}</div>
    </div>
  )
}

function Empty({ label }: { label: string }) {
  return <div className="empty-state m-3">{label}</div>
}
