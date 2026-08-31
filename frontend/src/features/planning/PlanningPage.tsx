import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  AlertTriangle,
  ArrowRightLeft,
  ChevronRight,
  ExternalLink,
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
  type StoryScene,
} from '@/commons/apis/planning'
import { updateVideoWorkspaceApi } from '@/commons/apis/generateVideo'
import { fetchSocialProfilesApi } from '@/commons/apis/socialProfiles'
import { MediaAssetPreview, mediaPlaybackUrl, mediaPreviewUrl, isImageMedia, isVideoMedia } from '@/commons/media'
import { SocialProfileAvatar, platformLabel } from '@/commons/component/social-ui'
import { Sheet, SheetContent } from '@/commons/component/ui/sheet'
import { SeriesModal, TransferSeriesModal, type SeriesFormData } from '@/features/generate-video/components/SeriesModal'
import { PlanningRunDetailSheet } from './PlanningRunDetailSheet'
import { OpenDraftWorkspaceButton } from './OpenDraftWorkspaceButton'

const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString('vi-VN') : '-'
const shortId = (value: string) => value.slice(0, 8)

function planningRunTitle(job: PlanningRun) {
  if (job.workflow_title) return job.workflow_title
  if (job.selected_count > 0) return `Đã chọn ${job.selected_count} nội dung cho ${job.profile_name}`
  if (job.eligible_count > 0) return `${job.eligible_count} nội dung đủ điều kiện chờ tạo workflow`
  if (job.candidate_count > 0) return `Chưa có nội dung phù hợp từ ${job.crawl_job_name || 'crawl job'}`
  return `Không có nội dung mới từ ${job.crawl_job_name || 'crawl job'}`
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
    .replace(`profile ${job.profile_id}`, `profile ${job.profile_name}`)
    .replace(/Evaluated (\d+) candidate items/i, 'Đã đánh giá $1 nội dung')
    .replace(/with topic cosine threshold scoring\./i, 'bằng ngưỡng cosine theo chủ đề.')
    .replace(/against strategy embedding vector\./i, 'theo vector chiến lược.')
    .replace(/(\d+) candidates passed similarity threshold and avoid-topic filters\./i, '$1 nội dung vượt ngưỡng similarity và bộ lọc chủ đề tránh.')
    .replace(/(\d+) candidates passed similarity threshold and topic filters\./i, '$1 nội dung vượt ngưỡng similarity và bộ lọc chủ đề.')
}

