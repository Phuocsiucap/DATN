import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Clapperboard, Download, Film, Image as ImageIcon, Mic2, Plus, Save, ShieldCheck, Trash2, Volume2, VolumeX, Wand2, X } from 'lucide-react'
import {
  approveGenerateVideoProjectApi,
  createGenerateVideoStoryFromProjectApi,
  editGenerateVideoStoryWithAiApi,
  fetchGenerateVideoSavedStoryApi,
  fitGenerateVideoFramesApi,
  fetchGenerateVideoJobApi,
  generateFinalVideoApi,
  generateVideoVoiceApi,
  generateVideoMediaUrl,
  generateVideoOutputUrl,
  queueGenerateVideoProjectApi,
  reviewGenerateVideoStoryWithAiApi,
  saveGenerateVideoStoryApi,
  uploadGenerateVideoAudioApi,
  type GenerateVideoScene,
  type GenerateVideoStory,
  type GenerateVideoVoiceProvider,
} from '@/commons/apis/generateVideo'
import { fetchContentProjectApi, type ContentProject } from '@/commons/apis/planning'

type StepId = 'story' | 'video' | 'preview'

const defaultVoiceId = 'pNInz6obpgDQGcFmaJgB'
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
  { id: 'story', label: 'Kịch bản', icon: <ImageIcon size={16} /> },
  { id: 'video', label: 'Generate video', icon: <Clapperboard size={16} /> },
  { id: 'preview', label: 'Export MP4', icon: <Clapperboard size={16} /> },
]

type VideoProductionWorkspaceProps = {
  projectId: string
  onBackToList: () => void
}

