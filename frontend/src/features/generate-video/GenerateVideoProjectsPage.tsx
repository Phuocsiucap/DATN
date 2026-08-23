import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Edit, FileText, Layers, MoreVertical, Plus, RefreshCw, Trash2, Wand2, X, XCircle } from 'lucide-react'
import {
  approveContentPlanApi,
  createContentSeriesApi,
  deleteContentSeriesApi,
  fetchAllContentSeriesApi,
  fetchProfileSeriesReviewApi,
  regenerateContentPlanApi,
  rejectContentPlanApi,
  updateContentSeriesApi,
  updateMediaWorkflowApi,
  type ContentPlan,
  type ContentSeries,
  type PlanningProfile,
  type ProfileSeriesReview,
  type StoryScene,
} from '@/commons/apis/planning'
import { fetchSocialProfilesApi } from '@/commons/apis/socialProfiles'
import { createGenerateVideoStoryFromManualApi, generateVideoMediaUrl, type GenerateVideoStory } from '@/commons/apis/generateVideo'
import { SeriesModal } from '../module2/components/SeriesModal'
import { ReassignSeriesModal } from '../module2/components/ReassignSeriesModal'
import { PlanActionMenu } from '../module2/components/PlanActionMenu'

type GenerateVideoProjectsPageProps = {
  onOpenProject: (workflowId: string) => void
}