type PipelineStep = 'jobs' | 'plans' | 'series'

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
  const activeStep = initialStep
  const [jobs, setJobs] = useState<PlanningRun[]>([])
  const [selectedRun, setSelectedRun] = useState<PlanningRun | null>(null)
  const [runDetail, setRunDetail] = useState<PlanningRunDetail | null>(null)
  const [runDetailLoading, setRunDetailLoading] = useState(false)
  const runDetailRequest = useRef(0)
  const [reviewSeries, setReviewSeries] = useState<ProfileSeriesReview[]>([])
  const [profiles, setProfiles] = useState<PlanningProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')

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
    const [detail, nextRuns] = await Promise.all([fetchPlanningRunDetailApi(selectedRun.id), fetchPlanningRunsApi()])
    if (request === runDetailRequest.current) {
      setRunDetail(detail)
      setJobs(nextRuns.items)
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
        const [detail, nextRuns] = await Promise.all([fetchPlanningRunDetailApi(runId), fetchPlanningRunsApi()])
        if (!cancelled && request === runDetailRequest.current) {
          setRunDetail(detail)
          setJobs(nextRuns.items)
        }
      } catch { /* Keep the current result; the next poll can recover. */ }
      finally { fetching = false }
    }, 3000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [selectedRun, hasPendingCandidate])

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

  const loadData = async () => {
    setLoading(true)
    try {
      if (activeStep === 'jobs') {
        const nextRuns = await fetchPlanningRunsApi()
        setJobs(nextRuns.items)
        return
      }

      if (activeStep === 'plans') {
        const profileResponse = await fetchSocialProfilesApi()
        const nextProfiles = profileResponse.items || profileResponse || []
        setProfiles(nextProfiles)
        setSelectedProfileId((current) => current || nextProfiles[0]?.id || '')
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể tải dữ liệu AI Planning')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    if (activeStep !== 'plans') return
    if (!selectedProfileId) {
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
        fetchPlanningRunsApi().then((response) => setJobs(response.items)).catch(() => {})
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [activeStep, jobs])

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
    : 'Duyệt Thành Phẩm'
  const pageDescription = activeStep === 'jobs'
    ? 'Theo dõi đầu vào, kết quả chọn content và lý do của mỗi lần auto planning sau crawl.'
    : 'Duyệt kế hoạch theo từng social profile, nhóm theo series và xem từng bài trong series.'

  const handleRefresh = () => {
    if (activeStep === 'plans' && selectedProfileId) {
      void loadProfilePlanning(selectedProfileId)
      return
    }
    void loadData()
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
                {!isSystemUser ? 'PRIVATE WORKSPACE' : 'SYSTEM OVERVIEW'}
              </span>
            </div>
            <p className="workspace-subtitle">{pageDescription}</p>
          </div>
          <button onClick={handleRefresh} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0ea] bg-white px-3 text-xs font-semibold text-[#475569] hover:bg-slate-50 transition-colors">
            <RefreshCcw size={15} /> Tải lại
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-12 text-[#64748b]">
          <Loader2 className="animate-spin mr-2" size={24} /> Đang xử lý...
        </div>
      ) : (
        <div className="min-h-[600px]">
          {activeStep === 'jobs' && (
            <div className="space-y-4">
              {jobs.length === 0 ? <div className="workspace-card"><Empty label="Chưa có lần Auto Planning nào" /></div> : jobs.map((job) => (
                <div
                  key={job.id}
                  onClick={() => handleOpenRunDetail(job)}
                  title={`Planning run ${job.id}`}
                  className="workspace-card relative overflow-hidden p-0 hover:shadow-md transition-shadow cursor-pointer group"
                >
                  <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 flex-1 gap-3">
                      <SocialProfileAvatar
                        avatarUrl={job.profile_avatar_url}
                        name={job.profile_name}
                        platform={job.profile_platform || 'tiktok'}
                        size="xl"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge value={job.status} />
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">{job.planning_mode}</span>
                          {job.trigger && <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-700">{triggerLabel(job.trigger)}</span>}
                        </div>
                        <h3 className="mt-2 line-clamp-2 text-base font-black leading-6 text-slate-900 group-hover:text-[var(--accent)]">
                          {planningRunTitle(job)}
                        </h3>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-slate-500">
                          <span className="truncate">
                            {job.profile_name}
                            {job.profile_username ? ` (@${job.profile_username})` : ''}
                            {job.profile_platform ? ` · ${platformLabel(job.profile_platform)}` : ''}
                          </span>
                          <span className="truncate">Nguồn: {job.crawl_job_name || 'Crawl job'}</span>
                        </div>
                        <div className="mt-3 text-sm font-bold text-slate-700">
                          {planningRunOutcome(job)}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-start justify-between gap-3 lg:min-w-[190px] lg:flex-col lg:items-end">
                      <div className="text-right">
                        <div className="text-lg font-black text-slate-800">{Number(job.progress_percent).toFixed(0)}%</div>
                        <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">{stageLabel(job.current_stage)}</div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleOpenRunDetail(job)
                        }}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-[#d9e0ea] bg-white px-2.5 text-[11px] font-bold text-slate-700 transition-colors shadow-sm hover:bg-slate-50"
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
                      <div className="text-[10px] font-black uppercase text-slate-400">Tóm tắt xử lý</div>
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
                        onClick={() => onOpenProfileSettings?.(job.profile_id)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 transition-colors"
                      >
                        <Settings2 size={13} /> Cấu hình ngay
                      </button>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-[11px] text-slate-400">
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
                    <select
                      value={selectedProfileId}
                      onChange={(event) => setSelectedProfileId(event.target.value)}
                      className="h-10 rounded-lg border border-[#d9e0ea] bg-white px-3 text-sm font-semibold text-[#0f172a] outline-none focus:border-[#3525cd]"
                    >
                      {profiles.length === 0 && <option value="">Chưa có social profile</option>}
                      {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.profile_name}{profile.username ? ` (@${profile.username})` : ''} - {profile.platform}
                        </option>
                      ))}
                    </select>
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
                          <Badge value={item.series.status} />
                          <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">{item.series.series_type}</span>
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
                            <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">{getArticleStoryData(article).length} scene</span>
                          </div>
                          <div className="flex justify-end gap-2 flex-wrap">
                            <button
                              onClick={(event) => {
                                event.stopPropagation()
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
                              }}
                              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 transition-colors"
                            >
                              <ArrowRightLeft size={14} /> Chuyển series
                            </button>
                            {article.source_content && (
                              <button
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setSelectedReviewArticle({ article, seriesTitle: item.series.title })
                                }}
                                className="inline-flex h-9 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 hover:bg-blue-100"
                              >
                                <FileText size={15} /> View full
                              </button>
                            )}
                            {article.plan && (
                              <>
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    openRegenerateArticle(article.plan!)
                                  }}
                                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#d9e0ea] bg-white px-3 text-xs font-bold text-[#475569] hover:bg-slate-50"
                                >
                                  <RefreshCcw size={15} /> Viết lại
                                </button>
                                <OpenDraftWorkspaceButton workflowId={article.plan.workflow_id || article.plan.id} onOpenWorkflow={onOpenGenerateVideo}
                                  reviewRequired={article.plan.current_stage ? article.plan.current_stage === 'DRAFT_REVIEW_REQUIRED' : undefined}
                                  rejected={article.plan.status === 'REJECTED'} />
                                {article.plan.status === 'REJECTED' && <button type="button" disabled={restoreSubmitting}
                                  onClick={event => { event.stopPropagation(); void restoreRejectedPlan(article.plan!) }}
                                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-bold text-amber-800 disabled:opacity-50"
                                >Khôi phục workflow</button>}
                                <button
                                  onClick={async (event) => {
                                    event.stopPropagation()
                                    try {
                                      await rejectContentPlanApi(article.plan!.workflow_id || article.plan!.id, 'Không đạt yêu cầu')
                                      toast.success('Đã từ chối kịch bản.')
                                      if (selectedProfileId) void loadProfilePlanning(selectedProfileId)
                                    } catch (err: any) {
                                      toast.error(err?.response?.data?.detail || 'Lỗi từ chối!')
                                    }
                                  }}
                                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-200 bg-white px-3 text-xs font-bold text-red-600 hover:bg-red-50"
                                >
                                  <XCircle size={15} /> Từ chối
                                </button>
                              </>
                            )}
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

      <Sheet open={!!regeneratePlan} onOpenChange={(open) => !open && setRegeneratePlan(null)}>
        <SheetContent side="right" className="w-[calc(100vw-1rem)] max-w-[560px]">
          <div className="detail-shell">
            <div className="detail-header">
              <div className="mb-2 inline-flex rounded-md bg-blue-100 px-2 py-0.5 text-[10px] font-black uppercase text-blue-800">Regenerate bài</div>
              <h2 className="text-xl font-black leading-tight text-[#0f172a]">{regeneratePlan?.title || 'Viết lại bài'}</h2>
              <p className="mt-2 text-xs leading-5 text-[#64748b]">Nhập yêu cầu cụ thể để AI viết lại đúng bài này.</p>
            </div>

            <div className="detail-body space-y-4">
              <label className="block">
                <span className="detail-label mb-2 block">Yêu cầu viết lại</span>
                <textarea
                  value={regenerateInstructions}
                  onChange={(event) => setRegenerateInstructions(event.target.value)}
                  className="min-h-[180px] w-full resize-none rounded-md border border-[#d9e0ea] bg-white px-3 py-2 text-sm leading-6 text-[#0f172a] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-blue-100"
                  placeholder="Ví dụ: viết hook mạnh hơn, giọng căng hơn, chia thành nhiều scene ngắn hơn..."
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[#eef2f7] px-5 py-3">
              <button
                type="button"
                onClick={() => setRegeneratePlan(null)}
                className="inline-flex h-8 items-center rounded-md border border-[#d9e0ea] bg-white px-3 text-xs font-semibold text-[#475569] hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => void submitRegenerateArticle()}
                disabled={regenerateSubmitting}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-xs font-semibold text-white hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {regenerateSubmitting ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
                Gửi viết lại
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

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

function ArticleReviewSheet({
  selection,
  open,
  onOpenChange,
  onOpenSource,
  onOpenWorkflow,
}: {
  selection: { article: ProfileSeriesReview['articles'][number]; seriesTitle: string } | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenSource: (source: ReviewSourceContent) => void
  onOpenWorkflow?: (id: string) => void
}) {
  if (!selection) return null

  const { article, seriesTitle } = selection
  const source = article.source_content
  const sourceUrl = source?.source_url || source?.canonical_url
  const storyData = getArticleStoryData(article)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[calc(100vw-1rem)] max-w-[920px]">
        <div className="detail-shell">
          <div className="detail-header">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-[var(--primary)] px-2 py-0.5 text-[10px] font-black uppercase text-white">Bài review</span>
              {article.plan ? <Badge value={article.plan.status} /> : <Badge value="UNLINKED" />}
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">{storyData.length} scene</span>
            </div>
            <h2 className="text-xl font-black leading-tight text-[#0f172a]">{article.plan?.title || source?.canonical_title || 'Bài chưa liên kết kế hoạch'}</h2>
            <p className="mt-2 text-xs font-semibold text-[#64748b]">{seriesTitle}</p>
            {article.plan && <div className="mt-3 space-y-2">
              <OpenDraftWorkspaceButton workflowId={article.plan.workflow_id || article.plan.id}
                reviewRequired={article.plan.current_stage ? article.plan.current_stage === 'DRAFT_REVIEW_REQUIRED' : undefined}
                rejected={article.plan.status === 'REJECTED'}
                onOpenWorkflow={onOpenWorkflow ? id => { onOpenChange(false); onOpenWorkflow(id) } : undefined} />
              <p className="text-xs text-slate-500">Đây là bản xem nhanh. Mở trình sửa để xem đầy đủ lời thoại, liên kết ảnh/video và duyệt đúng phiên bản draft.</p>
            </div>}
          </div>

          <div className="detail-body">
            <div className="grid gap-4">
              {source && (
                <section className="detail-section border-blue-200 bg-blue-50/40">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-black uppercase text-blue-800">Bài gốc</span>
                        {source.source_type && <span className="text-xs font-bold text-slate-500">{source.source_type}</span>}
                        <span className="text-xs font-bold text-slate-500">Quality {Number(source.quality_score || 0).toFixed(0)}</span>
                      </div>
                      <h3 className="text-base font-black text-[#0f172a]">{source.canonical_title}</h3>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {sourceUrl && (
                        <a
                          href={sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-blue-200 bg-white px-3 text-xs font-bold text-blue-700 hover:bg-blue-50"
                        >
                          <ExternalLink size={15} /> Link nguồn
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => onOpenSource(source)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-xs font-bold text-white hover:bg-[var(--accent-strong)]"
                      >
                        <FileText size={15} /> View full
                      </button>
                    </div>
                  </div>

                  {source.summary && <p className="mb-4 text-sm leading-6 text-slate-700">{source.summary}</p>}

                  {(source.media || []).length > 0 && (
                    <ReviewMediaPreview source={source} onOpen={() => onOpenSource(source)} />
                  )}

                  <div className="max-h-[260px] overflow-y-auto rounded-md border border-blue-100 bg-white p-3">
                    <div className="detail-label mb-2">Nội dung gốc</div>
                    <div className="whitespace-pre-wrap text-sm leading-7 text-slate-800">
                      {source.full_text || source.summary || 'Backend chưa có full text cho bài này.'}
                    </div>
                  </div>
                </section>
              )}

              {article.plan && (
                <section className="detail-section">
                  <div className="detail-label mb-2">Metadata kịch bản</div>
                  <h3 className="text-base font-black text-[#0f172a]">{article.plan.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{article.plan.content_angle || 'Chưa có góc khai thác.'}</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tone</div>
                      <div className="mt-1 text-sm font-bold text-slate-800">{article.plan.tone || '-'}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Audience</div>
                      <div className="mt-1 text-sm font-bold text-slate-800">{article.plan.target_audience || '-'}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Duration</div>
                      <div className="mt-1 text-sm font-bold text-slate-800">{article.plan.target_duration_seconds ? `${article.plan.target_duration_seconds}s` : '-'}</div>
                    </div>
                  </div>
                </section>
              )}

              <section className="detail-section">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="detail-label">Story data</div>
                  <span className="text-xs font-bold text-slate-400">{storyData.length} scene</span>
                </div>
                {storyData.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Bài này chưa có story_data.</div>
                ) : (
                  <div className="grid gap-4">
                    {storyData.map((scene, index) => (
                      <div key={`${scene.image || 'scene'}-${index}`} className="rounded-md border border-slate-200 bg-[#fbfcfe] p-4">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-[var(--primary)] px-2 py-0.5 text-[10px] font-black uppercase text-white">Scene {index + 1}</span>
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">{scene.duration}s</span>
                          <span className="rounded-md bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">{scene.effect || 'slow-zoom'}</span>
                        </div>
                        <div className="mt-4 grid gap-4">
                          <DetailBlock title="Subtitle" tone="slate">
                            {scene.subtitle || 'Chưa có subtitle.'}
                          </DetailBlock>
                          {scene.voice_text && (
                            <DetailBlock title="Voice text" tone="blue">
                              {scene.voice_text}
                            </DetailBlock>
                          )}
                          {scene.image && (
                            <DetailBlock title="Image" tone="emerald">
                              {scene.image}
                            </DetailBlock>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function getArticleStoryData(article: ProfileSeriesReview['articles'][number]): StoryScene[] {
  return article.story_data || article.plan?.story_data || article.plan?.draft_json?.story_data || []
}

function sourceCategoryId(source?: ReviewSourceContent | null): string {
  if (!source) return ''
  const metadata = source.source_metadata || {}
  return String(source.categoryId || source.category_id || source.normalized?.categoryId || metadata.categoryId || metadata.category_id || '')
}

function ReviewMediaPreview({
  source,
  onOpen,
}: {
  source: ReviewSourceContent
  onOpen: () => void
}) {
  const mediaItems = (source.media || []).slice(0, 4)
  const remainingCount = Math.max(0, (source.media || []).length - mediaItems.length)

  return (
    <div className="mb-3 rounded-md border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="detail-label">Ảnh / video gốc</div>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:text-blue-900"
        >
          View full <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {mediaItems.map((item) => {
          return (
            <button
              key={item.id}
              type="button"
              onClick={onOpen}
              className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100 text-left hover:border-blue-300"
            >
              <MediaAssetPreview item={item} compact={false} />
            </button>
          )
        })}
        {remainingCount > 0 && (
          <button
            type="button"
            onClick={onOpen}
            className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm font-black text-slate-500 hover:border-blue-300 hover:bg-blue-50"
          >
            +{remainingCount}
          </button>
        )}
      </div>
    </div>
  )
}

function ContentItemPreview({ media }: { media?: ReviewSourceContent['media'] }) {
  const first = media?.[0]
  if (!first) {
    return (
      <div className="flex h-14 w-20 items-center justify-center rounded-md border border-dashed border-[#d9e0ea] bg-[#fbfcfd] text-[11px] text-[#94a3b8]">
        No media
      </div>
    )
  }
  const mediaUrl = mediaPlaybackUrl(first)
  const previewUrl = mediaPreviewUrl(first)
  const isVideo = isVideoMedia(first)

  if (!previewUrl && !mediaUrl) {
    return (
      <div className="flex h-14 w-20 items-center justify-center rounded-md border border-dashed border-[#d9e0ea] bg-[#fbfcfd] text-[11px] text-[#94a3b8]">
        No media
      </div>
    )
  }

  return (
    <div className="relative h-14 w-20 overflow-hidden rounded-md bg-black">
      {isVideo && mediaUrl ? (
        <MediaAssetPreview item={first} compact className="h-14 w-20" />
      ) : (
        <img
          src={previewUrl || ''}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={(event) => { event.currentTarget.src = 'https://placehold.co/160x112?text=No+Preview' }}
        />
      )}
    </div>
  )
}

function SourceContentSheet({
  source,
  open,
  onOpenChange,
}: {
  source: ReviewSourceContent | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!source) return null

  const sourceUrl = source.source_url || source.canonical_url
  const publishedAt = source.source_published_at || source.published_at
  const mediaItems = source.media || []
  const sources = source.sources || []
  const categoryId = sourceCategoryId(source)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[calc(100vw-1rem)] max-w-[860px]">
        <div className="detail-shell">
          <div className="detail-header">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-blue-100 px-2 py-0.5 text-[10px] font-black uppercase text-blue-800">Bài gốc</span>
              <Badge value={source.status} />
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">{source.content_type}</span>
            </div>
            <h2 className="text-xl font-black leading-tight text-[#0f172a]">{source.canonical_title}</h2>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-semibold text-[#64748b]">
              {source.source_type && <span>{source.source_type}</span>}
              {categoryId && <span>Category {categoryId}</span>}
              {source.source_author && <span>{source.source_author}</span>}
              <span>Quality {Number(source.quality_score || 0).toFixed(0)}</span>
              <span>{formatDate(publishedAt || source.created_at)}</span>
            </div>
          </div>

          <div className="detail-body">
            <div className="grid gap-4">
              {sourceUrl && (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 hover:bg-blue-100"
                >
                  <ExternalLink size={16} /> Mở link nguồn
                </a>
              )}

              {source.summary && (
                <DetailBlock title="Tóm tắt nguồn" tone="blue">
                  {source.summary}
                </DetailBlock>
              )}

              {mediaItems.length > 0 && (
                <section className="detail-section">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="detail-label">Ảnh / video gốc</div>
                    <span className="text-xs font-bold text-slate-400">{mediaItems.length} media</span>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {mediaItems.map((item) => {
                      const mediaUrl = mediaPlaybackUrl(item)
                      const thumbUrl = mediaPreviewUrl(item)
                      const isVideo = isVideoMedia(item)
                      const isImage = isImageMedia(item)

                      return (
                        <div key={item.id} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                          {mediaUrl && isVideo ? (
                            <MediaAssetPreview item={item} controls />
                          ) : thumbUrl && isImage ? (
                            <img src={thumbUrl} alt="" className="aspect-video w-full bg-slate-100 object-cover" loading="lazy" />
                          ) : thumbUrl ? (
                            <a href={thumbUrl} target="_blank" rel="noreferrer" className="flex aspect-video items-center justify-center gap-2 bg-slate-100 text-sm font-bold text-slate-600 hover:bg-slate-200">
                              <ExternalLink size={16} /> Mở media
                            </a>
                          ) : (
                            <div className="flex aspect-video items-center justify-center text-sm font-semibold text-slate-400">Không có URL media</div>
                          )}
                          <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] font-semibold text-slate-500">
                            <span className="uppercase">{item.media_type}</span>
                            {item.duration_seconds ? <span>{item.duration_seconds}s</span> : <span>{item.width && item.height ? `${item.width}x${item.height}` : ''}</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              <section className="detail-section">
                <div className="detail-label mb-3">Nội dung đầy đủ</div>
                <div className="whitespace-pre-wrap text-sm leading-7 text-slate-800">
                  {source.full_text || source.summary || 'Backend chưa có full text cho bài này. Có thể nguồn crawl chưa lưu raw document hoặc chưa normalize xong.'}
                </div>
              </section>

              {sources.length > 0 && (
                <section className="detail-section">
                  <div className="detail-label mb-3">Nguồn crawl</div>
                  <div className="space-y-2">
                    {sources.map((item) => (
                      <a
                        key={item.id}
                        href={item.source_url || '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm hover:border-blue-200 hover:bg-blue-50"
                      >
                        <span className="min-w-0 truncate font-semibold text-slate-700">{item.source_title || item.source_external_id || item.source_type}</span>
                        <ExternalLink size={15} className="shrink-0 text-slate-400" />
                      </a>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DetailBlock({
  title,
  tone,
  children,
}: {
  title: string
  tone: 'slate' | 'violet' | 'blue' | 'amber' | 'emerald'
  children: string
}) {
  const styles = {
    slate: 'border-slate-300 bg-slate-50 text-slate-800',
    violet: 'border-[#c7d2fe] bg-[#f5f2ff] text-[#312e81]',
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }

  return (
    <section className={`rounded-md border p-3 ${styles[tone]}`}>
      <div className="mb-2 text-[11px] font-black uppercase opacity-75">{title}</div>
      <p className="text-sm leading-6">{children}</p>
    </section>
  )
}

function Badge({ value }: { value: string }) {
  let color = 'bg-slate-100 text-slate-700'
  if (['SUCCEEDED', 'COMPLETED', 'READY', 'APPROVED'].includes(value)) color = 'bg-emerald-100 text-emerald-800'
  if (['FAILED', 'REJECTED'].includes(value)) color = 'bg-red-100 text-red-800'
  if (['RUNNING', 'PENDING', 'PROCESSING', 'GENERATED'].includes(value)) color = 'bg-blue-100 text-blue-800'
  if (['NEEDS_REVIEW'].includes(value)) color = 'bg-amber-100 text-amber-800'
  return <span className={`px-2 py-1 inline-flex items-center justify-center rounded-md text-[10px] font-bold uppercase tracking-wider ${color}`}>{value}</span>
}

function RunMetric({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${accent ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-slate-50'}`}>
      <div className="text-[10px] font-black uppercase text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-black tabular-nums ${accent ? 'text-blue-700' : 'text-slate-800'}`}>{value}</div>
    </div>
  )
}

function Empty({ label }: { label: string }) {
  return <div className="empty-state m-3">{label}</div>
}
