import { useEffect, useMemo, useState } from 'react'

import { Loader2, RefreshCcw, Video, CheckCircle2, XCircle, ChevronRight, Filter, Lightbulb, ListVideo, BrainCircuit, AlertTriangle, Settings2, FileText, ExternalLink } from 'lucide-react'

import {
  approveContentPlanApi,
  fetchProjectRunsApi,
  fetchProfileSeriesReviewApi,
  regenerateContentPlanApi,
  rejectContentPlanApi,
  type ContentPlan,
  type PlanningProfile,
  type ProjectRun,
  type ProfileSeriesReview,
  type ReviewSourceContent,
} from '@/commons/apis/planning'
import { fetchSocialProfilesApi } from '@/commons/apis/socialProfiles'
import { Sheet, SheetContent } from '@/commons/component/ui/sheet'
import { ProjectRunDetailDialog } from './ProjectRunDetailDialog'

const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString('vi-VN') : '-'
const shortId = (value: string) => value.slice(0, 8)

type PipelineStep = 'jobs' | 'plans' | 'series' | 'output'

const isTopicConfigError = (job: ProjectRun) =>
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
  onOpenGenerateVideo?: (projectId?: string) => void
}) {
  const activeStep = initialStep
  const [jobs, setJobs] = useState<ProjectRun[]>([])
  const [reviewSeries, setReviewSeries] = useState<ProfileSeriesReview[]>([])
  const [profiles, setProfiles] = useState<PlanningProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')

  const [selectedJob, setSelectedJob] = useState<ProjectRun | null>(null)
  const [selectedReviewArticle, setSelectedReviewArticle] = useState<{
    article: ProfileSeriesReview['articles'][number]
    seriesTitle: string
  } | null>(null)
  const [selectedSourceContent, setSelectedSourceContent] = useState<ReviewSourceContent | null>(null)
  const [regeneratePlan, setRegeneratePlan] = useState<ContentPlan | null>(null)
  const [regenerateInstructions, setRegenerateInstructions] = useState('')
  const [regenerateSubmitting, setRegenerateSubmitting] = useState(false)

  const [loading, setLoading] = useState(true)
  const [plansLoading, setPlansLoading] = useState(false)
  const [message, setMessage] = useState('')

  const selectedProfile = useMemo(
    () => profiles.find(profile => profile.id === selectedProfileId),
    [profiles, selectedProfileId],
  )

  const loadProfilePlanning = async (profileId: string) => {
    setPlansLoading(true)
    setMessage('')
    try {
      const nextReviewSeries = await fetchProfileSeriesReviewApi(profileId)
      setReviewSeries(nextReviewSeries)
    } catch (error: any) {
      setReviewSeries([])
      setMessage(error?.response?.data?.detail || 'Không thể tải kế hoạch theo profile')
    } finally {
      setPlansLoading(false)
    }
  }

  const loadData = async () => {
    setLoading(true)
    setMessage('')
    try {
      if (activeStep === 'jobs') {
        const nextJobs = await fetchProjectRunsApi()
        setJobs(nextJobs)
        return
      }

      if (activeStep === 'plans') {
        const profileResponse = await fetchSocialProfilesApi()
        const nextProfiles = profileResponse.items || profileResponse || []
        setProfiles(nextProfiles)
        setSelectedProfileId((current) => current || nextProfiles[0]?.id || '')
      }
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể tải dữ liệu AI Planning')
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
    if (!selectedReviewArticle) return
    const selectedPlanId = selectedReviewArticle.article.plan?.id
    const selectedPartIds = new Set(selectedReviewArticle.article.parts.map(part => part.id))
    const stillExists = reviewSeries.some(item => item.articles.some(article => {
      if (selectedPlanId && article.plan?.id === selectedPlanId) return true
      return article.parts.some(part => selectedPartIds.has(part.id))
    }))
    if (stillExists) return
    setSelectedReviewArticle(null)
  }, [reviewSeries, selectedReviewArticle])

  const pageTitle = activeStep === 'jobs'
    ? 'Tiến Trình Job'
    : activeStep === 'plans'
      ? 'Duyệt Thành Phẩm'
      : 'Xem Đầu Ra'
  const pageDescription = activeStep === 'jobs'
    ? 'Theo dõi các job AI Planning, trạng thái xử lý và log chi tiết.'
    : activeStep === 'plans'
      ? 'Duyệt kế hoạch theo từng social profile, nhóm theo series và xem từng bài trong series.'
      : 'Xem đầu ra đã sẵn sàng chuyển sang Generate Video để sản xuất video.'

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
    setMessage('')
  }

  const submitRegenerateArticle = async () => {
    if (!regeneratePlan) return
    setMessage('')
    setRegenerateSubmitting(true)
    try {
      await regenerateContentPlanApi(regeneratePlan.id, regenerateInstructions.trim() || undefined)
      setMessage('Đã gửi yêu cầu viết lại bài. Job mới sẽ xuất hiện ở trang Tiến Trình Job.')
      setRegeneratePlan(null)
      setRegenerateInstructions('')
      if (selectedProfileId) void loadProfilePlanning(selectedProfileId)
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể gửi yêu cầu viết lại bài')
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

      {message && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{message}</div>}

      {loading ? (
        <div className="flex items-center justify-center p-12 text-[#64748b]">
          <Loader2 className="animate-spin mr-2" size={24} /> Đang xử lý...
        </div>
      ) : (
        <div className="min-h-[600px]">
          {activeStep === 'jobs' && (
            <div className="space-y-4">
              {jobs.length === 0 ? <div className="workspace-card"><Empty label="Không có Job AI nào đang chạy" /></div> : jobs.map((job) => (
                <div key={job.id} onClick={() => setSelectedJob(job)} className="workspace-card p-4 cursor-pointer hover:border-slate-300 transition-all relative overflow-hidden group">
                  <div className="flex justify-between items-start mb-5">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-sm font-bold text-slate-700">#{shortId(job.id)}</span>
                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-bold uppercase">{job.planning_mode}</span>
                        <Badge value={job.status} />
                      </div>
                      <div className="mt-2 mb-1 text-sm font-bold text-[var(--accent)]">
                        Job AI Planning
                      </div>
                      <div className="text-xs text-slate-500 font-mono">Started: {formatDate(job.created_at)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-slate-800">{Number(job.progress_percent).toFixed(0)}%</div>
                      <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Tiến độ</div>
                    </div>
                  </div>

                  {/* Pipeline Topology */}
                  <div className="relative px-2 pb-2">
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-[2px] bg-slate-100 z-0 rounded-full"></div>
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 h-[2px] bg-[var(--accent)] z-0 transition-all duration-1000 rounded-full" style={{ width: `${job.progress_percent}%` }}></div>

                    <div className="flex items-center justify-between relative z-10">
                      {[
                        { id: 'SCORING_CANDIDATES', label: 'Score', icon: Filter },
                        { id: 'CREATING_PLAN', label: 'Plan', icon: Lightbulb },
                        { id: 'CREATING_SERIES', label: 'Series', icon: ListVideo },
                        { id: 'BUILDING_CONTEXT', label: 'Context', icon: BrainCircuit },
                        { id: 'VALIDATING_PLAN', label: 'Review', icon: CheckCircle2 }
                      ].map((stage, idx, arr) => {
                        const Icon = stage.icon;
                        const stageIndex = arr.findIndex(s => s.id === job.current_stage)
                        let state = 'pending'
                        if (job.status === 'COMPLETED' || job.status === 'WAITING_REVIEW') state = 'done'
                        else if (job.status === 'FAILED') {
                          state = idx <= stageIndex ? 'failed' : 'pending'
                        } else {
                          if (idx < stageIndex) state = 'done'
                          else if (idx === stageIndex) state = 'current'
                        }

                        let boxClass = 'bg-white border-slate-200 text-slate-400'
                        let iconClass = 'text-slate-400'
                        if (state === 'done') {
                          boxClass = 'bg-blue-50 border-[var(--accent)] text-[var(--accent-strong)] shadow-sm'
                          iconClass = 'text-[var(--accent)]'
                        } else if (state === 'current') {
                          boxClass = 'bg-blue-50 border-blue-400 text-blue-700 ring-4 ring-blue-100/50 shadow-sm'
                          iconClass = 'text-blue-600 animate-pulse'
                        } else if (state === 'failed') {
                          boxClass = 'bg-red-50 border-red-400 text-red-600'
                          iconClass = 'text-red-500'
                        }

                        return (
                          <div key={stage.id} className="flex items-center">
                            <div className={`px-4 py-2 border rounded-lg text-center flex flex-col items-center justify-center w-[85px] transition-colors ${boxClass}`}>
                              <Icon size={16} className={`mb-1.5 ${iconClass}`} />
                              <span className="text-[10px] font-mono font-bold uppercase tracking-wide">{stage.label}</span>
                            </div>
                            {idx < arr.length - 1 && (
                              <div className="px-2">
                                <ChevronRight size={16} className={`${state === 'done' ? 'text-[var(--accent)]' : 'text-slate-300'}`} />
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  {/* Error banner: Chưa cấu hình Content Topics */}
                  {isTopicConfigError(job) && (
                    <div
                      className="mt-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
                      <div className="flex-1">
                        <p className="font-bold text-amber-800">Chưa cấu hình chủ đề nội dung</p>
                        <p className="mt-0.5 text-amber-700">Profile này chưa có <strong>Content Topics</strong>. Auto Planning cần ít nhất 1 chủ đề để chọn bài phù hợp.</p>
                      </div>
                      <button
                        onClick={() => job.profile_id && onOpenProfileSettings?.(job.profile_id)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 transition-colors"
                      >
                        <Settings2 size={13} /> Cấu hình ngay
                      </button>
                    </div>
                  )}
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
                        <p className="mt-1 line-clamp-2 max-w-3xl text-sm leading-6 text-slate-600">{item.series.description || 'Các bài trong series này được nhóm theo nguồn content và mỗi bài có các part kịch bản riêng.'}</p>
                      </div>
                    </div>

                    <div className="table-scroll rounded-lg border border-[#eef2f7] bg-white">
                      <div className="data-grid-lg">
                        <div className="grid grid-cols-[96px_2fr_0.8fr_0.8fr_0.8fr_1.4fr] gap-3 bg-[#f8fafc] px-4 py-3 text-xs font-bold uppercase tracking-wider text-[#64748b]">
                          <div>Preview</div>
                          <div>Bài báo gốc</div>
                          <div>Nguồn</div>
                          <div>Quality</div>
                          <div>Part</div>
                          <div className="text-right">Thao tác</div>
                        </div>
                      {item.articles.length === 0 ? (
                        <div className="w-full rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Series này chưa có bài.</div>
                      ) : item.articles.map((article, articleIndex) => (
                        <div
                          key={article.plan?.id || `${item.series.id}-${articleIndex}`}
                          onClick={() => setSelectedReviewArticle({ article, seriesTitle: item.series.title })}
                          className="grid cursor-pointer grid-cols-[96px_2fr_0.8fr_0.8fr_0.8fr_1.4fr] items-center gap-3 border-t border-[#eef2f7] px-4 py-3 text-sm transition-colors hover:bg-slate-50"
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
                          <div className="font-bold text-[#0f172a]">{article.source_content ? Number(article.source_content.quality_score || 0).toFixed(1) : '-'}</div>
                          <div className="flex items-center gap-2">
                            <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">{article.parts.length} part</span>
                            {article.plan ? <Badge value={article.plan.status} /> : <Badge value="UNLINKED" />}
                          </div>
                          <div className="flex justify-end gap-2">
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
                                <button
                                  onClick={async (event) => {
                                    event.stopPropagation()
                                    try {
                                      const result = await approveContentPlanApi(article.plan!.id)
                                      if (selectedProfileId) void loadProfilePlanning(selectedProfileId)
                                      const projectId = result.content_projects?.[0]?.id
                                      if (!projectId) throw new Error('Backend did not return project_id')
                                      onOpenGenerateVideo?.(projectId)
                                    } catch {
                                      alert('Lỗi phê duyệt!')
                                    }
                                  }}
                                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700"
                                >
                                  <CheckCircle2 size={15} /> Duyệt
                                </button>
                                <button
                                  onClick={async (event) => {
                                    event.stopPropagation()
                                    try {
                                      await rejectContentPlanApi(article.plan!.id, 'Không đạt yêu cầu')
                                      if (selectedProfileId) void loadProfilePlanning(selectedProfileId)
                                    } catch {
                                      alert('Lỗi từ chối!')
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

          {activeStep === 'output' && (
            <div className="flex items-center justify-center h-[500px] border-2 border-dashed border-slate-300 rounded-xl bg-slate-50">
              <div className="text-center max-w-sm">
                <Video size={48} className="mx-auto text-slate-400 mb-4" />
                <h3 className="text-lg font-bold text-slate-700 mb-2">Generate Video</h3>
                <p className="text-sm text-slate-500 mb-6">Đầu ra của Series đã sẵn sàng chuyển sang Generate Video để tự động dựng video và lồng tiếng.</p>
                <button onClick={() => onOpenGenerateVideo?.()} className="h-9 rounded-md bg-[var(--primary)] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#1e293b]">
                  Chuyển sang Sản Xuất Video
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {selectedJob && (
        <ProjectRunDetailDialog
          job={selectedJob}
          open={!!selectedJob}
          onOpenChange={(open) => !open && setSelectedJob(null)}
        />
      )}

      <ArticleReviewSheet
        selection={selectedReviewArticle}
        open={!!selectedReviewArticle}
        onOpenChange={(open) => !open && setSelectedReviewArticle(null)}
        onOpenSource={(source) => setSelectedSourceContent(source)}
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
                  placeholder="Ví dụ: viết hook mạnh hơn, giọng căng hơn, chỉ giữ 1 part. Nếu muốn chia nhiều part, ghi rõ: chia thành 3 part..."
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
    </div>
  )
}

function ArticleReviewSheet({
  selection,
  open,
  onOpenChange,
  onOpenSource,
}: {
  selection: { article: ProfileSeriesReview['articles'][number]; seriesTitle: string } | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenSource: (source: ReviewSourceContent) => void
}) {
  if (!selection) return null

  const { article, seriesTitle } = selection
  const source = article.source_content
  const sourceUrl = source?.source_url || source?.canonical_url

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[calc(100vw-1rem)] max-w-[920px]">
        <div className="detail-shell">
          <div className="detail-header">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-[var(--primary)] px-2 py-0.5 text-[10px] font-black uppercase text-white">Bài review</span>
              {article.plan ? <Badge value={article.plan.status} /> : <Badge value="UNLINKED" />}
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">{article.parts.length} part</span>
            </div>
            <h2 className="text-xl font-black leading-tight text-[#0f172a]">{article.plan?.title || source?.canonical_title || 'Bài chưa liên kết kế hoạch'}</h2>
            <p className="mt-2 text-xs font-semibold text-[#64748b]">{seriesTitle}</p>
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
                  <div className="detail-label mb-2">Plan</div>
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
                  <div className="detail-label">Part / kịch bản sinh ra</div>
                  <span className="text-xs font-bold text-slate-400">{article.parts.length} part</span>
                </div>
                {article.parts.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Bài này chưa có part.</div>
                ) : (
                  <div className="grid gap-4">
                    {article.parts.map((part) => (
                      <div key={part.id} className="rounded-md border border-slate-200 bg-[#fbfcfe] p-4">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-[var(--primary)] px-2 py-0.5 text-[10px] font-black uppercase text-white">Part {part.part_number}</span>
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">{part.part_type}</span>
                          <Badge value={part.status} />
                        </div>
                        <h4 className="text-base font-black text-[#0f172a]">{part.title}</h4>
                        <div className="mt-4 grid gap-4">
                          <DetailBlock title="Mục tiêu tập" tone="slate">
                            {part.goal || 'Chưa có mục tiêu cụ thể.'}
                          </DetailBlock>
                          {part.hook_direction && (
                            <DetailBlock title="Hook mở bài" tone="blue">
                              {part.hook_direction}
                            </DetailBlock>
                          )}
                          <DetailList title="Diễn biến chính" items={part.main_beats} emptyLabel="Chưa có beat nội dung." />
                          {part.ending_direction && (
                            <DetailBlock title="Hướng kết bài" tone="amber">
                              {part.ending_direction}
                            </DetailBlock>
                          )}
                          <div className="grid gap-4 lg:grid-cols-2">
                            <DetailList title="Ghi chú sản xuất" items={part.production_notes || []} emptyLabel="Chưa có ghi chú sản xuất." compact />
                            <DetailList title="Rủi ro cần lưu ý" items={part.risk_notes || []} emptyLabel="Chưa có rủi ro được ghi nhận." compact />
                          </div>
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
          const mediaUrl = item.storage_url || item.source_url
          const thumbUrl = item.thumbnail_url || mediaUrl
          const isVideo = item.media_type?.toUpperCase().includes('VIDEO') || item.mime_type?.startsWith('video/')
          const isImage = item.media_type?.toUpperCase().includes('IMAGE') || item.mime_type?.startsWith('image/')

          return (
            <button
              key={item.id}
              type="button"
              onClick={onOpen}
              className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100 text-left hover:border-blue-300"
            >
              {mediaUrl && isVideo ? (
                <div className="relative">
                  <video src={mediaUrl} poster={item.thumbnail_url || undefined} muted preload="metadata" className="aspect-video w-full bg-black object-cover opacity-90" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                    <span className="rounded-full bg-white/90 px-3 py-1 text-[10px] font-black uppercase text-slate-800">Video</span>
                  </div>
                </div>
              ) : thumbUrl && isImage ? (
                <img src={thumbUrl} alt="" className="aspect-video w-full object-cover transition-transform group-hover:scale-[1.02]" loading="lazy" />
              ) : (
                <div className="flex aspect-video items-center justify-center text-xs font-bold text-slate-500">{item.media_type}</div>
              )}
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
  const mediaUrl = first.storage_url || first.source_url
  const previewUrl = first.thumbnail_url || mediaUrl
  const isVideo = first.media_type?.toUpperCase().includes('VIDEO') || first.mime_type?.startsWith('video/')

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
        <>
          <video src={mediaUrl} poster={first.thumbnail_url || undefined} muted preload="metadata" className="h-full w-full object-cover opacity-90" />
          <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-black uppercase text-white">Video</span>
        </>
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
                      const mediaUrl = item.storage_url || item.source_url
                      const thumbUrl = item.thumbnail_url || mediaUrl
                      const isVideo = item.media_type?.toUpperCase().includes('VIDEO') || item.mime_type?.startsWith('video/')
                      const isImage = item.media_type?.toUpperCase().includes('IMAGE') || item.mime_type?.startsWith('image/')

                      return (
                        <div key={item.id} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                          {mediaUrl && isVideo ? (
                            <video src={mediaUrl} poster={item.thumbnail_url || undefined} controls className="aspect-video w-full bg-black object-contain" />
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

function DetailList({
  title,
  items,
  emptyLabel,
  compact = false,
}: {
  title: string
  items: unknown
  emptyLabel: string
  compact?: boolean
}) {
  const normalizedItems = normalizeDetailItems(items)

  return (
    <section className="rounded-md border border-slate-200 bg-white p-3">
      <div className="detail-label mb-3">{title}</div>
      {normalizedItems.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyLabel}</p>
      ) : (
        <ol className={compact ? 'space-y-2' : 'space-y-3'}>
          {normalizedItems.map((item, index) => (
            <li key={`${title}-${index}`} className="flex gap-3 text-sm leading-6 text-slate-700">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-black text-slate-500">{index + 1}</span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function normalizeDetailItems(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) {
    return value
      .map((item) => typeof item === 'string' ? item : JSON.stringify(item))
      .filter((item) => item && item !== 'null' && item !== 'undefined')
  }
  if (typeof value === 'string') return value.trim() ? [value] : []
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        if (Array.isArray(item)) return `${key}: ${item.join(', ')}`
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') return `${key}: ${item}`
        return `${key}: ${JSON.stringify(item)}`
      })
      .filter((item) => item && !item.endsWith(': null') && !item.endsWith(': undefined'))
  }
  return [String(value)]
}

function Badge({ value }: { value: string }) {
  let color = 'bg-slate-100 text-slate-700'
  if (['SUCCEEDED', 'COMPLETED', 'READY', 'APPROVED'].includes(value)) color = 'bg-emerald-100 text-emerald-800'
  if (['FAILED', 'REJECTED'].includes(value)) color = 'bg-red-100 text-red-800'
  if (['RUNNING', 'PENDING', 'PROCESSING', 'GENERATED'].includes(value)) color = 'bg-blue-100 text-blue-800'
  if (['NEEDS_REVIEW'].includes(value)) color = 'bg-amber-100 text-amber-800'
  return <span className={`px-2 py-1 inline-flex items-center justify-center rounded-md text-[10px] font-bold uppercase tracking-wider ${color}`}>{value}</span>
}

function Empty({ label }: { label: string }) {
  return <div className="empty-state m-3">{label}</div>
}
