import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clapperboard,
  Download,
  ExternalLink,
  Eye,
  FastForward,
  FileText,
  Film,
  FolderKanban,
  Clock,
  Globe,
  Image as ImageIcon,
  Lock,
  Maximize2,
  Mic2,
  Music,
  Newspaper,
  Pause,
  Pencil,
  Play,
  Plus,
  Rewind,
  Save,
  Settings,
  ShieldCheck,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Trash2,
  Type,
  UploadCloud,
  Volume2,
  VolumeX,
  Wand2,
  X,
} from 'lucide-react'
import { ContentDetailDialog } from '@/features/content/ContentDetailDialog'
import {
  approveGenerateVideoDraftApi,
  createGenerateVideoStoryFromProjectApi,
  deleteVideoWorkspaceApi,
  editGenerateVideoStoryWithAiApi,
  fetchGenerateVideoJobApi,
  fetchVideoWorkflowProgressApi,
  fetchVideoWorkspaceApi,
  generateFinalVideoApi,
  generateVideoVoiceApi,
  generateVideoMediaUrl,
  generateVideoOutputUrl,
  reviewGenerateVideoStoryWithAiApi,
  saveGenerateVideoStoryApi,
  updateVideoWorkspaceApi,
  uploadGenerateVideoAudioApi,
  normalizeStoryResponse,
  type GenerateVideoScene,
  type GenerateVideoJob,
  type GenerateVideoStory,
  type GenerateVideoVoiceProvider,
  type VideoWorkflowProgress,
  type VideoWorkspaceDetail,
} from '@/commons/apis/generateVideo'
import { fetchAllContentSeriesApi, fetchContentSeriesApi, type ContentSeries } from '@/commons/apis/planning'
import { TransferSeriesModal } from './components/SeriesModal'
import WorkflowProgress from './WorkflowProgress'

type StepId = 'story' | 'plan' | 'video' | 'preview'
type PlanDraft = {
  title: string
  content_angle: string
  target_audience: string
  tone: string
  format: string
  risk_level: string
  target_duration_seconds: string
  recommended_part_count: string
  ai_reasoning: string
  production_requirements: string
  story_data: string
}

const defaultVoiceId = ''
const voiceProviderOptions: Array<{ value: GenerateVideoVoiceProvider; label: string }> = [
  { value: 'elevenlabs', label: 'ElevenLabs' },
  { value: 'edge_tts_namminh', label: 'Edge NamMinh' },
  { value: 'edge_tts_hoaimy', label: 'Edge HoaiMy' },
]
type ProCutAudioTrackType = 'voice' | 'music' | 'sfx'
type ProCutAudioTrack = NonNullable<NonNullable<GenerateVideoStory['audio']>['tracks']>[number]

const proCutFigmaAssets = {
  arrowLeft: 'https://www.figma.com/api/mcp/asset/02b369b0-f498-4377-bc0e-eca2fd75ebc9.svg',
  arrowUpRight: 'https://www.figma.com/api/mcp/asset/6161c6ae-8717-408c-ae2f-8e21d86faf43.svg',
  download: 'https://www.figma.com/api/mcp/asset/7f866ded-29da-4b3d-b6de-35f53a3966ed.svg',
  uploadCloud: 'https://www.figma.com/api/mcp/asset/060b6f2d-b89a-4dfd-b89f-ad7699f743ed.svg',
  settings: 'https://www.figma.com/api/mcp/asset/51476d19-aeaf-49e2-ac65-8d16a83dd4b9.svg',
  settingsPanel: 'https://www.figma.com/api/mcp/asset/9fae2d6b-fc5e-441b-834f-9dfcc0521386.svg',
  monitor: 'https://www.figma.com/api/mcp/asset/c0dfd15d-86de-496b-99eb-f661fe473f85.svg',
  chevronDown: 'https://www.figma.com/api/mcp/asset/88daa364-854e-42c0-9afd-88302ad99732.svg',
  ellipse: 'https://www.figma.com/api/mcp/asset/8a53f37e-9f6b-4a1c-839c-868ea29f7279.svg',
  skipBack: 'https://www.figma.com/api/mcp/asset/9aa85085-c2a4-44ab-8f47-38b90a23baf6.svg',
  rewind: 'https://www.figma.com/api/mcp/asset/7ab5983b-7bed-4db9-951f-fb119eba1fc2.svg',
  play: 'https://www.figma.com/api/mcp/asset/210e6da9-e0b2-43a1-bd01-a3c591963217.svg',
  fastForward: 'https://www.figma.com/api/mcp/asset/3d67e4d7-d5ac-4e30-9092-a223989f2f4c.svg',
  skipForward: 'https://www.figma.com/api/mcp/asset/367c101c-58a8-48e6-b350-616b5c0c0305.svg',
  eye: 'https://www.figma.com/api/mcp/asset/da03ff30-4b9a-4f02-910e-47828207bd84.svg',
  film: 'https://www.figma.com/api/mcp/asset/4ba58b65-1652-4d93-ab60-0b1756be6b36.svg',
  volume2: 'https://www.figma.com/api/mcp/asset/11f4f0c3-55e5-4706-96cd-70c87e8e4760.svg',
  lock: 'https://www.figma.com/api/mcp/asset/ca534b29-337a-4184-a2d2-1cc3eea475bd.svg',
  type: 'https://www.figma.com/api/mcp/asset/9f149eb8-53f5-4d12-bfd2-586e6b0ec886.svg',
  music: 'https://www.figma.com/api/mcp/asset/b9f68472-68ec-4f44-b4b3-c0b065205c48.svg',
  plus: 'https://www.figma.com/api/mcp/asset/6f464834-6143-45b9-9689-cee6feed9b2c.svg',
}

const steps: Array<{ id: StepId; label: string; icon: React.ReactNode }> = [
  { id: 'video', label: 'Studio Editor', icon: <Clapperboard size={16} /> },
  { id: 'preview', label: 'Export MP4', icon: <Clapperboard size={16} /> },
]

const emptyPlanDraft: PlanDraft = {
  title: '',
  content_angle: '',
  target_audience: '',
  tone: '',
  format: '',
  risk_level: '',
  target_duration_seconds: '',
  recommended_part_count: '',
  ai_reasoning: '',
  production_requirements: '{}',
  story_data: '[]',
}

function planDraftFromProject(workflow: VideoWorkspaceDetail | null): PlanDraft {
  if (!workflow) return emptyPlanDraft
  const metadata = workflow.metadata || {}
  const draftStory = workflowStory(workflow)
  return {
    title: workflow.title || '',
    content_angle: String(metadata.content_angle || ''),
    target_audience: String(metadata.target_audience || ''),
    tone: String(metadata.tone || ''),
    format: String(metadata.format || ''),
    risk_level: String(metadata.risk_level || ''),
    target_duration_seconds: metadata.target_duration_seconds ? String(metadata.target_duration_seconds) : '',
    recommended_part_count: metadata.recommended_part_count ? String(metadata.recommended_part_count) : '',
    ai_reasoning: Array.isArray(metadata.ai_reasoning) ? metadata.ai_reasoning.map(String).join('\n') : '',
    production_requirements: JSON.stringify(metadata.production_requirements || {}, null, 2),
    story_data: JSON.stringify(draftStory ? storyTimelineScenes(draftStory) : [], null, 2),
  }
}

function planDraftToPayload(draft: PlanDraft) {
  let productionRequirements: Record<string, unknown> = {}
  let storyData: unknown[] = []
  try {
    productionRequirements = draft.production_requirements.trim() ? JSON.parse(draft.production_requirements) : {}
  } catch {
    throw new Error('Production requirements phải là JSON hợp lệ')
  }
  try {
    const parsed = draft.story_data.trim() ? JSON.parse(draft.story_data) : []
    if (!Array.isArray(parsed)) throw new Error()
    storyData = parsed
  } catch {
    throw new Error('Story data phải là JSON array hợp lệ')
  }

  return {
    title: draft.title.trim(),
    content_angle: draft.content_angle.trim() || null,
    target_audience: draft.target_audience.trim() || null,
    tone: draft.tone.trim() || null,
    format: draft.format.trim() || null,
    risk_level: draft.risk_level.trim() || null,
    target_duration_seconds: draft.target_duration_seconds ? Number(draft.target_duration_seconds) : null,
    recommended_part_count: draft.recommended_part_count ? Number(draft.recommended_part_count) : null,
    ai_reasoning: draft.ai_reasoning.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    production_requirements: productionRequirements,
    story_data: storyData,
  }
}

type VideoProductionWorkspaceProps = {
  workflowId: string
  onBackToList: () => void
}