export default function GenerateVideoProjectsPage({ onOpenProject }: GenerateVideoProjectsPageProps) {
  const [profiles, setProfiles] = useState<PlanningProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [reviewSeries, setReviewSeries] = useState<ProfileSeriesReview[]>([])
  const [allSeriesList, setAllSeriesList] = useState<ContentSeries[]>([])
  const [selectedSeriesId, setSelectedSeriesId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [reviewLoading, setReviewLoading] = useState(true)
  const [status, setStatus] = useState('Sẵn sàng')
  const [showNewManual, setShowNewManual] = useState(false)
  const [manualTitle, setManualTitle] = useState('')
  const [manualText, setManualText] = useState('')
  const [manualImages, setManualImages] = useState('')
  const [manualStory, setManualStory] = useState<GenerateVideoStory | null>(null)

  // Series CRUD State
  const [showSeriesModal, setShowSeriesModal] = useState(false)
  const [editingSeries, setEditingSeries] = useState<ContentSeries | null>(null)

  // Plan Reassign Series State
  const [reassigningPlan, setReassigningPlan] = useState<ContentPlan | null>(null)

  const loadProfiles = async () => {
    try {
      const profileResponse = await fetchSocialProfilesApi()
      const nextProfiles = (profileResponse.items || profileResponse || []) as PlanningProfile[]
      setProfiles(nextProfiles)
      setSelectedProfileId((current) => current || nextProfiles[0]?.id || '')
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không tải được danh sách profile')
      setReviewLoading(false)
    }
  }

  const loadSeriesReview = async (profileId: string) => {
    setReviewLoading(true)
    try {
      const [nextReviewSeries, allSeriesData] = await Promise.all([
        fetchProfileSeriesReviewApi(profileId),
        fetchAllContentSeriesApi().catch(() => []),
      ])
      setReviewSeries(nextReviewSeries)
      setAllSeriesList(allSeriesData)
      setSelectedSeriesId((current) => {
        if (current && nextReviewSeries.some((item) => item.series.id === current)) return current
        return nextReviewSeries[0]?.series.id || ''
      })
      setStatus('Đã tải dữ liệu series review')
    } catch (error: any) {
      setReviewSeries([])
      setStatus(error?.response?.data?.detail || error?.message || 'Không tải được dữ liệu duyệt series')
    } finally {
      setReviewLoading(false)
    }
  }

  useEffect(() => {
    void loadProfiles()
  }, [])

  useEffect(() => {
    if (!selectedProfileId) {
      setReviewSeries([])
      setSelectedSeriesId('')
      setReviewLoading(false)
      return
    }
    void loadSeriesReview(selectedProfileId)
  }, [selectedProfileId])

  const reloadGenerateVideoData = async () => {
    if (selectedProfileId) await loadSeriesReview(selectedProfileId)
  }

  const handleCreateSeries = () => {
    setEditingSeries(null)
    setShowSeriesModal(true)
  }

  const handleEditSeries = (series: ContentSeries) => {
    setEditingSeries(series)
    setShowSeriesModal(true)
  }

  const handleDeleteSeries = async (series: ContentSeries) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa Series "${series.title}" không?`)) return
    setBusy(`delete-series-${series.id}`)
    try {
      await deleteContentSeriesApi(series.id)
      setStatus(`Đã xóa Series "${series.title}" thành công`)
      await reloadGenerateVideoData()
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không xóa được Series')
    } finally {
      setBusy(null)
    }
  }

  const handleSaveSeries = async (data: {
    title: string
    description?: string
    series_type?: string
    profile_id?: string
    status?: string
    total_parts?: number
    current_part?: number
  }) => {
    setBusy('save-series')
    try {
      if (editingSeries) {
        await updateContentSeriesApi(editingSeries.id, data)
        setStatus(`Đã cập nhật Series "${data.title}"`)
      } else {
        await createContentSeriesApi({
          ...data,
          profile_id: selectedProfileId || data.profile_id,
        })
        setStatus(`Đã tạo Series mới "${data.title}"`)
      }
      setShowSeriesModal(false)
      setEditingSeries(null)
      await reloadGenerateVideoData()
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không lưu được thông tin Series')
    } finally {
      setBusy(null)
    }
  }

  const handleUpdateSeriesMapping = async (plan: ContentPlan, seriesId: string | null) => {
    setBusy(`reassign-${plan.id}`)
    try {
      const targetWorkflowId = plan.workflow_id || plan.id
      await updateMediaWorkflowApi(targetWorkflowId, { series_id: seriesId })
      setStatus(`Đã chuyển kịch bản "${plan.title}" sang Series mới!`)
      setReassigningPlan(null)
      await reloadGenerateVideoData()
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không thể chuyển Series cho bài viết này')
    } finally {
      setBusy(null)
    }
  }

  const handleRegeneratePlan = async (plan: ContentPlan) => {
    setBusy(`regenerate-${plan.id}`)
    try {
      await regenerateContentPlanApi(plan.id, 'Regenerated from Generate Video workspace')
      setStatus(`Đã gửi yêu cầu tạo lại kịch bản "${plan.title}"`)
      await reloadGenerateVideoData()
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không thể tạo lại kịch bản')
    } finally {
      setBusy(null)
    }
  }

  const createManualStory = async () => {
    if (!manualText.trim()) return
    setBusy('manual-story')
    try {
      const story = await createGenerateVideoStoryFromManualApi({
        title: manualTitle.trim() || 'Kịch bản nhập tay',
        text: manualText,
        images: manualImages.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        media_type: 'IMAGE',
      })
      setManualStory(story)
      setStatus('Đã tạo kịch bản từ nội dung nhập tay')
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không tạo được kịch bản nhập tay')
    } finally {
      setBusy(null)
    }
  }

  const approveArticle = async (article: ReviewArticle, openAfterApprove = true) => {
    if (!article.plan) return
    setBusy(`approve-${article.plan.id}`)
    try {
      await approveContentPlanApi(article.plan.id, 'Approved from Generate Video series queue')
      setStatus('Đã duyệt kịch bản và chuyển vào Generate Video')
      await reloadGenerateVideoData()
      if (openAfterApprove) onOpenProject(article.plan.workflow_id || article.plan.id)
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không duyệt được kịch bản')
    } finally {
      setBusy(null)
    }
  }

  const rejectArticle = async (article: ReviewArticle) => {
    if (!article.plan) return
    setBusy(`reject-${article.plan.id}`)
    try {
      await rejectContentPlanApi(article.plan.id, 'Rejected from Generate Video series queue')
      setStatus('Đã từ chối kịch bản')
      await reloadGenerateVideoData()
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không từ chối được kịch bản')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="text-sm font-black text-[#0f172a]">Generate Video</h1>
          {selectedProfileId && (
            <select
              value={selectedProfileId}
              onChange={(event) => setSelectedProfileId(event.target.value)}
              className="h-7 max-w-[260px] rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-[#0f172a] outline-none focus:border-[var(--accent)]"
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.profile_name}{profile.username ? ` (@${profile.username})` : ''} - {profile.platform}
                </option>
              ))}
            </select>
          )}
          {(busy || isStatusError(status)) && (
            <span className={`text-[11px] font-semibold ${isStatusError(status) ? 'text-red-600' : 'text-slate-500'}`}>
              {busy ? 'Đang xử lý...' : status}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={handleCreateSeries}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 text-[11px] font-bold text-blue-700 hover:bg-blue-100 transition-colors"
          >
            <Layers size={13} /> Thêm Series Mới
          </button>
          <button onClick={() => setShowNewManual(true)} className="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--accent)] px-2 text-[11px] font-semibold text-white">
            <Plus size={13} /> New Story
          </button>
          <button onClick={() => void reloadGenerateVideoData()} className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--outline-variant)] bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-[var(--surface-container-low)]">
            <RefreshCw size={13} /> Reload
          </button>
        </div>
      </div>

      {showNewManual && (
        <ManualStoryComposer
          busy={busy === 'manual-story'}
          title={manualTitle}
          text={manualText}
          images={manualImages}
          story={manualStory}
          onClose={() => setShowNewManual(false)}
          onTitleChange={setManualTitle}
          onTextChange={setManualText}
          onImagesChange={setManualImages}
          onCreate={() => void createManualStory()}
        />
      )}

      <SeriesReviewBoard
        seriesItems={reviewSeries}
        selectedSeriesId={selectedSeriesId}
        loading={reviewLoading}
        busy={busy}
        onSeriesChange={setSelectedSeriesId}
        onOpenProject={onOpenProject}
        onApproveArticle={(article) => void approveArticle(article)}
        onRejectArticle={(article) => void rejectArticle(article)}
        onCreateSeries={handleCreateSeries}
        onEditSeries={handleEditSeries}
        onDeleteSeries={(series) => void handleDeleteSeries(series)}
        onOpenReassignModal={(plan) => setReassigningPlan(plan)}
        onRegeneratePlan={(plan) => void handleRegeneratePlan(plan)}
      />

      {showSeriesModal && (
        <SeriesModal
          isOpen={showSeriesModal}
          seriesToEdit={editingSeries}
          profiles={profiles as any[]}
          onClose={() => {
            setShowSeriesModal(false)
            setEditingSeries(null)
          }}
          onSubmit={(data) => void handleSaveSeries(data)}
        />
      )}

      {reassigningPlan && (
        <ReassignSeriesModal
          isOpen={Boolean(reassigningPlan)}
          plan={reassigningPlan}
          seriesList={allSeriesList.length > 0 ? allSeriesList : reviewSeries.map((r) => r.series)}
          onClose={() => setReassigningPlan(null)}
          onConfirm={(plan, seriesId) => handleUpdateSeriesMapping(plan, seriesId)}
        />
      )}
    </div>
  )
}

type ReviewArticle = ProfileSeriesReview['articles'][number]

function SeriesActionMenu({
  series,
  onEdit,
  onDelete,
  onCreateNew,
}: {
  series: ContentSeries
  onEdit: (series: ContentSeries) => void
  onDelete: (series: ContentSeries) => void
  onCreateNew?: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [menuCoords, setMenuCoords] = useState<{ top: number; right: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const updateCoords = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setMenuCoords({
        top: rect.bottom + 4,
        right: Math.max(8, window.innerWidth - rect.right),
      })
    }
  }

  const toggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isOpen) {
      updateCoords()
      setIsOpen(true)
    } else {
      setIsOpen(false)
    }
  }

  useEffect(() => {
    if (!isOpen) return
    const handleScrollOrResize = () => updateCoords()
    window.addEventListener('scroll', handleScrollOrResize, true)
    window.addEventListener('resize', handleScrollOrResize)
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true)
      window.removeEventListener('resize', handleScrollOrResize)
    }
  }, [isOpen])

  return (
    <div className="inline-block text-left" onClick={(e) => e.stopPropagation()}>
      <button
        ref={buttonRef}
        onClick={toggleMenu}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-sm transition-colors"
        title="Tùy chọn Series (...)"
      >
        <MoreVertical size={14} />
      </button>

      {isOpen && menuCoords && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setIsOpen(false)} />
          <div
            style={{
              position: 'fixed',
              top: `${menuCoords.top}px`,
              right: `${menuCoords.right}px`,
            }}
            className="z-[9999] w-44 rounded-xl border border-slate-200 bg-white py-1 shadow-2xl text-xs animate-in fade-in zoom-in-95 duration-100"
          >
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsOpen(false)
                onEdit(series)
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-slate-700 hover:bg-blue-50 hover:text-blue-600 font-semibold transition-colors"
            >
              <Edit size={14} className="text-blue-500" />
              Chỉnh sửa Series
            </button>

            {onCreateNew && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setIsOpen(false)
                  onCreateNew()
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-slate-700 hover:bg-emerald-50 hover:text-emerald-600 font-semibold transition-colors"
              >
                <Plus size={14} className="text-emerald-500" />
                Tạo Series mới
              </button>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsOpen(false)
                onDelete(series)
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-red-600 hover:bg-red-50 font-semibold transition-colors border-t border-slate-100"
            >
              <Trash2 size={14} className="text-red-500" />
              Xóa Series
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function SeriesReviewBoard({
  seriesItems,
  selectedSeriesId,
  loading,
  busy,
  onSeriesChange,
  onOpenProject,
  onApproveArticle,
  onRejectArticle,
  onCreateSeries,
  onEditSeries,
  onDeleteSeries,
  onOpenReassignModal,
  onRegeneratePlan,
}: {
  seriesItems: ProfileSeriesReview[]
  selectedSeriesId: string
  loading: boolean
  busy: string | null
  onSeriesChange: (seriesId: string) => void
  onOpenProject: (workflowId: string) => void
  onApproveArticle: (article: ReviewArticle) => void
  onRejectArticle: (article: ReviewArticle) => void
  onCreateSeries: () => void
  onEditSeries: (series: ContentSeries) => void
  onDeleteSeries: (series: ContentSeries) => void
  onOpenReassignModal: (plan: ContentPlan) => void
  onRegeneratePlan: (plan: ContentPlan) => void
}) {
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    if (selectedSeriesId && rowRefs.current[selectedSeriesId]) {
      rowRefs.current[selectedSeriesId]?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }
  }, [selectedSeriesId])

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      {loading ? (
        <div className="flex h-full items-center justify-center rounded-md border border-slate-200 bg-white p-10 text-sm font-semibold text-slate-500">
          <RefreshCw className="mr-2 animate-spin" size={16} /> Đang tải series...
        </div>
      ) : seriesItems.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 rounded-md border border-slate-200 bg-white p-6 text-center text-sm font-semibold text-slate-500">
          <div>Profile này chưa có series/story_data để duyệt.</div>
          <button
            onClick={onCreateSeries}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#2563eb] px-3 text-xs font-bold text-white shadow-sm hover:bg-[#1d4ed8]"
          >
            <Plus size={14} /> Thêm Series Mới Ngay
          </button>
        </div>
      ) : (
        <div className="grid h-full min-h-0 overflow-hidden lg:grid-cols-[232px_minmax(0,1fr)]">
          <div className="min-h-0 border-b border-slate-100 lg:border-b-0 lg:border-r">
            <div className="h-full overflow-y-auto p-2">
              {seriesItems.map((item) => (
                <SeriesPickerItem
                  key={item.series.id}
                  item={item}
                  active={selectedSeriesId === item.series.id}
                  onSelect={() => onSeriesChange(item.series.id)}
                />
              ))}
            </div>
          </div>

          <div className="min-h-0 min-w-0 overflow-y-auto bg-slate-50/60 p-2.5">
            <div className="grid gap-3">
              {seriesItems.map((item) => (
                <div
                  key={item.series.id}
                  ref={(el) => {
                    rowRefs.current[item.series.id] = el
                  }}
                >
                  <SeriesFeedRow
                    item={item}
                    active={selectedSeriesId === item.series.id}
                    busy={busy}
                    onOpenProject={onOpenProject}
                    onApproveArticle={onApproveArticle}
                    onRejectArticle={onRejectArticle}
                    onCreateSeries={onCreateSeries}
                    onEditSeries={onEditSeries}
                    onDeleteSeries={onDeleteSeries}
                    onOpenReassignModal={onOpenReassignModal}
                    onRegeneratePlan={onRegeneratePlan}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SeriesPickerItem({
  item,
  active,
  onSelect,
}: {
  item: ProfileSeriesReview
  active: boolean
  onSelect: () => void
}) {
  const isActive = String(item.series.status || '').toUpperCase() === 'ACTIVE'
  const statusLabel = isActive ? 'Active' : 'Inactive'

  return (
    <div
      onClick={onSelect}
      className={`group mb-1.5 w-full rounded-md border px-2.5 py-2 text-left transition-colors cursor-pointer ${
        active ? 'border-[var(--accent)] bg-blue-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <div className="line-clamp-2 text-[11px] font-bold leading-4 text-[#0f172a]">{item.series.title}</div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] font-semibold text-slate-500">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
          <span className={isActive ? 'text-emerald-700' : 'text-slate-500'}>{statusLabel}</span>
        </span>
        <span className="shrink-0 text-slate-400">{item.articles.length} bài</span>
      </div>
    </div>
  )
}

function SeriesFeedRow({
  item,
  active,
  busy,
  onOpenProject,
  onApproveArticle,
  onRejectArticle,
  onCreateSeries,
  onEditSeries,
  onDeleteSeries,
  onOpenReassignModal,
  onRegeneratePlan,
}: {
  item: ProfileSeriesReview
  active: boolean
  busy: string | null
  onOpenProject: (workflowId: string) => void
  onApproveArticle: (article: ReviewArticle) => void
  onRejectArticle: (article: ReviewArticle) => void
  onCreateSeries: () => void
  onEditSeries: (series: ContentSeries) => void
  onDeleteSeries: (series: ContentSeries) => void
  onOpenReassignModal: (plan: ContentPlan) => void
  onRegeneratePlan: (plan: ContentPlan) => void
}) {
  return (
    <section className={`rounded-md border bg-white shadow-sm ${active ? 'border-[var(--accent)] ring-1 ring-blue-100' : 'border-slate-200'}`}>
      <div className="border-b border-slate-100 p-2.5 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <SeriesStatusBadge value={item.series.status} />
            <span className="text-[11px] font-bold text-slate-500">{item.articles.length} bài</span>
          </div>
          <h2 className="line-clamp-1 text-sm font-black leading-5 text-[#0f172a]">{item.series.title}</h2>
          <p className="mt-0.5 line-clamp-1 text-xs leading-5 text-slate-600">{item.series.description || 'Series đã có story_data theo scene, sẵn sàng duyệt để đưa vào xưởng video.'}</p>
        </div>
        <div className="flex items-center gap-1">
          <SeriesActionMenu
            series={item.series}
            onEdit={onEditSeries}
            onDelete={onDeleteSeries}
            onCreateNew={onCreateSeries}
          />
        </div>
      </div>

      <div className="overflow-x-auto p-2.5">
        {item.articles.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm font-semibold text-slate-500">Series này chưa có bài/story_data.</div>
        ) : (
          <div className="flex gap-2.5">
            {item.articles.map((article, index) => (
              <ReviewArticleCard
                key={article.plan?.id || `${item.series.id}-${index}`}
                article={article}
                currentSeriesId={item.series.id}
                busy={busy}
                onOpenProject={onOpenProject}
                onApprove={onApproveArticle}
                onReject={onRejectArticle}
                onOpenReassignModal={onOpenReassignModal}
                onRegeneratePlan={onRegeneratePlan}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function ReviewArticleCard({
  article,
  currentSeriesId,
  busy,
  onOpenProject,
  onApprove,
  onReject,
  onOpenReassignModal,
  onRegeneratePlan,
}: {
  article: ReviewArticle
  currentSeriesId?: string
  busy: string | null
  onOpenProject: (workflowId: string) => void
  onApprove: (article: ReviewArticle) => void
  onReject: (article: ReviewArticle) => void
  onOpenReassignModal: (plan: ContentPlan) => void
  onRegeneratePlan: (plan: ContentPlan) => void
}) {
  const storyData = getArticleStoryData(article)
  const preview = getArticlePreviewUrl(article)
  const status = article.plan?.status || article.status || 'UNLINKED'
  const disabled = Boolean(busy)

  const planId = article.plan?.id || article.workflow_id || (article as any).id || ''
  const activeSeriesId =
    article.plan?.series_id ||
    article.plan?.draft_json?.target_series_id ||
    (currentSeriesId && currentSeriesId !== planId ? currentSeriesId : null) ||
    null

  const planForActionMenu: ContentPlan = {
    id: planId,
    workflow_id: article.plan?.workflow_id || article.plan?.id || article.workflow_id || (article as any).id || '',
    profile_id: article.plan?.profile_id || '',
    series_id: activeSeriesId,
    title: article.plan?.title || article.source_content?.canonical_title || 'Kịch bản chưa đặt tên',
    content_angle: article.plan?.content_angle || article.source_content?.summary || '',
    status: article.plan?.status || article.status || 'READY',
    source_content: article.source_content || article.plan?.source_content || null,
    story_data: storyData,
    draft_json: article.plan?.draft_json || {},
    planning_mode: article.plan?.planning_mode || 'SERIES',
    confidence_score: article.plan?.confidence_score || 80,
    created_at: article.plan?.created_at || new Date().toISOString(),
    updated_at: article.plan?.updated_at || new Date().toISOString(),
  } as ContentPlan

  const handleCardClick = () => {
    if (!disabled) {
      onOpenProject(article.workflow_id || article.plan?.workflow_id || article.plan?.id || '')
    }
  }

  return (
    <article
      onClick={handleCardClick}
      className="flex w-[240px] shrink-0 cursor-pointer flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm hover:border-blue-300 hover:shadow-md transition-all"
    >
      <div className="relative h-[118px] shrink-0 overflow-hidden bg-slate-950">
        {preview ? (
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center px-2 text-center text-[11px] font-bold text-slate-400">No media</div>
        )}
        <div className="absolute left-2 top-2">
          <StatusBadge value={status} />
        </div>
        <div className="absolute right-2 top-2 z-20" onClick={(e) => e.stopPropagation()}>
          <PlanActionMenu
            plan={planForActionMenu}
            onOpenReassignModal={onOpenReassignModal}
            onRegenerate={onRegeneratePlan}
            buttonClassName="flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow-md hover:bg-white hover:text-slate-900 transition-colors"
          />
        </div>
        <div className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-black text-white">
          {getArticleStageLabel(status)}
        </div>
      </div>

      <div className="min-w-0 flex-1 p-2.5">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-slate-600">{storyData.length} scene</span>
          {article.source_content?.source_type && <span className="text-[10px] font-semibold text-slate-500">{article.source_content.source_type}</span>}
        </div>
        <h3 className="line-clamp-2 text-xs font-black leading-4 text-[#0f172a]">
          {article.source_content?.canonical_title || article.plan?.title || 'Bài chưa liên kết nguồn'}
        </h3>
        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">
          {article.source_content?.summary || article.source_content?.canonical_url || article.plan?.content_angle || 'Chưa có mô tả.'}
        </p>
        <div className="mt-2 grid gap-1">
          {storyData.slice(0, 2).map((scene, index) => (
            <div key={`${scene.subtitle || scene.image || index}`} className="line-clamp-1 rounded bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-slate-600">
              Scene {index + 1}: {scene.subtitle || scene.voice_text || scene.image || 'Chưa có nội dung'}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-auto flex items-center justify-end gap-1.5 border-t border-slate-100 p-2">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onApprove(article)
          }}
          disabled={disabled || isApprovedStatus(status)}
          className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md bg-emerald-600 px-2 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <CheckCircle2 size={12} /> Duyệt
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onReject(article)
          }}
          disabled={disabled || status === 'REJECTED'}
          className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-red-200 bg-white px-2 text-[11px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          <XCircle size={12} /> Từ chối
        </button>
      </div>
    </article>
  )
}

function ManualStoryComposer({
  busy,
  title,
  text,
  images,
  story,
  onClose,
  onTitleChange,
  onTextChange,
  onImagesChange,
  onCreate,
}: {
  busy: boolean
  title: string
  text: string
  images: string
  story: GenerateVideoStory | null
  onClose: () => void
  onTitleChange: (value: string) => void
  onTextChange: (value: string) => void
  onImagesChange: (value: string) => void
  onCreate: () => void
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black text-[#0f172a]">New manual story_data</div>
          <div className="mt-1 text-xs font-semibold text-slate-500">Nhập nội dung, bấm tạo để sinh video draft.</div>
        </div>
        <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-600">
          <X size={15} />
        </button>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="grid content-start gap-3">
          <input value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="Tiêu đề" className="h-10 rounded-lg border border-slate-200 px-3 text-sm" />
          <textarea value={text} onChange={(event) => onTextChange(event.target.value)} placeholder="Nội dung bài" className="h-44 rounded-lg border border-slate-200 p-3 text-sm" />
          <textarea value={images} onChange={(event) => onImagesChange(event.target.value)} placeholder="Link ảnh/video, mỗi dòng một link" className="h-24 rounded-lg border border-slate-200 p-3 text-sm" />
          <button disabled={!text.trim() || busy} onClick={onCreate} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-xs font-semibold text-white disabled:opacity-50">
            <Wand2 size={14} /> {busy ? 'Đang tạo...' : 'Tạo video draft'}
          </button>
        </div>
        <ManualStoryPreview story={story} />
      </div>
    </div>
  )
}

function ManualStoryPreview({ story }: { story: GenerateVideoStory | null }) {
  if (!story) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-sm font-semibold text-slate-400">
        Video draft nhập tay sẽ hiển thị ở đây
      </div>
    )
  }
  const scenes = story.timeline?.text || []
  const video = story.timeline?.video || []
  return (
    <div className="max-h-[520px] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="mb-3 text-sm font-black text-[#0f172a]">{story.meta?.title || 'Kịch bản video'}</div>
      <div className="grid gap-2">
        {scenes.map((scene, index) => {
          const media = video[index]?.src || ''
          return (
            <div key={scene.id || index} className="grid gap-2 rounded-md border border-slate-200 bg-white p-2 sm:grid-cols-[92px_1fr]">
              <div className="overflow-hidden rounded bg-black">
                {media ? <img src={generateVideoMediaUrl(media)} alt="" className="aspect-[9/16] w-full object-contain" /> : <div className="aspect-[9/16]" />}
              </div>
              <div>
                <div className="text-[11px] font-black uppercase text-slate-400">Scene {index + 1}</div>
                <div className="mt-1 text-sm font-semibold leading-5 text-slate-700">{scene.text}</div>
                <div className="mt-2 text-[11px] font-semibold text-slate-400">{Number(scene.start || 0).toFixed(2)}s - {Number(scene.end || 0).toFixed(2)}s</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function getArticleStoryData(article: ReviewArticle): StoryScene[] {
  return article.story_data || article.plan?.story_data || article.plan?.draft_json?.story_data || []
}

function getArticlePreviewUrl(article: ReviewArticle) {
  const media = article.source_content?.media?.[0]
  return media?.thumbnail_url || media?.storage_url || media?.source_url || getArticleStoryData(article).find((scene) => scene.image)?.image || ''
}

function isApprovedStatus(status?: string | null) {
  return ['APPROVED', 'PRODUCTION_READY', 'SCRIPTING', 'EDITING', 'REVIEWING', 'VOICE_READY', 'RENDERING', 'RENDERED', 'VIDEO_APPROVED', 'QUEUED_FOR_PUBLISHING', 'PUBLISHED'].includes(String(status || '').toUpperCase())
}

function getArticleStageLabel(status?: string | null) {
  const value = String(status || '').toUpperCase()
  if (value === 'READY' || value === 'WAITING_REVIEW') return 'Chờ duyệt'
  if (value === 'APPROVED' || value === 'PRODUCTION_READY') return 'Chờ tạo'
  if (value === 'SCRIPTING' || value === 'EDITING' || value === 'REVIEWING') return 'Đang xử lý'
  if (value === 'VOICE_READY') return 'Đã có voice'
  if (value === 'RENDERING') return 'Đang tạo'
  if (value === 'RENDERED' || value === 'VIDEO_APPROVED') return 'Đã tạo'
  if (value === 'REJECTED') return 'Từ chối'
  if (value === 'FAILED') return 'Lỗi'
  return 'Chờ'
}

function isStatusError(status: string) {
  return /không|lỗi|failed|error/i.test(status)
}

function SeriesStatusBadge({ value }: { value?: string | null }) {
  const upper = String(value || 'INACTIVE').toUpperCase()
  const active = upper === 'ACTIVE'
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] font-black uppercase ${active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
      {active ? 'ACTIVE' : 'INACTIVE'}
    </span>
  )
}

function StatusBadge({ value }: { value: string }) {
  const upper = String(value || 'READY').toUpperCase()
  let color = 'bg-slate-100 text-slate-700'
  if (isApprovedStatus(upper)) color = 'bg-emerald-100 text-emerald-800'
  if (upper === 'REJECTED' || upper === 'FAILED') color = 'bg-red-100 text-red-700'
  if (upper === 'WAITING_REVIEW' || upper === 'REVIEWING') color = 'bg-amber-100 text-amber-800'
  return <span className={`rounded px-2 py-0.5 text-[10px] font-black uppercase ${color}`}>{projectStatusLabel(upper)}</span>
}

function projectStatusLabel(status?: string | null) {
  const value = String(status || '').toUpperCase()
  if (value === 'APPROVED') return 'Đã duyệt'
  if (value === 'REJECTED') return 'Từ chối'
  if (value === 'WAITING_REVIEW') return 'Chờ duyệt'
  if (value === 'RENDERED') return 'Đã render'
  if (value === 'VOICE_READY') return 'Đã có voice'
  if (value === 'EDITING' || value === 'IN_PROGRESS') return 'Đang chỉnh'
  if (value === 'READY') return 'Sẵn sàng'
  return value || 'Sẵn sàng'
}