export default function VideoProductionWorkspace({ projectId, onBackToList }: VideoProductionWorkspaceProps) {
  const [selectedId, setSelectedId] = useState('')
  const [selectedProject, setSelectedProject] = useState<ContentProject | null>(null)
  const [story, setStory] = useState<GenerateVideoStory | null>(null)
  const [previewStory, setPreviewStory] = useState<GenerateVideoStory | null>(null)
  const [storyText, setStoryText] = useState('')
  const [storySceneIndex, setStorySceneIndex] = useState(0)
  const [editPrompt, setEditPrompt] = useState('')
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [exportedVideoUrl, setExportedVideoUrl] = useState('')
  const [activeStep, setActiveStep] = useState<StepId>('story')
  const [voiceId] = useState(defaultVoiceId)
  const [voiceSpeed] = useState(1)
  const [voiceProvider, setVoiceProvider] = useState<GenerateVideoVoiceProvider>('elevenlabs')
  const [status, setStatus] = useState('Sẵn sàng')
  const [loadError, setLoadError] = useState('')
  const [storyLoadError, setStoryLoadError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [audioVersion, setAudioVersion] = useState(Date.now())
  const [previewVersion, setPreviewVersion] = useState(0)
  const createStoryBusyRef = useRef(false)
  const actionLocksRef = useRef<Record<string, boolean>>({})
  const activeStory = story || previewStory
  const hasStoryInput = Boolean(activeStory || storyText.trim())
  const canRenderMp4 = Boolean(activeStory || storyText.trim())

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
    setStory(null)
    setPreviewStory(null)
    setStoryText('')
    setExportedVideoUrl('')
    setLoadError('')
    setStoryLoadError('')
    setActiveStep('story')
    setStatus('Đang tải video project...')
    void loadInitial()
  }, [projectId])

  const totalDuration = useMemo(() => {
    if (!story) return 0
    const scenes = storyTimelineScenes(story)
    return storyTimelineDuration(story, scenes)
  }, [story])

  const audioSrc = previewStory?.audio?.voice
    ? `${generateVideoMediaUrl(previewStory.audio.voice)}?v=${audioVersion}`
    : ''
  const editSourceContent = (selectedProject?.source_content || (selectedProject?.metadata?.source_content as Record<string, any> | undefined) || selectedProject?.metadata || {}) as Record<string, any>
  const loadInitial = async () => {
    setBusy('load')
    try {
      setSelectedId(projectId)
      await loadProjectById(projectId)
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

  const loadProjectById = async (projectId: string, options: { openSavedStory?: boolean } = {}) => {
    setBusy('load-project')
    try {
      setLoadError('')
      setStoryLoadError('')
      const project = await fetchContentProjectApi(projectId)
      setSelectedProject(project)
      setSelectedId(projectId)
      const artifacts = getProjectArtifacts(project)
      setExportedVideoUrl(artifacts?.final ? generateVideoOutputUrl(String(artifacts.final)) : '')
      window.history.replaceState({ projectId }, '', `/generate-video/${encodeURIComponent(projectId)}`)
      if (!project.video_draft_id) {
        setStory(null)
        setPreviewStory(null)
        setStoryText('')
        setStoryLoadError('')
        setActiveStep('story')
        setStatus('Đã tải content project. Bấm Create story để tạo kịch bản video.')
        return
      }
      try {
        const savedStory = await fetchGenerateVideoSavedStoryApi(project.id)
        updateStory(savedStory)
        setPreviewStory(savedStory)
        setPreviewVersion(Date.now())
        setActiveStep(options.openSavedStory ? inferActiveStepFromProject(project, savedStory) : 'story')
        setStatus('Đã tải content project, kịch bản và nội dung bài đã normalize')
      } catch (error: any) {
        setStory(null)
        setPreviewStory(null)
        setStoryText('')
        setStoryLoadError(readApiError(error, 'Chưa có story đã lưu cho project này.'))
        setActiveStep('story')
        setStatus('Đã tải content project. Bấm Create story để tạo kịch bản video.')
      }
    } catch (error: any) {
      const message = readApiError(error, 'Không tải được video project')
      setLoadError(message)
      setStatus(message)
    } finally {
      setBusy(null)
    }
  }

  const createStory = async () => {
    if (createStoryBusyRef.current) return
    createStoryBusyRef.current = true
    setBusy('story')
    try {
      const result = await createGenerateVideoStoryFromProjectApi(selectedId)
      setStatus(`Đã đưa vào hàng đợi tạo kịch bản (${result.job.id.slice(0, 8)})`)
      const completedJob = await waitForGenerateVideoJob(result.job.id, (job) => {
        setStatus(`Đang tạo kịch bản: ${job.status} · ${Math.round(Number(job.progress_percent || 0))}%`)
      }, 5 * 60 * 1000)
      if (completedJob.status === 'FAILED') {
        throw new Error(completedJob.error_message || 'Script job failed')
      }
      const nextStory = completedJob.story || await fetchGenerateVideoSavedStoryApi(selectedId)
      nextStory.meta = { ...(nextStory.meta || {}), project_id: selectedId }
      updateStory(nextStory)
      setPreviewStory(nextStory)
      setActiveStep('story')
      setStatus('Đã tạo kịch bản từ content project')
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không tạo được story')
    } finally {
      createStoryBusyRef.current = false
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
      const review = result.story.meta?.ai_story_review
      setStatus(review?.action === 'REVISED' ? 'Đã lưu. AI reviewer đã sửa story_data cho khớp kịch bản.' : 'Đã lưu. AI reviewer đã duyệt story_data.')
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
      const result = await editGenerateVideoStoryWithAiApi(parsed, editPrompt.trim())
      updateStory(result)
      setActiveStep('story')
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
      const result = await reviewGenerateVideoStoryWithAiApi(parsed, 'Duyệt story_data trước khi tạo voice hoặc render video.')
      updateStory(result.story)
      setPreviewStory(result.story)
      setPreviewVersion(Date.now())
      const review = result.review || result.story.meta?.ai_story_review
      setStatus(review?.action === 'REVISED'
        ? 'AI reviewer đã sửa story_data để khớp kịch bản và nguồn. Hãy tạo lại voice nếu voice cũ bị bỏ.'
        : 'AI reviewer đã duyệt story_data, có thể tiếp tục tạo voice/render.')
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không duyệt được story bằng AI')
    } finally {
      endAction('review-story')
      setBusy(null)
    }
  }

  const generateVoice = async () => {
    if (!beginAction('voice')) return
    setBusy('voice')
    try {
      const parsed = currentStoryForAction()
      const saved = await saveGenerateVideoStoryApi(parsed)
      const result = await generateVideoVoiceApi(saved.story, voiceId, voiceSpeed, voiceProvider)
      const nextStory = { ...saved.story, meta: result.meta || saved.story.meta, audio: result.audio || saved.story.audio, timeline: result.timeline || saved.story.timeline }
      updateStory(nextStory)
      setPreviewStory(nextStory)
      setAudioVersion(Date.now())
      setPreviewVersion(Date.now())
      setActiveStep('video')
      const voiceLabel = voiceProviderOptions.find((option) => option.value === (result.voice_provider || voiceProvider))?.label || result.voice_id
      setStatus(result.fit_frame_error
        ? `Đã tạo voice (${voiceLabel}, ${result.voice_speed}x) nhưng fit frame lỗi: ${result.fit_frame_error}`
        : `Đã tạo voice và fit frame bằng Whisper-1 (${voiceLabel}, ${result.voice_speed}x)`)
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không tạo được voice')
    } finally {
      endAction('voice')
      setBusy(null)
    }
  }

  const fitFrames = async () => {
    if (!beginAction('fit')) return
    setBusy('fit')
    try {
      const parsed = currentStoryForAction()
      const saved = await saveGenerateVideoStoryApi(parsed)
      const result = await fitGenerateVideoFramesApi(saved.story)
      const nextStory = { ...saved.story, meta: result.meta || saved.story.meta, audio: result.audio || saved.story.audio, timeline: result.timeline || saved.story.timeline }
      updateStory(nextStory)
      setPreviewStory(nextStory)
      setPreviewVersion(Date.now())
      setActiveStep('video')
      setStatus('Đã fit frame bằng Whisper-1, preview audio đã cập nhật theo duration mới')
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không fit được frame')
    } finally {
      endAction('fit')
      setBusy(null)
    }
  }

  const exportVideo = async () => {
    if (!beginAction('export-video')) return
    setBusy('export-video')
    try {
      const parsed = currentStoryForAction()
      const saved = await saveGenerateVideoStoryApi(parsed)
      const result = await generateFinalVideoApi(saved.story)
      setActiveStep('preview')
      setStatus(`Đã đưa vào hàng đợi render (${result.job.id.slice(0, 8)})`)
      const completedJob = await waitForGenerateVideoJob(result.job.id, (job) => {
        setStatus(`Đang render MP4: ${job.status} · ${Math.round(Number(job.progress_percent || 0))}%`)
      }, 10 * 60 * 1000)
      if (completedJob.status === 'FAILED') {
        throw new Error(completedJob.error_message || 'Render job failed')
      }
      if (completedJob.story) {
        updateStory(completedJob.story)
        setPreviewStory(completedJob.story)
      }
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

  const approveVideo = async () => {
    if (!selectedId) return
    if (!beginAction('approve-video')) return
    setBusy('approve-video')
    try {
      await approveGenerateVideoProjectApi(selectedId)
      await loadProjectById(selectedId)
      setActiveStep('preview')
      setStatus('Đã duyệt video. Video có thể đưa vào queue đăng bài.')
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không duyệt được video')
    } finally {
      endAction('approve-video')
      setBusy(null)
    }
  }

  const queueVideo = async () => {
    if (!selectedId) return
    if (!beginAction('queue-video')) return
    setBusy('queue-video')
    try {
      await queueGenerateVideoProjectApi(selectedId)
      await loadProjectById(selectedId)
      setActiveStep('preview')
      setStatus('Đã đưa video vào queue đăng bài. Kiểm tra ở Duyệt Queue hoặc Lịch đăng.')
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không đưa được video vào queue')
    } finally {
      endAction('queue-video')
      setBusy(null)
    }
  }

  return (
    <div className="workspace-page">
      <div className="workspace-header">
        <div>
          <h1 className="workspace-title">{selectedProject?.title || 'Generate Video · Video Detail'}</h1>
          <p className="workspace-subtitle">
            {selectedProject
              ? `Project ${selectedProject.id.slice(0, 8)} · ${selectedProject.status || inferProjectStatus(selectedProject, story)}`
              : 'Xử lý pipeline cho một video project từ Module 2 đến MP4 hoàn chỉnh.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onBackToList} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700">
            <ArrowLeft size={14} /> Danh sách
          </button>
          <button onClick={() => void loadInitial()} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700">
            Reload
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {steps.map((step, index) => {
          const active = activeStep === step.id
          return (
            <button
              key={step.id}
              onClick={() => setActiveStep(step.id)}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs font-bold transition ${active ? 'border-[#2563eb] bg-[#eff6ff] text-[#1d4ed8]' : 'border-slate-200 bg-white text-slate-600'}`}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded bg-slate-100">{step.icon}</span>
              <span>{index + 1}. {step.label}</span>
            </button>
          )
        })}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
        {busy ? 'Đang xử lý...' : status}
      </div>

      {loadError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {loadError}
        </div>
      ) : (
        <ProjectHealthSummary
          project={selectedProject}
          story={story}
          storyLoadError={storyLoadError}
          totalDuration={totalDuration}
        />
      )}

      <div className="grid gap-4">
        {activeStep === 'story' && (
          <Panel title="1. Kịch bản & nội dung bài">
            <div className="flex flex-wrap gap-2">
              <button disabled={!selectedId || Boolean(busy)} onClick={() => void createStory()} className="h-8 rounded-md bg-[var(--accent)] px-3 text-xs font-semibold text-white disabled:opacity-50">
                Create story
              </button>
              <button disabled={!hasStoryInput || Boolean(busy)} onClick={() => setShowEditDialog(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 text-xs font-semibold text-white disabled:opacity-50">
                <Wand2 size={14} /> Edit with AI
              </button>
              <button disabled={!hasStoryInput || Boolean(busy)} onClick={() => void reviewStoryWithAi()} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#0f766e] px-3 text-xs font-semibold text-white disabled:opacity-50">
                <ShieldCheck size={14} /> AI review story
              </button>
              <button disabled={!hasStoryInput || Boolean(busy)} onClick={() => void saveStory()} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-50">
                <Save size={14} /> Save project
              </button>
            </div>
            <div className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
              <StoryDataEditor
                story={story}
                sceneIndex={storySceneIndex}
                onSelectScene={setStorySceneIndex}
                onChange={(nextStory, nextIndex) => {
                  updateStory(nextStory)
                  if (typeof nextIndex === 'number') setStorySceneIndex(nextIndex)
                }}
              />
              <SourceContentPreview source={editSourceContent} />
            </div>
          </Panel>
        )}
      </div>

      {showEditDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4">
          <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <div className="text-base font-black text-[#0f172a]">Edit story with AI</div>
                <div className="mt-1 text-xs font-semibold text-slate-500">Nhập yêu cầu chỉnh sửa cho story data hiện tại.</div>
              </div>
              <button onClick={() => setShowEditDialog(false)} className="icon-button border border-slate-200 bg-white text-slate-600">
                <X size={16} />
              </button>
            </div>
            <div className="grid flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="grid content-start gap-3">
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
                  <button disabled={!editPrompt.trim() || Boolean(busy)} onClick={() => void editStoryWithAi()} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-xs font-semibold text-white disabled:opacity-50">
                    <Wand2 size={14} /> Submit
                  </button>
                </div>
              </div>
              <SourceContentPreview source={editSourceContent} />
            </div>
          </div>
        </div>
      )}

      {activeStep === 'video' && (
        <StoryVisualPreview
          story={previewStory || story}
          version={previewVersion}
          audioSrc={audioSrc}
          saving={busy === 'save'}
          exporting={busy === 'export-video'}
          voiceGenerating={busy === 'voice'}
          voiceProvider={voiceProvider}
          fitting={busy === 'fit'}
          onSave={() => void saveStory()}
          onExport={() => void exportVideo()}
          onGenerateVoice={() => void generateVoice()}
          onVoiceProviderChange={setVoiceProvider}
          onFitFrames={() => void fitFrames()}
          onExit={() => setActiveStep('story')}
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
                <button disabled={!canRenderMp4 || busy === 'export-video'} onClick={() => void exportVideo()} className="h-8 w-full rounded-md bg-[var(--error)] px-3 text-xs font-semibold text-white disabled:opacity-50">
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
                    <button disabled={Boolean(busy)} onClick={() => void approveVideo()} className="h-8 rounded-md bg-[var(--success)] px-3 text-xs font-semibold text-white disabled:opacity-50">
                      Duyệt video
                    </button>
                    <button disabled={Boolean(busy)} onClick={() => void queueVideo()} className="h-8 rounded-md bg-[var(--accent)] px-3 text-xs font-semibold text-white disabled:opacity-50">
                      Đưa vào queue đăng
                    </button>
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

function ProjectHealthSummary({
  project,
  story,
  storyLoadError,
  totalDuration,
}: {
  project: ContentProject | null
  story: GenerateVideoStory | null
  storyLoadError: string
  totalDuration: number
}) {
  const artifacts = getProjectArtifacts(project)
  const timeline = project?.metadata?.timeline as Record<string, any> | undefined
  const timelineDuration = Number(story?.timeline?.duration || timeline?.duration || totalDuration || 0)
  const savedStoryState = story
    ? 'Đã có story/timeline'
    : storyLoadError
      ? 'Chưa có story đã lưu'
      : 'Đang kiểm tra story'
  const projectStatus = inferProjectStatus(project, story)

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <HealthCard label="Project" value={project ? projectStatus : 'Đang tải'} tone={project ? 'blue' : 'muted'} />
      <HealthCard label="Project sources" value={project?.sources?.length ? `${project.sources.length} source` : 'Chưa có source'} tone={project?.sources?.length ? 'green' : 'muted'} />
      <HealthCard label="Story data" value={savedStoryState} tone={story ? 'green' : storyLoadError ? 'amber' : 'muted'} />
      <HealthCard label="Duration / Output" value={`${timelineDuration.toFixed(2)}s · ${artifacts?.final ? 'Có MP4' : 'Chưa render'}`} tone={artifacts?.final ? 'green' : 'muted'} />
    </div>
  )
}

function HealthCard({ label, value, tone }: { label: string; value: string; tone: 'blue' | 'green' | 'amber' | 'muted' }) {
  const toneClass = {
    blue: 'border-blue-200 bg-blue-50 text-blue-800',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    muted: 'border-slate-200 bg-white text-slate-700',
  }[tone]
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="text-[11px] font-black uppercase text-current opacity-70">{label}</div>
      <div className="mt-1 text-sm font-black">{value}</div>
    </div>
  )
}

function SourceContentPreview({ source }: { source: Record<string, any> }) {
  const mediaItems = Array.isArray(source.media) ? source.media : []
  const sourceUrl = source.source_url || source.canonical_url
  const text = source.full_text || source.summary || ''

  return (
    <div className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div>
        <div className="text-xs font-black uppercase tracking-wider text-slate-500">Bài gốc</div>
        <div className="mt-1 text-sm font-black leading-snug text-[#0f172a]">{source.canonical_title || source.title || 'Chưa có tiêu đề'}</div>
        {sourceUrl && (
          <a href={sourceUrl} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs font-bold text-[#2563eb]">
            {sourceUrl}
          </a>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-xs font-black uppercase tracking-wider text-slate-500">Media ({mediaItems.length})</div>
        </div>
        {mediaItems.length === 0 ? (
          <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm font-semibold text-slate-400">
            Không có ảnh/video trong bài
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {mediaItems.map((item: Record<string, any>, index: number) => (
              <SourceMediaItem key={item.id || index} item={item} index={index} />
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">Nội dung</div>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-700">
          {text ? text.split(/\n+/).filter(Boolean).slice(0, 12).map((paragraph: string, index: number) => (
            <p key={index} className="mb-2 last:mb-0">{paragraph}</p>
          )) : <span className="text-slate-400">Chưa có nội dung text.</span>}
        </div>
      </div>
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
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      {mediaUrlValue && isVideo ? (
        <video src={mediaUrlValue} poster={item.thumbnail_url || undefined} controls className="aspect-video w-full bg-black object-contain" />
      ) : previewUrl && isImage ? (
        <a href={mediaUrlValue || previewUrl} target="_blank" rel="noreferrer">
          <img src={previewUrl} alt={`media-${index + 1}`} className="aspect-video w-full object-cover" />
        </a>
      ) : mediaUrlValue ? (
        <a href={mediaUrlValue} target="_blank" rel="noreferrer" className="flex aspect-video items-center justify-center px-3 text-center text-xs font-bold text-[#2563eb]">
          Mở media
        </a>
      ) : (
        <div className="flex aspect-video items-center justify-center text-xs font-semibold text-slate-400">Không có URL media</div>
      )}
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] font-bold text-slate-500">
        <span className="uppercase">{mediaType || mimeType || 'MEDIA'}</span>
        {mediaUrlValue && <a href={mediaUrlValue} target="_blank" rel="noreferrer" className="truncate text-[#2563eb]">Open</a>}
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
const videoAspectPresets = [
  { label: '9:16', width: 1080, height: 1920 },
  { label: '3:4', width: 1080, height: 1440 },
  { label: '4:5', width: 1080, height: 1350 },
  { label: '1:1', width: 1080, height: 1080 },
  { label: '16:9', width: 1920, height: 1080 },
]
const fpsPresets = [15, 24, 25, 30, 50, 60]
const backgroundPresets = ['#05070b', '#000000', '#ffffff', '#f8fafc', '#111827', '#ef4444', '#2563eb', '#16a34a', '#ff6200']

function StoryDataEditor({
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
              <span>{meta.ai_story_review.action === 'REVISED' ? 'AI reviewer đã sửa story_data' : 'AI reviewer đã duyệt story_data'}</span>
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
              <Field label="Project ID"><input value={meta.project_id || ''} onChange={(event) => updateMeta('project_id', event.target.value)} className={inputClass} /></Field>
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
  onChange,
}: {
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
    setPlaying(Boolean(scenes.length))
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
      void audio.play().catch(() => setPlaying(false))
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
    if (!playing && audioRef.current) {
      audioRef.current.currentTime = Math.max(0, (currentTime >= videoDuration ? 0 : currentTime) - mainVoiceStart)
    }
    setPlaying((value) => !value)
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
  const previewMaxHeight = isFullscreen ? 365 : 270
  const previewMaxWidth = Math.min(isFullscreen ? 650 : 520, Math.round(previewMaxHeight * frameAspect))
  const previewStage = (
    <div
      className="relative mx-auto w-full overflow-hidden rounded-lg bg-slate-950"
      style={{
        aspectRatio: `${frameSize.width} / ${frameSize.height}`,
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
  onToggleFullscreen,
  onToggleTrackMute,
  saving,
  exporting,
  voiceGenerating,
  voiceProvider,
  fitting,
  onChange,
}: {
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
    const sceneStart = getSceneStart(scenes, index)
    const sceneEnd = getSceneEnd(scenes, index)
    const previousEnd = index > 0 ? getSubtitleStart(scenes, index - 1) + getSubtitleDuration(scenes, index - 1) : 0
    const nextStart = index < scenes.length - 1 ? getSubtitleStart(scenes, index + 1) : videoDuration
    const minStart = Math.max(sceneStart, previousEnd)
    const maxEnd = Math.max(minStart + 0.1, Math.min(sceneEnd, nextStart))
    const nextStartValue = clampNumber(start, minStart, Math.max(minStart, maxEnd - 0.1))
    const nextDurationValue = clampNumber(duration, 0.1, Math.max(0.1, maxEnd - nextStartValue))
    const nextScenes = scenes.map((item, currentIndex) => currentIndex === index
      ? {
          ...item,
          subtitle_start: roundToFrame(nextStartValue, fps),
          subtitle_duration: roundToFrame(nextDurationValue, fps),
        }
      : item)
    onChange(updateRenderScenes(story, nextScenes))
    onSelect(index)
    onSeek(getSubtitleStart(nextScenes, index))
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

  return (
    <div
      className={isFullscreen
        ? "fixed inset-0 z-[80] flex h-screen w-screen flex-col overflow-hidden border border-[#2d2d37] bg-[#111115] text-[#f1f1f6] shadow-sm"
        : "relative flex h-[720px] w-full flex-col overflow-hidden rounded-lg border border-[#2d2d37] bg-[#111115] text-[#f1f1f6] shadow-sm"}
      onClick={() => setAudioMenu(null)}
    >
      <ProCutTopToolbar
        fps={fps}
        isFullscreen={isFullscreen}
        onDuplicate={duplicateScene}
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
}

function FigmaIcon({ alt = '', className = '', name, size = 14 }: { alt?: string; className?: string; name: keyof typeof proCutFigmaAssets; size?: number }) {
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <img alt={alt} src={proCutFigmaAssets[name]} className="absolute inset-0 block h-full w-full max-w-none" />
    </span>
  )
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
  onDuplicate,
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
  onDuplicate: () => void
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
          <ToolbarIconButton label="Duplicate" onClick={onDuplicate}><FigmaIcon name="arrowUpRight" size={14} /></ToolbarIconButton>
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
              <button aria-label={playing ? 'Pause' : 'Play'} onClick={onPlayToggle} className="flex size-9 items-center justify-center rounded-full bg-[#ff6200] text-white">
                {playing ? <span className="text-xs font-black">II</span> : <FigmaIcon name="play" size={18} />}
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
              <option value="shake-reveal">shake-reveal</option>
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
              {scenes.map((scene, index) => {
                const start = getSceneStart(scenes, index)
                const end = getSceneEnd(scenes, index)
                const left = videoDuration ? (start / videoDuration) * 100 : 0
                const width = videoDuration ? Math.max(2, ((end - start) / videoDuration) * 100) : 0
                const mediaType = getSceneMediaType(scene)
                return (
                  <div
                    key={`${scene.image}-${index}`}
                    className={`absolute inset-y-0 border-r border-[#111115] bg-[#ff6200] ${index === sceneIndex ? 'ring-2 ring-inset ring-white' : ''}`}
                    style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                  >
                    <button
                      onClick={() => {
                        onSelect(index)
                        onSeek(getSceneStart(scenes, index))
                      }}
                      className="h-full w-full overflow-hidden text-left"
                    >
                      <SceneMediaThumb scene={scene} className="absolute left-1 top-1 h-9 w-9 rounded object-cover opacity-80" />
                      <span className="absolute left-12 top-1 max-w-[calc(100%-54px)] truncate text-[10px] font-semibold text-white">{fileNameFromPath(scene.image || `${mediaType}_clip`)}</span>
                      <span className="absolute bottom-1 left-12 text-[9px] font-semibold text-white/80">{Number(scene.duration || 0).toFixed(2)}s · {mediaType}</span>
                    </button>
                    {index < scenes.length - 1 && (
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
              {scenes.map((scene, index) => {
                const subtitleStart = getSubtitleStart(scenes, index)
                const subtitleDuration = getSubtitleDuration(scenes, index)
                const left = videoDuration ? (subtitleStart / videoDuration) * 100 : 0
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
                        subtitleDragRef.current = { index, mode: 'trim-start', startX: event.clientX, start: subtitleStart, duration: subtitleDuration, timelineWidth: timelineRef.current?.getBoundingClientRect().width || 1 }
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
                        subtitleDragRef.current = { index, mode: 'move', startX: event.clientX, start: subtitleStart, duration: subtitleDuration, timelineWidth: timelineRef.current?.getBoundingClientRect().width || 1 }
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
                        onSelect(index)
                        onSeek(subtitleStart)
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
                        subtitleDragRef.current = { index, mode: 'trim-end', startX: event.clientX, start: subtitleStart, duration: subtitleDuration, timelineWidth: timelineRef.current?.getBoundingClientRect().width || 1 }
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
  if (effect === 'shake-reveal') {
    const shake = Math.sin(value * Math.PI * 10) * (1 - value) * 1.5
    const rotation = -1 + value * 2 + shake
    return { transform: `scale(1.05) rotate(${rotation}deg)`, transformOrigin: 'center center' }
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

function updateSceneAt(story: GenerateVideoStory, scenes: GenerateVideoScene[], index: number, patch: Partial<GenerateVideoScene>, onChange: (story: GenerateVideoStory) => void) {
  onChange(updateRenderScenes(story, scenes.map((scene, currentIndex) => currentIndex === index ? { ...scene, ...patch } : scene)))
}

function storyTimelineScenes(story: GenerateVideoStory): GenerateVideoScene[] {
  const timeline = story.timeline || {}
  const video = timeline.video || []
  const text = timeline.text || []
  if (!video.length && (story.story_data?.length || story.scenes?.length)) {
    return story.story_data?.length ? story.story_data : story.scenes || []
  }
  return video.map((clip, index) => {
    const mediaType = normalizeSceneMediaType(clip.type, String(clip.src || ''))
    const textClip = text[index] || text.find((item) => {
      const overlap = Math.min(Number(item.end || 0), Number(clip.end || 0)) - Math.max(Number(item.start || 0), Number(clip.start || 0))
      return overlap > 0
    })
    const duration = Math.max(0.1, Number(clip.duration || Number(clip.end || 0) - Number(clip.start || 0) || 4))
    const start = Number(clip.start || 0)
    const end = typeof clip.end === 'number' ? clip.end : start + duration
    const textStart = typeof textClip?.start === 'number' ? textClip.start : Number(clip.start || 0)
    const textEnd = typeof textClip?.end === 'number' ? textClip.end : textStart + duration
    return {
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
      subtitle: String(textClip?.text || ''),
      voice_text: textClip?.voice_text,
      subtitle_start: textStart,
      subtitle_duration: Math.max(0.1, textEnd - textStart),
      text_style: textClip?.style || {},
      timing: textClip?.timing,
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
                  <option value="shake-reveal">shake-reveal</option>
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

function updateRenderScenes(story: GenerateVideoStory, scenes: GenerateVideoScene[]): GenerateVideoStory {
  const fps = story.video?.fps || 30
  let cursor = 0
  let previousTextEnd = 0
  const video = scenes.map((scene, index) => {
    const duration = Math.max(1 / fps, Number(scene.duration || 4))
    const start = roundToFrame(typeof scene.start === 'number' ? Math.max(0, scene.start) : cursor, fps)
    const clipEnd = roundToFrame(start + duration, fps)
    cursor = Math.max(cursor, clipEnd)
    const mediaType = getSceneMediaType(scene)
    return {
      id: story.timeline?.video?.[index]?.id || `video-${index + 1}`,
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
  const text = scenes.flatMap((scene, index) => {
    const subtitle = String(scene.subtitle || '').trim()
    if (!subtitle) return []
    const fallbackStart = video[index]?.start ?? 0
    const sceneEnd = video[index]?.end ?? fallbackStart + Number(scene.duration || 1)
    const fallbackDuration = Math.max(1 / fps, sceneEnd - fallbackStart)
    const rawStart = typeof scene.subtitle_start === 'number' ? scene.subtitle_start : fallbackStart
    const rawDuration = typeof scene.subtitle_duration === 'number' ? scene.subtitle_duration : fallbackDuration
    const start = roundToFrame(clampNumber(Math.max(previousTextEnd, rawStart), fallbackStart, Math.max(fallbackStart, sceneEnd - 1 / fps)), fps)
    const end = roundToFrame(clampNumber(start + rawDuration, start + 1 / fps, sceneEnd), fps)
    previousTextEnd = end
    return [{
      id: story.timeline?.text?.[index]?.id || `text-${index + 1}`,
      type: 'subtitle',
      start,
      end,
      duration: roundToFrame(end - start, fps),
      text: subtitle,
      ...(scene.voice_text ? { voice_text: scene.voice_text } : {}),
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
      version: 1,
      duration: roundToFrame(duration || 1, fps),
      video,
      text,
      audio,
    },
  }
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

function storyTimelineDuration(story: GenerateVideoStory, scenes: GenerateVideoScene[]) {
  return Math.max(
    Number(story.timeline?.duration || 0),
    ...scenes.map((_, index) => getSceneEnd(scenes, index)),
    scenes.reduce((total, scene) => total + Number(scene.duration || 0), 0),
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
  const duration = story.timeline?.duration || storyTimelineScenes(story).reduce((total, scene) => total + Number(scene.duration || 0), 0)
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
  const videoDuration = story.timeline?.duration || storyTimelineScenes(story).reduce((total, scene) => total + Number(scene.duration || 0), 0)
  const tracks = storyAudioTracks(story, videoDuration)
  updateAudio(story, onChange, {
    tracks: tracks.map((track) => track.id === trackId ? { ...track, ...patch } : track),
  })
}

function removeAudioTrack(story: GenerateVideoStory, onChange: (story: GenerateVideoStory) => void, trackId: string) {
  const videoDuration = story.timeline?.duration || storyTimelineScenes(story).reduce((total, scene) => total + Number(scene.duration || 0), 0)
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
  if (error?.response?.status === 401) return 'Bạn cần đăng nhập lại để xem project này.'
  if (error?.response?.status === 403) return 'Tài khoản hiện tại không có quyền xem project này.'
  if (error?.response?.status === 404) return 'Không tìm thấy video project này hoặc project thuộc user khác.'
  return error?.message || fallback
}

function inferProjectStatus(project: ContentProject | null, story: GenerateVideoStory | null) {
  const projectStatus = project?.status || String(project?.metadata?.project_status || '')
  if (projectStatus) return projectStatus
  if (getProjectArtifacts(project)?.final) return 'RENDERED'
  if (story?.audio?.voice) return 'VOICE_READY'
  if (story) return 'EDITING'
  return 'READY'
}

function inferActiveStepFromProject(project: ContentProject | null, story: GenerateVideoStory | null): StepId {
  const artifacts = getProjectArtifacts(project)
  if (artifacts?.final && story) return 'video'
  if (story) {
    return 'video'
  }
  return 'story'
}

function getProjectArtifacts(project: ContentProject | null) {
  const finalArtifact = project?.artifacts?.find((artifact) => artifact.artifact_type === 'FINAL_VIDEO' && artifact.uri)
  if (finalArtifact?.uri) return { final: finalArtifact.uri }
  const rendered = project?.rendered_video || project?.metadata?.rendered_video
  return rendered ? { final: String(rendered) } : null
}

function roundToFrame(value: number, fps: number) {
  return Math.max(0.5, Math.round(value * fps) / fps)
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