export default function VideoProductionWorkspace({ workflowId, onBackToList }: VideoProductionWorkspaceProps) {
  const [selectedId, setSelectedId] = useState('')
  const [selectedProject, setSelectedProject] = useState<VideoWorkspaceDetail | null>(null)
  const [planDraft, setPlanDraft] = useState<PlanDraft>(emptyPlanDraft)
  const [story, setStory] = useState<GenerateVideoStory | null>(null)
  const [previewStory, setPreviewStory] = useState<GenerateVideoStory | null>(null)
  const [storyText, setStoryText] = useState('')
  const [storySceneIndex, setStorySceneIndex] = useState(0)
  const [editPrompt, setEditPrompt] = useState('')
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showContentDetailId, setShowContentDetailId] = useState<string | null>(null)
  const [exportedVideoUrl, setExportedVideoUrl] = useState('')

  const [transferModalOpen, setTransferModalOpen] = useState(false)
  const [allSeries, setAllSeries] = useState<ContentSeries[]>([])
  const [transferSubmitting, setTransferSubmitting] = useState(false)

  const openTransferModal = async () => {
    setTransferModalOpen(true)
    const profileId = selectedProject?.profile?.id
    if (profileId) {
      try {
        const data = await fetchContentSeriesApi(profileId)
        setAllSeries(data)
      } catch {
        setAllSeries([])
      }
    } else {
      try {
        const data = await fetchAllContentSeriesApi()
        setAllSeries(data)
      } catch {
        setAllSeries([])
      }
    }
  }

  const handleTransferSeries = async (targetSeriesId: string | null) => {
    if (!selectedId) return
    setTransferSubmitting(true)
    try {
      await updateVideoWorkspaceApi(selectedId, { series_id: targetSeriesId })
      setStatus('Đã chuyển dự án sang series mới!')
      setTransferModalOpen(false)
      await loadProjectById(selectedId, { quiet: true })
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || 'Không thể chuyển series')
    } finally {
      setTransferSubmitting(false)
    }
  }

  const contentId = useMemo(() => {
    if (!selectedProject) return null
    return (
      selectedProject.primary_content_id ||
      (selectedProject.source_content as any)?.id ||
      (selectedProject.source_content as any)?._id ||
      (selectedProject.source_content as any)?.content_id ||
      (story?.meta as any)?.source_content_id ||
      null
    )
  }, [selectedProject, story])
  const [activeStep, setActiveStep] = useState<StepId>('story')
  const [voiceId] = useState(defaultVoiceId)
  const [voiceSpeed] = useState(1.2)
  const [voiceProvider, setVoiceProvider] = useState<GenerateVideoVoiceProvider>('edge_tts_namminh')
  const [workflowProgress, setWorkflowProgress] = useState<VideoWorkflowProgress | null>(null)
  const [status, setStatus] = useState('Sẵn sàng')
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [audioVersion, setAudioVersion] = useState(Date.now())
  const [previewVersion, setPreviewVersion] = useState(0)
  const createStoryBusyRef = useRef(false)
  const actionLocksRef = useRef<Record<string, boolean>>({})
  const refreshedTaskRef = useRef('')
  const activeStory = story || previewStory
  const _hasStoryInput = Boolean(activeStory || storyText.trim())
  const canRenderMp4 = Boolean(activeStory || storyText.trim())
  const workflowRunning = Boolean(activeProgressTask(workflowProgress))
  const actionsLocked = Boolean(busy) || workflowRunning
  const draftQuality = selectedProject?.metadata?.draft_quality as { status?: string; score?: number; issues?: Array<{ code?: string; message?: string; severity?: string }> } | undefined
  const draftRecheck = selectedProject?.metadata?.draft_quality_recheck as { status?: string; score?: number; issues?: Array<{ code?: string; message?: string; severity?: string }> } | undefined
  const visibleDraftQuality = draftRecheck || draftQuality
  const draftReviewRequired = Boolean(
    selectedProject?.capabilities.can_approve_draft
    || selectedProject?.current_stage === 'DRAFT_REVIEW_REQUIRED',
  )

  const beginAction = (key: string) => {
    if (actionLocksRef.current[key]) return false
    actionLocksRef.current[key] = true
    return true
  }

  const endAction = (key: string) => {
    actionLocksRef.current[key] = false
  }

  useEffect(() => {
    setSelectedProject(null)
    setPlanDraft(emptyPlanDraft)
    setStory(null)
    setPreviewStory(null)
    setStoryText('')
    setExportedVideoUrl('')
    setWorkflowProgress(null)
    refreshedTaskRef.current = ''
    setLoadError('')
    setActiveStep('story')
    setStatus('Đang tải workflow kịch bản...')
    void loadInitial()
  }, [workflowId])

  useEffect(() => {
    if (!workflowId) return
    let disposed = false
    const poll = async () => {
      try {
        const next = await fetchVideoWorkflowProgressApi(workflowId)
        if (disposed) return
        setWorkflowProgress(next)
        if (next.final_video) setExportedVideoUrl(generateVideoOutputUrl(next.final_video))
        const latest = next.tasks[0]
        if (latest && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(latest.status) && refreshedTaskRef.current !== latest.id) {
          refreshedTaskRef.current = latest.id
          await loadProjectById(workflowId, { openSavedStory: true, quiet: true })
        }
      } catch {
        // The main workspace request owns user-facing errors.
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 2000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [workflowId])

  const audioSrc = previewStory?.audio?.voice
    ? `${generateVideoMediaUrl(previewStory.audio.voice)}?v=${audioVersion}`
    : ''


  const loadInitial = async () => {
    setBusy('load')
    try {
      setSelectedId(workflowId)
      await loadProjectById(workflowId)
    } finally {
      setBusy(null)
    }
  }

  const updateStory = (nextStory: GenerateVideoStory) => {
    setStory(nextStory)
    setStoryText(JSON.stringify(nextStory, null, 2))
    setStorySceneIndex((current) => Math.min(current, Math.max(0, storyTimelineScenes(nextStory).length - 1)))
  }

  const currentStoryForAction = () => {
    if (story) return story
    if (previewStory) {
      updateStory(previewStory)
      return previewStory
    }
    if (!storyText.trim()) throw new Error('Missing story')
    const parsed = JSON.parse(storyText) as GenerateVideoStory
    setStory(parsed)
    return parsed
  }

  const loadProjectById = async (workflowId: string, options: { openSavedStory?: boolean; quiet?: boolean } = {}) => {
    if (!options.quiet) setBusy('load-project')
    try {
      setLoadError('')
      const workflow = await fetchVideoWorkspaceApi(workflowId)
      setSelectedProject(workflow)
      setPlanDraft(planDraftFromProject(workflow))
      setSelectedId(workflowId)
      setWorkflowProgress(workflowProgressFromDetail(workflow))
      setExportedVideoUrl(workflow.final_video ? generateVideoOutputUrl(workflow.final_video) : '')
      window.history.replaceState({ workflowId }, '', `/generate-video/${encodeURIComponent(workflowId)}`)

      const directStory = workflowStory(workflow)
      if (directStory) {
        updateStory(directStory)
        setPreviewStory(directStory)
        setPreviewVersion(Date.now())
        setActiveStep(options.openSavedStory ? inferActiveStepFromProject(workflow, directStory) : 'video')
        setStatus('')
      } else {
        setStory(null)
        setPreviewStory(null)
        setStoryText('')
        setActiveStep('story')
        setStatus('')
      }
    } catch (error: any) {
      const message = readApiError(error, 'Không tải được kịch bản video')
      setLoadError(message)
      setStatus(message)
    } finally {
      if (!options.quiet) setBusy(null)
    }
  }

  const _createStory = async () => {
    if (createStoryBusyRef.current) return
    createStoryBusyRef.current = true
    setBusy('story')
    try {
      const result = await createGenerateVideoStoryFromProjectApi(selectedId)
      setStatus(`Đã đưa vào hàng đợi tạo kịch bản (${result.job.id.slice(0, 8)})`)
      const completedJob = await waitForGenerateVideoJob(result.job.id, (job) => {
        setWorkflowProgress(progressFromJob(selectedId, job))
        setStatus(`Đang tạo kịch bản: ${job.status} · ${Math.round(Number(job.progress_percent || 0))}%`)
      }, 5 * 60 * 1000)
      if (completedJob.status === 'FAILED') {
        throw new Error(completedJob.error_message || 'Script job failed')
      }
      const updatedProject = await fetchVideoWorkspaceApi(selectedId)
      const nextStory = workflowStory(updatedProject)
      if (nextStory) {
        nextStory.meta = { ...(nextStory.meta || {}), workflow_id: selectedId }
        updateStory(nextStory)
        setPreviewStory(nextStory)
        setActiveStep('story')
        setStatus('')
      }
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không tạo được story')
    } finally {
      createStoryBusyRef.current = false
      setBusy(null)
    }
  }

  const _savePlan = async () => {
    if (!selectedId) return
    if (!beginAction('save-plan')) return
    setBusy('save-plan')
    try {
      const payload = planDraftToPayload(planDraft)
      const { story_data: storyData, ...metadata } = payload
      await updateVideoWorkspaceApi(selectedId, {
        ...metadata,
      })
      if (story || previewStory) {
        await saveGenerateVideoStoryApi(updateRenderScenes(currentStoryForAction(), storyData as GenerateVideoScene[]))
      }
      const workflow = await fetchVideoWorkspaceApi(selectedId)
      setSelectedProject(workflow)
      setPlanDraft(planDraftFromProject(workflow))
      setStatus('Đã lưu draft. Hãy tạo lại voice hoặc video nếu timeline đã thay đổi.')
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không lưu được kế hoạch AI')
    } finally {
      endAction('save-plan')
      setBusy(null)
    }
  }

  const saveStory = async () => {
    if (!beginAction('save-story')) return
    setBusy('save')
    try {
      const parsed = currentStoryForAction()
      const result = await saveGenerateVideoStoryApi(parsed)
      updateStory(result.story)
      setPreviewStory(result.story)
      setPreviewVersion(Date.now())
      const workflow = await fetchVideoWorkspaceApi(selectedId)
      setSelectedProject(workflow)
      setStatus(workflow.capabilities.can_approve_draft ? 'Đã lưu draft. Cần duyệt phiên bản hiện tại trước khi tạo voice/render.' : 'Đã lưu kịch bản.')
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'JSON story không hợp lệ')
    } finally {
      endAction('save-story')
      setBusy(null)
    }
  }

  const editStoryWithAi = async () => {
    if (!beginAction('edit-story')) return
    setBusy('edit-story')
    try {
      const parsed = currentStoryForAction()
      await saveGenerateVideoStoryApi(parsed)
      const result = await editGenerateVideoStoryWithAiApi(selectedId, editPrompt.trim())
      const completedJob = await waitForGenerateVideoJob(result.job.id, (job) => {
        setWorkflowProgress(progressFromJob(selectedId, job))
        setStatus(`Đang chỉnh draft bằng AI · ${Math.round(Number(job.progress_percent || 0))}%`)
      }, 5 * 60 * 1000)
      if (completedJob.status === 'FAILED') throw new Error(completedJob.error_message || 'AI edit thất bại')
      await loadProjectById(selectedId, { openSavedStory: true, quiet: true })
      setActiveStep('video')
      setShowEditDialog(false)
      setStatus('Đã chỉnh timeline bằng AI từ dữ liệu đã gen + tài liệu gốc')
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không chỉnh được story bằng AI')
    } finally {
      endAction('edit-story')
      setBusy(null)
    }
  }

  const reviewStoryWithAi = async () => {
    if (!beginAction('review-story')) return
    setBusy('review-story')
    try {
      const parsed = currentStoryForAction()
      await saveGenerateVideoStoryApi(parsed)
      const result = await reviewGenerateVideoStoryWithAiApi(selectedId, 'Duyệt draft trước khi tạo voice hoặc render video.')
      const completedJob = await waitForGenerateVideoJob(result.job.id, (job) => {
        setWorkflowProgress(progressFromJob(selectedId, job))
        setStatus(`AI đang review draft · ${Math.round(Number(job.progress_percent || 0))}%`)
      }, 5 * 60 * 1000)
      if (completedJob.status === 'FAILED') throw new Error(completedJob.error_message || 'AI review thất bại')
      await loadProjectById(selectedId, { openSavedStory: true, quiet: true })
      setPreviewVersion(Date.now())
      setStatus('AI review hoàn tất, draft mới nhất đã được lưu.')
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không duyệt được story bằng AI')
    } finally {
      endAction('review-story')
      setBusy(null)
    }
  }

  const generateVoice = async () => {
    if (selectedProject && !selectedProject.capabilities.can_generate_voice) {
      setStatus('Draft cần được duyệt trước khi tạo voice.')
      return
    }
    if (!beginAction('voice')) return
    setBusy('voice')
    try {
      const parsed = currentStoryForAction()
      await saveGenerateVideoStoryApi(parsed)
      const savedWorkflow = await fetchVideoWorkspaceApi(selectedId)
      setSelectedProject(savedWorkflow)
      if (!savedWorkflow.capabilities.can_generate_voice) throw new Error('Draft vừa thay đổi, cần duyệt lại trước khi tạo voice.')
      const result = await generateVideoVoiceApi(selectedId, voiceId || undefined, voiceSpeed, voiceProvider)
      const completedJob = await waitForGenerateVideoJob(result.job.id, (job) => {
        setWorkflowProgress(progressFromJob(selectedId, job))
        setStatus(`Đang tạo voice và căn timeline · ${Math.round(Number(job.progress_percent || 0))}%`)
      }, 5 * 60 * 1000)
      if (completedJob.status === 'FAILED') throw new Error(completedJob.error_message || 'Tạo voice thất bại')
      await loadProjectById(selectedId, { openSavedStory: true, quiet: true })
      setAudioVersion(Date.now())
      setPreviewVersion(Date.now())
      setActiveStep('video')
      const voiceLabel = voiceProviderOptions.find((option) => option.value === voiceProvider)?.label || voiceId
      setStatus(`Đã tạo voice và fit frame thành công (${voiceLabel}, ${voiceSpeed}x)`)
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không tạo được voice')
    } finally {
      endAction('voice')
      setBusy(null)
    }
  }

  const exportVideo = async () => {
    if (selectedProject && !selectedProject.capabilities.can_render) {
      setStatus(draftReviewRequired ? 'Draft cần được duyệt trước khi render.' : 'Workflow chưa sẵn sàng để render.')
      return
    }
    if (!beginAction('export-video')) return
    setBusy('export-video')
    try {
      const parsed = currentStoryForAction()
      await saveGenerateVideoStoryApi(parsed)
      const savedWorkflow = await fetchVideoWorkspaceApi(selectedId)
      setSelectedProject(savedWorkflow)
      if (!savedWorkflow.capabilities.can_render) throw new Error('Hãy duyệt draft và tạo voice mới trước khi render.')
      const result = await generateFinalVideoApi(selectedId)
      setActiveStep('preview')
      setStatus(`Đã đưa vào hàng đợi render (${result.job.id.slice(0, 8)})`)
      const completedJob = await waitForGenerateVideoJob(result.job.id, (job) => {
        setWorkflowProgress(progressFromJob(selectedId, job))
        setStatus(`Đang render MP4: ${job.status} · ${Math.round(Number(job.progress_percent || 0))}%`)
      }, 10 * 60 * 1000)
      if (completedJob.status === 'FAILED') {
        throw new Error(completedJob.error_message || 'Render job failed')
      }
      await loadProjectById(selectedId, { openSavedStory: true, quiet: true })
      if (completedJob.video_url) {
        setExportedVideoUrl(generateVideoOutputUrl(completedJob.video_url))
      }
      setStatus('Đã xuất video MP4 hoàn chỉnh')
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không xuất được video')
    } finally {
      endAction('export-video')
      setBusy(null)
    }
  }

  const approveDraft = async () => {
    if (!selectedId || !beginAction('approve-draft')) return
    setBusy('approve-draft')
    try {
      const saved = await saveGenerateVideoStoryApi(currentStoryForAction())
      const result = await approveGenerateVideoDraftApi(selectedId, saved.script_signature)
      await loadProjectById(selectedId, { openSavedStory: true, quiet: true })
      setStatus(
        result.series_warning
          ? 'Đã duyệt draft. Series đề xuất đã đầy hoặc không còn khả dụng; bạn có thể chọn series khác.'
          : result.job
          ? `Đã duyệt draft${result.series_applied ? ' và áp dụng series' : ''}; auto-production đã được xếp hàng.`
          : `Đã duyệt draft${result.series_applied ? ' và áp dụng series' : ''}.`,
      )
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không duyệt được draft')
    } finally {
      endAction('approve-draft')
      setBusy(null)
    }
  }

  const deleteCurrentProject = async () => {
    if (!selectedId || !selectedProject) return
    if (!window.confirm(`Bạn có chắc chắn muốn xóa vĩnh viễn workflow "${selectedProject.title}"? Hành động này không thể hoàn tác.`)) {
      return
    }
    setBusy('delete-project')
    try {
      await deleteVideoWorkspaceApi(selectedId)
      onBackToList()
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không xóa được workflow')
    } finally {
      setBusy(null)
    }
  }

  const isStudioDetail = activeStep === 'video' && Boolean(previewStory || story)

  return (
    <div className={isStudioDetail ? "min-h-[calc(100vh-24px)] bg-[#f6f8ff]" : "workspace-page"}>
      {draftReviewRequired && (
        <div className="mx-3 mb-3 flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-sm sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-black">
              <ShieldCheck size={17} /> Draft cần người dùng duyệt
              {typeof visibleDraftQuality?.score === 'number' && (
                <span className="rounded-full bg-white px-2 py-0.5 text-xs text-amber-800">Quality {visibleDraftQuality.score}/100</span>
              )}
            </div>
            <p className="mt-1 text-xs font-medium text-amber-800">
              Voice và render đang bị khóa. Hãy đối chiếu bài gốc, sửa nếu cần, rồi duyệt phiên bản lời thoại hiện tại.
            </p>
            <p className="mt-1 text-xs text-amber-800">
              Duyệt sẽ lưu bản đang sửa và có thể xếp hàng tạo voice/video theo cấu hình auto. Đây không phải duyệt video để đăng mạng xã hội.
            </p>
            {visibleDraftQuality?.issues?.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-900">
                {visibleDraftQuality.issues.slice(0, 4).map((issue, index) => (
                  <li key={`${issue.code || 'issue'}-${index}`}>{issue.message || issue.code}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {contentId && <button type="button" onClick={() => setShowContentDetailId(contentId)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 text-xs font-bold text-amber-900">
              <Newspaper size={15} /> Xem bài gốc
            </button>}
            <button
              type="button"
              onClick={() => void approveDraft()}
              disabled={actionsLocked || !selectedProject?.capabilities.can_approve_draft}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 text-xs font-black text-white hover:bg-amber-700 disabled:opacity-50"
            >
              <CheckCircle2 size={15} /> {busy === 'approve-draft' ? 'Đang duyệt...' : 'Duyệt draft hiện tại'}
            </button>
          </div>
        </div>
      )}
      {isStudioDetail && (loadError || status) && <div role="status" aria-live="polite"
        className={`mx-3 mb-3 rounded-lg border p-3 text-sm ${loadError ? 'border-red-200 bg-red-50 text-red-800' : 'border-slate-200 bg-white text-slate-700'}`}>
        {loadError || status}
      </div>}
      {!isStudioDetail && (
      <div className="mb-4 flex flex-col gap-4">
        <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={onBackToList} className="icon-button shrink-0 border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">
                <ArrowLeft size={16} />
              </button>
              <h1 className="truncate text-xl font-black text-slate-900">
                {selectedProject?.title || 'Video Script Editor'}
              </h1>
              {selectedProject && (
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-black uppercase text-emerald-800">
                  {inferProjectStatus(selectedProject, story)}
                </span>
              )}
              {selectedProject && (
                <button
                  type="button"
                  onClick={() => void deleteCurrentProject()}
                  disabled={Boolean(busy)}
                  title="Xóa workflow này"
                  className="ml-auto flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50/50 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100 transition-colors disabled:opacity-40"
                >
                  <Trash2 size={14} />
                  <span>Xóa Workflow</span>
                </button>
              )}
            </div>
            
            {selectedProject && (
              <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium text-slate-600 md:pl-12">
                <button
                  type="button"
                  onClick={() => void openTransferModal()}
                  title="Chuyển series cho dự án này"
                  className="flex items-center gap-1.5 rounded-md bg-indigo-50 px-2.5 py-1 text-indigo-700 hover:bg-indigo-100 transition-colors font-bold shadow-2xs"
                >
                  <FolderKanban size={13} />
                  <span>{selectedProject.series?.title || 'Chưa thuộc series nào'}</span>
                  <Pencil size={11} className="ml-0.5 opacity-75" />
                </button>
                <div className="flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1">
                  <Film size={13} className="text-slate-400" />
                  {String(selectedProject.metadata?.format || 'NARRATED_STORY').replace('_', ' ')}
                </div>
                <div className="flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1">
                  <Mic2 size={13} className="text-slate-400" />
                  {String(selectedProject.metadata?.tone || 'Tự nhiên')}
                </div>
                {Boolean(selectedProject.metadata?.target_duration_seconds) && (
                  <div className="flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1">
                    <Clock size={13} className="text-slate-400" />
                    {String(selectedProject.metadata?.target_duration_seconds)}s
                  </div>
                )}
                {Boolean(selectedProject.metadata?.confidence_score) && (
                   <div className="flex items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1 text-blue-700">
                     <CheckCircle2 size={13} />
                     Confidence: {String(selectedProject.metadata?.confidence_score)}%
                   </div>
                )}
                <div className="ml-1 text-[11px] text-slate-400">
                  ID: {selectedProject.id.slice(0, 8)}
                </div>
              </div>
            )}
          </div>
          
          <div className="flex shrink-0 items-center gap-2">
            {contentId && (
              <button
                onClick={() => setShowContentDetailId(contentId)}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 text-xs font-bold text-blue-700 shadow-sm transition-all hover:bg-blue-100"
              >
                <Newspaper size={15} /> Xem bài gốc
              </button>
            )}
            <button onClick={() => void loadInitial()} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 shadow-sm transition-all hover:bg-slate-50">
               Reload
            </button>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
          <div className="flex flex-wrap items-center gap-2">
            {steps.map((step, index) => {
              const active = activeStep === step.id
              return (
                <button
                  key={step.id}
                  onClick={() => setActiveStep(step.id)}
                  className={`flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-bold transition-all ${active ? 'border-[#2563eb] bg-[#eff6ff] text-[#1d4ed8] shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded ${active ? 'bg-blue-100 text-blue-700' : 'bg-slate-100'}`}>
                    {step.icon}
                  </span>
                  <span>{index + 1}. {step.label}</span>
                </button>
              )
            })}
          </div>
          {status ? (
            <div className="flex items-center rounded-md border border-slate-200 bg-white px-4 py-2 text-[12px] font-bold text-slate-700 shadow-sm">
              {status}
            </div>
          ) : null}
        </div>

        <WorkflowProgress progress={workflowProgress} />

        {loadError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            {loadError}
          </div>
        )}
      </div>
      )}

      {showEditDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4">
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <div className="text-base font-black text-[#0f172a]">Edit story with AI</div>
                <div className="mt-1 text-xs font-semibold text-slate-500">Nhập yêu cầu chỉnh sửa cho story data hiện tại.</div>
              </div>
              <button onClick={() => setShowEditDialog(false)} className="icon-button border border-slate-200 bg-white text-slate-600">
                <X size={16} />
              </button>
            </div>
            <div className="flex flex-col gap-3 p-4">
              <textarea
                autoFocus
                value={editPrompt}
                onChange={(event) => setEditPrompt(event.target.value)}
                placeholder="Ví dụ: Viết lại subtitle tự nhiên hơn, tăng kịch tính ở 2 scene đầu, vẫn giữ đúng dữ kiện bài gốc."
                className="h-40 w-full resize-y rounded-md border border-slate-200 p-3 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-blue-100"
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowEditDialog(false)} className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700">
                  Cancel
                </button>
                <button disabled={!editPrompt.trim() || actionsLocked} onClick={() => void editStoryWithAi()} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-xs font-semibold text-white disabled:opacity-50">
                  <Wand2 size={14} /> Submit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeStep === 'video' && (
        <StoryVisualPreview
          draftReviewRequired={draftReviewRequired}
          story={previewStory || story}
          version={previewVersion}
          audioSrc={audioSrc}
          saving={busy === 'save'}
          exporting={busy === 'export-video'}
          voiceGenerating={busy === 'voice' || workflowRunning}
          voiceProvider={voiceProvider}
          fitting={busy === 'voice'}
          onSave={() => void saveStory()}
          onExport={() => void exportVideo()}
          onGenerateVoice={() => void generateVoice()}
          onVoiceProviderChange={setVoiceProvider}
          onFitFrames={() => void generateVoice()}
          onExit={() => setActiveStep('video')}
          onReload={() => void loadInitial()}
          onEditWithAi={() => setShowEditDialog(true)}
          onReviewWithAi={() => void reviewStoryWithAi()}
          onChange={(nextStory) => {
            setPreviewStory(nextStory)
            updateStory(nextStory)
          }}
        />
      )}

      <div>
        <section className="grid gap-4">
          {activeStep === 'preview' && (
          <Panel title="3. Export MP4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
              <div className="space-y-3">
                <button disabled={!canRenderMp4 || actionsLocked || selectedProject?.capabilities.can_render === false} onClick={() => void exportVideo()} className="h-8 w-full rounded-md bg-[var(--error)] px-3 text-xs font-semibold text-white disabled:opacity-50">
                  {busy === 'export-video' ? 'Đang render MP4...' : 'Render ra file MP4'}
                </button>
                <p className="text-sm text-slate-500">Bấm render để backend gọi Remotion và ghi file MP4 vào `data_demo/video_gen_demo/out`.</p>
                {exportedVideoUrl && (
                  <div className="grid gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <a href={exportedVideoUrl} target="_blank" rel="noreferrer" className="text-sm font-black text-emerald-800 hover:underline">
                      Mở video đã xuất
                    </a>
                    <a href={exportedVideoUrl} download className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800">
                      <Download size={14} /> Tải video
                    </a>
                    <a href={`/approvals?profile_id=${encodeURIComponent(selectedProject?.profile?.id || '')}`} className="inline-flex min-h-8 items-center justify-center rounded-md bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white">
                      Mở Approvals để duyệt và lên lịch
                    </a>
                    <p className="text-xs leading-5 text-emerald-800">Sản xuất video đã hoàn tất. Duyệt video, chọn lịch hoặc đăng ngay tại trang Approvals.</p>
                  </div>
                )}
              </div>
              <div className="justify-self-start lg:justify-self-end">
                <div className="w-[180px] overflow-hidden rounded-lg border border-slate-200 bg-black shadow-sm sm:w-[210px]">
                  {exportedVideoUrl ? (
                    <video src={exportedVideoUrl} controls className="block aspect-[9/16] h-auto w-full bg-black object-contain" />
                  ) : (
                    <div className="flex aspect-[9/16] items-center justify-center bg-slate-950 px-3 text-center text-xs font-semibold text-slate-400">
                      Chưa có MP4
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Panel>
          )}
        </section>
      </div>
      {showContentDetailId && (
        <ContentDetailDialog
          contentId={showContentDetailId}
          onClose={() => setShowContentDetailId(null)}
        />
      )}
      {transferModalOpen && (
        <TransferSeriesModal
          itemTitle={selectedProject?.title || 'Video Project'}
          currentSeriesId={selectedProject?.series?.id}
          seriesList={allSeries}
          isSubmitting={transferSubmitting}
          onClose={() => setTransferModalOpen(false)}
          onSubmit={(targetSeriesId) => void handleTransferSeries(targetSeriesId)}
        />
      )}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-black text-[#0f172a]">
        <CheckCircle2 size={16} className="text-[#16a34a]" />
        {title}
      </div>
      {children}
    </div>
  )
}

async function waitForGenerateVideoJob(
  jobId: string,
  onUpdate: (job: Awaited<ReturnType<typeof fetchGenerateVideoJobApi>>['job']) => void,
  timeoutMs: number,
) {
  const timeoutAt = Date.now() + timeoutMs
  while (Date.now() < timeoutAt) {
    const { job } = await fetchGenerateVideoJobApi(jobId)
    onUpdate(job)
    if (job.status === 'RENDERED' || job.status === 'COMPLETED' || job.status === 'FAILED') {
      return job
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2000))
  }
  throw new Error('Job xử lý quá lâu, kiểm tra lại sau.')
}




function _SourceContentPreview({ source }: { source: Record<string, any> }) {
  const [activeTab, setActiveTab] = useState<'content' | 'media'>('content')

  const mediaItems = useMemo(() => {
    return Array.isArray(source.media)
      ? source.media.filter((item): item is Record<string, any> => Boolean(item) && typeof item === 'object')
      : []
  }, [source.media])

  const sourceUrl = typeof source.source_url === 'string'
    ? source.source_url
    : typeof source.canonical_url === 'string'
      ? source.canonical_url
      : ''

  const sourceDomain = useMemo(() => {
    if (!sourceUrl) return ''
    try {
      return new URL(sourceUrl).hostname.replace(/^www\./, '')
    } catch {
      return sourceUrl
    }
  }, [sourceUrl])

  const sourceTitle = typeof source.canonical_title === 'string'
    ? source.canonical_title
    : typeof source.title === 'string'
      ? source.title
      : 'Chưa có tiêu đề'

  const text = typeof source.full_text === 'string'
    ? source.full_text
    : typeof source.summary === 'string'
      ? source.summary
      : ''

  const paragraphs = useMemo(() => text ? text.split(/\n+/).filter(Boolean) : [], [text])
  const wordCount = useMemo(() => text.split(/\s+/).filter(Boolean).length, [text])

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-xs">
            <BookOpen size={17} strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Nguồn bài viết</span>
              {sourceDomain && (
                <span className="inline-flex items-center gap-1 rounded-full border border-blue-200/80 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                  <Globe size={10} />
                  {sourceDomain}
                </span>
              )}
            </div>
            <h3 className="mt-0.5 truncate text-sm font-black text-slate-900" title={sourceTitle}>
              {sourceTitle}
            </h3>
          </div>
        </div>

        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
          >
            <ExternalLink size={13} />
            Mở bài gốc
          </a>
        )}
      </div>

      {/* Segmented Tab Controls */}
      <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-100/80 p-1">
        <div className="grid flex-1 grid-cols-2 gap-1">
          <button
            onClick={() => setActiveTab('content')}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition-all ${
              activeTab === 'content'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText size={14} />
            Nội dung ({wordCount} từ)
          </button>
          <button
            onClick={() => setActiveTab('media')}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition-all ${
              activeTab === 'media'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ImageIcon size={14} />
            Media ({mediaItems.length})
          </button>
        </div>
      </div>

      {/* Tab Body */}
      {activeTab === 'content' ? (
        <div className="max-h-[360px] overflow-y-auto rounded-xl border border-slate-200/80 bg-slate-50/60 p-3.5 text-xs leading-6 text-slate-700 space-y-2.5 font-normal">
          {paragraphs.length > 0 ? (
            paragraphs.slice(0, 15).map((paragraph: string, index: number) => (
              <p key={index} className="text-slate-700 leading-relaxed">
                {paragraph}
              </p>
            ))
          ) : (
            <div className="flex h-28 items-center justify-center text-slate-400 font-semibold">
              Chưa có nội dung văn bản cho bài gốc.
            </div>
          )}
        </div>
      ) : (
        <div className="max-h-[360px] overflow-y-auto pr-0.5">
          {mediaItems.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-4 text-center">
              <ImageIcon size={24} className="text-slate-300" />
              <span className="mt-2 text-xs font-bold text-slate-500">Bài gốc không đính kèm ảnh/video</span>
            </div>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {mediaItems.map((item, index) => (
                <SourceMediaItem key={item.id || index} item={item} index={index} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SourceMediaItem({ item, index }: { item: Record<string, any>; index: number }) {
  const mediaUrlValue = item.storage_url || item.source_url
  const previewUrl = item.thumbnail_url || mediaUrlValue
  const mediaType = String(item.media_type || '')
  const mimeType = String(item.mime_type || '')
  const isVideo = mediaType.toUpperCase().includes('VIDEO') || mimeType.startsWith('video/') || String(mediaUrlValue || '').match(/\.(mp4|webm|mov|m3u8)(\?|$)/i)
  const isImage = mediaType.toUpperCase().includes('IMAGE') || mimeType.startsWith('image/') || String(previewUrl || '').match(/\.(png|jpe?g|webp|gif|avif)(\?|$)/i)

  return (
    <div className="group relative overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xs transition-all hover:border-blue-300 hover:shadow-xs">
      <div className="relative aspect-video w-full bg-slate-950 overflow-hidden">
        {mediaUrlValue && isVideo ? (
          <video src={mediaUrlValue} poster={item.thumbnail_url || undefined} controls className="h-full w-full object-contain" />
        ) : previewUrl && isImage ? (
          <a href={mediaUrlValue || previewUrl} target="_blank" rel="noreferrer" className="block h-full w-full">
            <img
              src={previewUrl}
              alt={`media-${index + 1}`}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          </a>
        ) : mediaUrlValue ? (
          <a href={mediaUrlValue} target="_blank" rel="noreferrer" className="flex h-full w-full items-center justify-center p-3 text-center text-xs font-bold text-blue-600">
            <ExternalLink size={16} className="mr-1" /> Mở media
          </a>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-slate-400">
            Không có URL
          </div>
        )}

        <span className="absolute left-2 top-2 rounded-md bg-slate-950/70 backdrop-blur-xs px-2 py-0.5 text-[9px] font-black uppercase text-white tracking-wider">
          {isVideo ? 'VIDEO' : isImage ? 'IMAGE' : 'MEDIA'}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] font-bold text-slate-600 bg-slate-50/80">
        <span className="truncate text-slate-500 font-mono text-[10px]">#{index + 1}</span>
        {mediaUrlValue && (
          <a
            href={mediaUrlValue}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-blue-600 hover:underline"
          >
            Mở tab mới <ExternalLink size={10} />
          </a>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-black uppercase tracking-wider text-slate-500">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  )
}

const inputClass = 'h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 outline-none focus:border-[#2563eb]'
const _textareaClass = 'w-full resize-y rounded-lg border border-slate-200 p-3 text-sm font-medium text-slate-700 outline-none focus:border-[#2563eb]'
const videoAspectPresets = [
  { label: '9:16', width: 1080, height: 1920 },
  { label: '3:4', width: 1080, height: 1440 },
  { label: '4:5', width: 1080, height: 1350 },
  { label: '1:1', width: 1080, height: 1080 },
  { label: '16:9', width: 1920, height: 1080 },
]
const fpsPresets = [15, 24, 25, 30, 50, 60]
const backgroundPresets = ['#05070b', '#000000', '#ffffff', '#f8fafc', '#111827', '#ef4444', '#2563eb', '#16a34a', '#ff6200']

function _StoryDataEditor({
  story,
  sceneIndex,
  onSelectScene,
  onChange,
}: {
  story: GenerateVideoStory | null
  sceneIndex: number
  onSelectScene: (index: number) => void
  onChange: (story: GenerateVideoStory, nextIndex?: number) => void
}) {
  if (!story) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
        Chưa có story data. Bấm Create story để tạo dữ liệu rồi chỉnh sửa tại đây.
      </div>
    )
  }

  const scenes = storyTimelineScenes(story)
  const meta = story.meta || {}
  const video = story.video || { width: 1080, height: 1920, fps: 30, background: '#05070b' }
  const audio = story.audio || {}
  const updateMeta = (field: keyof NonNullable<GenerateVideoStory['meta']>, value: string) => onChange({ ...story, meta: { ...meta, [field]: value } })
  const updateVideo = (field: keyof GenerateVideoStory['video'], value: string | number) => onChange({ ...story, video: { ...video, [field]: value } })
  const updateVideoFields = (patch: Partial<GenerateVideoStory['video']>) => onChange({ ...story, video: { ...video, ...patch } })
  const updateAudioFields = (patch: Partial<NonNullable<GenerateVideoStory['audio']>>) => updateAudio(story, onChange, patch)
  const aspectValue = `${video.width}x${video.height}`
  const aspectPreset = videoAspectPresets.find((preset) => preset.width === Number(video.width) && preset.height === Number(video.height))
  const backgroundColor = normalizeColorValue(String(video.background || '#05070b'))

  return (
    <div className="mt-3 grid gap-4">
      <div className="rounded-lg border border-[#d9e0ea] bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-black text-[#0f172a]">Story data editor</div>
            <div className="mt-1 text-xs font-medium text-slate-500">{scenes.length} scene · chỉnh sửa xong bấm Save edits để lưu như logic cũ.</div>
          </div>
          <div className="rounded bg-[#eff6ff] px-3 py-1.5 text-xs font-black text-[#1d4ed8]">
            {(meta.source || 'generate-video').toUpperCase()}
          </div>
        </div>

        {meta.ai_story_review && (
          <div className={`mb-3 rounded-md border px-3 py-2 text-xs font-semibold ${meta.ai_story_review.action === 'REVISED' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck size={14} />
              <span>{meta.ai_story_review.action === 'REVISED' ? 'AI reviewer đã sửa draft' : 'AI reviewer đã duyệt draft'}</span>
              {meta.ai_story_review.reviewed_at && <span className="text-[11px] opacity-75">{new Date(meta.ai_story_review.reviewed_at).toLocaleString()}</span>}
            </div>
            {meta.ai_story_review.notes?.length ? (
              <div className="mt-1 line-clamp-2 opacity-90">{meta.ai_story_review.notes.join(' · ')}</div>
            ) : null}
            {meta.voice_invalidated_by_story_review ? (
              <div className="mt-1 text-[11px] font-black text-amber-700">Voice cũ đã bị bỏ vì timeline/subtitle thay đổi.</div>
            ) : null}
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <div className="grid gap-3">
            <Field label="Tiêu đề">
              <input value={meta.title || ''} onChange={(event) => updateMeta('title', event.target.value)} className={inputClass} />
            </Field>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Series ID"><input value={meta.series_id || ''} onChange={(event) => updateMeta('series_id', event.target.value)} className={inputClass} /></Field>
              <Field label="Plan ID"><input value={meta.plan_id || ''} onChange={(event) => updateMeta('plan_id', event.target.value)} className={inputClass} /></Field>
              <Field label="Workflow ID"><input value={meta.workflow_id || ''} onChange={(event) => updateMeta('workflow_id', event.target.value)} className={inputClass} /></Field>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_130px]">
              <Field label="Khung hình">
                <select
                  value={aspectPreset ? aspectValue : 'custom'}
                  onChange={(event) => {
                    const preset = videoAspectPresets.find((item) => `${item.width}x${item.height}` === event.target.value)
                    if (preset) updateVideoFields({ width: preset.width, height: preset.height })
                  }}
                  className={inputClass}
                >
                  {videoAspectPresets.map((preset) => (
                    <option key={preset.label} value={`${preset.width}x${preset.height}`}>{preset.label} · {preset.width}x{preset.height}</option>
                  ))}
                  {!aspectPreset && <option value="custom">Custom · {video.width}x{video.height}</option>}
                </select>
              </Field>
              <Field label="FPS">
                <select value={fpsPresets.includes(Number(video.fps)) ? Number(video.fps) : 'custom'} onChange={(event) => updateVideo('fps', Number(event.target.value) || 30)} className={inputClass}>
                  {fpsPresets.map((fps) => <option key={fps} value={fps}>{fps}</option>)}
                  {!fpsPresets.includes(Number(video.fps)) && <option value="custom">Custom · {video.fps}</option>}
                </select>
              </Field>
            </div>
            <Field label="Background">
              <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  {backgroundPresets.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`Background ${color}`}
                      onClick={() => updateVideo('background', color)}
                      className={`h-8 w-8 rounded-md border ${backgroundColor === color ? 'border-[#2563eb] ring-2 ring-[#bfdbfe]' : 'border-slate-200'}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                  <input type="color" value={backgroundColor} onChange={(event) => updateVideo('background', event.target.value)} className="h-8 w-10 cursor-pointer rounded border border-slate-200 bg-white p-1" />
                  <div className="h-8 w-12 rounded border border-slate-200" style={{ backgroundColor: backgroundColor }} />
                </div>
                <input value={video.background || ''} onChange={(event) => updateVideo('background', event.target.value)} className={inputClass} placeholder="#05070b" />
              </div>
            </Field>
          </div>

          <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-sm font-black text-[#0f172a]">Audio</div>
            <Field label="Voice path"><input value={audio.voice || ''} onChange={(event) => updateAudioFields({ voice: event.target.value })} className={inputClass} /></Field>
            <Field label="Music path"><input value={audio.music || ''} onChange={(event) => updateAudioFields({ music: event.target.value })} className={inputClass} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Voice volume"><input type="number" min="0" step="0.05" value={audio.voiceVolume ?? 1} onChange={(event) => updateAudioFields({ voiceVolume: Number(event.target.value) || 0 })} className={inputClass} /></Field>
              <Field label="Music volume"><input type="number" min="0" step="0.05" value={audio.musicVolume ?? 0} onChange={(event) => updateAudioFields({ musicVolume: Number(event.target.value) || 0 })} className={inputClass} /></Field>
            </div>
          </div>
        </div>
      </div>

      <SceneEditor
        story={story}
        scenes={scenes}
        sceneIndex={sceneIndex}
        onSelect={onSelectScene}
        onChange={onChange}
      />
    </div>
  )
}

function StoryVisualPreview({
  draftReviewRequired,
  story,
  version,
  audioSrc,
  saving,
  exporting,
  voiceGenerating,
  voiceProvider,
  fitting,
  onSave,
  onExport,
  onGenerateVoice,
  onVoiceProviderChange,
  onFitFrames,
  onExit,
  onReload,
  onEditWithAi,
  onReviewWithAi,
  onChange,
}: {
  draftReviewRequired: boolean
  story: GenerateVideoStory | null
  version: number
  audioSrc: string
  saving: boolean
  exporting: boolean
  voiceGenerating: boolean
  voiceProvider: GenerateVideoVoiceProvider
  fitting: boolean
  onSave: () => void
  onExport: () => void
  onGenerateVoice: () => void
  onVoiceProviderChange: (provider: GenerateVideoVoiceProvider) => void
  onFitFrames: () => void
  onExit: () => void
  onReload: () => void
  onEditWithAi?: () => void
  onReviewWithAi?: () => void
  onChange: (story: GenerateVideoStory) => void
}) {
  const scenes = useMemo(() => story ? storyTimelineScenes(story) : [], [story])
  const [sceneIndex, setSceneIndex] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [mutedTracks, setMutedTracks] = useState<Record<string, boolean>>({})
  const [voiceDuration, setVoiceDuration] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const musicAudioRef = useRef<HTMLAudioElement | null>(null)
  const timelineAudioRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ index: number; startX: number; leftDuration: number; rightDuration: number; totalDuration: number; timelineWidth: number } | null>(null)
  const musicDragRef = useRef<{ mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; totalDuration: number; timelineWidth: number } | null>(null)
  const playStartRef = useRef<{ clock: number; time: number } | null>(null)

  useEffect(() => {
    setSceneIndex(0)
    setCurrentTime(0)
    setPlaying(false)
  }, [version, scenes.length])

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = Boolean(mutedTracks['audio-2'])
      audioRef.current.volume = clampNumber(Number(story?.audio?.voiceVolume ?? 1), 0, 1)
    }
  }, [mutedTracks, story?.audio?.voiceVolume])

  const videoDuration = story ? storyTimelineDuration(story, scenes) : scenes.reduce((total, item) => total + Number(item.duration || 0), 0)
  const previewAudio = story?.audio || {}
  const musicSrc = previewAudio.music ? `${generateVideoMediaUrl(previewAudio.music)}?v=${version}` : ''
  const musicStart = Number(previewAudio.musicStart || 0)
  const musicDuration = Number(previewAudio.musicDuration || Math.max(0.1, videoDuration - musicStart))
  const musicVolume = typeof previewAudio.musicVolume === 'number' ? previewAudio.musicVolume : 0.12
  const audio1Muted = Boolean(mutedTracks['audio-1'])
  const audio2Muted = Boolean(mutedTracks['audio-2'])
  const timelineAudioTracks = story ? storyAudioTracks(story, videoDuration) : []
  const mainVoiceTrack = timelineAudioTracks.find((track) => track.type === 'voice' && (!previewAudio.voice || track.src === previewAudio.voice))
  const mainVoiceStart = Number(mainVoiceTrack?.start || 0)
  const extraPlaybackTracks = timelineAudioTracks.filter((track) => {
    if (!track.src) return false
    if (track.id === 'voice-main' || track.id === 'music-main') return false
    if (previewAudio.voice && track.type === 'voice' && track.src === previewAudio.voice) return false
    if (previewAudio.music && track.type === 'music' && track.src === previewAudio.music) return false
    return true
  })

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.currentTime = Math.max(0, (currentTime >= videoDuration ? 0 : currentTime) - mainVoiceStart)
      void audio.play().catch((err) => {
        console.warn('Voice play deferred/failed:', err)
      })
    } else {
      audio.pause()
    }
  }, [mainVoiceStart, playing, videoDuration])

  useEffect(() => {
    const music = musicAudioRef.current
    if (!music) return
    music.muted = audio1Muted
    music.volume = clampNumber(musicVolume, 0, 1)

    const musicOffset = currentTime - musicStart
    const inMusicRange = Boolean(musicSrc) && musicOffset >= 0 && musicOffset <= musicDuration
    if (!inMusicRange) {
      music.pause()
      return
    }

    if (Math.abs(music.currentTime - musicOffset) > 0.35) {
      music.currentTime = musicOffset
    }
    if (playing && music.paused) {
      void music.play().catch(() => undefined)
    } else if (!playing) {
      music.pause()
    }
  }, [audio1Muted, currentTime, musicDuration, musicSrc, musicStart, musicVolume, playing])

  useEffect(() => {
    extraPlaybackTracks.forEach((track) => {
      const audio = timelineAudioRefs.current[track.id]
      if (!audio) return
      const start = Number(track.start || 0)
      const duration = Number(track.duration || Math.max(0.1, videoDuration - start))
      const offset = currentTime - start
      const inRange = offset >= 0 && offset <= duration
      audio.muted = Boolean(mutedTracks[track.id])
      audio.volume = clampNumber(Number(track.volume ?? 1), 0, 1)
      if (!inRange) {
        audio.pause()
        return
      }
      if (Math.abs(audio.currentTime - offset) > 0.35) {
        audio.currentTime = Math.max(0, offset)
      }
      if (playing && audio.paused) {
        void audio.play().catch(() => undefined)
      } else if (!playing) {
        audio.pause()
      }
    })
  }, [currentTime, extraPlaybackTracks, mutedTracks, playing, videoDuration])

  useEffect(() => {
    if (!playing) {
      playStartRef.current = null
      return
    }
    playStartRef.current = { clock: performance.now(), time: currentTime >= videoDuration ? 0 : currentTime }
    let frameId = 0
    const tick = () => {
      const start = playStartRef.current
      if (!start) return
      const voiceAudio = audioSrc ? audioRef.current : null
      const voiceClockTime = voiceAudio && !voiceAudio.paused && Number.isFinite(voiceAudio.currentTime)
        ? mainVoiceStart + voiceAudio.currentTime
        : null
      const nextTime = Math.min(videoDuration, voiceClockTime ?? start.time + (performance.now() - start.clock) / 1000)
      setCurrentTime(nextTime)
      setSceneIndex(sceneIndexAtTime(scenes, nextTime))
      if (nextTime >= videoDuration) {
        setPlaying(false)
        return
      }
      frameId = window.requestAnimationFrame(tick)
    }
    frameId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frameId)
  }, [audioSrc, mainVoiceStart, playing, videoDuration, scenes])

  const seekTo = (time: number) => {
    const nextTime = clampNumber(time, 0, videoDuration)
    setCurrentTime(nextTime)
    setSceneIndex(sceneIndexAtTime(scenes, nextTime))
    if (playing) {
      playStartRef.current = { clock: performance.now(), time: nextTime }
    }
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, nextTime - mainVoiceStart)
    }
  }

  const togglePlayback = () => {
    const nextPlaying = !playing
    if (nextPlaying) {
      const startPos = currentTime >= videoDuration ? 0 : currentTime
      if (currentTime >= videoDuration) {
        setCurrentTime(0)
        setSceneIndex(0)
      }
      if (audioRef.current && audioSrc) {
        audioRef.current.currentTime = Math.max(0, startPos - mainVoiceStart)
        void audioRef.current.play().catch((err) => {
          console.warn('Direct audio play failed/blocked by browser:', err)
        })
      }
    } else {
      if (audioRef.current) {
        audioRef.current.pause()
      }
    }
    setPlaying(nextPlaying)
  }
  const toggleTrackMute = (trackId: string) => {
    setMutedTracks((current) => ({ ...current, [trackId]: !current[trackId] }))
  }

  if (!scenes.length) {
    return (
      <div className="grid gap-3">
        <div className="flex aspect-[9/16] max-h-[520px] items-center justify-center rounded-lg bg-slate-950 text-sm font-semibold text-slate-400">Chưa có story để preview.</div>
        {story && (
          <button onClick={() => onChange(updateRenderScenes(story, [emptyScene()]))} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
            <Plus size={16} /> Thêm scene
          </button>
        )}
      </div>
    )
  }

  const timelineSceneIndex = Math.min(sceneIndexAtTime(scenes, currentTime), scenes.length - 1)
  const selectedSceneIndex = Math.min(sceneIndex, scenes.length - 1)
  const visibleSceneIndex = playing || timelineSceneIndex !== selectedSceneIndex ? timelineSceneIndex : selectedSceneIndex
  const scene = scenes[visibleSceneIndex]
  const displayTime = clampNumber(currentTime, getSceneStart(scenes, visibleSceneIndex), getSceneEnd(scenes, visibleSceneIndex))
  const sceneLocalTime = clampNumber(displayTime - getSceneStart(scenes, visibleSceneIndex), 0, Math.max(0.1, Number(scene.duration || 0)))
  const sceneProgress = clampNumber(sceneLocalTime / Math.max(0.1, Number(scene.duration || 0)), 0, 1)
  const subtitleSceneIndex = activeSubtitleSceneIndexAtTime(scenes, displayTime)
  const subtitleScene = subtitleSceneIndex >= 0 ? scenes[subtitleSceneIndex] : undefined
  const visibleSubtitle = subtitleScene?.subtitle || ''
  const subtitleStyle = subtitleScene?.text_style || {}
  const updateSubtitlePosition = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!story || subtitleSceneIndex < 0) return
    const rect = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!rect) return
    const left = clampNumber(((event.clientX - rect.left) / Math.max(1, rect.width)) * 100, 8, 92)
    const top = clampNumber(((event.clientY - rect.top) / Math.max(1, rect.height)) * 100, 10, 90)
    const nextScenes = scenes.map((item, index) => index === subtitleSceneIndex
      ? {
          ...item,
          text_style: {
            ...(item.text_style || {}),
            left: `${left}%`,
            top: `${top}%`,
            right: 'auto',
            bottom: 'auto',
            transform: 'translate(-50%, -50%)',
          },
        }
      : item)
    onChange(updateRenderScenes(story, nextScenes))
  }
  const frameSize = normalizeVideoFrame(story?.video)
  const frameAspect = frameSize.width / frameSize.height
  const storyBackgroundColor = normalizeColorValue(String(story?.video?.background || '#05070b'))
  const previewMaxHeight = isFullscreen ? 365 : 270
  const previewMaxWidth = Math.min(isFullscreen ? 650 : 520, Math.round(previewMaxHeight * frameAspect))
  const previewStage = (
    <div
      className="relative mx-auto w-full overflow-hidden rounded-lg bg-slate-950"
      style={{
        aspectRatio: `${frameSize.width} / ${frameSize.height}`,
        backgroundColor: storyBackgroundColor,
        maxHeight: previewMaxHeight,
        maxWidth: Math.max(180, previewMaxWidth),
      }}
    >
      <div className="absolute inset-0 overflow-hidden">
        <div className="h-full w-full" style={sceneVisualStyle(scene)}>
          <SceneMediaPreview
            key={`${version}-${visibleSceneIndex}-${scene.image}`}
            scene={scene}
            playing={playing}
            progress={sceneProgress}
            time={sceneLocalTime}
          />
        </div>
      </div>
      {visibleSubtitle && (
        <div
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            updateSubtitlePosition(event)
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) updateSubtitlePosition(event)
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          className={`absolute cursor-grab rounded bg-black/45 px-3 py-2 text-center font-black leading-tight text-white shadow-lg active:cursor-grabbing ${isFullscreen ? 'text-xl' : 'text-base'}`}
          style={{
            left: '50%',
            top: '82%',
            transform: 'translate(-50%, -50%)',
            width: '86%',
            ...(subtitleStyle as React.CSSProperties),
          }}
        >
          {visibleSubtitle}
        </div>
      )}
      <div className="absolute left-3 top-3 rounded bg-black/55 px-2 py-1 text-xs font-bold text-white">
        {visibleSceneIndex + 1}/{scenes.length} · {Number(scene.duration || 4)}s · {displayTime.toFixed(2)}s
      </div>
    </div>
  )
  return (
    <div className="grid gap-3">
      <RemotionLikeEditor
        draftReviewRequired={draftReviewRequired}
        key={version}
        story={story}
        scenes={scenes}
        sceneIndex={sceneIndex}
        playing={playing}
        previewStage={previewStage}
        videoDuration={videoDuration}
        currentTime={currentTime}
        voiceDuration={voiceDuration}
        audioSrc={audioSrc}
        isFullscreen={isFullscreen}
        mutedTracks={{ ...mutedTracks, 'audio-1': audio1Muted, 'audio-2': audio2Muted }}
        timelineRef={timelineRef}
        dragRef={dragRef}
        musicDragRef={musicDragRef}
        onSelect={setSceneIndex}
        onSeek={seekTo}
        onPlayToggle={togglePlayback}
        onSave={onSave}
        onExport={onExport}
        onGenerateVoice={onGenerateVoice}
        onVoiceProviderChange={onVoiceProviderChange}
        onFitFrames={onFitFrames}
        onExit={onExit}
        onReload={onReload}
        onEditWithAi={onEditWithAi}
        onReviewWithAi={onReviewWithAi}
        onToggleFullscreen={() => setIsFullscreen((value) => !value)}
        onToggleTrackMute={toggleTrackMute}
        saving={saving}
        exporting={exporting}
        voiceGenerating={voiceGenerating}
        voiceProvider={voiceProvider}
        fitting={fitting}
        onChange={onChange}
      />

      {audioSrc ? (
        <audio
          ref={audioRef}
          key={audioSrc}
          src={audioSrc}
          muted={audio2Muted}
          className="sr-only"
          onLoadedMetadata={(event) => {
            const duration = event.currentTarget.duration
            setVoiceDuration(Number.isFinite(duration) ? duration : null)
          }}
          onEnded={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
      ) : (
        <audio ref={audioRef} className="sr-only" />
      )}
      {musicSrc ? (
        <audio ref={musicAudioRef} key={musicSrc} src={musicSrc} muted={audio1Muted} className="sr-only" />
      ) : (
        <audio ref={musicAudioRef} className="sr-only" />
      )}
      {extraPlaybackTracks.map((track) => (
        <audio
          key={`${track.id}-${track.src}`}
          ref={(node) => {
            timelineAudioRefs.current[track.id] = node
          }}
          src={`${generateVideoMediaUrl(track.src)}?v=${version}`}
          muted={Boolean(mutedTracks[track.id])}
          className="sr-only"
        />
      ))}
    </div>
  )
}

function RemotionLikeEditor({
  draftReviewRequired,
  story,
  scenes,
  sceneIndex,
  playing,
  previewStage,
  videoDuration,
  currentTime,
  voiceDuration,
  audioSrc,
  isFullscreen,
  mutedTracks,
  timelineRef,
  dragRef,
  musicDragRef,
  onSelect,
  onSeek,
  onPlayToggle,
  onSave,
  onExport,
  onGenerateVoice,
  onVoiceProviderChange,
  onFitFrames,
  onExit,
  onReload,
  onEditWithAi,
  onReviewWithAi,
  onToggleFullscreen,
  onToggleTrackMute,
  saving,
  exporting,
  voiceGenerating,
  voiceProvider,
  fitting,
  onChange,
}: {
  draftReviewRequired: boolean
  story: GenerateVideoStory | null
  scenes: GenerateVideoScene[]
  sceneIndex: number
  playing: boolean
  previewStage: React.ReactNode
  videoDuration: number
  currentTime: number
  voiceDuration: number | null
  audioSrc: string
  isFullscreen: boolean
  mutedTracks: Record<string, boolean>
  timelineRef: React.RefObject<HTMLDivElement | null>
  dragRef: React.MutableRefObject<{ index: number; startX: number; leftDuration: number; rightDuration: number; totalDuration: number; timelineWidth: number } | null>
  musicDragRef: React.MutableRefObject<{ mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; totalDuration: number; timelineWidth: number } | null>
  onSelect: (index: number) => void
  onSeek: (time: number) => void
  onPlayToggle: () => void
  onSave: () => void
  onExport: () => void
  onGenerateVoice: () => void
  onVoiceProviderChange: (provider: GenerateVideoVoiceProvider) => void
  onFitFrames: () => void
  onExit: () => void
  onReload: () => void
  onEditWithAi?: () => void
  onReviewWithAi?: () => void
  onToggleFullscreen: () => void
  onToggleTrackMute: (trackId: string) => void
  saving: boolean
  exporting: boolean
  voiceGenerating: boolean
  voiceProvider: GenerateVideoVoiceProvider
  fitting: boolean
  onChange: (story: GenerateVideoStory) => void
}) {
  const subtitleDragRef = useRef<{ index: number; mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; timelineWidth: number } | null>(null)
  const trackDragRef = useRef<{ id: string; mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; timelineWidth: number } | null>(null)
  const [addAudioType, setAddAudioType] = useState<ProCutAudioTrackType | null>(null)
  const [addAudioMode, setAddAudioMode] = useState<'local' | 'link'>('local')
  const [addAudioLink, setAddAudioLink] = useState('')
  const [addAudioFile, setAddAudioFile] = useState<File | null>(null)
  const [addAudioBusy, setAddAudioBusy] = useState(false)
  const [addAudioError, setAddAudioError] = useState('')
  const [audioMenu, setAudioMenu] = useState<{ x: number; y: number; kind: 'legacy-music' | 'track'; trackId?: string } | null>(null)

  if (!story) return null

  const fps = story.video?.fps || 30
  const currentScene = scenes[Math.min(sceneIndex, scenes.length - 1)]
  const audio = story.audio || {}
  const audioTracks = storyAudioTracks(story, videoDuration)
  const musicSrc = audio.music ? generateVideoMediaUrl(audio.music) : ''
  const musicStart = Number(audio.musicStart || 0)
  const musicDuration = Number(audio.musicDuration || Math.max(0, videoDuration - musicStart))
  const musicLeft = videoDuration ? (musicStart / videoDuration) * 100 : 0
  const musicWidth = videoDuration ? Math.max(4, (musicDuration / videoDuration) * 100) : 0
  const voiceTrack = audioTracks.find((track) => track.type === 'voice' && (!audio.voice || track.src === audio.voice)) || audioTracks.find((track) => track.type === 'voice')
  const voiceStart = Number(voiceTrack?.start || 0)
  const voiceDurationValue = Number(voiceTrack?.duration || voiceDuration || Math.max(0, videoDuration - voiceStart))
  const voiceLeft = videoDuration ? (voiceStart / videoDuration) * 100 : 0
  const voiceWidth = videoDuration ? Math.min(100 - voiceLeft, Math.max(2, (voiceDurationValue / Math.max(videoDuration, 1)) * 100)) : 0
  const playheadLeft = videoDuration ? (currentTime / videoDuration) * 100 : 0
  const audio1Muted = Boolean(mutedTracks['audio-1'])
  const audio2Muted = Boolean(mutedTracks['audio-2'])
  const additionalAudioTracks = audioTracks.filter((track) => {
    if (track.id === voiceTrack?.id || track.id === 'music-main') return false
    if (audio.voice && track.type === 'voice' && track.src === audio.voice) return false
    if (audio.music && track.type === 'music' && track.src === audio.music) return false
    return true
  })

  const seekFromTimelinePointer = (clientX: number) => {
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect) return
    const nextTime = ((clientX - rect.left) / Math.max(1, rect.width)) * videoDuration
    onSeek(nextTime)
    onSelect(sceneIndexAtTime(scenes, nextTime))
  }
  const openAudioMenu = (event: React.MouseEvent<HTMLElement>, item: { kind: 'legacy-music' | 'track'; trackId?: string }) => {
    event.preventDefault()
    event.stopPropagation()
    setAudioMenu({ x: event.clientX, y: event.clientY, ...item })
  }
  const deleteAudioMenuTarget = () => {
    if (!audioMenu) return
    if (audioMenu.kind === 'legacy-music') {
      updateAudio(story, onChange, { music: '', musicStart: 0, musicDuration: 0 })
    } else if (audioMenu.trackId) {
      removeAudioTrack(story, onChange, audioMenu.trackId)
    }
    setAudioMenu(null)
  }

  const resizeScene = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current) return
    const drag = dragRef.current
    const secondsPerPixel = drag.totalDuration / Math.max(1, drag.timelineWidth)
    const deltaSeconds = (event.clientX - drag.startX) * secondsPerPixel
    const combined = drag.leftDuration + drag.rightDuration
    const left = Math.min(combined - 0.5, Math.max(0.5, drag.leftDuration + deltaSeconds))
    const right = combined - left
    const nextScenes = scenes.map((item) => ({ ...item, timing: undefined }))
    nextScenes[drag.index].duration = roundToFrame(left, fps)
    nextScenes[drag.index + 1].duration = roundToFrame(right, fps)
    onChange(updateRenderScenes(story, nextScenes))
    onSelect(drag.index)
      onSeek(getSceneEnd(nextScenes, drag.index))
  }
  const updateSubtitleTiming = (index: number, start: number, duration: number) => {
    const current = scenes[index]
    const ids = new Set([...(current.video_ids || []), ...(current.video_id ? [current.video_id] : [])])
    const visuals = scenes.filter(scene => scene.video_id && ids.has(scene.video_id))
    const sceneStart = visuals.length ? Math.min(...visuals.map(scene => Number(scene.start || 0))) : getSceneStart(scenes, index)
    const sceneEnd = visuals.length ? Math.max(...visuals.map(scene => Number(scene.end || 0))) : getSceneEnd(scenes, index)
    const uniqueTexts = collapseTextScenes(scenes)
    const textIndex = uniqueTexts.findIndex(scene => scene.text_id === current.text_id)
    const previous = uniqueTexts[textIndex - 1]
    const next = uniqueTexts[textIndex + 1]
    const previousEnd = previous ? Number(previous.subtitle_start || 0) + Number(previous.subtitle_duration || 0) : 0
    const nextStart = next ? Number(next.subtitle_start || 0) : videoDuration
    const minStart = Math.max(sceneStart, previousEnd)
    const maxEnd = Math.max(minStart + 0.1, Math.min(sceneEnd, nextStart))
    const nextStartValue = clampNumber(start, minStart, Math.max(minStart, maxEnd - 0.1))
    const nextDurationValue = clampNumber(duration, 0.1, Math.max(0.1, maxEnd - nextStartValue))
    updateSceneAt(story, scenes, index, {
      subtitle_start: roundToFrame(nextStartValue, fps),
      subtitle_duration: roundToFrame(nextDurationValue, fps),
    }, onChange)
    onSelect(index)
    onSeek(nextStartValue)
  }

  const insertSceneAfter = (scenePatch: Partial<GenerateVideoScene> = {}) => {
    const insertAt = Math.min(sceneIndex + 1, scenes.length)
    const nextScenes = [
      ...scenes.slice(0, insertAt),
      { ...emptyScene(), ...scenePatch },
      ...scenes.slice(insertAt),
    ]
    onChange(updateRenderScenes(story, nextScenes))
    onSelect(insertAt)
    onSeek(getSceneStart(nextScenes, insertAt))
  }

  const duplicateScene = () => {
    const current = scenes[sceneIndex]
    if (!current) return
    insertSceneAfter({ ...current, timing: undefined })
  }
  const openAddAudio = (type: ProCutAudioTrackType = 'music') => {
    setAddAudioType(type)
    setAddAudioMode('local')
    setAddAudioLink('')
    setAddAudioFile(null)
    setAddAudioError('')
  }

  const createAudioTrack = (type: ProCutAudioTrackType, src: string) => {
    const nextTrack = {
      id: `${type}-${Date.now()}`,
      type,
      src,
      start: currentTime,
      duration: Math.max(0.5, videoDuration - currentTime),
      volume: type === 'voice' ? 1 : 0.12,
    }
    updateAudio(story, onChange, { tracks: [...audioTracks, nextTrack], ...(type === 'voice' ? { voice: src } : {}) })
  }

  const submitAddAudio = async () => {
    if (!addAudioType) return
    setAddAudioError('')
    setAddAudioBusy(true)
    try {
      let src = addAudioLink.trim()
      if (addAudioMode === 'local') {
        if (!addAudioFile) {
          setAddAudioError('Chọn một file audio trước đã.')
          return
        }
        const result = await uploadGenerateVideoAudioApi(addAudioFile)
        src = result.asset_path
      }
      if (!src) {
        setAddAudioError('Nhập link audio trước đã.')
        return
      }
      createAudioTrack(addAudioType, src)
      setAddAudioType(null)
      setAddAudioLink('')
      setAddAudioFile(null)
    } catch (error: any) {
      setAddAudioError(error?.response?.data?.detail || error?.message || 'Không thêm được audio')
    } finally {
      setAddAudioBusy(false)
    }
  }

  const legacyEditor = (
    <div
      className={isFullscreen
        ? "fixed inset-0 z-[80] flex h-screen w-screen flex-col overflow-hidden border border-[#2d2d37] bg-[#111115] text-[#f1f1f6] shadow-sm"
        : "relative flex h-[720px] w-full flex-col overflow-hidden rounded-lg border border-[#2d2d37] bg-[#111115] text-[#f1f1f6] shadow-sm"}
      onClick={() => setAudioMenu(null)}
    >
      <ProCutTopToolbar
        fps={fps}
        isFullscreen={isFullscreen}
        onExit={onExit}
        onExport={onExport}
        onGenerateVoice={onGenerateVoice}
        onVoiceProviderChange={onVoiceProviderChange}
        onFitFrames={onFitFrames}
        onSave={onSave}
        onToggleFullscreen={onToggleFullscreen}
        saving={saving}
        exporting={exporting}
        voiceGenerating={voiceGenerating}
        voiceProvider={voiceProvider}
        fitting={fitting}
        story={story}
        videoDuration={videoDuration}
      />

      {addAudioType && (
        <ProCutAddAudioPanel
          busy={addAudioBusy}
          error={addAudioError}
          file={addAudioFile}
          link={addAudioLink}
          mode={addAudioMode}
          type={addAudioType}
          onCancel={() => setAddAudioType(null)}
          onFileChange={setAddAudioFile}
          onLinkChange={setAddAudioLink}
          onModeChange={setAddAudioMode}
          onTypeChange={setAddAudioType}
          onSubmit={() => void submitAddAudio()}
        />
      )}

      <ProCutMainSplit
        currentScene={currentScene}
        currentTime={currentTime}
        fps={fps}
        isFullscreen={isFullscreen}
        playing={playing}
        previewStage={previewStage}
        sceneIndex={sceneIndex}
        scenes={scenes}
        story={story}
        videoDuration={videoDuration}
        onChange={onChange}
        onPlayToggle={onPlayToggle}
        onSeek={onSeek}
      />

      <ProCutTimelinePanel
        audioMenu={audioMenu}
        audioSrc={audioSrc}
        audio1Muted={audio1Muted}
        audio2Muted={audio2Muted}
        audioTracks={additionalAudioTracks}
        dragRef={dragRef}
        mutedTracks={mutedTracks}
        musicDragRef={musicDragRef}
        musicDuration={musicDuration}
        musicLeft={musicLeft}
        musicSrc={musicSrc}
        musicStart={musicStart}
        musicWidth={musicWidth}
        playheadLeft={playheadLeft}
        sceneIndex={sceneIndex}
        scenes={scenes}
        story={story}
        subtitleDragRef={subtitleDragRef}
        trackDragRef={trackDragRef}
        timelineRef={timelineRef}
        videoDuration={videoDuration}
        isFullscreen={isFullscreen}
        voiceLeft={voiceLeft}
        voiceWidth={voiceWidth}
        onAudioMenuDelete={deleteAudioMenuTarget}
        onAddTrack={() => openAddAudio()}
        onChange={onChange}
        onContextMenuTrack={openAudioMenu}
        onResizeScene={resizeScene}
        onSeek={onSeek}
        onSeekFromPointer={seekFromTimelinePointer}
        onSelect={onSelect}
        onToggleTrackMute={onToggleTrackMute}
        onUpdateSubtitleTiming={updateSubtitleTiming}
      />
    </div>
  )
  void legacyEditor

  return (
    <div
      className={isFullscreen
        ? "fixed inset-0 z-[80] flex h-screen w-screen flex-col overflow-hidden bg-[#f6f8ff] text-slate-950"
        : "relative flex h-[calc(100vh-24px)] min-h-[760px] w-full flex-col overflow-hidden bg-[#f6f8ff] text-slate-950"}
      onClick={() => setAudioMenu(null)}
    >
      {addAudioType && (
        <ProCutAddAudioPanel
          busy={addAudioBusy}
          error={addAudioError}
          file={addAudioFile}
          link={addAudioLink}
          mode={addAudioMode}
          type={addAudioType}
          onCancel={() => setAddAudioType(null)}
          onFileChange={setAddAudioFile}
          onLinkChange={setAddAudioLink}
          onModeChange={setAddAudioMode}
          onTypeChange={setAddAudioType}
          onSubmit={() => void submitAddAudio()}
        />
      )}
      <StudioProductionShell
        draftReviewRequired={draftReviewRequired}
        audioMenu={audioMenu}
        audioSrc={audioSrc}
        audio1Muted={audio1Muted}
        audio2Muted={audio2Muted}
        audioTracks={additionalAudioTracks}
        currentScene={currentScene}
        currentTime={currentTime}
        dragRef={dragRef}
        exporting={exporting}
        fitting={fitting}
        fps={fps}
        isFullscreen={isFullscreen}
        mutedTracks={mutedTracks}
        musicDragRef={musicDragRef}
        musicDuration={musicDuration}
        musicLeft={musicLeft}
        musicSrc={musicSrc}
        musicStart={musicStart}
        musicWidth={musicWidth}
        playing={playing}
        playheadLeft={playheadLeft}
        previewStage={previewStage}
        saving={saving}
        sceneIndex={sceneIndex}
        scenes={scenes}
        story={story}
        subtitleDragRef={subtitleDragRef}
        timelineRef={timelineRef}
        trackDragRef={trackDragRef}
        videoDuration={videoDuration}
        voiceGenerating={voiceGenerating}
        voiceLeft={voiceLeft}
        voiceProvider={voiceProvider}
        voiceWidth={voiceWidth}
        onAddTrack={() => openAddAudio()}
        onAudioMenuDelete={deleteAudioMenuTarget}
        onChange={onChange}
        onContextMenuTrack={openAudioMenu}
        onDuplicate={duplicateScene}
        onEditWithAi={onEditWithAi}
        onReviewWithAi={onReviewWithAi}
        onExit={onExit}
        onExport={onExport}
        onFitFrames={onFitFrames}
        onGenerateVoice={onGenerateVoice}
        onReload={onReload}
        onPlayToggle={onPlayToggle}
        onResizeScene={resizeScene}
        onSeek={onSeek}
        onSeekFromPointer={seekFromTimelinePointer}
        onSelect={onSelect}
        onSave={onSave}
        onToggleFullscreen={onToggleFullscreen}
        onToggleTrackMute={onToggleTrackMute}
        onUpdateSubtitleTiming={updateSubtitleTiming}
        onVoiceProviderChange={onVoiceProviderChange}
      />
    </div>
  )
}

function StudioProductionShell({
  draftReviewRequired,
  audioMenu,
  audioSrc,
  audio1Muted,
  audio2Muted,
  audioTracks,
  currentScene,
  currentTime,
  dragRef,
  exporting,
  fitting,
  fps,
  isFullscreen,
  mutedTracks,
  musicDragRef,
  musicDuration,
  musicLeft,
  musicSrc,
  musicStart,
  musicWidth,
  playing,
  playheadLeft,
  previewStage,
  saving,
  sceneIndex,
  scenes,
  story,
  subtitleDragRef,
  timelineRef,
  trackDragRef,
  videoDuration,
  voiceGenerating,
  voiceLeft,
  voiceProvider,
  voiceWidth,
  onAddTrack,
  onAudioMenuDelete,
  onChange,
  onContextMenuTrack,
  onDuplicate,
  onEditWithAi,
  onReviewWithAi,
  onExit,
  onExport,
  onFitFrames,
  onGenerateVoice,
  onReload,
  onPlayToggle,
  onResizeScene,
  onSeek,
  onSeekFromPointer,
  onSelect,
  onSave,
  onToggleFullscreen,
  onToggleTrackMute,
  onUpdateSubtitleTiming,
  onVoiceProviderChange,
}: {
  draftReviewRequired: boolean
  audioMenu: { x: number; y: number; kind: 'legacy-music' | 'track'; trackId?: string } | null
  audioSrc: string
  audio1Muted: boolean
  audio2Muted: boolean
  audioTracks: ProCutAudioTrack[]
  currentScene: GenerateVideoScene | undefined
  currentTime: number
  dragRef: React.MutableRefObject<{ index: number; startX: number; leftDuration: number; rightDuration: number; totalDuration: number; timelineWidth: number } | null>
  exporting: boolean
  fitting: boolean
  fps: number
  isFullscreen: boolean
  mutedTracks: Record<string, boolean>
  musicDragRef: React.MutableRefObject<{ mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; totalDuration: number; timelineWidth: number } | null>
  musicDuration: number
  musicLeft: number
  musicSrc: string
  musicStart: number
  musicWidth: number
  playing: boolean
  playheadLeft: number
  previewStage: React.ReactNode
  saving: boolean
  sceneIndex: number
  scenes: GenerateVideoScene[]
  story: GenerateVideoStory
  subtitleDragRef: React.MutableRefObject<{ index: number; mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; timelineWidth: number } | null>
  timelineRef: React.RefObject<HTMLDivElement | null>
  trackDragRef: React.MutableRefObject<{ id: string; mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; timelineWidth: number } | null>
  videoDuration: number
  voiceGenerating: boolean
  voiceLeft: number
  voiceProvider: GenerateVideoVoiceProvider
  voiceWidth: number
  onAddTrack: () => void
  onAudioMenuDelete: () => void
  onChange: (story: GenerateVideoStory) => void
  onContextMenuTrack: (event: React.MouseEvent<HTMLElement>, item: { kind: 'legacy-music' | 'track'; trackId?: string }) => void
  onDuplicate: () => void
  onEditWithAi?: () => void
  onReviewWithAi?: () => void
  onExit: () => void
  onExport: () => void
  onFitFrames: () => void
  onGenerateVoice: () => void
  onReload: () => void
  onPlayToggle: () => void
  onResizeScene: (event: React.PointerEvent<HTMLButtonElement>) => void
  onSeek: (time: number) => void
  onSeekFromPointer: (clientX: number) => void
  onSelect: (index: number) => void
  onSave: () => void
  onToggleFullscreen: () => void
  onToggleTrackMute: (trackId: string) => void
  onUpdateSubtitleTiming: (index: number, start: number, duration: number) => void
  onVoiceProviderChange: (provider: GenerateVideoVoiceProvider) => void
}) {
  const progress = videoDuration ? Math.min(100, Math.max(0, (currentTime / videoDuration) * 100)) : 0
  const frameSize = normalizeVideoFrame(story.video)
  const aspectLabel = `${frameSize.width}x${frameSize.height}`
  return (
    <>
      <div className="shrink-0 px-3 pb-3 pt-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-[#637097]">
              <button title="Quay lại" onClick={onExit} className="grid h-8 w-8 place-items-center rounded-[8px] border border-[#dfe4f3] bg-white text-[#2d3463] shadow-sm hover:bg-[#f5f7ff]">
                <ArrowLeft size={15} />
              </button>
              <span>Xưởng sản xuất video</span>
              <ChevronDown size={13} className="-rotate-90 text-[#9aa4c3]" />
              <span>Chi tiết dự án</span>
            </div>
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-8 w-8 place-items-center rounded-[8px] bg-[#ede9fe] text-[#6247ff]">
                <Clapperboard size={16} />
              </div>
              <h1 className="truncate text-[22px] font-black leading-tight text-[#11183c]">{getStoryProjectName(story)}</h1>
              <span className={`rounded-[8px] px-3 py-1 text-[11px] font-black uppercase ${draftReviewRequired ? 'bg-amber-100 text-amber-800' : 'bg-[#d5f7e8] text-[#069467]'}`}>
                {draftReviewRequired ? 'Cần duyệt draft' : 'Đã có draft'}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 pl-11 text-[11px] font-bold text-[#4f5b7f]">
              <span className="rounded bg-white px-2 py-1 shadow-sm">TikTok</span>
              <span className="rounded bg-white px-2 py-1 shadow-sm">SocialContentHub</span>
              <span className="rounded bg-white px-2 py-1 shadow-sm">{String(story.meta?.source || 'Ẩm thực')}</span>
              <span className="rounded bg-white px-2 py-1 shadow-sm">{Math.round(videoDuration)}s</span>
              <span className="rounded bg-white px-2 py-1 shadow-sm">{frameSize.width > frameSize.height ? '16:9' : '9:16'} · {aspectLabel}</span>
              <span className="rounded bg-white px-2 py-1 shadow-sm">{fps} FPS</span>
              <span>Tạo draft</span>
              <span>ID {String(story.meta?.workflow_id || '').slice(0, 8) || 'draft'}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onEditWithAi && (
              <button onClick={onEditWithAi} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[var(--primary)] px-3 text-[12px] font-bold text-white shadow-sm hover:opacity-90">
                <Wand2 size={13} /> Edit with AI
              </button>
            )}
            {onReviewWithAi && (
              <button onClick={onReviewWithAi} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#0f766e] px-3 text-[12px] font-bold text-white shadow-sm hover:opacity-90">
                <ShieldCheck size={13} /> AI Review
              </button>
            )}
            <button onClick={onReload} className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[#dfe4f3] bg-white px-3 text-[12px] font-bold text-[#27305b] shadow-sm hover:bg-[#f8faff]">
              <Rewind size={13} /> Reload
            </button>
            <button disabled={exporting} onClick={onExport} className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-[#6247ff] px-4 text-[12px] font-black text-white shadow-lg shadow-[#6247ff]/25 hover:bg-[#4f36ee] disabled:opacity-50">
              <Download size={14} /> {exporting ? 'Đang render...' : 'Xuất MP4'}
            </button>
          </div>
        </div>
        <StudioStageProgress progress={progress} voiceReady={Boolean(audioSrc)} exporting={exporting} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[250px_minmax(320px,1fr)_380px_280px] gap-3 overflow-hidden px-3 pb-3">
        <StudioSceneRail scenes={scenes} sceneIndex={sceneIndex} videoDuration={videoDuration} onDuplicate={onDuplicate} onSeek={onSeek} onSelect={onSelect} />
        <section className="relative flex min-w-0 flex-col overflow-hidden rounded-[8px] bg-[#d9deea] shadow-sm">
          <div className="absolute left-4 top-20 z-10 grid gap-2 text-[12px] font-black text-[#27305b]">
              {videoAspectPresets.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => onChange({ ...story, video: { ...(story.video || {}), width: preset.width, height: preset.height } })}
                className={`h-9 w-16 rounded-[8px] border ${frameSize.width === preset.width && frameSize.height === preset.height ? 'border-[#6247ff] bg-[#eef2ff] text-[#4f36ee] ring-2 ring-[#6247ff]/15' : 'border-transparent bg-white/45 text-white hover:bg-white/60'}`}
                >
                  {preset.label}
                </button>
              ))}
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-8">
            <div className="relative flex h-full max-h-[560px] w-full items-center justify-center">
              <div className="absolute right-10 top-0 flex rounded-full bg-[#11183c]/80 p-1 text-white">
                <button title={isFullscreen ? 'Thu nhỏ' : 'Toàn màn hình'} onClick={onToggleFullscreen} className="grid h-8 w-8 place-items-center rounded-full bg-[#11183c]"><Maximize2 size={13} /></button>
                <button title="Fit frame" disabled={fitting || saving || exporting || voiceGenerating} onClick={onFitFrames} className="grid h-8 w-8 place-items-center rounded-full text-white/70 disabled:opacity-50"><SlidersHorizontal size={13} /></button>
              </div>
              {previewStage}
            </div>
          </div>
          <div className="mx-3 mb-3 rounded-[14px] bg-white/40 px-3 py-2 backdrop-blur">
            <div className="flex items-center justify-between text-[12px] font-black text-[#11183c]">
              <span>{formatStudioClock(currentTime)} / {formatStudioClock(videoDuration)}</span>
              <div className="flex items-center gap-3">
                <button title="Về đầu" onClick={() => onSeek(0)} className="grid h-8 w-8 place-items-center rounded-full bg-white/80 text-[#27305b] shadow-sm"><SkipBack size={14} /></button>
                <button title={playing ? 'Tạm dừng' : 'Phát'} onClick={onPlayToggle} className="grid h-10 w-10 place-items-center rounded-full bg-[#11183c] text-white shadow-md">
                  {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
                </button>
                <button title="Tới cuối" onClick={() => onSeek(videoDuration)} className="grid h-8 w-8 place-items-center rounded-full bg-white/80 text-[#27305b] shadow-sm"><SkipForward size={14} /></button>
              </div>
              <button title="Tắt/bật voice" onClick={() => onToggleTrackMute('audio-2')} className="grid h-8 w-8 place-items-center rounded-full bg-white/80 text-[#27305b] shadow-sm">
                {audio2Muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
            </div>
          </div>
        </section>
        <StudioSceneEditorPanel
          currentScene={currentScene}
          sceneIndex={sceneIndex}
          scenes={scenes}
          story={story}
          videoDuration={videoDuration}
          onChange={onChange}
          onEditWithAi={onEditWithAi}
          onReviewWithAi={onReviewWithAi}
        />
        <StudioInspector
          audio1Muted={audio1Muted}
          audio2Muted={audio2Muted}
          currentScene={currentScene}
          sceneIndex={sceneIndex}
          scenes={scenes}
          story={story}
          voiceGenerating={voiceGenerating}
          voiceProvider={voiceProvider}
          onChange={onChange}
          onGenerateVoice={onGenerateVoice}
          onSave={onSave}
          onSelect={onSelect}
          onToggleTrackMute={onToggleTrackMute}
          onVoiceProviderChange={onVoiceProviderChange}
        />
      </div>

      <StudioTimelinePanel
        audioMenu={audioMenu}
        audioSrc={audioSrc}
        audio1Muted={audio1Muted}
        audio2Muted={audio2Muted}
        audioTracks={audioTracks}
        dragRef={dragRef}
        mutedTracks={mutedTracks}
        musicDragRef={musicDragRef}
        musicDuration={musicDuration}
        musicLeft={musicLeft}
        musicSrc={musicSrc}
        musicStart={musicStart}
        musicWidth={musicWidth}
        playheadLeft={playheadLeft}
        sceneIndex={sceneIndex}
        scenes={scenes}
        story={story}
        subtitleDragRef={subtitleDragRef}
        timelineRef={timelineRef}
        trackDragRef={trackDragRef}
        videoDuration={videoDuration}
        voiceLeft={voiceLeft}
        voiceWidth={voiceWidth}
        onAddTrack={onAddTrack}
        onAudioMenuDelete={onAudioMenuDelete}
        onChange={onChange}
        onContextMenuTrack={onContextMenuTrack}
        onResizeScene={onResizeScene}
        onSeek={onSeek}
        onSeekFromPointer={onSeekFromPointer}
        onSelect={onSelect}
        onToggleTrackMute={onToggleTrackMute}
        onUpdateSubtitleTiming={onUpdateSubtitleTiming}
      />
    </>
  )
}

function StudioStageProgress({ exporting, progress, voiceReady }: { exporting: boolean; progress: number; voiceReady: boolean }) {
  const stages = [
    { label: 'Kịch bản', state: 'done' as const },
    { label: 'Draft', state: 'active' as const },
    { label: 'Voice', state: voiceReady ? 'done' as const : 'idle' as const },
    { label: 'Render', state: exporting ? 'active' as const : 'idle' as const },
    { label: 'Hoàn tất', state: progress >= 100 ? 'done' as const : 'idle' as const },
  ]
  return (
    <div className="mt-5">
      <div className="mb-1 flex justify-end text-[12px] font-black text-[#11183c]">{Math.round(progress)}%</div>
      <div className="relative h-12">
        <div className="absolute left-0 right-0 top-2 h-1 rounded-full bg-[#d8ddef]">
          <div className="h-full rounded-full bg-[#6247ff]" style={{ width: `${Math.max(28, Math.min(100, progress || 28))}%` }} />
        </div>
        <div className="relative grid grid-cols-5">
          {stages.map((stage) => {
            const active = stage.state === 'active'
            const done = stage.state === 'done'
            return (
              <div key={stage.label} className="grid justify-items-center gap-1">
                <span className={`grid h-5 w-5 place-items-center rounded-full border-2 ${done ? 'border-[#16b78f] bg-[#16b78f] text-white' : active ? 'border-[#6247ff] bg-[#6247ff] text-white' : 'border-[#b9c1d8] bg-white text-[#8a94b4]'}`}>
                  {done ? <CheckCircle2 size={13} /> : <Circle size={9} fill="currentColor" />}
                </span>
                <span className={`text-[11px] font-black ${active ? 'text-[#6247ff]' : done ? 'text-[#16b78f]' : 'text-[#667097]'}`}>{stage.label}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function StudioSceneRail({
  scenes,
  sceneIndex,
  videoDuration,
  onDuplicate,
  onSeek,
  onSelect,
}: {
  scenes: GenerateVideoScene[]
  sceneIndex: number
  videoDuration: number
  onDuplicate: () => void
  onSeek: (time: number) => void
  onSelect: (index: number) => void
}) {
  return (
    <aside className="flex min-h-0 flex-col rounded-[8px] border border-[#dfe4f3] bg-white shadow-sm">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-[#e8ecf7] px-3">
        <div className="flex items-center gap-2 text-[13px] font-black text-[#11183c]">
          <FileText size={15} className="text-[#6247ff]" />
          Kịch bản ({scenes.length})
        </div>
        <button title="AI gợi ý" className="inline-flex h-7 items-center gap-1 rounded-[8px] border border-[#c9c2ff] px-2 text-[11px] font-bold text-[#6247ff]">
          <Wand2 size={12} /> AI gợi ý
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {scenes.map((scene, index) => {
          const active = index === sceneIndex
          const start = getSceneStart(scenes, index)
          const end = getSceneEnd(scenes, index)
          return (
            <button
              key={`${scene.image}-${index}`}
              onClick={() => {
                onSelect(index)
                onSeek(start)
              }}
              className={`grid w-full grid-cols-[24px_84px_minmax(0,1fr)] gap-2 rounded-[8px] border p-2 text-left transition ${active ? 'border-[#6247ff] bg-[#f4f2ff] shadow-sm ring-2 ring-[#6247ff]/10' : 'border-transparent hover:border-[#dfe4f3] hover:bg-[#f8faff]'}`}
            >
              <span className={`grid h-7 w-6 place-items-center rounded-[6px] text-[12px] font-black ${active ? 'bg-white text-[#6247ff]' : 'bg-[#f3f6fd] text-[#667097]'}`}>{index + 1}</span>
              <SceneMediaThumb scene={scene} className="h-14 w-[84px] rounded-[6px] object-cover" />
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-black text-[#11183c]">Scene {index + 1}</span>
                <span className="mt-0.5 block truncate text-[11px] font-semibold text-[#56617f]">{scene.subtitle || fileNameFromPath(scene.image || '')}</span>
                <span className="mt-1 block text-[10px] font-bold text-[#7782a4]">{formatStudioClock(start)} - {formatStudioClock(end)}</span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="border-t border-[#e8ecf7] p-2">
        <button onClick={onDuplicate} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] border border-[#dfe4f3] bg-white text-[12px] font-bold text-[#6247ff] hover:bg-[#f7f5ff]">
          <Plus size={14} /> Thêm scene
        </button>
        <div className="mt-1 text-center text-[10px] font-bold text-[#98a2c3]">{formatStudioClock(videoDuration)} tổng thời lượng</div>
      </div>
    </aside>
  )
}

function StudioSceneEditorPanel({
  currentScene,
  sceneIndex,
  scenes,
  story,
  videoDuration: _videoDuration,
  onChange,
  onEditWithAi,
  onReviewWithAi,
}: {
  currentScene: GenerateVideoScene | undefined
  sceneIndex: number
  scenes: GenerateVideoScene[]
  story: GenerateVideoStory
  videoDuration: number
  onChange: (story: GenerateVideoStory) => void
  onEditWithAi?: () => void
  onReviewWithAi?: () => void
}) {
  const [activeTab, setActiveTab] = useState<'frame' | 'video'>('frame')
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const addFrameInputRef = useRef<HTMLInputElement>(null)

  const handleMediaChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      let assetUrl = ''
      try {
        const res = await uploadGenerateVideoAudioApi(file)
        assetUrl = res.asset_path
      } catch {
        assetUrl = URL.createObjectURL(file)
      }
      if (currentScene) {
        updateSceneAt(story, scenes, sceneIndex, {
          image: assetUrl,
          media_type: file.type.startsWith('video/') ? 'video' : 'image',
        }, onChange)
      }
    } catch (err) {
      console.error('Lỗi upload file media:', err)
    } finally {
      e.target.value = ''
    }
  }

  const handleAddFrame = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      let assetUrl = ''
      try {
        const res = await uploadGenerateVideoAudioApi(file)
        assetUrl = res.asset_path
      } catch {
        assetUrl = URL.createObjectURL(file)
      }
      const newScene: GenerateVideoScene = {
        ...emptyScene(),
        image: assetUrl,
        duration: 4,
        subtitle: file.name.replace(/\.[^/.]+$/, ''),
        media_type: file.type.startsWith('video/') ? 'video' : 'image',
      }
      const insertAt = Math.min(sceneIndex + 1, scenes.length)
      const nextScenes = [
        ...scenes.slice(0, insertAt),
        newScene,
        ...scenes.slice(insertAt),
      ]
      onChange(updateRenderScenes(story, nextScenes))
    } catch (err) {
      console.error('Lỗi thêm frame mới:', err)
    } finally {
      e.target.value = ''
    }
  }

  const subtitleStyle = (currentScene?.text_style || {}) as Record<string, unknown>
  const fontSize = readNumericStyleValue(subtitleStyle.fontSize, 48)
  const titleText = story.meta?.title || getStoryProjectName(story)
  const subtitleText = currentScene?.subtitle || ''
  const updateScene = (patch: Partial<GenerateVideoScene>) => currentScene && updateSceneAt(story, scenes, sceneIndex, patch, onChange)
  const updateSubtitleStyle = (patch: React.CSSProperties) => currentScene && updateScene({
    text_style: {
      ...(currentScene.text_style || {}),
      ...patch,
    },
  })
  const applyFitAll = (fit: 'cover' | 'contain') => onChange(updateRenderScenes(story, scenes.map((scene) => ({ ...scene, fit }))))
  const _sceneStart = getSceneStart(scenes, sceneIndex)
  const _sceneEnd = getSceneEnd(scenes, sceneIndex)
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-[8px] border border-[#dfe4f3] bg-white shadow-sm">
      <input ref={mediaInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleMediaChange} />
      <input ref={addFrameInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleAddFrame} />
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-[#e8ecf7] px-3">
        <div className="text-[15px] font-black text-[#11183c]">Scene {sceneIndex + 1}/{scenes.length}</div>
        <div className="flex items-center gap-1.5">
          {onEditWithAi && (
            <button onClick={onEditWithAi} title="Edit with AI" className="inline-flex h-7 items-center gap-1 rounded-[7px] bg-[var(--primary)] px-2 text-[11px] font-bold text-white hover:opacity-90">
              <Wand2 size={12} /> AI Edit
            </button>
          )}
          {onReviewWithAi && (
            <button onClick={onReviewWithAi} title="AI Review" className="inline-flex h-7 items-center gap-1 rounded-[7px] bg-[#0f766e] px-2 text-[11px] font-bold text-white hover:opacity-90">
              <ShieldCheck size={12} /> Review
            </button>
          )}
        </div>
      </div>
      <div className="grid h-10 shrink-0 grid-cols-2 border-b border-[#e8ecf7] text-[12px] font-black">
        <button onClick={() => setActiveTab('frame')} className={activeTab === 'frame' ? 'border-b-2 border-[#6247ff] text-[#6247ff]' : 'text-[#667097] hover:bg-[#f8faff]'}>Frame</button>
        <button onClick={() => setActiveTab('video')} className={activeTab === 'video' ? 'border-b-2 border-[#6247ff] text-[#6247ff]' : 'text-[#667097] hover:bg-[#f8faff]'}>Video</button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <div className="overflow-hidden rounded-[8px] border border-[#dfe4f3] bg-[#f3f6fd]">
          <div className="h-36">
            {currentScene ? <SceneMediaThumb scene={currentScene} className="h-full w-full object-cover" /> : null}
          </div>
          <div className="grid grid-cols-3 gap-2 border-t border-[#dfe4f3] bg-white p-2">
            <button onClick={() => mediaInputRef.current?.click()} className="inline-flex h-8 items-center justify-center gap-1 rounded-[7px] border border-[#dfe4f3] text-[11px] font-bold text-[#27305b] hover:bg-[#f8faff]"><ImageIcon size={12} /> Thay media</button>
            <button onClick={onEditWithAi} className="inline-flex h-8 items-center justify-center gap-1 rounded-[7px] border border-[#dfe4f3] text-[11px] font-bold text-[#27305b] hover:bg-[#f8faff]"><Wand2 size={12} /> AI Edit</button>
            <button onClick={() => addFrameInputRef.current?.click()} className="inline-flex h-8 items-center justify-center gap-1 rounded-[7px] border border-[#c9c2ff] bg-[#f7f5ff] text-[11px] font-bold text-[#6247ff] hover:bg-[#eeeaff]"><Plus size={12} /> Thêm frame</button>
          </div>
        </div>

        <StudioSection title="Hiệu ứng chuyển động">
          <div className="grid grid-cols-5 gap-2">
            {[
              { value: 'none', label: 'Để nguyên' },
              { value: 'slow-zoom', label: 'Slow zoom' },
              { value: 'pan-right', label: 'Pan right' },
              { value: 'pan-left', label: 'Pan left' },
              { value: 'push-in', label: 'Push in' },
            ].map((effect) => (
              <button
                key={effect.value}
                onClick={() => updateScene({ effect: effect.value })}
                className={`h-8 rounded-[7px] border px-1 text-[10px] font-bold ${currentScene?.effect === effect.value ? 'border-[#6247ff] bg-[#f4f2ff] text-[#6247ff]' : 'border-[#dfe4f3] text-[#3b4568] hover:bg-[#f8faff]'}`}
              >
                {effect.label}
              </button>
            ))}
          </div>
        </StudioSection>

        <StudioSection title="Cách hiển thị">
          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => applyFitAll('contain')} className="h-8 rounded-[7px] border border-[#6247ff] bg-[#f4f2ff] text-[11px] font-bold text-[#6247ff]">All</button>
            <button onClick={() => updateScene({ fit: 'cover' })} className={`h-8 rounded-[7px] border text-[11px] font-bold ${getSceneMediaFit(currentScene) === 'cover' ? 'border-[#6247ff] bg-[#f4f2ff] text-[#6247ff]' : 'border-[#dfe4f3] text-[#3b4568]'}`}>Làm đầy</button>
            <button onClick={() => updateScene({ fit: 'contain' })} className={`h-8 rounded-[7px] border text-[11px] font-bold ${getSceneMediaFit(currentScene) === 'contain' ? 'border-[#6247ff] bg-[#f4f2ff] text-[#6247ff]' : 'border-[#dfe4f3] text-[#3b4568]'}`}>Fit</button>
          </div>
        </StudioSection>

        <StudioSection title="Nội dung hiển thị">
          <StudioTextBlock
            color={String(subtitleStyle.color || '#ffffff')}
            fontSize={fontSize}
            text={String(titleText || '')}
            onColorChange={(color) => updateSubtitleStyle({ color })}
            onFontSizeChange={(value) => updateSubtitleStyle({ fontSize: value })}
            onTextChange={(value) => onChange({ ...story, meta: { ...(story.meta || {}), title: value } })}
          />
          <StudioTextBlock
            color={String(subtitleStyle.accentColor || '#ffd43b')}
            fontSize={Math.max(20, fontSize - 12)}
            text={subtitleText}
            onColorChange={(color) => updateSubtitleStyle({ accentColor: color, color })}
            onFontSizeChange={(value) => updateSubtitleStyle({ fontSize: value })}
            onTextChange={(value) => updateScene({ subtitle: value })}
          />
          <button type="button" className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[7px] border border-[#c9c2ff] text-[12px] font-bold text-[#6247ff] hover:bg-[#f7f5ff]">
            <Plus size={14} /> Thêm text / sticker
          </button>
        </StudioSection>
      </div>
    </section>
  )
}

function StudioTextBlock({
  color,
  fontSize,
  text,
  onColorChange,
  onFontSizeChange,
  onTextChange,
}: {
  color: string
  fontSize: number
  text: string
  onColorChange: (color: string) => void
  onFontSizeChange: (value: number) => void
  onTextChange: (value: string) => void
}) {
  const normalizedColor = normalizeColorValue(color)
  return (
    <div className="rounded-[8px] border border-[#dfe4f3] bg-white p-2">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-[6px] bg-[#f0edff] text-[#6247ff]"><Type size={13} /></span>
        <input value={text} onChange={(event) => onTextChange(event.target.value)} className={`${studioInputClass} flex-1`} />
      </div>
      <div className="grid grid-cols-[1fr_64px_36px_36px_36px] gap-2">
        <select className={studioInputClass} defaultValue="Be Vietnam Pro">
          <option>Be Vietnam Pro</option>
          <option>Inter</option>
          <option>Arial</option>
        </select>
        <input type="number" min={12} max={96} value={fontSize} onChange={(event) => onFontSizeChange(Number(event.target.value) || 48)} className={studioInputClass} />
        <input title="Màu chữ" type="color" value={normalizedColor} onChange={(event) => onColorChange(event.target.value)} className="h-9 w-9 rounded-[7px] border border-[#dfe4f3] bg-white p-1" />
        <button title="Nghiêng" className="h-9 rounded-[7px] border border-[#dfe4f3] text-sm font-black italic text-[#27305b]">I</button>
        <button title="In đậm" className="h-9 rounded-[7px] border border-[#dfe4f3] text-sm font-black text-[#27305b]">B</button>
      </div>
    </div>
  )
}

function StudioInspector({
  audio1Muted,
  audio2Muted,
  currentScene,
  sceneIndex,
  scenes,
  story,
  voiceGenerating,
  voiceProvider,
  onChange,
  onGenerateVoice,
  onSave,
  onSelect,
  onToggleTrackMute,
  onVoiceProviderChange,
}: {
  audio1Muted: boolean
  audio2Muted: boolean
  currentScene: GenerateVideoScene | undefined
  sceneIndex: number
  scenes: GenerateVideoScene[]
  story: GenerateVideoStory
  voiceGenerating: boolean
  voiceProvider: GenerateVideoVoiceProvider
  onChange: (story: GenerateVideoStory) => void
  onGenerateVoice: () => void
  onSave: () => void
  onSelect: (index: number) => void
  onToggleTrackMute: (trackId: string) => void
  onVoiceProviderChange: (provider: GenerateVideoVoiceProvider) => void
}) {
  const [activeTab, setActiveTab] = useState<'info' | 'ai' | 'script'>('info')
  const meta = story.meta || {}
  const video = story.video || { width: 1080, height: 1920, fps: 30, background: '#05070b' }
  const audio = story.audio || {}
  const review = meta.ai_story_review
  const reviewNotes = Array.isArray(review?.notes) ? review.notes.filter(Boolean) : []
  const backgroundColor = normalizeColorValue(String(video.background || '#05070b'))
  const updateMeta = (field: keyof NonNullable<GenerateVideoStory['meta']>, value: string) => onChange({ ...story, meta: { ...meta, [field]: value } })
  const updateVideo = (patch: Partial<GenerateVideoStory['video']>) => onChange({ ...story, video: { ...video, ...patch } })
  const updateScene = (patch: Partial<GenerateVideoScene>) => currentScene && updateSceneAt(story, scenes, sceneIndex, patch, onChange)
  const updateSceneByIndex = (index: number, patch: Partial<GenerateVideoScene>) => updateSceneAt(story, scenes, index, patch, onChange)
  const updateSubtitleStyle = (patch: React.CSSProperties) => currentScene && updateScene({
    text_style: {
      ...(currentScene.text_style || {}),
      ...patch,
    },
  })
  const applyReadableSubtitleStyle = () => updateSubtitleStyle({
    color: '#ffffff',
    fontSize: 56,
    fontWeight: 900,
    left: '50%',
    top: '82%',
    right: 'auto',
    bottom: 'auto',
    width: '86%',
    transform: 'translate(-50%, -50%)',
    textShadow: '0 8px 28px rgba(0,0,0,0.72)',
  })
  const copySubtitleToVoice = () => {
    if (!currentScene) return
    updateScene({ voice_text: currentScene.subtitle || currentScene.voice_text || '' })
  }
  const tabClass = (tab: 'info' | 'ai' | 'script') =>
    activeTab === tab ? 'border-b-2 border-[#6247ff] text-[#6247ff]' : 'text-[#56617f] hover:bg-[#f8faff] hover:text-[#27305b]'
  return (
    <aside className="flex min-h-0 flex-col rounded-[8px] border border-[#dfe4f3] bg-white shadow-sm">
      <div className="grid h-11 shrink-0 grid-cols-3 border-b border-[#e8ecf7] text-[12px] font-black text-[#56617f]">
        <button onClick={() => setActiveTab('info')} className={tabClass('info')}>Thông tin</button>
        <button onClick={() => setActiveTab('ai')} className={tabClass('ai')}>AI gợi ý</button>
        <button onClick={() => setActiveTab('script')} className={tabClass('script')}>Script</button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {activeTab === 'info' && (
          <>
            <StudioSection title="Story data">
              <StudioField label="Tiêu đề">
                <input value={meta.title || getStoryProjectName(story)} onChange={(event) => updateMeta('title', event.target.value)} className={studioInputClass} />
              </StudioField>
              <div className="grid grid-cols-2 gap-2">
                <StudioField label="Series ID"><input value={meta.series_id || ''} onChange={(event) => updateMeta('series_id', event.target.value)} className={studioInputClass} /></StudioField>
                <StudioField label="Workflow ID"><input value={meta.workflow_id || ''} onChange={(event) => updateMeta('workflow_id', event.target.value)} className={studioInputClass} /></StudioField>
              </div>
            </StudioSection>

            <StudioSection title="Cấu hình sản xuất">
              <div className="grid grid-cols-2 gap-2">
                <StudioField label="Khung hình">
                  <select
                    value={`${video.width}x${video.height}`}
                    onChange={(event) => {
                      const preset = videoAspectPresets.find((item) => `${item.width}x${item.height}` === event.target.value)
                      if (preset) updateVideo({ width: preset.width, height: preset.height })
                    }}
                    className={studioInputClass}
                  >
                    {videoAspectPresets.map((preset) => <option key={preset.label} value={`${preset.width}x${preset.height}`}>{preset.label} · {preset.width}x{preset.height}</option>)}
                  </select>
                </StudioField>
                <StudioField label="FPS">
                  <select value={video.fps || 30} onChange={(event) => updateVideo({ fps: Number(event.target.value) || 30 })} className={studioInputClass}>
                    {fpsPresets.map((fps) => <option key={fps} value={fps}>{fps}</option>)}
                  </select>
                </StudioField>
              </div>
              <StudioField label="Background">
                <div className="grid gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {backgroundPresets.map((color) => (
                      <button
                        key={color}
                        type="button"
                        title={color}
                        onClick={() => updateVideo({ background: color })}
                        className={`h-7 w-7 rounded-[7px] border ${backgroundColor === color ? 'border-[#6247ff] ring-2 ring-[#6247ff]/20' : 'border-[#dfe4f3]'}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input type="color" value={backgroundColor} onChange={(event) => updateVideo({ background: event.target.value })} className="h-9 w-11 rounded-[7px] border border-[#dfe4f3] bg-white p-1" />
                    <input value={video.background || ''} onChange={(event) => updateVideo({ background: event.target.value })} className={studioInputClass} placeholder="#05070b" />
                  </div>
                </div>
              </StudioField>
            </StudioSection>

            <StudioSection title="Audio">
              <StudioAudioPath label="Voice path" muted={audio2Muted} value={audio.voice || ''} onChange={(value) => updateAudio(story, onChange, { voice: value })} onToggleMute={() => onToggleTrackMute('audio-2')} />
              <StudioAudioPath label="Music path" muted={audio1Muted} value={audio.music || ''} onChange={(value) => updateAudio(story, onChange, { music: value })} onToggleMute={() => onToggleTrackMute('audio-1')} />
              <StudioVolume label="Voice volume" value={Number(audio.voiceVolume ?? 1)} onChange={(value) => updateAudio(story, onChange, { voiceVolume: value })} />
              <StudioVolume label="Music volume" value={Number(audio.musicVolume ?? 0.12)} onChange={(value) => updateAudio(story, onChange, { musicVolume: value })} />
            </StudioSection>

            <StudioSection title="Yêu cầu sản xuất">
              <StudioCheckbox label="Cần Voice AI" checked={Boolean(audio.voice)} />
              <StudioCheckbox label="Cần Subtitles" checked={scenes.some((scene) => String(scene.subtitle || '').trim())} />
              <StudioCheckbox label="Cần Background Media" checked={scenes.some((scene) => Boolean(scene.image))} />
              <StudioCheckbox label="Nhất quán nhân vật" checked={false} />
            </StudioSection>
          </>
        )}

        {activeTab === 'ai' && (
          <>
            <StudioSection title="AI review">
              {review ? (
                <div className={`rounded-[8px] border px-3 py-2 text-[12px] font-bold ${review.action === 'REVISED' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span>{review.action === 'REVISED' ? 'AI đã chỉnh draft' : 'AI đã duyệt draft'}</span>
                    {review.reviewed_at && <span className="text-[10px] opacity-75">{new Date(review.reviewed_at).toLocaleString()}</span>}
                  </div>
                  {reviewNotes.length ? <div className="mt-1 text-[11px] font-semibold opacity-90">{reviewNotes.join(' · ')}</div> : null}
                </div>
              ) : (
                <div className="rounded-[8px] border border-dashed border-[#cfd6ea] bg-[#f8faff] px-3 py-3 text-[12px] font-semibold text-[#667097]">
                  Chưa có kết quả AI review cho draft này.
                </div>
              )}
            </StudioSection>

            <StudioSection title={`Gợi ý nhanh cho scene ${sceneIndex + 1}`}>
              <div className="grid gap-2">
                <button type="button" onClick={() => updateScene({ effect: 'slow-zoom', fit: 'cover' })} className="h-9 rounded-[7px] border border-[#dfe4f3] px-3 text-left text-[12px] font-bold text-[#27305b] hover:bg-[#f8faff]">
                  Slow zoom + làm đầy khung
                </button>
                <button type="button" onClick={() => updateScene({ effect: 'pan-right', fit: 'cover' })} className="h-9 rounded-[7px] border border-[#dfe4f3] px-3 text-left text-[12px] font-bold text-[#27305b] hover:bg-[#f8faff]">
                  Pan right cho ảnh có không gian ngang
                </button>
                <button type="button" onClick={() => updateScene({ fit: 'contain' })} className="h-9 rounded-[7px] border border-[#dfe4f3] px-3 text-left text-[12px] font-bold text-[#27305b] hover:bg-[#f8faff]">
                  Giữ nguyên ảnh, dùng background làm nền
                </button>
                <button type="button" onClick={applyReadableSubtitleStyle} className="h-9 rounded-[7px] border border-[#c9c2ff] bg-[#f7f5ff] px-3 text-left text-[12px] font-bold text-[#6247ff] hover:bg-[#f0edff]">
                  Tối ưu chữ phụ đề cho mobile
                </button>
                <button type="button" onClick={copySubtitleToVoice} className="h-9 rounded-[7px] border border-[#dfe4f3] px-3 text-left text-[12px] font-bold text-[#27305b] hover:bg-[#f8faff]">
                  Dùng subtitle hiện tại làm voice text
                </button>
              </div>
            </StudioSection>
          </>
        )}

        {activeTab === 'script' && (
          <>
            <StudioSection title={`Script scene ${sceneIndex + 1}`}>
              <StudioField label="Subtitle hiển thị">
                <textarea value={currentScene?.subtitle || ''} onChange={(event) => updateScene({ subtitle: event.target.value })} className={`${studioInputClass} min-h-24 py-2`} />
              </StudioField>
              <StudioField label="Voice text">
                <textarea value={currentScene?.voice_text || currentScene?.voice_subtitle || ''} onChange={(event) => updateScene({ voice_text: event.target.value })} className={`${studioInputClass} min-h-24 py-2`} />
              </StudioField>
            </StudioSection>

            <StudioSection title="Toàn bộ script">
              <div className="space-y-2">
                {scenes.map((scene, index) => (
                  <div key={`${scene.video_id || 'no-media'}:${scene.text_id || index}-script`} className={`rounded-[8px] border p-2 ${index === sceneIndex ? 'border-[#6247ff] bg-[#f7f5ff]' : 'border-[#e3e8f4] bg-white'}`}>
                    <button type="button" onClick={() => onSelect(index)} className="mb-1 flex w-full items-center justify-between text-left text-[11px] font-black text-[#27305b]">
                      <span>Scene {index + 1}</span>
                      <span>{formatStudioClock(getSceneStart(scenes, index))}</span>
                    </button>
                    <textarea value={scene.subtitle || ''} onChange={(event) => updateSceneByIndex(index, { subtitle: event.target.value })} className={`${studioInputClass} min-h-16 py-2`} />
                  </div>
                ))}
              </div>
            </StudioSection>
          </>
        )}
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-[#e8ecf7] p-3">
        <button onClick={onSave} className="h-9 rounded-[8px] border border-[#c9c2ff] bg-white text-[12px] font-black text-[#6247ff] hover:bg-[#f7f5ff]">
          Lưu chỉnh sửa
        </button>
        <button onClick={onGenerateVoice} disabled={voiceGenerating} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[8px] bg-[#6247ff] text-[12px] font-black text-white shadow-sm shadow-[#6247ff]/25 hover:bg-[#4f36ee] disabled:opacity-50">
          <Mic2 size={14} /> {voiceGenerating ? 'Đang tạo' : 'Tạo Voice AI'}
        </button>
        <select
          aria-label="Voice provider"
          value={voiceProvider}
          disabled={voiceGenerating}
          onChange={(event) => onVoiceProviderChange(event.target.value as GenerateVideoVoiceProvider)}
          className="col-span-2 h-8 rounded-[8px] border border-[#dfe4f3] bg-white px-2 text-[11px] font-bold text-[#2d3463] outline-none disabled:opacity-50"
        >
          {voiceProviderOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
    </aside>
  )
}

const studioInputClass = 'h-9 w-full min-w-0 rounded-[7px] border border-[#dfe4f3] bg-white px-2.5 text-[12px] font-semibold text-[#27305b] outline-none focus:border-[#6247ff] focus:ring-2 focus:ring-[#6247ff]/10'

function StudioSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="space-y-2.5 border-b border-[#eef1f8] pb-4 last:border-b-0">
      <div className="text-[12px] font-black text-[#11183c]">{title}</div>
      {children}
    </section>
  )
}

function StudioField({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] font-black text-[#667097]">{label}</span>
      {children}
    </label>
  )
}

function StudioVolume({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const normalized = clampNumber(value, 0, 1)
  return (
    <label className="grid gap-1">
      <span className="flex items-center justify-between text-[10px] font-black text-[#667097]">
        <span>{label}</span>
        <span>{Math.round(normalized * 100)}%</span>
      </span>
      <input type="range" min={0} max={1} step={0.01} value={normalized} onChange={(event) => onChange(Number(event.target.value))} style={{ accentColor: '#6247ff' }} />
    </label>
  )
}

function StudioAudioPath({
  label,
  muted,
  value,
  onChange,
  onToggleMute,
}: {
  label: string
  muted: boolean
  value: string
  onChange: (value: string) => void
  onToggleMute: () => void
}) {
  return (
    <StudioField label={label}>
      <div className="grid grid-cols-[1fr_32px_32px] gap-1.5">
        <input value={value} onChange={(event) => onChange(event.target.value)} className={studioInputClass} />
        <button type="button" onClick={onToggleMute} className="grid h-9 place-items-center rounded-[7px] border border-[#dfe4f3] text-[#6247ff]">
          {muted ? <VolumeX size={14} /> : <Play size={13} fill="currentColor" />}
        </button>
        <button type="button" onClick={() => onChange('')} className="grid h-9 place-items-center rounded-[7px] border border-[#dfe4f3] text-[#27305b]">
          <X size={14} />
        </button>
      </div>
    </StudioField>
  )
}

function StudioCheckbox({ checked, label }: { checked: boolean; label: string }) {
  return (
    <label className="flex items-center gap-2 text-[12px] font-bold text-[#27305b]">
      <input type="checkbox" checked={checked} readOnly className="h-4 w-4 rounded border-[#c9c2ff]" style={{ accentColor: '#6247ff' }} />
      <span>{label}</span>
    </label>
  )
}

function StudioTimelinePanel({
  audioMenu,
  audioSrc,
  audio1Muted,
  audio2Muted,
  audioTracks,
  dragRef,
  mutedTracks,
  musicDragRef,
  musicDuration,
  musicLeft,
  musicSrc,
  musicStart,
  musicWidth,
  playheadLeft,
  sceneIndex,
  scenes,
  story,
  subtitleDragRef,
  timelineRef,
  trackDragRef,
  videoDuration,
  voiceLeft,
  voiceWidth,
  onAddTrack,
  onAudioMenuDelete,
  onChange,
  onContextMenuTrack,
  onResizeScene,
  onSeek,
  onSeekFromPointer,
  onSelect,
  onToggleTrackMute,
  onUpdateSubtitleTiming,
}: {
  audioMenu: { x: number; y: number; kind: 'legacy-music' | 'track'; trackId?: string } | null
  audioSrc: string
  audio1Muted: boolean
  audio2Muted: boolean
  audioTracks: ProCutAudioTrack[]
  dragRef: React.MutableRefObject<{ index: number; startX: number; leftDuration: number; rightDuration: number; totalDuration: number; timelineWidth: number } | null>
  mutedTracks: Record<string, boolean>
  musicDragRef: React.MutableRefObject<{ mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; totalDuration: number; timelineWidth: number } | null>
  musicDuration: number
  musicLeft: number
  musicSrc: string
  musicStart: number
  musicWidth: number
  playheadLeft: number
  sceneIndex: number
  scenes: GenerateVideoScene[]
  story: GenerateVideoStory
  subtitleDragRef: React.MutableRefObject<{ index: number; mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; timelineWidth: number } | null>
  timelineRef: React.RefObject<HTMLDivElement | null>
  trackDragRef: React.MutableRefObject<{ id: string; mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; timelineWidth: number } | null>
  videoDuration: number
  voiceLeft: number
  voiceWidth: number
  onAddTrack: () => void
  onAudioMenuDelete: () => void
  onChange: (story: GenerateVideoStory) => void
  onContextMenuTrack: (event: React.MouseEvent<HTMLElement>, item: { kind: 'legacy-music' | 'track'; trackId?: string }) => void
  onResizeScene: (event: React.PointerEvent<HTMLButtonElement>) => void
  onSeek: (time: number) => void
  onSeekFromPointer: (clientX: number) => void
  onSelect: (index: number) => void
  onToggleTrackMute: (trackId: string) => void
  onUpdateSubtitleTiming: (index: number, start: number, duration: number) => void
}) {
  const fps = story.video?.fps || 30
  const visualScenes = collapseVisualScenes(scenes)
  const textScenes = collapseTextScenes(scenes)
  return (
    <section className="relative h-[232px] shrink-0 overflow-hidden border-t border-[#dfe4f3] bg-white px-3 pb-3 pt-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex gap-1.5">
          <button className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-[#dfe4f3] px-2 text-[11px] font-bold text-[#27305b]"><ScissorsIcon /> Tách</button>
          <button className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-[#dfe4f3] px-2 text-[11px] font-bold text-[#27305b]"><Trash2 size={12} /> Xóa</button>
          <button onClick={onAddTrack} className="inline-flex h-7 items-center gap-1 rounded-[7px] border border-[#dfe4f3] px-2 text-[11px] font-bold text-[#27305b]"><Plus size={12} /> Thêm media</button>
        </div>
        <div className="text-[11px] font-black text-[#667097]">{formatStudioClock(videoDuration)} · {Math.round(videoDuration * fps)} frames</div>
      </div>
      <div className="relative h-[190px] overflow-x-auto overflow-y-hidden rounded-[8px] border border-[#dfe4f3] bg-[#f7f9ff]">
        <StudioFrameRuler duration={videoDuration} fps={fps} headerWidth={118} onSeek={onSeek} />
        <div
          data-no-seek="true"
          className="absolute bottom-0 top-7 z-30 -ml-1.5 flex w-3 cursor-ew-resize justify-center"
          style={{ left: `calc(118px + (100% - 118px) * ${playheadLeft / 100})` }}
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.setPointerCapture(event.pointerId)
            onSeekFromPointer(event.clientX)
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) onSeekFromPointer(event.clientX)
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          }}
        >
          <div className="h-full w-0.5 bg-[#14b8a6]" />
          <div className="absolute top-0 rounded bg-[#6247ff] px-1 py-0.5 text-[9px] font-black text-white">{formatStudioClock((playheadLeft / 100) * videoDuration)}</div>
        </div>
        {audioMenu && (
          <div className="fixed z-[70] min-w-36 rounded-[8px] border border-[#dfe4f3] bg-white p-1 shadow-xl" style={{ left: audioMenu.x, top: audioMenu.y }} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
            <button onClick={onAudioMenuDelete} className="flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-left text-xs font-black text-red-600 hover:bg-red-50">
              <Trash2 size={14} /> Delete track
            </button>
          </div>
        )}
        <StudioTimelineTrack label="Video / Frame" icon={<Film size={13} />}>
          <div ref={timelineRef} className="relative h-8 overflow-hidden bg-white">
            {visualScenes.map((scene, index) => {
              const sourceIndex = findSceneIndexForVisual(scenes, scene, index)
              const start = Number(scene.start || 0)
              const end = typeof scene.end === 'number' ? scene.end : start + Number(scene.duration || 0)
              const left = videoDuration ? (start / videoDuration) * 100 : 0
              const width = videoDuration ? Math.max(2, ((end - start) / videoDuration) * 100) : 0
              return (
                <div key={`${scene.video_id || scene.image}-${index}`} className={`absolute inset-y-0 overflow-hidden border-r border-white ${sourceIndex === sceneIndex ? 'ring-2 ring-inset ring-[#6247ff]' : ''}`} style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}>
                  <button onClick={() => { onSelect(sourceIndex); onSeek(start) }} className="h-full w-full overflow-hidden">
                    <SceneMediaThumb scene={scene} className="h-full w-full object-cover" />
                  </button>
                  {visualScenes.length === scenes.length && index < scenes.length - 1 && (
                    <button
                      data-no-seek="true"
                      onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture(event.pointerId)
                        dragRef.current = { index, startX: event.clientX, leftDuration: Number(scenes[index].duration || 0), rightDuration: Number(scenes[index + 1].duration || 0), totalDuration: videoDuration, timelineWidth: timelineRef.current?.getBoundingClientRect().width || 1 }
                      }}
                      onPointerMove={onResizeScene}
                      onPointerUp={() => { dragRef.current = null }}
                      className="absolute right-0 top-0 h-full w-2 cursor-col-resize bg-white/80"
                    />
                  )}
                </div>
              )
            })}
          </div>
        </StudioTimelineTrack>
        <StudioTimelineTrack label="Subtitle" icon={<Type size={13} />}>
          <div className="relative h-8 overflow-hidden bg-white">
            {textScenes.map((scene, index) => {
              const sourceIndex = findSceneIndexForText(scenes, scene, index)
              const textStart = getSubtitleStart(textScenes, index)
              const subtitleDuration = getSubtitleDuration(textScenes, index)
              const left = videoDuration ? (textStart / videoDuration) * 100 : 0
              const width = videoDuration ? Math.max(4, (subtitleDuration / videoDuration) * 100) : 0
              if (!String(scene.subtitle || '').trim()) return null
              return (
                <div key={`${scene.text_id || index}`} className="absolute top-1 h-6 overflow-hidden rounded-[5px] border border-[#efb33d] bg-[#ffd78a]" style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}>
                  <button
                    data-no-seek="true"
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      event.currentTarget.setPointerCapture(event.pointerId)
                      subtitleDragRef.current = { index: sourceIndex, mode: 'move', startX: event.clientX, start: textStart, duration: subtitleDuration, timelineWidth: timelineRef.current?.getBoundingClientRect().width || 1 }
                    }}
                    onPointerMove={(event) => {
                      if (!subtitleDragRef.current) return
                      const drag = subtitleDragRef.current
                      const secondsPerPixel = videoDuration / Math.max(1, drag.timelineWidth)
                      onUpdateSubtitleTiming(drag.index, drag.start + (event.clientX - drag.startX) * secondsPerPixel, drag.duration)
                    }}
                    onPointerUp={() => { subtitleDragRef.current = null }}
                    className="h-full w-full cursor-grab truncate px-2 text-left text-[10px] font-black text-[#5f3900]"
                  >
                    {scene.subtitle}
                  </button>
                </div>
              )
            })}
          </div>
        </StudioTimelineTrack>
        <StudioTimelineTrack label="Voice AI" icon={<Mic2 size={13} />} muted={audio2Muted} onToggleMute={() => onToggleTrackMute('audio-2')}>
          <div className="relative h-8 overflow-hidden bg-white">
            {audioSrc ? <WaveformCanvas src={audioSrc} color={audio2Muted ? '#94a3b8' : '#7c5cff'} className={`absolute inset-y-1 rounded-[5px] border bg-[#ede9fe] ${audio2Muted ? 'border-slate-300 opacity-50' : 'border-[#b8a9ff]'}`} style={{ left: `${voiceLeft}%`, width: `${voiceWidth}%` }} /> : null}
          </div>
        </StudioTimelineTrack>
        <StudioTimelineTrack label="Background Music" icon={<Music size={13} />} muted={audio1Muted} onToggleMute={() => onToggleTrackMute('audio-1')}>
          <div className="relative h-8 overflow-hidden bg-white">
            {musicSrc ? (
              <div onContextMenu={(event) => onContextMenuTrack(event, { kind: 'legacy-music' })} className={`absolute inset-y-1 overflow-hidden rounded-[5px] border bg-[#d9fbef] ${audio1Muted ? 'border-slate-300 opacity-50' : 'border-[#74dfbd]'}`} style={{ left: `${musicLeft}%`, width: `${Math.min(musicWidth, 100 - musicLeft)}%` }}>
                <button
                  data-no-seek="true"
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId)
                    musicDragRef.current = { mode: 'move', startX: event.clientX, start: musicStart, duration: musicDuration, totalDuration: videoDuration, timelineWidth: timelineRef.current?.getBoundingClientRect().width || 1 }
                  }}
                  onPointerMove={(event) => {
                    if (!musicDragRef.current) return
                    const drag = musicDragRef.current
                    const secondsPerPixel = drag.totalDuration / Math.max(1, drag.timelineWidth)
                    updateAudio(story, onChange, { musicStart: clampNumber(drag.start + (event.clientX - drag.startX) * secondsPerPixel, 0, Math.max(0, videoDuration - drag.duration)) })
                  }}
                  onPointerUp={() => { musicDragRef.current = null }}
                  className="h-full w-full cursor-grab px-2"
                >
                  <WaveformCanvas src={musicSrc} color={audio1Muted ? '#94a3b8' : '#21c79a'} className="h-full w-full" />
                </button>
              </div>
            ) : null}
          </div>
        </StudioTimelineTrack>
        {audioTracks.map((track, index) => (
          <StudioTimelineTrack key={track.id} label={`${track.type} ${index + 1}`} icon={<Music size={13} />} muted={Boolean(mutedTracks[track.id])} onToggleMute={() => onToggleTrackMute(track.id)}>
            <StudioExtraAudioClip muted={Boolean(mutedTracks[track.id])} scenes={scenes} story={story} timelineRef={timelineRef} track={track} trackDragRef={trackDragRef} videoDuration={videoDuration} onChange={onChange} onContextMenuTrack={onContextMenuTrack} onSeek={onSeek} onSelect={onSelect} />
          </StudioTimelineTrack>
        ))}
      </div>
    </section>
  )
}

function StudioTimelineTrack({ children, icon, label, muted, onToggleMute }: { children: React.ReactNode; icon: React.ReactNode; label: string; muted?: boolean; onToggleMute?: () => void }) {
  return (
    <div className="grid grid-cols-[118px_minmax(900px,1fr)] border-t border-[#e8ecf7] first:border-t-0">
      <div className="flex h-8 items-center justify-between border-r border-[#e8ecf7] bg-[#f2f5fc] px-2 text-[10px] font-black text-[#27305b]">
        <span className="flex min-w-0 items-center gap-1.5">
          {icon}
          <span className="truncate">{label}</span>
        </span>
        {onToggleMute ? (
          <button title={muted ? 'Bật âm' : 'Tắt âm'} onClick={onToggleMute} className="grid h-5 w-5 place-items-center rounded bg-white text-[#667097]">
            {muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
          </button>
        ) : null}
      </div>
      {children}
    </div>
  )
}

function StudioFrameRuler({ duration, fps, headerWidth, onSeek }: { duration: number; fps: number; headerWidth: number; onSeek: (time: number) => void }) {
  const ticks = Array.from({ length: 13 })
  return (
    <div className="flex h-7 cursor-pointer items-start justify-between border-b border-[#e8ecf7] bg-white pr-3 text-[10px] font-black text-[#667097]" style={{ marginLeft: headerWidth }} onClick={(event) => {
      const rect = event.currentTarget.getBoundingClientRect()
      onSeek(((event.clientX - rect.left) / Math.max(1, rect.width)) * duration)
    }}>
      {ticks.map((_, index) => {
        const seconds = (duration * index) / Math.max(1, ticks.length - 1)
        return (
          <span key={index} className="relative flex h-7 min-w-[84px] items-start px-2 pt-1.5">
            {formatStudioClock(seconds)}
            <span className="absolute bottom-1 left-2 h-1 w-px bg-[#cbd3e8]" />
            <span className="sr-only">{Math.round(seconds * fps)} frames</span>
          </span>
        )
      })}
    </div>
  )
}

function StudioExtraAudioClip({
  muted,
  scenes,
  story,
  timelineRef,
  track,
  trackDragRef,
  videoDuration,
  onChange,
  onContextMenuTrack,
  onSeek,
  onSelect,
}: {
  muted: boolean
  scenes: GenerateVideoScene[]
  story: GenerateVideoStory
  timelineRef: React.RefObject<HTMLDivElement | null>
  track: ProCutAudioTrack
  trackDragRef: React.MutableRefObject<{ id: string; mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; timelineWidth: number } | null>
  videoDuration: number
  onChange: (story: GenerateVideoStory) => void
  onContextMenuTrack: (event: React.MouseEvent<HTMLElement>, item: { kind: 'legacy-music' | 'track'; trackId?: string }) => void
  onSeek: (time: number) => void
  onSelect: (index: number) => void
}) {
  const src = track.src ? generateVideoMediaUrl(track.src) : ''
  const start = Number(track.start || 0)
  const duration = Number(track.duration || Math.max(0.5, videoDuration - start))
  const left = videoDuration ? (start / videoDuration) * 100 : 0
  const width = videoDuration ? Math.max(4, (duration / videoDuration) * 100) : 0
  const seekFromLane = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-no-seek="true"]')) return
    const rect = event.currentTarget.getBoundingClientRect()
    const nextTime = ((event.clientX - rect.left) / Math.max(1, rect.width)) * videoDuration
    onSeek(nextTime)
    onSelect(sceneIndexAtTime(scenes, nextTime))
  }
  return (
    <div onClick={seekFromLane} className="relative h-8 overflow-hidden bg-white">
      <div onContextMenu={(event) => onContextMenuTrack(event, { kind: 'track', trackId: track.id })} className={`absolute inset-y-1 overflow-hidden rounded-[5px] border ${muted ? 'border-slate-300 bg-slate-100 opacity-50' : 'border-[#b8a9ff] bg-[#ede9fe]'}`} style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}>
        <button
          data-no-seek="true"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            trackDragRef.current = { id: track.id, mode: 'move', startX: event.clientX, start, duration, timelineWidth: timelineRef.current?.getBoundingClientRect().width || 1 }
          }}
          onPointerMove={(event) => {
            if (!trackDragRef.current) return
            const drag = trackDragRef.current
            const secondsPerPixel = videoDuration / Math.max(1, drag.timelineWidth)
            updateAudioTrack(story, onChange, drag.id, { start: clampNumber(drag.start + (event.clientX - drag.startX) * secondsPerPixel, 0, Math.max(0, videoDuration - drag.duration)) })
          }}
          onPointerUp={() => { trackDragRef.current = null }}
          className="h-full w-full cursor-grab px-2"
        >
          {src ? <WaveformCanvas src={src} color={muted ? '#94a3b8' : '#7c5cff'} className="h-full w-full" /> : null}
        </button>
      </div>
    </div>
  )
}

function ScissorsIcon() {
  return <span className="text-[12px] font-black">⌘</span>
}

function FigmaIcon({ className = '', name, size = 14 }: { className?: string; name: keyof typeof proCutFigmaAssets; size?: number }) {
  switch (name) {
    case 'arrowLeft':
      return <ArrowLeft size={size} className={className} />
    case 'arrowUpRight':
      return <ArrowUpRight size={size} className={className} />
    case 'download':
      return <Save size={size} className={className} />
    case 'uploadCloud':
      return <UploadCloud size={size} className={className} />
    case 'settings':
      return <Settings size={size} className={className} />
    case 'settingsPanel':
      return <SlidersHorizontal size={size} className={className} />
    case 'monitor':
      return <Maximize2 size={size} className={className} />
    case 'chevronDown':
      return <ChevronDown size={size} className={className} />
    case 'ellipse':
      return <Circle size={size} className={className} fill="currentColor" />
    case 'skipBack':
      return <SkipBack size={size} className={className} />
    case 'rewind':
      return <Rewind size={size} className={className} />
    case 'play':
      return <Play size={size} className={className} fill="currentColor" />
    case 'fastForward':
      return <FastForward size={size} className={className} />
    case 'skipForward':
      return <SkipForward size={size} className={className} />
    case 'eye':
      return <Eye size={size} className={className} />
    case 'film':
      return <Film size={size} className={className} />
    case 'volume2':
      return <Volume2 size={size} className={className} />
    case 'lock':
      return <Lock size={size} className={className} />
    case 'type':
      return <Type size={size} className={className} />
    case 'music':
      return <Music size={size} className={className} />
    case 'plus':
      return <Plus size={size} className={className} />
    default:
      return <Film size={size} className={className} />
  }
}

function ProCutTopToolbar({
  fps,
  isFullscreen,
  onExit,
  saving,
  exporting,
  voiceGenerating,
  voiceProvider,
  fitting,
  story,
  videoDuration,
  onExport,
  onGenerateVoice,
  onVoiceProviderChange,
  onFitFrames,
  onSave,
  onToggleFullscreen,
}: {
  fps: number
  isFullscreen: boolean
  onExit: () => void
  saving: boolean
  exporting: boolean
  voiceGenerating: boolean
  voiceProvider: GenerateVideoVoiceProvider
  fitting: boolean
  story: GenerateVideoStory
  videoDuration: number
  onExport: () => void
  onGenerateVoice: () => void
  onVoiceProviderChange: (provider: GenerateVideoVoiceProvider) => void
  onFitFrames: () => void
  onSave: () => void
  onToggleFullscreen: () => void
}) {
  const projectName = getStoryProjectName(story)
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border border-[#2d2d37] bg-[#17171c] px-4">
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex shrink-0 items-center gap-1">
          <span className="size-[18px] rounded bg-[#ff6200]" />
          <span className="text-[14px] font-extrabold text-[#f1f1f6]">PRO CUT</span>
        </div>
        <div className="hidden items-center gap-3 text-[12px] font-medium text-[#9e9eae] lg:flex">
          <button>File</button>
          <button>Edit</button>
          <button>Clip</button>
          <button>Timeline</button>
          <button>View</button>
          <button>Window</button>
          <button>Help</button>
        </div>
      </div>

      <div className="mx-3 hidden min-w-0 items-center gap-2 text-center lg:flex">
        <p className="max-w-[300px] truncate text-[12px] font-semibold text-[#f1f1f6]">{projectName}</p>
        <span className="size-1 rounded-sm bg-[#626272]" />
        <p className="text-[11px] text-[#626272]">{story.video?.width || 1080}x{story.video?.height || 1920} · {fps} fps · {Math.round(videoDuration * fps)} frames</p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div className="flex items-start gap-1">
          <ToolbarIconButton label="Back" onClick={onExit}><FigmaIcon name="arrowLeft" size={14} /></ToolbarIconButton>
        </div>
        <ToolbarActionButton disabled={saving} onClick={onSave} icon={<FigmaIcon name="download" size={14} />} label={saving ? 'Saving' : 'Save'} />
        <select
          aria-label="Voice provider"
          title="Voice provider"
          value={voiceProvider}
          disabled={voiceGenerating || saving || exporting}
          onChange={(event) => onVoiceProviderChange(event.target.value as GenerateVideoVoiceProvider)}
          className="h-[26px] rounded border border-[#2d2d37] bg-[#1e1e24] px-2 text-[11px] font-semibold text-[#f1f1f6] outline-none hover:bg-[#26262e] disabled:opacity-50"
        >
          {voiceProviderOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <ToolbarActionButton disabled={voiceGenerating || saving || exporting} onClick={onGenerateVoice} icon={<Mic2 size={14} />} label={voiceGenerating ? 'Generating' : 'Voice'} />
        <ToolbarActionButton disabled={fitting || saving || exporting || voiceGenerating} onClick={onFitFrames} icon={<Wand2 size={14} />} label={fitting ? 'Refitting' : 'Refit'} />
        <ToolbarActionButton onClick={onToggleFullscreen} icon={<FigmaIcon name="monitor" size={14} />} label={isFullscreen ? 'Embed' : 'Full'} />
        <ToolbarActionButton active disabled={exporting} onClick={onExport} icon={<FigmaIcon name="uploadCloud" size={14} />} label={exporting ? 'Rendering' : 'Export'} />
        <ToolbarIconButton label="Settings"><FigmaIcon name="settings" size={18} /></ToolbarIconButton>
      </div>
    </div>
  )
}

function ToolbarIconButton({ children, label, onClick }: { children: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-[26px] min-w-[34px] items-center justify-center rounded border border-[#2d2d37] bg-[#1e1e24] px-[10px] text-[#f1f1f6] hover:border-[#3e3e4c] hover:bg-[#26262e]"
    >
      {children}
    </button>
  )
}

function ToolbarActionButton({ active, disabled, icon, label, onClick }: { active?: boolean; disabled?: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-[26px] items-center gap-[6px] rounded px-[10px] text-[11px] font-semibold disabled:opacity-50 ${active ? 'bg-[#ff6200] text-white hover:bg-[#ea580c]' : 'border border-[#2d2d37] bg-[#1e1e24] text-[#f1f1f6] hover:bg-[#26262e]'}`}
    >
      {icon}
      {label}
    </button>
  )
}

function ProCutAddAudioPanel({
  busy,
  error,
  file,
  link,
  mode,
  type,
  onCancel,
  onFileChange,
  onLinkChange,
  onModeChange,
  onTypeChange,
  onSubmit,
}: {
  busy: boolean
  error: string
  file: File | null
  link: string
  mode: 'local' | 'link'
  type: ProCutAudioTrackType
  onCancel: () => void
  onFileChange: (file: File | null) => void
  onLinkChange: (value: string) => void
  onModeChange: (mode: 'local' | 'link') => void
  onTypeChange: (type: ProCutAudioTrackType) => void
  onSubmit: () => void
}) {
  const typeOptions: Array<{ type: ProCutAudioTrackType; label: string; hint: string }> = [
    { type: 'voice', label: 'Voice', hint: 'Lời đọc hoặc overdub' },
    { type: 'music', label: 'Music', hint: 'Nhạc nền, ambience' },
    { type: 'sfx', label: 'SFX', hint: 'Âm thanh nhấn cảnh' },
  ]
  return (
    <div className="absolute inset-0 z-[65] flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="grid w-full max-w-[520px] gap-4 rounded-lg border border-[#2d2d37] bg-[#111115] p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase text-[#9e9eae]">Add Track</div>
            <div className="mt-1 text-[13px] font-bold text-[#f1f1f6]">Thêm audio vào timeline tại playhead</div>
          </div>
          <button aria-label="Close add track" onClick={onCancel} className="flex size-8 items-center justify-center rounded border border-[#2d2d37] bg-[#1e1e24] text-[#f1f1f6] hover:bg-[#26262e]">
            <X size={15} />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {typeOptions.map((option) => (
            <button
              key={option.type}
              onClick={() => onTypeChange(option.type)}
              className={`grid min-h-16 gap-1 rounded-md border px-3 py-2 text-left ${type === option.type ? 'border-[#ff6200] bg-[#ff6200]/15 text-white' : 'border-[#2d2d37] bg-[#1e1e24] text-[#f1f1f6] hover:bg-[#26262e]'}`}
            >
              <span className="text-xs font-black uppercase">{option.label}</span>
              <span className="text-[10px] font-semibold text-[#9e9eae]">{option.hint}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => onModeChange('local')} className={`h-8 rounded text-xs font-semibold ${mode === 'local' ? 'bg-[#f1f1f6] text-[#111115]' : 'bg-[#1e1e24] text-[#f1f1f6]'}`}>Chọn local</button>
          <button onClick={() => onModeChange('link')} className={`h-8 rounded text-xs font-semibold ${mode === 'link' ? 'bg-[#f1f1f6] text-[#111115]' : 'bg-[#1e1e24] text-[#f1f1f6]'}`}>Điền link</button>
        </div>
        {mode === 'local' ? (
          <label className="grid gap-1 text-xs font-semibold text-[#9e9eae]">
            Audio file {file ? `· ${file.name}` : ''}
            <input
              type="file"
              accept="audio/*"
              onChange={(event) => onFileChange(event.target.files?.[0] || null)}
              className="h-9 rounded border border-[#2d2d37] bg-[#1e1e24] px-2 py-1 text-xs font-bold text-slate-200 file:mr-3 file:rounded file:border-0 file:bg-[#ff6200] file:px-2 file:py-1 file:text-xs file:font-black file:text-white"
            />
          </label>
        ) : (
          <label className="grid gap-1 text-xs font-semibold text-[#9e9eae]">
            Audio URL
            <input
              value={link}
              onChange={(event) => onLinkChange(event.target.value)}
              placeholder="https://... hoặc assets/audio/..."
              className="h-9 rounded border border-[#2d2d37] bg-[#1e1e24] px-2 text-xs font-semibold text-white outline-none"
            />
            <button type="button" onClick={() => onLinkChange('assets/audio/demo-ambient.wav')} className="justify-self-start rounded border border-[#2d2d37] bg-[#1e1e24] px-2 py-1 text-[11px] font-semibold text-[#f1f1f6] hover:bg-[#26262e]">
              Dùng demo audio
            </button>
          </label>
        )}
        <div className="flex items-center justify-between gap-3">
          <div className="min-h-4 text-xs font-semibold text-red-300">{error}</div>
          <button disabled={busy} onClick={onSubmit} className="h-8 rounded bg-[#ff6200] px-3 text-xs font-semibold text-white disabled:opacity-50">
            {busy ? 'Adding...' : 'Add to timeline'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ProCutMainSplit({
  currentScene,
  currentTime,
  fps,
  isFullscreen,
  playing,
  previewStage,
  sceneIndex,
  scenes,
  story,
  videoDuration,
  onChange,
  onPlayToggle,
  onSeek,
}: {
  currentScene: GenerateVideoScene | undefined
  currentTime: number
  fps: number
  isFullscreen: boolean
  playing: boolean
  previewStage: React.ReactNode
  sceneIndex: number
  scenes: GenerateVideoScene[]
  story: GenerateVideoStory
  videoDuration: number
  onChange: (story: GenerateVideoStory) => void
  onPlayToggle: () => void
  onSeek: (time: number) => void
}) {
  const progress = videoDuration ? Math.min(100, Math.max(0, (currentTime / videoDuration) * 100)) : 0
  return (
    <div className={isFullscreen ? "grid h-[492px] shrink-0 grid-cols-[minmax(0,1fr)_380px]" : "grid h-[390px] shrink-0 grid-cols-[minmax(0,1fr)_320px]"}>
      <section className="flex min-w-0 flex-col border border-[#2d2d37]">
        <PaneHeader icon={<FigmaIcon name="monitor" size={14} />} title="Program Monitor" />
        <div className="flex min-h-0 flex-1 items-center justify-center bg-[#111115] p-4">
          <div className="flex h-full max-h-[428px] w-full max-w-[760px] items-center justify-center overflow-hidden rounded-md border border-[#3e3e4c] bg-black">
            {previewStage}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-3 border border-[#2d2d37] bg-[#17171c] p-3">
          <button
            className="group flex h-4 items-center rounded-sm bg-[#2d2d37]"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              onSeek(((event.clientX - rect.left) / Math.max(1, rect.width)) * videoDuration)
            }}
          >
            <span className="h-1 rounded-sm bg-[#ff6200]" style={{ width: `${progress}%` }} />
            <FigmaIcon name="ellipse" size={10} className="-ml-1 opacity-90 group-hover:opacity-100" />
          </button>
          <div className="flex items-center justify-between">
            <p className="text-[14px] font-bold text-[#ff6200]">{formatTimelineClock(currentTime, fps)}</p>
            <div className="flex items-center gap-4 text-[#9e9eae]">
              <button aria-label="Skip back" onClick={() => onSeek(0)}><FigmaIcon name="skipBack" size={16} /></button>
              <button aria-label="Rewind" onClick={() => onSeek(Math.max(0, currentTime - 1))}><FigmaIcon name="rewind" size={16} /></button>
              <button aria-label={playing ? 'Pause' : 'Play'} onClick={onPlayToggle} className="flex size-9 items-center justify-center rounded-full bg-[#ff6200] text-white hover:bg-[#ea580c] transition-colors shadow">
                {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
              </button>
              <button aria-label="Forward" onClick={() => onSeek(Math.min(videoDuration, currentTime + 1))}><FigmaIcon name="fastForward" size={16} /></button>
              <button aria-label="Skip forward" onClick={() => onSeek(videoDuration)}><FigmaIcon name="skipForward" size={16} /></button>
            </div>
            <p className="text-[13px] font-medium text-[#9e9eae]">{formatTimelineClock(videoDuration, fps)}</p>
          </div>
        </div>
      </section>

      <ProCutInspector
        currentScene={currentScene}
        isFullscreen={isFullscreen}
        sceneIndex={sceneIndex}
        scenes={scenes}
        story={story}
        onChange={onChange}
      />
    </div>
  )
}

function PaneHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between border border-[#2d2d37] bg-[#1e1e24] px-4">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase text-[#9e9eae]">
        {icon}
        {title}
      </div>
      <FigmaIcon name="chevronDown" size={14} />
    </div>
  )
}

function ProCutInspector({
  currentScene,
  isFullscreen,
  sceneIndex,
  scenes,
  story,
  onChange,
}: {
  currentScene: GenerateVideoScene | undefined
  isFullscreen: boolean
  sceneIndex: number
  scenes: GenerateVideoScene[]
  story: GenerateVideoStory
  onChange: (story: GenerateVideoStory) => void
}) {
  const selectedName = currentScene?.image ? fileNameFromPath(currentScene.image) : `${getSceneMediaType(currentScene)} clip`
  const mediaFit = getSceneMediaFit(currentScene)
  const scale = Number((currentScene as any)?.scale || 100)
  const opacity = Number((currentScene as any)?.opacity || 100)
  const positionX = Number((currentScene as any)?.position_x || 0)
  const positionY = Number((currentScene as any)?.position_y || 0)
  const rotation = Number((currentScene as any)?.rotation || 0)
  const subtitleStyle = (currentScene?.text_style || {}) as Record<string, unknown>
  const subtitleFontFamily = String(subtitleStyle.fontFamily || 'Inter, system-ui, sans-serif')
  const subtitleFontSize = readNumericStyleValue(subtitleStyle.fontSize, isFullscreen ? 24 : 18)
  const subtitleLeft = readNumericStyleValue(subtitleStyle.left, 50)
  const subtitleTop = readNumericStyleValue(subtitleStyle.top, 82)
  const updateSubtitleStyle = (patch: React.CSSProperties) => {
    if (!currentScene) return
    updateSceneAt(story, scenes, sceneIndex, {
      text_style: {
        ...(currentScene.text_style || {}),
        ...patch,
      },
    }, onChange)
  }
  return (
    <aside className={`${isFullscreen ? "w-[380px]" : "w-[320px]"} flex min-h-0 flex-col bg-[#17171c]`}>
      <PaneHeader icon={<FigmaIcon name="settingsPanel" size={14} />} title="Inspector / Properties" />
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase text-[#626272]">Selected Clip</p>
          <p className="truncate text-[13px] font-bold text-[#f1f1f6]">{selectedName}</p>
        </div>
        <InspectorDivider />

        <InspectorSection title="Transform">
          <label className="grid gap-1 text-[10px] text-[#626272]">
            Media Fit
            <div className="grid grid-cols-[1fr_58px] gap-2">
              <select
                value={mediaFit}
                onChange={(event) => updateSceneAt(story, scenes, sceneIndex, { fit: event.target.value }, onChange)}
                className="h-8 rounded border border-[#2d2d37] bg-[#111115] px-2 text-[11px] font-semibold text-[#f1f1f6] outline-none"
              >
                <option value="contain">Để nguyên</option>
                <option value="cover">Làm đầy</option>
              </select>
              <button
                type="button"
                onClick={() => onChange(updateRenderScenes(story, scenes.map((scene) => ({ ...scene, fit: mediaFit }))))}
                className="h-8 rounded border border-[#2d2d37] bg-[#1e1e24] text-[11px] font-bold text-[#f1f1f6] hover:bg-[#26262e]"
              >
                All
              </button>
            </div>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <InspectorNumber label="Position X" max={800} min={-800} step={1} suffix="px" value={positionX} onChange={(value) => updateSceneAt(story, scenes, sceneIndex, { position_x: value }, onChange)} />
            <InspectorNumber label="Position Y" max={800} min={-800} step={1} suffix="px" value={positionY} onChange={(value) => updateSceneAt(story, scenes, sceneIndex, { position_y: value }, onChange)} />
          </div>
          <InspectorSlider label="Scale" min={10} max={200} step={1} value={scale} onChange={(value) => updateSceneAt(story, scenes, sceneIndex, { scale: value }, onChange)} />
          <InspectorSlider label="Rotation" min={-180} max={180} step={1} value={rotation} onChange={(value) => updateSceneAt(story, scenes, sceneIndex, { rotation: value }, onChange)} />
        </InspectorSection>

        <InspectorDivider />
        <InspectorSection title="Compositing">
          <InspectorSlider label="Opacity" min={0} max={100} step={1} value={opacity} onChange={(value) => updateSceneAt(story, scenes, sceneIndex, { opacity: value }, onChange)} />
        </InspectorSection>

        <InspectorDivider />
        <InspectorSection title="Subtitle">
          <label className="grid gap-1 text-[10px] text-[#626272]">
            Font
            <select
              value={subtitleFontFamily}
              onChange={(event) => updateSubtitleStyle({ fontFamily: event.target.value })}
              className="h-8 rounded border border-[#2d2d37] bg-[#111115] px-2 text-[11px] font-semibold text-[#f1f1f6] outline-none"
            >
              <option value="Inter, system-ui, sans-serif">Inter</option>
              <option value="Arial, Helvetica, sans-serif">Arial</option>
              <option value="Roboto, Arial, sans-serif">Roboto</option>
              <option value="Montserrat, Arial, sans-serif">Montserrat</option>
              <option value="'Times New Roman', Georgia, serif">Serif</option>
              <option value="'Courier New', monospace">Mono</option>
            </select>
          </label>
          <InspectorSlider label="Font Size" min={12} max={72} step={1} value={subtitleFontSize} onChange={(value) => updateSubtitleStyle({ fontSize: value })} />
          <div className="grid grid-cols-2 gap-3">
            <InspectorNumber label="Text X" max={92} min={8} step={1} suffix="%" value={subtitleLeft} onChange={(value) => updateSubtitleStyle({ left: `${value}%`, right: 'auto', transform: 'translate(-50%, -50%)' })} />
            <InspectorNumber label="Text Y" max={90} min={10} step={1} suffix="%" value={subtitleTop} onChange={(value) => updateSubtitleStyle({ top: `${value}%`, bottom: 'auto', transform: 'translate(-50%, -50%)' })} />
          </div>
        </InspectorSection>

        <InspectorDivider />
        <InspectorSection title="Active Effects">
          <label className="grid gap-1 text-[10px] text-[#626272]">
            Effect
            <select
              value={currentScene?.effect || 'slow-zoom'}
              onChange={(event) => updateSceneAt(story, scenes, sceneIndex, { effect: event.target.value }, onChange)}
              className="h-8 rounded border border-[#2d2d37] bg-[#111115] px-2 text-[11px] font-semibold text-[#f1f1f6] outline-none"
            >
              <option value="slow-zoom">slow-zoom</option>
              <option value="pan-right">pan-right</option>
              <option value="pan-left">pan-left</option>
              <option value="push-in">push-in</option>
            </select>
          </label>
          <div className="flex h-[30px] items-center gap-2 rounded border border-[#2d2d37] bg-[#111115] px-2 text-[11px] font-semibold text-[#f1f1f6]">
            <FigmaIcon name="eye" size={14} />
            <span>{currentScene?.effect || 'slow-zoom'}</span>
          </div>
        </InspectorSection>
      </div>
    </aside>
  )
}

function InspectorSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-bold uppercase text-[#9e9eae]">{title}</p>
      {children}
    </div>
  )
}

function InspectorDivider() {
  return <div className="h-px bg-[#2d2d37]" />
}

function InspectorNumber({ label, max, min, step, suffix, value, onChange }: { label: string; max: number; min: number; step: number; suffix: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="space-y-1">
      <p className="text-[10px] text-[#626272]">{label}</p>
      <div className="flex h-8 items-center rounded border border-[#2d2d37] bg-[#111115] px-2 text-[11px] text-[#f1f1f6]">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(clampNumber(Number(event.target.value) || 0, min, max))}
          className="min-w-0 flex-1 bg-transparent text-[#f1f1f6] outline-none"
        />
        <span className="text-[#626272]">{suffix}</span>
      </div>
    </label>
  )
}

function InspectorSlider({ label, max, min = 0, step = 0.01, value, onChange }: { label: string; max: number; min?: number; step?: number; value: number; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-1 text-[10px] text-[#626272]">
      <span className="flex items-center justify-between">
        <span>{label}</span>
        <span className="text-[11px] text-[#f1f1f6]">{value.toFixed(2)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} style={{ accentColor: '#ff6200' }} />
    </label>
  )
}

function ProCutTimelinePanel({
  audioMenu,
  audioSrc,
  audio1Muted,
  audio2Muted,
  audioTracks,
  dragRef,
  mutedTracks,
  musicDragRef,
  musicDuration,
  musicLeft,
  musicSrc,
  musicStart,
  musicWidth,
  playheadLeft,
  sceneIndex,
  scenes,
  story,
  subtitleDragRef,
  trackDragRef,
  timelineRef,
  videoDuration,
  isFullscreen,
  voiceLeft,
  voiceWidth,
  onAudioMenuDelete,
  onAddTrack,
  onChange,
  onContextMenuTrack,
  onResizeScene,
  onSeek,
  onSeekFromPointer,
  onSelect,
  onToggleTrackMute,
  onUpdateSubtitleTiming,
}: {
  audioMenu: { x: number; y: number; kind: 'legacy-music' | 'track'; trackId?: string } | null
  audioSrc: string
  audio1Muted: boolean
  audio2Muted: boolean
  audioTracks: ProCutAudioTrack[]
  dragRef: React.MutableRefObject<{ index: number; startX: number; leftDuration: number; rightDuration: number; totalDuration: number; timelineWidth: number } | null>
  mutedTracks: Record<string, boolean>
  musicDragRef: React.MutableRefObject<{ mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; totalDuration: number; timelineWidth: number } | null>
  musicDuration: number
  musicLeft: number
  musicSrc: string
  musicStart: number
  musicWidth: number
  playheadLeft: number
  sceneIndex: number
  scenes: GenerateVideoScene[]
  story: GenerateVideoStory
  subtitleDragRef: React.MutableRefObject<{ index: number; mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; timelineWidth: number } | null>
  trackDragRef: React.MutableRefObject<{ id: string; mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; timelineWidth: number } | null>
  timelineRef: React.RefObject<HTMLDivElement | null>
  videoDuration: number
  isFullscreen: boolean
  voiceLeft: number
  voiceWidth: number
  onAudioMenuDelete: () => void
  onAddTrack: () => void
  onChange: (story: GenerateVideoStory) => void
  onContextMenuTrack: (event: React.MouseEvent<HTMLElement>, item: { kind: 'legacy-music' | 'track'; trackId?: string }) => void
  onResizeScene: (event: React.PointerEvent<HTMLButtonElement>) => void
  onSeek: (time: number) => void
  onSeekFromPointer: (clientX: number) => void
  onSelect: (index: number) => void
  onToggleTrackMute: (trackId: string) => void
  onUpdateSubtitleTiming: (index: number, start: number, duration: number) => void
}) {
  const fps = story.video?.fps || 30
  const visualScenes = collapseVisualScenes(scenes)
  const textScenes = collapseTextScenes(scenes)
  return (
    <section className={`${isFullscreen ? "min-h-[260px]" : "min-h-[220px]"} flex-1 overflow-y-auto overflow-x-hidden border-t border-[#2d2d37] bg-[#111115]`}>
      <div className="relative min-h-full">
        <FrameRuler duration={videoDuration} fps={fps} headerWidth={200} onSeek={onSeek} />
        <div
          data-no-seek="true"
          className="absolute bottom-0 top-[30px] z-30 -ml-2 flex w-4 cursor-ew-resize justify-center"
          style={{ left: `calc(200px + (100% - 200px) * ${playheadLeft / 100})` }}
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.setPointerCapture(event.pointerId)
            onSeekFromPointer(event.clientX)
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              onSeekFromPointer(event.clientX)
            }
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
          }}
        >
          <div className="h-full w-px bg-[#ff3347]" />
          <div className="absolute top-0 h-0 w-0 border-x-[5px] border-t-[8px] border-x-transparent border-t-[#ff3347]" />
        </div>
        {audioMenu && (
          <div
            data-no-seek="true"
            className="fixed z-[70] min-w-36 rounded border border-[#2d2d37] bg-[#111115] p-1 shadow-xl"
            style={{ left: audioMenu.x, top: audioMenu.y }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button onClick={onAudioMenuDelete} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs font-black text-red-300 hover:bg-red-500/15">
              <Trash2 size={14} /> Delete track
            </button>
          </div>
        )}

        <div className="grid">
          <ProCutTrack label="Video 2" icon={<FigmaIcon name="film" size={14} />} locked>
            <div className="relative h-12 border border-[#2d2d37] bg-[#141419]" />
          </ProCutTrack>
          <ProCutTrack label="Video 1" icon={<FigmaIcon name="film" size={14} />} locked>
            <div ref={timelineRef} className="relative h-12 overflow-hidden border border-[#2d2d37] bg-[#141419]">
              {visualScenes.map((scene, index) => {
                const sourceIndex = findSceneIndexForVisual(scenes, scene, index)
                const start = Number(scene.start || 0)
                const end = typeof scene.end === 'number' ? scene.end : start + Number(scene.duration || 0)
                const left = videoDuration ? (start / videoDuration) * 100 : 0
                const width = videoDuration ? Math.max(2, ((end - start) / videoDuration) * 100) : 0
                const mediaType = getSceneMediaType(scene)
                return (
                  <div
                    key={`${scene.video_id || scene.image}-${index}`}
                    className={`absolute inset-y-0 border-r border-[#111115] bg-[#ff6200] ${sourceIndex === sceneIndex ? 'ring-2 ring-inset ring-white' : ''}`}
                    style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                  >
                    <button
                      onClick={() => {
                        onSelect(sourceIndex)
                        onSeek(start)
                      }}
                      className="h-full w-full overflow-hidden text-left"
                    >
                      <SceneMediaThumb scene={scene} className="absolute left-1 top-1 h-9 w-9 rounded object-cover opacity-80" />
                      <span className="absolute left-12 top-1 max-w-[calc(100%-54px)] truncate text-[10px] font-semibold text-white">{fileNameFromPath(scene.image || `${mediaType}_clip`)}</span>
                      <span className="absolute bottom-1 left-12 text-[9px] font-semibold text-white/80">{Number(scene.duration || 0).toFixed(2)}s · {mediaType}</span>
                    </button>
                    {visualScenes.length === scenes.length && index < scenes.length - 1 && (
                      <button
                        data-no-seek="true"
                        onPointerDown={(event) => {
                          event.currentTarget.setPointerCapture(event.pointerId)
                          dragRef.current = {
                            index,
                            startX: event.clientX,
                            leftDuration: Number(scenes[index].duration || 0),
                            rightDuration: Number(scenes[index + 1].duration || 0),
                            totalDuration: videoDuration,
                            timelineWidth: timelineRef.current?.getBoundingClientRect().width || 1,
                          }
                        }}
                        onPointerMove={onResizeScene}
                        onPointerUp={() => { dragRef.current = null }}
                        className="absolute right-0 top-0 h-full w-2 cursor-col-resize bg-white/70"
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </ProCutTrack>

          <ProCutTrack label="Text 1" icon={<FigmaIcon name="type" size={14} />} locked>
            <div className="relative h-12 overflow-hidden border border-[#2d2d37] bg-[#141419]">
              {textScenes.map((scene, index) => {
                const sourceIndex = findSceneIndexForText(scenes, scene, index)
                const textStart = getSubtitleStart(textScenes, index)
                const subtitleDuration = getSubtitleDuration(textScenes, index)
                const left = videoDuration ? (textStart / videoDuration) * 100 : 0
                const width = videoDuration ? Math.max(4, (subtitleDuration / videoDuration) * 100) : 0
                if (!String(scene.subtitle || '').trim()) return null
                return (
                  <div
                    key={index}
                    className="absolute top-1 h-10 overflow-hidden rounded border border-[#d8a900] bg-[#ffd84d] shadow"
                    style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                  >
                    <button
                      data-no-seek="true"
                      aria-label="Trim subtitle start"
                      onPointerDown={(event) => {
                        event.stopPropagation()
                        event.currentTarget.setPointerCapture(event.pointerId)
                        subtitleDragRef.current = { index: sourceIndex, mode: 'trim-start', startX: event.clientX, start: textStart, duration: subtitleDuration, timelineWidth: timelineRef.current?.getBoundingClientRect().width || 1 }
                      }}
                      onPointerMove={(event) => {
                        if (!subtitleDragRef.current) return
                        const drag = subtitleDragRef.current
                        const secondsPerPixel = videoDuration / Math.max(1, drag.timelineWidth)
                        const nextStart = clampNumber(drag.start + (event.clientX - drag.startX) * secondsPerPixel, 0, drag.start + drag.duration - 0.1)
                        onUpdateSubtitleTiming(drag.index, nextStart, drag.duration + drag.start - nextStart)
                      }}
                      onPointerUp={() => { subtitleDragRef.current = null }}
                      className="absolute left-0 top-0 z-10 h-full w-2 cursor-ew-resize bg-black/35"
                    />
                    <button
                      data-no-seek="true"
                      aria-label="Move subtitle"
                      onPointerDown={(event) => {
                        event.stopPropagation()
                        event.currentTarget.setPointerCapture(event.pointerId)
                        subtitleDragRef.current = { index: sourceIndex, mode: 'move', startX: event.clientX, start: textStart, duration: subtitleDuration, timelineWidth: timelineRef.current?.getBoundingClientRect().width || 1 }
                      }}
                      onPointerMove={(event) => {
                        if (!subtitleDragRef.current) return
                        const drag = subtitleDragRef.current
                        const secondsPerPixel = videoDuration / Math.max(1, drag.timelineWidth)
                        onUpdateSubtitleTiming(drag.index, drag.start + (event.clientX - drag.startX) * secondsPerPixel, drag.duration)
                      }}
                      onPointerUp={() => { subtitleDragRef.current = null }}
                      className="absolute left-2 top-1 z-20 flex h-8 w-6 cursor-grab items-center justify-center rounded bg-black/15 text-[10px] font-black text-[#111115] active:cursor-grabbing"
                    >
                      T
                    </button>
                    <input
                      data-no-seek="true"
                      value={scene.subtitle || ''}
                      onFocus={() => {
                        onSelect(sourceIndex)
                        onSeek(textStart)
                      }}
                      onChange={(event) => updateSceneAt(story, scenes, index, { subtitle: event.target.value }, onChange)}
                      title={scene.subtitle || `Scene ${index + 1}`}
                      className="h-full w-full min-w-0 truncate border-0 bg-transparent px-3 pl-11 pr-5 text-left text-[11px] font-semibold normal-case text-[#111115] outline-none"
                    />
                    <button
                      data-no-seek="true"
                      aria-label="Trim subtitle end"
                      onPointerDown={(event) => {
                        event.stopPropagation()
                        event.currentTarget.setPointerCapture(event.pointerId)
                        subtitleDragRef.current = { index: sourceIndex, mode: 'trim-end', startX: event.clientX, start: textStart, duration: subtitleDuration, timelineWidth: timelineRef.current?.getBoundingClientRect().width || 1 }
                      }}
                      onPointerMove={(event) => {
                        if (!subtitleDragRef.current) return
                        const drag = subtitleDragRef.current
                        const secondsPerPixel = videoDuration / Math.max(1, drag.timelineWidth)
                        onUpdateSubtitleTiming(drag.index, drag.start, drag.duration + (event.clientX - drag.startX) * secondsPerPixel)
                      }}
                      onPointerUp={() => { subtitleDragRef.current = null }}
                      className="absolute right-0 top-0 z-10 h-full w-2 cursor-ew-resize bg-black/35"
                    />
                  </div>
                )
              })}
            </div>
          </ProCutTrack>

          <ProCutTrack label="Audio 1" icon={<FigmaIcon name="music" size={14} />} muted={audio1Muted} locked onToggleMute={() => onToggleTrackMute('audio-1')}>
            <div className="relative h-12 overflow-hidden border border-[#2d2d37] bg-[#141419]">
              {musicSrc ? (
                <div
                  onContextMenu={(event) => onContextMenuTrack(event, { kind: 'legacy-music' })}
                  className={`absolute top-2 h-12 overflow-hidden rounded border bg-[#123232] transition-opacity ${audio1Muted ? 'border-[#626272] opacity-45' : 'border-[#00e5c9]'}`}
                  style={{ left: `${musicLeft}%`, width: `${Math.min(musicWidth, 100 - musicLeft)}%` }}
                >
                  <button
                    data-no-seek="true"
                    aria-label="Trim music start"
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      event.currentTarget.setPointerCapture(event.pointerId)
                      musicDragRef.current = {
                        mode: 'trim-start',
                        startX: event.clientX,
                        start: musicStart,
                        duration: musicDuration,
                        totalDuration: videoDuration,
                        timelineWidth: timelineRef.current?.getBoundingClientRect().width || event.currentTarget.parentElement?.parentElement?.getBoundingClientRect().width || 1,
                      }
                    }}
                    onPointerMove={(event) => {
                      if (!musicDragRef.current) return
                      const drag = musicDragRef.current
                      const secondsPerPixel = drag.totalDuration / Math.max(1, drag.timelineWidth)
                      const delta = (event.clientX - drag.startX) * secondsPerPixel
                      const nextStart = clampNumber(drag.start + delta, 0, drag.start + drag.duration - 0.5)
                      updateAudio(story, onChange, { musicStart: nextStart, musicDuration: drag.duration + drag.start - nextStart })
                    }}
                    onPointerUp={() => { musicDragRef.current = null }}
                    className="absolute left-0 top-0 z-10 h-full w-3 cursor-ew-resize bg-[#00e5c9]"
                  />
                  <button
                    data-no-seek="true"
                    aria-label="Move music clip"
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId)
                      musicDragRef.current = {
                        mode: 'move',
                        startX: event.clientX,
                        start: musicStart,
                        duration: musicDuration,
                        totalDuration: videoDuration,
                        timelineWidth: timelineRef.current?.getBoundingClientRect().width || event.currentTarget.parentElement?.parentElement?.getBoundingClientRect().width || 1,
                      }
                    }}
                    onPointerMove={(event) => {
                      if (!musicDragRef.current) return
                      const drag = musicDragRef.current
                      const secondsPerPixel = drag.totalDuration / Math.max(1, drag.timelineWidth)
                      const delta = (event.clientX - drag.startX) * secondsPerPixel
                      if (drag.mode === 'move') {
                        updateAudio(story, onChange, { musicStart: clampNumber(drag.start + delta, 0, Math.max(0, videoDuration - drag.duration)) })
                      } else if (drag.mode === 'trim-start') {
                        const nextStart = clampNumber(drag.start + delta, 0, drag.start + drag.duration - 0.5)
                        updateAudio(story, onChange, { musicStart: nextStart, musicDuration: drag.duration + drag.start - nextStart })
                      } else {
                        updateAudio(story, onChange, { musicDuration: clampNumber(drag.duration + delta, 0.5, Math.max(0.5, videoDuration - drag.start)) })
                      }
                    }}
                    onPointerUp={() => { musicDragRef.current = null }}
                    className="h-full w-full cursor-grab overflow-hidden px-3 active:cursor-grabbing"
                  >
                    <span className={`absolute left-4 top-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-semibold ${audio1Muted ? 'text-[#9e9eae]' : 'text-[#00e5c9]'}`}>{fileNameFromPath(musicSrc)}</span>
                    <WaveformCanvas src={musicSrc} color={audio1Muted ? '#626272' : '#00e5c9'} className="h-full w-full pt-4" />
                  </button>
                  <button
                    data-no-seek="true"
                    aria-label="Trim music end"
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      event.currentTarget.setPointerCapture(event.pointerId)
                      musicDragRef.current = {
                        mode: 'trim-end',
                        startX: event.clientX,
                        start: musicStart,
                        duration: musicDuration,
                        totalDuration: videoDuration,
                        timelineWidth: timelineRef.current?.getBoundingClientRect().width || event.currentTarget.parentElement?.parentElement?.getBoundingClientRect().width || 1,
                      }
                    }}
                    onPointerMove={(event) => {
                      if (!musicDragRef.current) return
                      const drag = musicDragRef.current
                      const secondsPerPixel = drag.totalDuration / Math.max(1, drag.timelineWidth)
                      const delta = (event.clientX - drag.startX) * secondsPerPixel
                      updateAudio(story, onChange, { musicDuration: clampNumber(drag.duration + delta, 0.5, Math.max(0.5, videoDuration - drag.start)) })
                    }}
                    onPointerUp={() => { musicDragRef.current = null }}
                    className="absolute right-0 top-0 z-10 h-full w-3 cursor-ew-resize bg-[#00e5c9]"
                  />
                </div>
              ) : null}
            </div>
          </ProCutTrack>

          <ProCutTrack label="Audio 2" icon={<FigmaIcon name="music" size={14} />} muted={audio2Muted} locked onToggleMute={() => onToggleTrackMute('audio-2')}>
            <div className="relative h-12 overflow-hidden border border-[#2d2d37] bg-[#141419]">
              {audioSrc ? <WaveformCanvas src={audioSrc} color={audio2Muted ? '#626272' : '#00e5c9'} className={`absolute inset-y-2 rounded border bg-[#123232] transition-opacity ${audio2Muted ? 'border-[#626272] opacity-45' : 'border-[#00e5c9]'}`} style={{ left: `${voiceLeft}%`, width: `${voiceWidth}%` }} /> : null}
            </div>
          </ProCutTrack>

          {audioTracks.map((track, index) => (
            <ProCutTrack
              key={track.id}
              label={`Audio ${index + 3}`}
              icon={<FigmaIcon name="music" size={14} />}
              muted={Boolean(mutedTracks[track.id])}
              locked
              onToggleMute={() => onToggleTrackMute(track.id)}
            >
              <ProCutTimelineAudioClip
                muted={Boolean(mutedTracks[track.id])}
                scenes={scenes}
                story={story}
                timelineRef={timelineRef}
                track={track}
                trackDragRef={trackDragRef}
                videoDuration={videoDuration}
                onChange={onChange}
                onContextMenuTrack={onContextMenuTrack}
                onSeek={onSeek}
                onSelect={onSelect}
              />
            </ProCutTrack>
          ))}

          <div className="grid grid-cols-[200px_minmax(0,1fr)]">
            <button onClick={onAddTrack} className="flex h-10 items-center gap-1 border border-[#2d2d37] bg-[#17171c] px-3 text-left text-[11px] font-bold text-[#ff6200]">
              <FigmaIcon name="plus" size={12} />
              Add Track
            </button>
            <div className="flex h-10 items-center border border-[#2d2d37] bg-[#1e1e24] px-4">
              <div className="h-2 w-full rounded bg-[#111115]">
                <div className="h-2 w-[180px] rounded bg-[#3e3e4c]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function ProCutTimelineAudioClip({
  muted,
  scenes,
  story,
  timelineRef,
  track,
  trackDragRef,
  videoDuration,
  onChange,
  onContextMenuTrack,
  onSeek,
  onSelect,
}: {
  muted: boolean
  scenes: GenerateVideoScene[]
  story: GenerateVideoStory
  timelineRef: React.RefObject<HTMLDivElement | null>
  track: ProCutAudioTrack
  trackDragRef: React.MutableRefObject<{ id: string; mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; timelineWidth: number } | null>
  videoDuration: number
  onChange: (story: GenerateVideoStory) => void
  onContextMenuTrack: (event: React.MouseEvent<HTMLElement>, item: { kind: 'legacy-music' | 'track'; trackId?: string }) => void
  onSeek: (time: number) => void
  onSelect: (index: number) => void
}) {
  const src = track.src ? generateVideoMediaUrl(track.src) : ''
  const start = Number(track.start || 0)
  const duration = Number(track.duration || Math.max(0.5, videoDuration - start))
  const left = videoDuration ? (start / videoDuration) * 100 : 0
  const width = videoDuration ? Math.max(4, (duration / videoDuration) * 100) : 0
  const color = muted ? '#626272' : track.type === 'voice' ? '#86efac' : track.type === 'music' ? '#f5d0fe' : '#fde68a'
  const border = muted ? 'border-[#626272]' : track.type === 'voice' ? 'border-[#86efac]' : track.type === 'music' ? 'border-[#d8b4fe]' : 'border-[#fde68a]'
  const bg = track.type === 'voice' ? 'bg-[#123226]' : track.type === 'music' ? 'bg-[#2c1d34]' : 'bg-[#332815]'
  const seekFromLane = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-no-seek="true"]')) return
    const rect = event.currentTarget.getBoundingClientRect()
    const nextTime = ((event.clientX - rect.left) / Math.max(1, rect.width)) * videoDuration
    onSeek(nextTime)
    onSelect(sceneIndexAtTime(scenes, nextTime))
  }

  return (
    <div onClick={seekFromLane} className="relative h-12 overflow-hidden border border-[#2d2d37] bg-[#141419]">
      <div
        onContextMenu={(event) => onContextMenuTrack(event, { kind: 'track', trackId: track.id })}
        className={`absolute top-1 h-10 overflow-hidden rounded border ${border} ${bg} transition-opacity ${muted ? 'opacity-45' : ''}`}
        style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
      >
        <button
          data-no-seek="true"
          aria-label="Trim audio start"
          onPointerDown={(event) => {
            event.stopPropagation()
            event.currentTarget.setPointerCapture(event.pointerId)
            trackDragRef.current = { id: track.id, mode: 'trim-start', startX: event.clientX, start, duration, timelineWidth: timelineRef.current?.getBoundingClientRect().width || 1 }
          }}
          onPointerMove={(event) => {
            if (!trackDragRef.current) return
            const drag = trackDragRef.current
            const secondsPerPixel = videoDuration / Math.max(1, drag.timelineWidth)
            const nextStart = clampNumber(drag.start + (event.clientX - drag.startX) * secondsPerPixel, 0, drag.start + drag.duration - 0.5)
            updateAudioTrack(story, onChange, drag.id, { start: nextStart, duration: drag.duration + drag.start - nextStart })
          }}
          onPointerUp={() => { trackDragRef.current = null }}
          className="absolute left-0 top-0 z-10 h-full w-3 cursor-ew-resize bg-white/55"
        />
        <button
          data-no-seek="true"
          aria-label="Move audio clip"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            trackDragRef.current = { id: track.id, mode: 'move', startX: event.clientX, start, duration, timelineWidth: timelineRef.current?.getBoundingClientRect().width || 1 }
          }}
          onPointerMove={(event) => {
            if (!trackDragRef.current) return
            const drag = trackDragRef.current
            const secondsPerPixel = videoDuration / Math.max(1, drag.timelineWidth)
            const delta = (event.clientX - drag.startX) * secondsPerPixel
            updateAudioTrack(story, onChange, drag.id, { start: clampNumber(drag.start + delta, 0, Math.max(0, videoDuration - drag.duration)) })
          }}
          onPointerUp={() => { trackDragRef.current = null }}
          className="h-full w-full cursor-grab overflow-hidden px-4 active:cursor-grabbing"
        >
          {src ? <WaveformCanvas src={src} color={color} className="h-full w-full pt-4" /> : null}
          <span className="absolute left-4 top-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {track.type} · {start.toFixed(1)}s
          </span>
        </button>
        <input
          data-no-seek="true"
          value={track.src}
          onChange={(event) => updateAudioTrack(story, onChange, track.id, { src: event.target.value })}
          onPointerDown={(event) => event.stopPropagation()}
          placeholder={track.type === 'voice' ? 'assets/audio/voice.mp3' : 'assets/audio/demo-ambient.wav'}
          className="absolute bottom-1 left-4 right-4 z-20 h-4 rounded border border-white/15 bg-black/55 px-1.5 text-[9px] font-semibold text-white outline-none"
        />
        <button
          data-no-seek="true"
          aria-label="Trim audio end"
          onPointerDown={(event) => {
            event.stopPropagation()
            event.currentTarget.setPointerCapture(event.pointerId)
            trackDragRef.current = { id: track.id, mode: 'trim-end', startX: event.clientX, start, duration, timelineWidth: timelineRef.current?.getBoundingClientRect().width || 1 }
          }}
          onPointerMove={(event) => {
            if (!trackDragRef.current) return
            const drag = trackDragRef.current
            const secondsPerPixel = videoDuration / Math.max(1, drag.timelineWidth)
            updateAudioTrack(story, onChange, drag.id, { duration: clampNumber(drag.duration + (event.clientX - drag.startX) * secondsPerPixel, 0.5, Math.max(0.5, videoDuration - drag.start)) })
          }}
          onPointerUp={() => { trackDragRef.current = null }}
          className="absolute right-0 top-0 z-10 h-full w-3 cursor-ew-resize bg-white/55"
        />
      </div>
    </div>
  )
}

function ProCutTrack({
  children,
  icon,
  label,
  locked,
  muted,
  onToggleMute,
}: {
  children: React.ReactNode
  icon: React.ReactNode
  label: string
  locked?: boolean
  muted?: boolean
  onToggleMute?: () => void
}) {
  return (
    <div className="grid grid-cols-[200px_minmax(0,1fr)]">
      <div className="flex h-full min-h-12 items-center justify-between border border-[#2d2d37] bg-[#17171c] px-3 text-[11px] font-bold text-[#f1f1f6]">
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate">{label}</span>
        </span>
        <span className="flex items-center gap-2 text-[#626272]">
          {onToggleMute ? (
            <button
              type="button"
              aria-label={muted ? `Bật âm ${label}` : `Tắt âm ${label}`}
              title={muted ? `Bật âm ${label}` : `Tắt âm ${label}`}
              onClick={(event) => {
                event.stopPropagation()
                onToggleMute()
              }}
              className={`flex size-6 items-center justify-center rounded border transition-colors ${muted ? 'border-[#ff6200] bg-[#ff6200]/15 text-[#ffb184]' : 'border-[#2d2d37] bg-[#1e1e24] text-[#9e9eae] hover:border-[#3e3e4c] hover:text-[#f1f1f6]'}`}
            >
              {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          ) : null}
          {locked ? <FigmaIcon name="lock" size={14} /> : null}
        </span>
      </div>
      {children}
    </div>
  )
}

function normalizeVideoFrame(video?: Partial<GenerateVideoStory['video']> | null) {
  const width = clampEvenDimension(video?.width, 1080)
  const height = clampEvenDimension(video?.height, 1920)
  return { width, height }
}

function clampEvenDimension(value: unknown, fallback: number) {
  const parsed = Math.round(Number(value) || fallback)
  const clamped = clampNumber(parsed, 240, 4096)
  return clamped % 2 === 0 ? clamped : clamped + 1
}

function getStoryProjectName(story: GenerateVideoStory) {
  const title = String((story as any).title || (story as any).project_name || (story as any).projectName || '').trim()
  return title || 'cyberpunk_trailer_draft_04.prproj'
}

function fileNameFromPath(src: string) {
  const clean = String(src || '').split(/[?#]/)[0]
  return clean.split(/[\\/]/).filter(Boolean).pop() || 'untitled'
}

function formatStudioClock(seconds: number) {
  const safeSeconds = Math.max(0, seconds || 0)
  const minutes = Math.floor(safeSeconds / 60)
  const wholeSeconds = Math.floor(safeSeconds % 60)
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}`
}

function formatTimelineClock(seconds: number, fps: number) {
  const safeSeconds = Math.max(0, seconds || 0)
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const wholeSeconds = Math.floor(safeSeconds % 60)
  const frames = Math.floor((safeSeconds - Math.floor(safeSeconds)) * fps)
  return [hours, minutes, wholeSeconds, frames].map((value) => String(value).padStart(2, '0')).join(':')
}

function FrameRuler({ duration, fps, headerWidth = 78, onSeek }: { duration: number; fps: number; headerWidth?: number; onSeek: (time: number) => void }) {
  const ticks = Array.from({ length: 9 })
  return (
    <div
      className="flex h-7 cursor-pointer items-start justify-between border-b border-[#2d2d37] pr-3 text-[10px] font-medium text-[#626272]"
      style={{ marginLeft: headerWidth }}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        onSeek(((event.clientX - rect.left) / Math.max(1, rect.width)) * duration)
      }}
    >
      {ticks.map((_, index) => {
        const seconds = (duration * index) / Math.max(1, ticks.length - 1)
        return (
          <span key={index} className="relative flex h-7 min-w-[120px] items-start px-2 pt-2">
            {formatTimelineClock(seconds, fps)}
            <span className="absolute bottom-1 left-2 h-px w-[120px] bg-[#2d2d37]" />
            <span className="sr-only">{Math.round(seconds * fps)} frames</span>
          </span>
        )
      })}
    </div>
  )
}

function StudioTrack({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[70px_1fr] items-stretch gap-2">
      <div className="flex items-center justify-end text-xs font-black uppercase text-slate-500">{label}</div>
      {children}
    </div>
  )
}

export function AudioLane({
  label,
  tracks,
  story,
  videoDuration,
  timelineRef,
  trackDragRef,
  onSeek,
  onSelect,
  scenes,
  onContextMenuTrack,
  onChange,
  allowLaneSeek = true,
  stacked = false,
}: {
  label: string
  tracks: NonNullable<NonNullable<GenerateVideoStory['audio']>['tracks']>
  story: GenerateVideoStory
  videoDuration: number
  timelineRef: React.RefObject<HTMLDivElement | null>
  trackDragRef: React.MutableRefObject<{ id: string; mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; timelineWidth: number } | null>
  onSeek: (time: number) => void
  onSelect: (index: number) => void
  scenes: GenerateVideoScene[]
  onContextMenuTrack: (event: React.MouseEvent<HTMLElement>, item: { kind: 'legacy-music' | 'track'; trackId?: string }) => void
  onChange: (story: GenerateVideoStory) => void
  allowLaneSeek?: boolean
  stacked?: boolean
}) {
  const laneHeight = stacked ? Math.max(88, tracks.length * 34 + 18) : 76
  const seekFromLane = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!allowLaneSeek) return
    if ((event.target as HTMLElement).closest('[data-no-seek="true"]')) return
    const rect = event.currentTarget.getBoundingClientRect()
    const nextTime = ((event.clientX - rect.left) / Math.max(1, rect.width)) * videoDuration
    onSeek(nextTime)
    onSelect(sceneIndexAtTime(scenes, nextTime))
  }

  return (
    <StudioTrack label={label}>
      <div onClick={seekFromLane} className="relative cursor-pointer overflow-hidden rounded bg-[#111827]" style={{ height: laneHeight }}>
        {tracks.map((track, index) => {
          const src = track.src ? generateVideoMediaUrl(track.src) : ''
          const start = Number(track.start || 0)
          const duration = Number(track.duration || Math.max(0.5, videoDuration - start))
          const left = videoDuration ? (start / videoDuration) * 100 : 0
          const width = videoDuration ? Math.max(4, (duration / videoDuration) * 100) : 0
          const color = track.type === 'voice' ? '#86efac' : track.type === 'music' ? '#f5d0fe' : '#fde68a'
          const bg = track.type === 'voice' ? '#14532d' : track.type === 'music' ? '#581c87' : '#78350f'
          const top = stacked ? 8 + index * 32 : 8
          const height = stacked ? 28 : 60

          return (
            <div
              key={track.id}
              onContextMenu={(event) => onContextMenuTrack(event, { kind: 'track', trackId: track.id })}
              className="absolute overflow-hidden rounded border border-white/20 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
              style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, top, height, backgroundColor: bg, zIndex: index + 1 }}
            >
              <button
                data-no-seek="true"
                aria-label="Trim audio start"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  trackDragRef.current = { id: track.id, mode: 'trim-start', startX: event.clientX, start, duration, timelineWidth: timelineRef.current?.getBoundingClientRect().width || 1 }
                }}
                onPointerMove={(event) => {
                  if (!trackDragRef.current) return
                  const drag = trackDragRef.current
                  const secondsPerPixel = videoDuration / Math.max(1, drag.timelineWidth)
                  const nextStart = clampNumber(drag.start + (event.clientX - drag.startX) * secondsPerPixel, 0, drag.start + drag.duration - 0.5)
                  updateAudioTrack(story, onChange, drag.id, { start: nextStart, duration: drag.duration + drag.start - nextStart })
                }}
                onPointerUp={() => { trackDragRef.current = null }}
                className="absolute left-0 top-0 z-10 h-full w-3 cursor-ew-resize bg-white/70"
              />
              <button
                data-no-seek="true"
                aria-label="Move audio"
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId)
                  trackDragRef.current = { id: track.id, mode: 'move', startX: event.clientX, start, duration, timelineWidth: timelineRef.current?.getBoundingClientRect().width || 1 }
                }}
                onPointerMove={(event) => {
                  if (!trackDragRef.current) return
                  const drag = trackDragRef.current
                  const secondsPerPixel = videoDuration / Math.max(1, drag.timelineWidth)
                  const delta = (event.clientX - drag.startX) * secondsPerPixel
                  updateAudioTrack(story, onChange, drag.id, { start: clampNumber(drag.start + delta, 0, Math.max(0, videoDuration - drag.duration)) })
                }}
                onPointerUp={() => { trackDragRef.current = null }}
                className="h-full w-full cursor-grab overflow-hidden px-3 active:cursor-grabbing"
              >
                {src ? (
                  <WaveformCanvas src={src} color={color} className="h-full w-full" />
                ) : (
                  <div className="flex h-full items-center justify-center px-4 text-[10px] font-black uppercase tracking-wider text-white/70">
                    nhập audio path
                  </div>
                )}
                <span className="absolute left-4 top-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-black text-white">
                  {track.type} · {start.toFixed(1)}s - {(start + duration).toFixed(1)}s
                </span>
              </button>
              <input
                data-no-seek="true"
                value={track.src}
                onChange={(event) => updateAudioTrack(story, onChange, track.id, { src: event.target.value })}
                onPointerDown={(event) => event.stopPropagation()}
                placeholder={track.type === 'voice' ? 'assets/audio/voice-...mp3' : 'assets/audio/demo-ambient.wav'}
                className="absolute bottom-1 left-4 right-4 z-20 h-5 rounded border border-white/20 bg-black/55 px-1.5 text-[10px] font-semibold text-white outline-none"
              />
              <button
                data-no-seek="true"
                aria-label="Trim audio end"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  trackDragRef.current = { id: track.id, mode: 'trim-end', startX: event.clientX, start, duration, timelineWidth: timelineRef.current?.getBoundingClientRect().width || 1 }
                }}
                onPointerMove={(event) => {
                  if (!trackDragRef.current) return
                  const drag = trackDragRef.current
                  const secondsPerPixel = videoDuration / Math.max(1, drag.timelineWidth)
                  updateAudioTrack(story, onChange, drag.id, { duration: clampNumber(drag.duration + (event.clientX - drag.startX) * secondsPerPixel, 0.5, Math.max(0.5, videoDuration - drag.start)) })
                }}
                onPointerUp={() => { trackDragRef.current = null }}
                className="absolute right-0 top-0 z-10 h-full w-3 cursor-ew-resize bg-white/70"
              />
            </div>
          )
        })}
      </div>
    </StudioTrack>
  )
}

function WaveformCanvas({ src, color, className, style }: { src: string; color: string; className?: string; style?: React.CSSProperties }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !src) return
    let cancelled = false
    const context = canvas.getContext('2d')
    if (!context) return

    const measure = () => {
      const rect = canvas.getBoundingClientRect()
      const width = Math.max(96, Math.floor(rect.width || canvas.clientWidth || 600))
      const height = Math.max(24, Math.floor(rect.height || canvas.clientHeight || 40))
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      return { width, height }
    }

    const drawFallback = () => {
      const { width, height } = measure()
      const bars = Math.max(36, Math.floor(width / 5))
      drawWaveformBars(context, seededWaveformPeaks(src, bars), color, width, height)
    }

    drawFallback()
    const resizeObserver = new ResizeObserver(() => {
      if (!cancelled) drawFallback()
    })
    resizeObserver.observe(canvas)

    fetch(src)
      .then((response) => {
        if (!response.ok) throw new Error(`Audio fetch failed: ${response.status}`)
        return response.arrayBuffer()
      })
      .then(async (buffer) => {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
        const audioContext = new AudioContextClass()
        try {
          const decoded = await audioContext.decodeAudioData(buffer.slice(0))
          if (cancelled) return
          const { width, height } = measure()
          const bars = Math.max(36, Math.floor(width / 5))
          drawWaveformBars(context, decodedWaveformPeaks(decoded, bars), color, width, height)
        } finally {
          void audioContext.close()
        }
      })
      .catch(() => drawFallback())

    return () => {
      cancelled = true
      resizeObserver.disconnect()
    }
  }, [color, src])

  return <canvas ref={canvasRef} className={className} style={style} />
}

function drawWaveformBars(context: CanvasRenderingContext2D, peaks: number[], color: string, width: number, height: number) {
  const maxPeak = Math.max(...peaks, 0.001)
  const gap = 1
  const barWidth = Math.max(1, width / Math.max(1, peaks.length) - gap)
  context.clearRect(0, 0, width, height)
  context.fillStyle = 'rgba(255,255,255,0.055)'
  context.fillRect(0, 0, width, height)
  context.fillStyle = color
  peaks.forEach((peak, index) => {
    const normalized = clampNumber(peak / maxPeak, 0.08, 1)
    const barHeight = Math.max(3, Math.pow(normalized, 0.72) * height * 0.84)
    const x = index * (barWidth + gap)
    const y = (height - barHeight) / 2
    context.fillRect(x, y, barWidth, barHeight)
  })
}

function decodedWaveformPeaks(decoded: AudioBuffer, bars: number) {
  const peaks: number[] = []
  const channelCount = Math.max(1, Math.min(2, decoded.numberOfChannels))
  const samplesPerBar = Math.max(1, Math.floor(decoded.length / bars))
  for (let index = 0; index < bars; index += 1) {
    const start = index * samplesPerBar
    const end = Math.min(decoded.length, start + samplesPerBar)
    let sum = 0
    let count = 0
    for (let channel = 0; channel < channelCount; channel += 1) {
      const data = decoded.getChannelData(channel)
      const stride = Math.max(1, Math.floor((end - start) / 80))
      for (let cursor = start; cursor < end; cursor += stride) {
        sum += Math.abs(data[cursor] || 0)
        count += 1
      }
    }
    peaks.push(count ? sum / count : 0)
  }
  return peaks
}

function seededWaveformPeaks(seed: string, bars: number) {
  let value = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return Array.from({ length: bars }, (_, index) => {
    value = Math.imul(value ^ (value >>> 15), 2246822507)
    const random = ((value >>> 0) % 1000) / 1000
    const wave = Math.sin(index * 0.33) * 0.22 + Math.sin(index * 0.091 + 1.8) * 0.18
    return clampNumber(0.34 + random * 0.42 + wave, 0.12, 1)
  })
}

function readNumericStyleValue(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^\d.-]/g, ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function sceneVisualStyle(scene: GenerateVideoScene): React.CSSProperties {
  const scale = clampNumber(Number(scene.scale ?? 100), 10, 200) / 100
  const opacity = clampNumber(Number(scene.opacity ?? 100), 0, 100) / 100
  const positionX = clampNumber(Number(scene.position_x ?? 0), -800, 800)
  const positionY = clampNumber(Number(scene.position_y ?? 0), -800, 800)
  const rotation = clampNumber(Number(scene.rotation ?? 0), -180, 180)
  return {
    opacity,
    transform: `translate(${positionX}px, ${positionY}px) scale(${scale}) rotate(${rotation}deg)`,
    transformOrigin: 'center center',
  }
}

function SceneMediaPreview({ scene, playing, progress, time }: { scene: GenerateVideoScene; playing: boolean; progress: number; time: number }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const src = scene.image || defaultMediaForType(getSceneMediaType(scene))
  const mediaFit = getSceneMediaFit(scene)
  const effectStyle = mediaFit === 'cover' ? sceneEffectStyle(scene.effect, progress) : undefined
  const fitClass = mediaFit === 'cover' ? 'object-cover' : 'object-contain'

  useEffect(() => {
    const video = videoRef.current
    if (!video || getSceneMediaType(scene) !== 'video') return
    if (Number.isFinite(time) && Math.abs(video.currentTime - time) > 0.08) {
      video.currentTime = Math.max(0, time)
    }
    if (playing) {
      void video.play().catch(() => undefined)
    } else {
      video.pause()
    }
  }, [playing, scene, time])

  if (getSceneMediaType(scene) === 'video') {
    if (!src) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-black text-[#9e9eae]">
          <Film size={34} className="text-[#ff6200]" />
          <span className="text-xs font-bold uppercase">Video clip</span>
        </div>
      )
    }
    return (
      <video
        ref={videoRef}
        src={src}
        muted
        playsInline
        preload="metadata"
        className={`h-full w-full ${fitClass}`}
        style={effectStyle}
      />
    )
  }
  return (
    <img
      src={src}
      alt=""
      className={`h-full w-full ${fitClass}`}
      style={effectStyle}
    />
  )
}

function sceneEffectStyle(effect: string | undefined, progress: number): React.CSSProperties {
  const value = clampNumber(progress, 0, 1)
  if (effect === 'pan-right') {
    const x = -4 + value * 8
    return { transform: `scale(1.1) translateX(${x}%)`, transformOrigin: 'center center' }
  }
  if (effect === 'pan-left') {
    const x = 4 - value * 8
    return { transform: `scale(1.1) translateX(${x}%)`, transformOrigin: 'center center' }
  }
  if (effect === 'push-in') {
    return { transform: `scale(${1.04 + value * 0.08})`, transformOrigin: 'center center' }
  }
  return { transform: `scale(${1 + value * 0.1})`, transformOrigin: 'center center' }
}

function SceneMediaThumb({ scene, className }: { scene: GenerateVideoScene; className: string }) {
  const src = scene.image || defaultMediaForType(getSceneMediaType(scene))
  const fitClass = getSceneMediaFit(scene) === 'cover' ? 'object-cover' : 'object-contain'
  if (getSceneMediaType(scene) === 'video') {
    return (
      <div className={`relative overflow-hidden bg-black ${className}`}>
        {src ? <video src={src} muted playsInline preload="metadata" className={`h-full w-full ${fitClass}`} /> : null}
        <Film size={14} className="absolute left-1 top-1 text-white drop-shadow" />
      </div>
    )
  }
  return <img src={src} alt="" className={`${className} ${fitClass}`} />
}

export function updateSceneAt(story: GenerateVideoStory, scenes: GenerateVideoScene[], index: number, patch: Partial<GenerateVideoScene>, onChange: (story: GenerateVideoStory) => void) {
  const target = scenes[index]
  const textKeys = new Set(['subtitle', 'voice_text', 'role', 'evidence_ids', 'subtitle_start', 'subtitle_duration', 'text_style', 'timing'])
  onChange(updateRenderScenes(story, scenes.map((scene, currentIndex) => {
    if (currentIndex === index) return { ...scene, ...patch }
    const sharedPatch = Object.fromEntries(Object.entries(patch).filter(([key]) => textKeys.has(key)
      ? target?.text_id && target.text_id === scene.text_id
      : target?.video_id && target.video_id === scene.video_id))
    return { ...scene, ...sharedPatch }
  })))
}

export function storyTimelineScenes(story: GenerateVideoStory): GenerateVideoScene[] {
  const timeline = story.timeline || {}
  const video = timeline.video || []
  const text = timeline.text || []
  if (!video.length && (story.story_data?.length || story.scenes?.length)) {
    return story.story_data?.length ? story.story_data : story.scenes || []
  }
  if (!video.length) {
    return text.map((textClip) => {
      const start = Number(textClip.start || 0)
      const end = typeof textClip.end === 'number' ? Number(textClip.end) : start + Number(textClip.duration || 4)
      const duration = Math.max(0.1, end - start)
      return {
        scene_index: typeof textClip.scene_index === 'number' ? textClip.scene_index : undefined,
        text_id: textClip.id,
        video_id: textClip.video_id,
        video_ids: Array.isArray(textClip.video_ids) ? textClip.video_ids : textClip.video_id ? [textClip.video_id] : undefined,
        start,
        end,
        duration,
        image: defaultMediaForType('image'),
        media_type: 'image',
        effect: 'slow-zoom',
        fit: 'contain',
        subtitle: String(textClip.text || ''),
        voice_text: textClip.voice_text,
        role: textClip.role,
        evidence_ids: textClip.evidence_ids,
        subtitle_start: start,
        subtitle_duration: duration,
        text_style: textClip.style || {},
        timing: textClip.timing,
      }
    })
  }
  // One editable row per actual link, not a positional zip of unequal tracks.
  type LinkedRow = { clip: typeof video[number]; matchedTextClip?: typeof text[number]; index: number }
  const pairs = video.flatMap<LinkedRow>((clip, index) => {
    const forward = clip.text_ids || (clip.text_id ? [clip.text_id] : [])
    let matches = text.filter(item => forward.includes(item.id)
      || (item.video_ids || (item.video_id ? [item.video_id] : [])).includes(clip.id))
    if (!matches.length && !forward.length) {
      matches = text.filter(item => !item.video_ids?.length && !item.video_id
        && Math.min(item.end, clip.end) > Math.max(item.start, clip.start))
    }
    return matches.length ? matches.map(matchedTextClip => ({ clip, matchedTextClip, index }))
      : [{ clip, matchedTextClip: undefined, index }]
  })
  return pairs.map(({ clip, matchedTextClip, index }) => {
    const mediaType = normalizeSceneMediaType(clip.type, String(clip.src || ''))
    const start = typeof clip?.start === 'number'
      ? Number(clip.start)
      : typeof matchedTextClip?.start === 'number'
        ? Number(matchedTextClip.start)
        : 0
    const fallbackDuration = Number(clip?.duration || Number(clip?.end || 0) - Number(clip?.start || 0) || 4)
    const end = typeof clip?.end === 'number'
      ? Number(clip.end)
      : typeof matchedTextClip?.end === 'number'
        ? Number(matchedTextClip.end)
        : start + fallbackDuration
    const duration = Math.max(0.1, end - start)
    const subtitleStart = typeof matchedTextClip?.start === 'number' ? Number(matchedTextClip.start) : start
    const subtitleEnd = typeof matchedTextClip?.end === 'number' ? Number(matchedTextClip.end) : subtitleStart + duration
    return {
      scene_index: typeof clip.scene_index === 'number' ? clip.scene_index : typeof matchedTextClip?.scene_index === 'number' ? matchedTextClip.scene_index : index,
      video_id: clip.id,
      text_id: matchedTextClip?.id,
      video_ids: matchedTextClip ? listUnique(pairs.filter(pair => pair.matchedTextClip?.id === matchedTextClip.id).map(pair => pair.clip.id)) : undefined,
      text_ids: listUnique(pairs.filter(pair => pair.clip.id === clip.id).flatMap(pair => pair.matchedTextClip ? [pair.matchedTextClip.id] : [])),
      text_weights: clip.text_weights,
      source_media_index: clip.source_media_index,
      visual_query: clip.visual_direction,
      start,
      end,
      duration,
      image: String(clip.src || defaultMediaForType(mediaType)),
      media_type: mediaType,
      effect: String(clip.effect || 'slow-zoom'),
      fit: getSceneMediaFit(clip as Partial<GenerateVideoScene>),
      scale: typeof clip.scale === 'number' ? clip.scale : undefined,
      opacity: typeof clip.opacity === 'number' ? clip.opacity : undefined,
      position_x: typeof clip.position_x === 'number' ? clip.position_x : undefined,
      position_y: typeof clip.position_y === 'number' ? clip.position_y : undefined,
      rotation: typeof clip.rotation === 'number' ? clip.rotation : undefined,
      subtitle: String(matchedTextClip?.text || ''),
      voice_text: matchedTextClip?.voice_text,
      role: matchedTextClip?.role,
      evidence_ids: matchedTextClip?.evidence_ids,
      subtitle_start: subtitleStart,
      subtitle_duration: Math.max(0.1, subtitleEnd - subtitleStart),
      text_style: matchedTextClip?.style || {},
      timing: matchedTextClip?.timing,
    }
  })
}

function storyAudioTracks(story: GenerateVideoStory, videoDuration: number) {
  const timelineTracks = (story.timeline?.audio || []).map((clip) => ({
    id: clip.id,
    type: clip.type as 'voice' | 'music' | 'sfx',
    src: clip.src || '',
    start: Number(clip.start || 0),
    duration: typeof clip.end === 'number' ? Math.max(0.1, clip.end - Number(clip.start || 0)) : Math.max(0.1, videoDuration - Number(clip.start || 0)),
    volume: typeof clip.volume === 'number' ? clip.volume : 1,
  }))
  const merged = new Map<string, NonNullable<NonNullable<GenerateVideoStory['audio']>['tracks']>[number]>()
  timelineTracks.forEach((track) => merged.set(track.id, track))
  ;(story.audio?.tracks || []).forEach((track) => merged.set(track.id, track))
  return Array.from(merged.values())
}

function storyAudioTimeline(story: GenerateVideoStory, fallbackDuration: number) {
  const audio = story.audio || {}
  const explicitTrackIds = new Set((audio.tracks || []).map((track) => track.id))
  const clips = (story.timeline?.audio || []).filter((clip) => {
    if (clip.type === 'voice') return Boolean(audio.voice) || explicitTrackIds.has(clip.id)
    if (clip.type === 'music') return Boolean(audio.music) || explicitTrackIds.has(clip.id)
    return true
  })
  if (audio.voice && !clips.some((clip) => clip.type === 'voice' && clip.src === audio.voice)) {
    clips.push({ id: 'voice-main', type: 'voice', start: 0, end: fallbackDuration || null, src: audio.voice, volume: audio.voiceVolume ?? 1 })
  }
  if (audio.music && !clips.some((clip) => clip.type === 'music' && clip.src === audio.music)) {
    const start = Number(audio.musicStart || 0)
    const duration = Number(audio.musicDuration || Math.max(0.1, fallbackDuration - start))
    clips.push({ id: 'music-main', type: 'music', start, end: start + duration, src: audio.music, volume: audio.musicVolume ?? 0 })
  }
  ;(audio.tracks || []).forEach((track) => {
    const start = Number(track.start || 0)
    const duration = Number(track.duration || Math.max(0.1, fallbackDuration - start))
    const nextClip = {
      id: track.id,
      type: track.type,
      start,
      end: start + duration,
      src: track.src,
      volume: track.volume,
    }
    const index = clips.findIndex((clip) => clip.id === track.id)
    if (index >= 0) clips[index] = nextClip
    else clips.push(nextClip)
  })
  return clips
    .filter((clip) => clip.src)
    .map((clip) => ({
      id: clip.id,
      type: clip.type,
      start: Math.max(0, Number(clip.start || 0)),
      end: typeof clip.end === 'number' ? Math.max(Number(clip.start || 0) + 0.1, Number(clip.end)) : null,
      src: clip.src,
      volume: typeof clip.volume === 'number' ? clip.volume : 1,
    }))
}

function SceneEditor({
  story,
  scenes,
  sceneIndex,
  onSelect,
  onChange,
}: {
  story: GenerateVideoStory | null
  scenes: GenerateVideoScene[]
  sceneIndex: number
  onSelect: (index: number) => void
  onChange: (story: GenerateVideoStory, nextIndex?: number) => void
}) {
  if (!story) return null

  const updateScene = (index: number, patch: Partial<GenerateVideoScene>) => {
    const nextScenes = scenes.map((scene, currentIndex) => currentIndex === index ? { ...scene, ...patch } : scene)
    onChange(updateRenderScenes(story, nextScenes), index)
  }

  const moveScene = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= scenes.length) return
    const nextScenes = [...scenes]
    const item = nextScenes[index]
    nextScenes[index] = nextScenes[nextIndex]
    nextScenes[nextIndex] = item
    onChange(updateRenderScenes(story, nextScenes), nextIndex)
  }

  const addScene = (scene: GenerateVideoScene = emptyFrameScene()) => {
    const nextScenes = [...scenes, scene]
    onChange(updateRenderScenes(story, nextScenes), nextScenes.length - 1)
  }

  const removeScene = (index: number) => {
    const nextScenes = scenes.filter((_, currentIndex) => currentIndex !== index)
    onChange(updateRenderScenes(story, nextScenes), Math.max(0, index - 1))
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-black text-[#0f172a]">Scene editor</div>
        <div className="flex gap-2">
          <button onClick={() => addScene(emptyFrameScene())} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-xs font-semibold text-white">
            <Plus size={14} /> Frame
          </button>
          <button onClick={() => addScene(emptyVideoScene())} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#ff6200] px-3 text-xs font-semibold text-white">
            <Plus size={14} /> Video
          </button>
        </div>
      </div>

      <div className="grid gap-2">
        {scenes.map((scene, index) => (
          <div key={index} className={`grid gap-3 rounded-lg border p-2 lg:grid-cols-[150px_1fr] ${index === sceneIndex ? 'border-[#2563eb] bg-white' : 'border-slate-200 bg-white/70'}`}>
            <StorySceneMediaPreview scene={scene} index={index} onSelect={() => onSelect(index)} />
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <button onClick={() => onSelect(index)} className="h-8 w-8 rounded bg-slate-100 text-xs font-black text-slate-700">{index + 1}</button>
                <select value={getSceneMediaType(scene)} onChange={(event) => updateScene(index, { media_type: event.target.value })} className="h-8 rounded border border-slate-200 px-2 text-xs">
                  <option value="image">Frame</option>
                  <option value="video">Video</option>
                </select>
                <input value={scene.image} onChange={(event) => updateScene(index, { image: event.target.value, media_type: normalizeSceneMediaType(scene.media_type, event.target.value) })} className="h-8 min-w-0 flex-1 rounded border border-slate-200 px-2 text-xs" placeholder="Image/video URL hoặc assets path" />
                <button disabled={index === 0} onClick={() => moveScene(index, -1)} className="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white disabled:opacity-40"><ArrowUp size={14} /></button>
                <button disabled={index === scenes.length - 1} onClick={() => moveScene(index, 1)} className="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white disabled:opacity-40"><ArrowDown size={14} /></button>
                <button disabled={scenes.length <= 1} onClick={() => removeScene(index)} className="flex h-8 w-8 items-center justify-center rounded border border-red-100 bg-red-50 text-red-600 disabled:opacity-40"><Trash2 size={14} /></button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[90px_1fr_120px_180px]">
                <input type="number" min="1" step="0.5" value={scene.duration} onChange={(event) => updateScene(index, { duration: Number(event.target.value) || 4 })} className="h-8 rounded border border-slate-200 px-2 text-xs" />
                <input value={scene.subtitle} onChange={(event) => updateScene(index, { subtitle: event.target.value })} className="h-8 rounded border border-slate-200 px-2 text-xs" placeholder="Subtitle" />
                <select value={scene.effect} onChange={(event) => updateScene(index, { effect: event.target.value })} className="h-8 rounded border border-slate-200 px-2 text-xs">
                  <option value="slow-zoom">slow-zoom</option>
                  <option value="pan-right">pan-right</option>
                  <option value="pan-left">pan-left</option>
                  <option value="push-in">push-in</option>
                </select>
                <div className="grid grid-cols-[1fr_48px] gap-2">
                  <select value={getSceneMediaFit(scene)} onChange={(event) => updateScene(index, { fit: event.target.value })} className="h-8 rounded border border-slate-200 px-2 text-xs">
                    <option value="contain">Để nguyên</option>
                    <option value="cover">Làm đầy</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => onChange(updateRenderScenes(story, scenes.map((item) => ({ ...item, fit: getSceneMediaFit(scene) }))), index)}
                    className="h-8 rounded border border-slate-200 bg-white text-xs font-black text-slate-700 hover:bg-slate-50"
                  >
                    All
                  </button>
                </div>
              </div>
              <textarea
                value={scene.voice_text || ''}
                onChange={(event) => updateScene(index, { voice_text: event.target.value })}
                className="min-h-16 rounded border border-slate-200 px-2 py-1 text-xs"
                placeholder="Voice text dài hơn subtitle nếu cần giữ duration theo plan"
              />
              {scene.timing && (
                <div className="text-[11px] font-semibold text-slate-500">
                  Voice timestamp: {Number(scene.timing.start || 0).toFixed(2)}s - {Number(scene.timing.end || 0).toFixed(2)}s
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StorySceneMediaPreview({ scene, index, onSelect }: { scene: GenerateVideoScene; index: number; onSelect: () => void }) {
  const rawSrc = String(scene.image || '').trim()
  const mediaType = getSceneMediaType(scene)
  const src = rawSrc ? generateVideoMediaUrl(rawSrc) : ''
  const fitClass = getSceneMediaFit(scene) === 'cover' ? 'object-cover' : 'object-contain'

  if (!src) {
    return (
      <button onClick={onSelect} className="flex aspect-[9/16] min-h-[160px] items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-100 text-xs font-semibold text-slate-400">
        No media
      </button>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-black">
      {mediaType === 'video' ? (
        <video src={src} controls preload="metadata" className={`block aspect-[9/16] w-full bg-black ${fitClass}`} />
      ) : (
        <button onClick={onSelect} className="block w-full">
          <img src={src} alt={`Scene ${index + 1}`} className={`block aspect-[9/16] w-full bg-black ${fitClass}`} />
        </button>
      )}
    </div>
  )
}

export function updateRenderScenes(story: GenerateVideoStory, scenes: GenerateVideoScene[]): GenerateVideoStory {
  const fps = story.video?.fps || 30
  let cursor = 0
  let previousTextEnd = 0
  const visualScenes = collapseVisualScenes(scenes)
  const video = visualScenes.map((scene, index) => {
    const duration = Math.max(1 / fps, Number(scene.duration || 4))
    const start = roundToFrame(typeof scene.start === 'number' ? Math.max(0, scene.start) : cursor, fps)
    const clipEnd = roundToFrame(start + duration, fps)
    cursor = Math.max(cursor, clipEnd)
    const mediaType = getSceneMediaType(scene)
    return {
      id: scene.video_id || story.timeline?.video?.[index]?.id || `video-${index + 1}`,
      ...(typeof scene.scene_index === 'number' ? { scene_index: scene.scene_index } : { scene_index: index }),
      ...(scene.text_ids?.length ? { text_ids: scene.text_ids, text_id: scene.text_ids[0] } : {}),
      ...(scene.text_weights ? { text_weights: scene.text_weights } : {}),
      ...(typeof scene.source_media_index === 'number' ? { source_media_index: scene.source_media_index } : {}),
      ...(scene.visual_query ? { visual_direction: scene.visual_query } : {}),
      type: mediaType,
      start,
      end: clipEnd,
      duration: roundToFrame(clipEnd - start, fps),
      src: scene.image || defaultMediaForType(mediaType),
      effect: scene.effect || 'slow-zoom',
      fit: getSceneMediaFit(scene),
      ...(typeof scene.scale === 'number' ? { scale: scene.scale } : {}),
      ...(typeof scene.opacity === 'number' ? { opacity: scene.opacity } : {}),
      ...(typeof scene.position_x === 'number' ? { position_x: scene.position_x } : {}),
      ...(typeof scene.position_y === 'number' ? { position_y: scene.position_y } : {}),
      ...(typeof scene.rotation === 'number' ? { rotation: scene.rotation } : {}),
    }
  })
  const emittedTextIds = new Set<string>()
  const text = scenes.flatMap((scene, index) => {
    const subtitle = String(scene.subtitle || '').trim()
    if (!subtitle) return []
    const textKey = scene.text_id || `text-${index + 1}`
    if (emittedTextIds.has(textKey)) return []
    emittedTextIds.add(textKey)
    const linkedVideos = findLinkedVideoClips(video, scene, index)
    const fallbackStart = linkedVideos.length ? Math.min(...linkedVideos.map((clip) => Number(clip.start || 0))) : 0
    const sceneEnd = linkedVideos.length ? Math.max(...linkedVideos.map((clip) => Number(clip.end || 0))) : fallbackStart + Number(scene.duration || 1)
    const fallbackDuration = Math.max(1 / fps, sceneEnd - fallbackStart)
    const rawStart = typeof scene.subtitle_start === 'number' ? scene.subtitle_start : fallbackStart
    const rawDuration = typeof scene.subtitle_duration === 'number' ? scene.subtitle_duration : fallbackDuration
    const start = roundToFrame(clampNumber(Math.max(previousTextEnd, rawStart), fallbackStart, Math.max(fallbackStart, sceneEnd - 1 / fps)), fps)
    const end = roundToFrame(clampNumber(start + rawDuration, start + 1 / fps, sceneEnd), fps)
    previousTextEnd = end
    const videoIds = linkedVideos.map((clip) => clip.id).filter(Boolean)
    return [{
      id: textKey || story.timeline?.text?.[index]?.id || `text-${index + 1}`,
      ...(typeof scene.scene_index === 'number' ? { scene_index: scene.scene_index } : {}),
      ...(videoIds.length ? { video_ids: videoIds, video_id: videoIds[0] } : {}),
      type: 'subtitle',
      start,
      end,
      duration: roundToFrame(end - start, fps),
      text: subtitle,
      ...(scene.voice_text ? { voice_text: scene.voice_text } : {}),
      ...(scene.role ? { role: scene.role } : {}),
      ...(scene.evidence_ids ? { evidence_ids: scene.evidence_ids } : {}),
      style: scene.text_style || story.timeline?.text?.[index]?.style || {},
      ...(scene.timing ? { timing: scene.timing } : {}),
    }]
  })
  const audio = storyAudioTimeline(story, Math.max(cursor, story.timeline?.duration || 0))
  const duration = Math.max(
    cursor,
    ...text.map((clip) => clip.end),
    ...audio.map((clip) => typeof clip.end === 'number' ? clip.end : 0),
  )
  const { scenes: _legacyScenes, story_data: _legacyStoryData, ...rest } = story as GenerateVideoStory & { scenes?: GenerateVideoScene[]; story_data?: GenerateVideoScene[] }
  return {
    ...rest,
    timeline: {
      ...story.timeline,
      version: 1,
      duration: roundToFrame(duration || 1, fps),
      video,
      text,
      audio,
    },
  }
}

function collapseVisualScenes(scenes: GenerateVideoScene[]) {
  const groups = new Map<string, GenerateVideoScene>()
  const order: string[] = []
  scenes.forEach((scene, index) => {
    const key = scene.video_id || (typeof scene.scene_index === 'number' ? `scene-${scene.scene_index}` : `row-${index}`)
    const start = getSceneStart(scenes, index)
    const end = getSceneEnd(scenes, index)
    const textIds = scene.text_id ? [scene.text_id] : []
    const existing = groups.get(key)
    if (!existing) {
      order.push(key)
      groups.set(key, {
        ...scene,
        video_id: scene.video_id,
        start,
        end,
        duration: Math.max(0.1, end - start),
        text_ids: listUnique([...(scene.text_ids || []), ...textIds]),
      })
      return
    }
    const nextStart = Math.min(Number(existing.start || start), start)
    const nextEnd = Math.max(Number(existing.end || end), end)
    groups.set(key, {
      ...existing,
      start: nextStart,
      end: nextEnd,
      duration: Math.max(0.1, nextEnd - nextStart),
      text_ids: listUnique([...(existing.text_ids || []), ...(scene.text_ids || []), ...textIds]),
    })
  })
  return order.map((key) => groups.get(key)!).filter(Boolean)
}

function collapseTextScenes(scenes: GenerateVideoScene[]) {
  const groups = new Map<string, GenerateVideoScene>()
  const order: string[] = []
  scenes.forEach((scene, index) => {
    const subtitle = String(scene.subtitle || '').trim()
    if (!subtitle) return
    const key = scene.text_id || `row-${index}`
    const start = getSubtitleStart(scenes, index)
    const end = start + getSubtitleDuration(scenes, index)
    const videoIds = scene.video_id ? [scene.video_id] : []
    const existing = groups.get(key)
    if (!existing) {
      order.push(key)
      groups.set(key, {
        ...scene,
        start,
        end,
        duration: Math.max(0.1, end - start),
        subtitle_start: start,
        subtitle_duration: Math.max(0.1, end - start),
        video_ids: listUnique([...(scene.video_ids || []), ...videoIds]),
      })
      return
    }
    const nextStart = Math.min(Number(existing.subtitle_start ?? existing.start ?? start), start)
    const nextEnd = Math.max(Number(existing.end || end), end)
    groups.set(key, {
      ...existing,
      start: nextStart,
      end: nextEnd,
      duration: Math.max(0.1, nextEnd - nextStart),
      subtitle_start: nextStart,
      subtitle_duration: Math.max(0.1, nextEnd - nextStart),
      video_ids: listUnique([...(existing.video_ids || []), ...(scene.video_ids || []), ...videoIds]),
    })
  })
  return order.map((key) => groups.get(key)!).filter(Boolean)
}

function findLinkedVideoClips(
  video: NonNullable<NonNullable<GenerateVideoStory['timeline']>['video']>,
  scene: GenerateVideoScene,
  fallbackIndex: number,
) {
  const ids = listUnique([...(scene.video_ids || []), ...(scene.video_id ? [scene.video_id] : [])])
  const byIds = ids.length ? video.filter((clip) => ids.includes(clip.id)) : []
  if (byIds.length) return byIds
  const byScene = typeof scene.scene_index === 'number' ? video.filter((clip) => clip.scene_index === scene.scene_index) : []
  if (byScene.length) return byScene
  return video[fallbackIndex] ? [video[fallbackIndex]] : []
}

function findSceneIndexForVisual(scenes: GenerateVideoScene[], visual: GenerateVideoScene, fallbackIndex: number) {
  const index = scenes.findIndex((scene) => {
    if (visual.video_id && scene.video_id === visual.video_id) return true
    if (typeof visual.scene_index === 'number' && scene.scene_index === visual.scene_index) return true
    return false
  })
  return index >= 0 ? index : Math.min(fallbackIndex, Math.max(0, scenes.length - 1))
}

function findSceneIndexForText(scenes: GenerateVideoScene[], textScene: GenerateVideoScene, fallbackIndex: number) {
  const index = scenes.findIndex((scene) => {
    if (textScene.text_id && scene.text_id === textScene.text_id) return true
    if (typeof textScene.scene_index === 'number' && scene.scene_index === textScene.scene_index) return true
    return false
  })
  return index >= 0 ? index : Math.min(fallbackIndex, Math.max(0, scenes.length - 1))
}

function listUnique<T>(items: T[]) {
  return Array.from(new Set(items.filter(Boolean)))
}

function sceneStartTime(scenes: GenerateVideoScene[], index: number) {
  return scenes.slice(0, Math.max(0, index)).reduce((total, scene) => total + Number(scene.duration || 0), 0)
}

function getSceneStart(scenes: GenerateVideoScene[], index: number) {
  const value = scenes[index]?.start
  return typeof value === 'number' ? Math.max(0, value) : sceneStartTime(scenes, index)
}

function getSceneEnd(scenes: GenerateVideoScene[], index: number) {
  const scene = scenes[index]
  if (!scene) return 0
  if (typeof scene.end === 'number') return Math.max(getSceneStart(scenes, index), scene.end)
  return getSceneStart(scenes, index) + Number(scene.duration || 0)
}

export function storyTimelineDuration(story: GenerateVideoStory, scenes: GenerateVideoScene[]) {
  return Math.max(
    Number(story.timeline?.duration || 0),
    ...scenes.map((_, index) => getSceneEnd(scenes, index)),
    0,
  )
}

function getSubtitleStart(scenes: GenerateVideoScene[], index: number) {
  const scene = scenes[index] as any
  const value = scene?.subtitle_start ?? scene?.subtitleStart
  return typeof value === 'number' ? value : getSceneStart(scenes, index)
}

function getSubtitleDuration(scenes: GenerateVideoScene[], index: number) {
  const scene = scenes[index] as any
  const value = scene?.subtitle_duration ?? scene?.subtitleDuration
  return typeof value === 'number' ? Math.max(0.1, value) : Number(scenes[index]?.duration || 0.1)
}

function activeSubtitleSceneIndexAtTime(scenes: GenerateVideoScene[], time: number) {
  return scenes.findIndex((scene, index) => {
    const subtitle = String(scene.subtitle || '').trim()
    if (!subtitle) return false
    const start = getSubtitleStart(scenes, index)
    const duration = getSubtitleDuration(scenes, index)
    return time >= start && time <= start + duration
  })
}

function sceneIndexAtTime(scenes: GenerateVideoScene[], time: number) {
  for (let index = 0; index < scenes.length; index += 1) {
    if (time >= getSceneStart(scenes, index) && time < getSceneEnd(scenes, index)) return index
  }
  const nextIndex = scenes.findIndex((_, index) => time < getSceneStart(scenes, index))
  if (nextIndex >= 0) return nextIndex
  return Math.max(0, scenes.length - 1)
}

function updateAudio(story: GenerateVideoStory, onChange: (story: GenerateVideoStory) => void, patch: NonNullable<GenerateVideoStory['audio']>) {
  const nextStory = { ...story, audio: { ...(story.audio || {}), ...patch } }
  const duration = storyTimelineDuration(story, storyTimelineScenes(story))
  onChange({
    ...nextStory,
    timeline: {
      ...(story.timeline || {}),
      audio: storyAudioTimeline(nextStory, duration),
    },
  })
}

function updateAudioTrack(
  story: GenerateVideoStory,
  onChange: (story: GenerateVideoStory) => void,
  trackId: string,
  patch: Partial<{
    id: string
    type: 'voice' | 'music' | 'sfx'
    src: string
    start: number
    duration?: number
    volume: number
  }>,
) {
  const videoDuration = storyTimelineDuration(story, storyTimelineScenes(story))
  const tracks = storyAudioTracks(story, videoDuration)
  updateAudio(story, onChange, {
    tracks: tracks.map((track) => track.id === trackId ? { ...track, ...patch } : track),
  })
}

function removeAudioTrack(story: GenerateVideoStory, onChange: (story: GenerateVideoStory) => void, trackId: string) {
  const videoDuration = storyTimelineDuration(story, storyTimelineScenes(story))
  const tracks = storyAudioTracks(story, videoDuration).filter((track) => track.id !== trackId)
  const nextTimelineAudio = (story.timeline?.audio || []).filter((clip) => clip.id !== trackId)
  const removed = story.timeline?.audio?.find((clip) => clip.id === trackId)
  onChange({
    ...story,
    audio: {
      ...(story.audio || {}),
      ...(removed?.type === 'voice' ? { voice: '' } : {}),
      ...(removed?.type === 'music' ? { music: '', musicStart: 0, musicDuration: 0 } : {}),
      tracks,
    },
    timeline: { ...(story.timeline || {}), audio: nextTimelineAudio },
  })
}

function emptyScene(): GenerateVideoScene {
  return emptyFrameScene()
}

function emptyFrameScene(): GenerateVideoScene {
  return {
    duration: 4,
    image: 'assets/images/001-signal-room.png',
    media_type: 'image',
    fit: 'contain',
    effect: 'slow-zoom',
    subtitle: '',
  }
}

function emptyVideoScene(): GenerateVideoScene {
  return {
    duration: 4,
    image: '',
    media_type: 'video',
    fit: 'contain',
    effect: 'none',
    subtitle: '',
  }
}

function getSceneMediaType(scene?: Partial<GenerateVideoScene> | null) {
  return normalizeSceneMediaType(scene?.media_type, scene?.image)
}

function getSceneMediaFit(scene?: Partial<GenerateVideoScene> | null): 'cover' | 'contain' {
  return scene?.fit === 'cover' ? 'cover' : 'contain'
}

function normalizeSceneMediaType(value?: string | null, src?: string | null): 'image' | 'video' {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'video') return 'video'
  if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(String(src || ''))) return 'video'
  return 'image'
}

function defaultMediaForType(type: 'image' | 'video') {
  return type === 'video' ? '' : 'assets/images/001-signal-room.png'
}

function readApiError(error: any, fallback: string) {
  const detail = error?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail) && detail.length) return detail.map((item) => item?.msg || String(item)).join(', ')
  if (error?.response?.status === 401) return 'Bạn cần đăng nhập lại để xem workflow này.'
  if (error?.response?.status === 403) return 'Tài khoản hiện tại không có quyền xem workflow này.'
  if (error?.response?.status === 404) return 'Không tìm thấy video workflow này hoặc workflow thuộc user khác.'
  return error?.message || fallback
}

function progressFromJob(workflowId: string, job: GenerateVideoJob): VideoWorkflowProgress {
  const task = {
    id: job.id,
    workflow_id: workflowId,
    task_type: job.run_type || job.task_type || '',
    status: job.status,
    current_stage: job.current_stage,
    progress_percent: Number(job.progress_percent || 0),
    error_message: job.error_message,
    created_at: job.created_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
  }
  return {
    workflow_id: workflowId,
    status: job.status,
    current_stage: job.current_stage,
    progress_percent: Number(job.progress_percent || 0),
    tasks: [task],
  }
}

function workflowProgressFromDetail(workflow: VideoWorkspaceDetail): VideoWorkflowProgress {
  return {
    workflow_id: workflow.id,
    status: workflow.status,
    current_stage: workflow.current_stage,
    progress_percent: workflow.progress_percent,
    tasks: workflow.tasks,
    final_video: workflow.final_video,
    updated_at: workflow.updated_at,
  }
}

function activeProgressTask(progress: VideoWorkflowProgress | null) {
  return progress?.tasks.find((task) => ['PENDING', 'RUNNING', 'PROCESSING'].includes(task.status)) || null
}

function workflowStory(workflow: VideoWorkspaceDetail | null): GenerateVideoStory | null {
  if (!workflow?.draft) return null
  const draft = workflow.draft
  if (!draft.timeline && !draft.story_data?.length && !draft.scenes?.length) return null
  return normalizeStoryResponse({
    ...draft,
    meta: { ...(draft.meta || {}), workflow_id: workflow.id },
  })
}

function inferProjectStatus(workflow: VideoWorkspaceDetail | null, story: GenerateVideoStory | null) {
  if (workflow?.current_stage === 'DRAFT_REVIEW_REQUIRED') return 'CẦN DUYỆT DRAFT'
  const projectStatus = workflow?.status || ''
  if (projectStatus) return projectStatus
  if (getWorkflowArtifacts(workflow)?.final) return 'RENDERED'
  if (story?.audio?.voice) return 'VOICE_READY'
  if (story) return 'EDITING'
  return 'READY'
}

function inferActiveStepFromProject(workflow: VideoWorkspaceDetail | null, story: GenerateVideoStory | null): StepId {
  const artifacts = getWorkflowArtifacts(workflow)
  if (artifacts?.final && story) return 'preview'
  return 'video'
}

function getWorkflowArtifacts(workflow: VideoWorkspaceDetail | null) {
  return workflow?.final_video ? { final: workflow.final_video } : null
}

function roundToFrame(value: number, fps: number) {
  return Math.max(0, Math.round(value * fps) / fps)
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function normalizeColorValue(value: string) {
  const trimmed = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed.slice(1).split('').map((item) => item + item).join('')}`
  }
  return '#05070b'
}
