import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, ChevronDown, Clapperboard, Download, Eye, FastForward, FileText, Film, Image as ImageIcon, Lock, Mic2, Monitor, Music, Plus, Rewind, Save, Settings, SkipBack, SkipForward, Trash2, Type, UploadCloud, Volume2, Wand2, X } from 'lucide-react'
import {
  createModule3StoryFromHandoffApi,
  createModule3StoryFromManualApi,
  editModule3StoryWithAiApi,
  fetchModule3SavedStoryApi,
  fitModule3FramesApi,
  fetchElevenLabsSharedVoicesApi,
  fetchModule3RenderJobApi,
  generateModule3FinalVideoApi,
  generateModule3VoiceApi,
  module3MediaUrl,
  module3OutputUrl,
  saveModule3StoryApi,
  uploadModule3AudioApi,
  type ElevenLabsSharedVoice,
  type Module3Scene,
  type Module3Story,
} from '@/commons/apis/module3VideoProduction'
import { fetchModule3HandoffApi, updateModule3HandoffApi, type Module3Handoff } from '@/commons/apis/planning'

type StepId = 'raw' | 'story' | 'video' | 'voice' | 'fit' | 'preview'

const defaultVoiceId = 'pNInz6obpgDQGcFmaJgB'

const steps: Array<{ id: StepId; label: string; icon: React.ReactNode }> = [
  { id: 'raw', label: 'Raw article', icon: <FileText size={16} /> },
  { id: 'story', label: 'Create story', icon: <ImageIcon size={16} /> },
  { id: 'video', label: 'Generate video', icon: <Clapperboard size={16} /> },
  { id: 'voice', label: 'Emotion & voice', icon: <Mic2 size={16} /> },
  { id: 'fit', label: 'Fit frames', icon: <Wand2 size={16} /> },
  { id: 'preview', label: 'Export MP4', icon: <Clapperboard size={16} /> },
]

type VideoProductionWorkspaceProps = {
  handoffId: string
  onBackToList: () => void
}

export default function VideoProductionWorkspace({ handoffId, onBackToList }: VideoProductionWorkspaceProps) {
  const [selectedId, setSelectedId] = useState('')
  const [selectedHandoff, setSelectedHandoff] = useState<Module3Handoff | null>(null)
  const [handoffDraft, setHandoffDraft] = useState<Module3Handoff | null>(null)
  const [inputMode, setInputMode] = useState<'handoff' | 'manual'>('handoff')
  const [manualTitle, setManualTitle] = useState('')
  const [manualText, setManualText] = useState('')
  const [manualImages, setManualImages] = useState('')
  const [rawSourceText, setRawSourceText] = useState('')
  const [story, setStory] = useState<Module3Story | null>(null)
  const [previewStory, setPreviewStory] = useState<Module3Story | null>(null)
  const [storyText, setStoryText] = useState('')
  const [storySceneIndex, setStorySceneIndex] = useState(0)
  const [editPrompt, setEditPrompt] = useState('')
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [debug, setDebug] = useState<any>(null)
  const [exportedVideoUrl, setExportedVideoUrl] = useState('')
  const [activeStep, setActiveStep] = useState<StepId>('raw')
  const [voiceId, setVoiceId] = useState(defaultVoiceId)
  const [voiceSpeed, setVoiceSpeed] = useState(1)
  const [status, setStatus] = useState('Sẵn sàng')
  const [loadError, setLoadError] = useState('')
  const [storyLoadError, setStoryLoadError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [audioVersion, setAudioVersion] = useState(Date.now())
  const [previewVersion, setPreviewVersion] = useState(0)
  const hasStoryInput = Boolean(story || storyText.trim())

  useEffect(() => {
    setSelectedHandoff(null)
    setHandoffDraft(null)
    setStory(null)
    setPreviewStory(null)
    setStoryText('')
    setRawSourceText('')
    setDebug(null)
    setExportedVideoUrl('')
    setLoadError('')
    setStoryLoadError('')
    setActiveStep('raw')
    setStatus('Đang tải video project...')
    void loadInitial()
  }, [handoffId])

  const totalDuration = useMemo(() => {
    return story ? storyTimelineScenes(story).reduce((total, scene) => total + Number(scene.duration || 0), 0) : 0
  }, [story])

  const audioSrc = previewStory?.audio?.voice
    ? `${module3MediaUrl(previewStory.audio.voice)}?v=${audioVersion}`
    : ''
  const editSourceContent = (handoffDraft?.payload?.source_content || selectedHandoff?.payload?.source_content || {}) as Record<string, any>
  const loadInitial = async () => {
    setBusy('load')
    try {
      setSelectedId(handoffId)
      await loadHandoffById(handoffId)
    } finally {
      setBusy(null)
    }
  }

  const updateStory = (nextStory: Module3Story) => {
    setStory(nextStory)
    setStoryText(JSON.stringify(nextStory, null, 2))
    setStorySceneIndex((current) => Math.min(current, Math.max(0, storyTimelineScenes(nextStory).length - 1)))
  }

  const parseStoryText = () => {
    if (!storyText.trim() && story) return story
    const parsed = JSON.parse(storyText) as Module3Story
    setStory(parsed)
    return parsed
  }

  const loadRawArticle = async () => {
    if (!selectedId) return
    await loadHandoffById(selectedId)
  }

  const loadHandoffById = async (handoffId: string) => {
    setBusy('raw')
    try {
      setLoadError('')
      setStoryLoadError('')
      const handoff = await fetchModule3HandoffApi(handoffId)
      setSelectedHandoff(handoff)
      setHandoffDraft(handoff)
      setSelectedId(handoffId)
      const artifacts = getVideoArtifacts(handoff)
      setExportedVideoUrl(artifacts?.final ? module3OutputUrl(String(artifacts.final)) : '')
      window.history.replaceState({ handoffId }, '', `/module3/${encodeURIComponent(handoffId)}`)
      try {
        const savedStory = await fetchModule3SavedStoryApi(handoffId)
        updateStory(savedStory)
        setPreviewStory(savedStory)
        setPreviewVersion(Date.now())
        setActiveStep(inferActiveStepFromProject(handoff, savedStory))
        setStatus('Đã tải handoff và bản edit đã lưu trước đó')
      } catch (error: any) {
        setStory(null)
        setPreviewStory(null)
        setStoryText('')
        setStoryLoadError(readApiError(error, 'Chưa có story đã lưu cho project này.'))
        setActiveStep('raw')
        setStatus('Đã tải Module 2 handoff. Bấm Create story khi muốn tạo timeline video.')
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
    setBusy('story')
    try {
      const rawSource = parseOptionalJson(rawSourceText)
      const result = inputMode === 'manual'
        ? await createModule3StoryFromManualApi({
            title: manualTitle,
            text: manualText,
            images: manualImages.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
            media_type: 'IMAGE',
          })
        : await createModule3StoryFromHandoffApi(selectedId, rawSource)
      updateStory(result)
      setActiveStep('story')
      setStatus(inputMode === 'manual' ? 'Bước 2 xong: đã tạo timeline từ dữ liệu nhập tay' : 'Bước 2 xong: đã tạo timeline từ Module 2 + raw source')
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không tạo được story')
    } finally {
      setBusy(null)
    }
  }

  const saveStory = async () => {
    setBusy('save')
    try {
      const parsed = parseStoryText()
      const result = await saveModule3StoryApi(parsed)
      updateStory(result.story)
      setPreviewStory(result.story)
      setPreviewVersion(Date.now())
      setStatus('Đã lưu tiến trình edit vào backend và story.json cho Remotion')
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'JSON story không hợp lệ')
    } finally {
      setBusy(null)
    }
  }

  const saveHandoffDraft = async () => {
    if (!handoffDraft) return
    setBusy('save-handoff')
    try {
      const result = await updateModule3HandoffApi(handoffDraft.id, {
        status: handoffDraft.status,
        handoff_note: handoffDraft.handoff_note,
        payload: handoffDraft.payload,
        parts: handoffDraft.parts,
      })
      setSelectedHandoff(result)
      setHandoffDraft(result)
      setStatus('Đã lưu chỉnh sửa handoff Module 3')
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không lưu được handoff')
    } finally {
      setBusy(null)
    }
  }

  const editStoryWithAi = async () => {
    setBusy('edit-story')
    try {
      const parsed = parseStoryText()
      const result = await editModule3StoryWithAiApi(parsed, editPrompt.trim())
      updateStory(result)
      setActiveStep('story')
      setShowEditDialog(false)
      setStatus('Đã chỉnh timeline bằng AI từ dữ liệu đã gen + tài liệu gốc')
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không chỉnh được story bằng AI')
    } finally {
      setBusy(null)
    }
  }

  const previewVisualVideo = () => {
    try {
      const parsed = parseStoryText()
      updateStory(parsed)
      setPreviewStory(parsed)
      setPreviewVersion(Date.now())
      setActiveStep('video')
      setStatus('Bước 3 xong: đang preview ảnh + text trực tiếp trên giao diện')
    } catch (error: any) {
      setStatus(error?.message || 'JSON story không hợp lệ')
    }
  }

  const generateVoice = async () => {
    setBusy('voice')
    try {
      const parsed = parseStoryText()
      await saveModule3StoryApi(parsed)
      const result = await generateModule3VoiceApi(parsed, voiceId, voiceSpeed)
      const nextStory = { ...parsed, meta: result.meta || parsed.meta, audio: result.audio || parsed.audio, timeline: result.timeline || parsed.timeline }
      updateStory(nextStory)
      setPreviewStory(nextStory)
      setAudioVersion(Date.now())
      setActiveStep('voice')
      setStatus(`Bước 4 xong: đã gắn emotion và tạo voice (${result.voice_id}, ${result.voice_speed}x)`)
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không tạo được voice')
    } finally {
      setBusy(null)
    }
  }

  const fitFrames = async () => {
    setBusy('fit')
    try {
      const parsed = parseStoryText()
      await saveModule3StoryApi(parsed)
      const result = await fitModule3FramesApi(parsed)
      const nextStory = { ...parsed, meta: result.meta || parsed.meta, audio: result.audio || parsed.audio, timeline: result.timeline || parsed.timeline }
      updateStory(nextStory)
      setPreviewStory(nextStory)
      setDebug(result.debug)
      setPreviewVersion(Date.now())
      setActiveStep('fit')
      setStatus('Bước 5 xong: đã fit frame bằng Whisper-1, preview audio đã cập nhật theo duration mới')
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không fit được frame')
    } finally {
      setBusy(null)
    }
  }

  const exportVideo = async () => {
    setBusy('export-video')
    try {
      const parsed = parseStoryText()
      await saveModule3StoryApi(parsed)
      const result = await generateModule3FinalVideoApi(parsed)
      setActiveStep('preview')
      setStatus(`Đã đưa vào hàng đợi render (${result.job.id.slice(0, 8)})`)
      const completedJob = await waitForRenderJob(result.job.id, (job) => {
        setStatus(`Đang render MP4: ${job.status} · ${Math.round(Number(job.progress_percent || 0))}%`)
      })
      if (completedJob.status === 'FAILED') {
        throw new Error(completedJob.error_message || 'Render job failed')
      }
      if (completedJob.story) {
        updateStory(completedJob.story)
        setPreviewStory(completedJob.story)
      }
      if (completedJob.video_url) {
        setExportedVideoUrl(module3OutputUrl(completedJob.video_url))
      }
      setStatus('Đã xuất video MP4 hoàn chỉnh')
    } catch (error: any) {
      setStatus(error?.response?.data?.detail || error?.message || 'Không xuất được video')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="workspace-page">
      <div className="workspace-header">
        <div>
          <h1 className="workspace-title">{getProjectTitle(selectedHandoff)}</h1>
          <p className="workspace-subtitle">
            {selectedHandoff
              ? `Project ${selectedHandoff.id.slice(0, 8)} · ${inferProjectStatus(selectedHandoff, story)}`
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
          handoff={selectedHandoff}
          story={story}
          storyLoadError={storyLoadError}
          totalDuration={totalDuration}
        />
      )}

      <div className="grid gap-4">
        {activeStep === 'raw' && (
          <Panel title="1. Chọn nguồn đầu vào">
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setInputMode('handoff')} className={`rounded-lg border px-3 py-2 text-sm font-bold ${inputMode === 'handoff' ? 'border-[#2563eb] bg-[#eff6ff] text-[#1d4ed8]' : 'border-slate-200 bg-white text-slate-600'}`}>
                  Từ Module 2
                </button>
                <button onClick={() => setInputMode('manual')} className={`rounded-lg border px-3 py-2 text-sm font-bold ${inputMode === 'manual' ? 'border-[#2563eb] bg-[#eff6ff] text-[#1d4ed8]' : 'border-slate-200 bg-white text-slate-600'}`}>
                  Nhập tay
                </button>
              </div>

              {inputMode === 'handoff' ? (
                <>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700">
                    {selectedHandoff?.title || selectedHandoff?.handoff_note || selectedId}
                  </div>
                  <button disabled={!selectedId || Boolean(busy)} onClick={() => void loadRawArticle()} className="h-8 rounded-md bg-[var(--primary)] px-3 text-xs font-semibold text-white disabled:opacity-50">
                    Load Module 2 output
                  </button>
                  <label className="text-xs font-black uppercase tracking-wider text-slate-500">Raw source bổ sung từ bài gốc, gồm text/images nếu có</label>
                  <textarea value={rawSourceText} onChange={(event) => setRawSourceText(event.target.value)} placeholder='{"title":"...","text":"...","images":["https://..."]}' className="h-28 rounded-lg border border-slate-200 p-3 font-mono text-xs" />
                  <HandoffDetailEditor
                    handoff={handoffDraft}
                    busy={Boolean(busy)}
                    onChange={setHandoffDraft}
                    onSave={() => void saveHandoffDraft()}
                  />
                </>
              ) : (
                <>
                  <input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} placeholder="Tiêu đề" className="h-10 rounded-lg border border-slate-200 px-3 text-sm" />
                  <textarea value={manualText} onChange={(event) => setManualText(event.target.value)} placeholder="Text bài gốc / nội dung thô" className="h-40 rounded-lg border border-slate-200 p-3 text-sm" />
                  <textarea value={manualImages} onChange={(event) => setManualImages(event.target.value)} placeholder="Link ảnh, mỗi dòng một link. Video để sau." className="h-24 rounded-lg border border-slate-200 p-3 text-sm" />
                  <JsonBox value={{ title: manualTitle, text: manualText, images: manualImages.split(/\r?\n/).filter(Boolean), media_type: 'IMAGE' }} empty="Chưa nhập dữ liệu." />
                </>
              )}
            </div>
          </Panel>
        )}

        {activeStep === 'story' && (
          <Panel title="2. Tạo story data">
            <div className="flex flex-wrap gap-2">
              <button disabled={(inputMode === 'handoff' ? !selectedHandoff : !manualText.trim()) || Boolean(busy)} onClick={() => void createStory()} className="h-8 rounded-md bg-[var(--accent)] px-3 text-xs font-semibold text-white disabled:opacity-50">
                Create story
              </button>
              <button disabled={!hasStoryInput || Boolean(busy)} onClick={() => setShowEditDialog(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 text-xs font-semibold text-white disabled:opacity-50">
                <Wand2 size={14} /> Edit with AI
              </button>
              <button disabled={!hasStoryInput || Boolean(busy)} onClick={() => void saveStory()} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-50">
                <Save size={14} /> Save project
              </button>
            </div>
            <StoryDataEditor
              story={story}
              sceneIndex={storySceneIndex}
              onSelectScene={setStorySceneIndex}
              onChange={(nextStory, nextIndex) => {
                updateStory(nextStory)
                if (typeof nextIndex === 'number') setStorySceneIndex(nextIndex)
              }}
            />
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
      <Panel title="3. Preview video visual-only">
        <div className="grid gap-3">
          <button disabled={!hasStoryInput || Boolean(busy)} onClick={previewVisualVideo} className="h-8 w-fit rounded-md bg-[var(--primary)] px-3 text-xs font-semibold text-white disabled:opacity-50">
            Preview video không âm thanh
          </button>
          <StoryVisualPreview
            story={previewStory}
            version={previewVersion}
            audioSrc={audioSrc}
            saving={busy === 'save'}
            onSave={() => void saveStory()}
            onChange={(nextStory) => {
              setPreviewStory(nextStory)
              updateStory(nextStory)
            }}
          />
        </div>
      </Panel>
      )}

      <div>
        <section className="grid gap-4">
          {activeStep === 'voice' && (
          <Panel title="4. Gắn emotion và tạo voice">
            <div className="grid gap-3">
              <VoicePicker selectedVoiceId={voiceId} onSelect={setVoiceId} />
              <label className="text-xs font-black uppercase tracking-wider text-slate-500">Voice ID</label>
              <input value={voiceId} onChange={(event) => setVoiceId(event.target.value)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm" />
              <label className="text-xs font-black uppercase tracking-wider text-slate-500">Voice speed · {voiceSpeed.toFixed(2)}x</label>
              <input
                type="range"
                min="0.7"
                max="1.2"
                step="0.05"
                value={voiceSpeed}
                onChange={(event) => setVoiceSpeed(Number(event.target.value))}
                className="w-full"
              />
              <input
                type="number"
                min="0.7"
                max="1.2"
                step="0.05"
                value={voiceSpeed}
                onChange={(event) => setVoiceSpeed(Number(event.target.value) || 1)}
                className="h-10 rounded-lg border border-slate-200 px-3 text-sm"
              />
              <button disabled={!hasStoryInput || Boolean(busy)} onClick={() => void generateVoice()} className="h-8 rounded-md bg-[var(--success)] px-3 text-xs font-semibold text-white disabled:opacity-50">
                Emotion + Generate voice
              </button>
              {audioSrc && <audio key={audioSrc} controls src={audioSrc} className="w-full" />}
            </div>
          </Panel>
          )}

          {activeStep === 'fit' && (
          <Panel title="5. Auto fit frame bằng Whisper">
            <div className="grid gap-3">
              <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                Tổng duration hiện tại: <strong>{totalDuration.toFixed(2)}s</strong>
              </div>
              <button disabled={!hasStoryInput || Boolean(busy)} onClick={() => void fitFrames()} className="h-8 rounded-md bg-[var(--accent)] px-3 text-xs font-semibold text-white disabled:opacity-50">
                Fit frames with Whisper-1
              </button>
              <JsonBox value={debug} empty="Chưa có debug Whisper." />
            </div>
          </Panel>
          )}

          {activeStep === 'preview' && (
          <Panel title="6. Export MP4">
            <div className="space-y-3">
              <button disabled={!hasStoryInput || Boolean(busy)} onClick={() => void exportVideo()} className="h-8 w-full rounded-md bg-[var(--error)] px-3 text-xs font-semibold text-white disabled:opacity-50">
                Render ra file MP4
              </button>
              {exportedVideoUrl && (
                <div className="grid gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <a href={exportedVideoUrl} target="_blank" rel="noreferrer" className="text-sm font-black text-emerald-800 hover:underline">
                    Mở video đã xuất
                  </a>
                  <video src={exportedVideoUrl} controls className="w-full rounded-lg bg-black" />
                </div>
              )}
              <p className="text-sm text-slate-500">Bấm render để backend gọi Remotion và ghi file MP4 vào `data_demo/video_gen_demo/out`.</p>
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

async function waitForRenderJob(
  jobId: string,
  onUpdate: (job: Awaited<ReturnType<typeof fetchModule3RenderJobApi>>['job']) => void,
) {
  const timeoutAt = Date.now() + 10 * 60 * 1000
  while (Date.now() < timeoutAt) {
    const { job } = await fetchModule3RenderJobApi(jobId)
    onUpdate(job)
    if (job.status === 'RENDERED' || job.status === 'FAILED') {
      return job
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2000))
  }
  throw new Error('Render quá lâu, kiểm tra lại render job sau.')
}

function ProjectHealthSummary({
  handoff,
  story,
  storyLoadError,
  totalDuration,
}: {
  handoff: Module3Handoff | null
  story: Module3Story | null
  storyLoadError: string
  totalDuration: number
}) {
  const artifacts = getVideoArtifacts(handoff)
  const timeline = getVideoTimelinePayload(handoff)
  const timelineDuration = Number(story?.timeline?.duration || timeline?.duration || totalDuration || 0)
  const savedStoryState = story
    ? 'Đã có story/timeline'
    : storyLoadError
      ? 'Chưa có story đã lưu'
      : 'Đang kiểm tra story'
  const projectStatus = inferProjectStatus(handoff, story)

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <HealthCard label="Project" value={handoff ? projectStatus : 'Đang tải'} tone={handoff ? 'blue' : 'muted'} />
      <HealthCard label="Module 2 data" value={handoff ? 'Đã nhận handoff' : 'Chưa tải'} tone={handoff ? 'green' : 'muted'} />
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

function HandoffDetailEditor({
  handoff,
  busy,
  onChange,
  onSave,
}: {
  handoff: Module3Handoff | null
  busy: boolean
  onChange: (handoff: Module3Handoff) => void
  onSave: () => void
}) {
  if (!handoff) {
    return <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Chưa có handoff từ Module 2.</div>
  }

  const payload = handoff.payload || {}
  const series = (payload.series || {}) as Record<string, any>
  const plan = (payload.plan || {}) as Record<string, any>
  const sourceContent = (payload.source_content || {}) as Record<string, any>
  const parts = handoff.parts || []
  const hasSeries = Boolean(payload.series)

  const updateRoot = (field: keyof Module3Handoff, value: any) => onChange({ ...handoff, [field]: value })
  const updatePayload = (key: string, value: any) => onChange({ ...handoff, payload: { ...payload, [key]: value } })
  const updatePayloadObject = (key: string, field: string, value: any) => {
    const current = ((payload[key] || {}) as Record<string, any>)
    updatePayload(key, { ...current, [field]: value })
  }
  const updatePartPayload = (partId: string, field: string, value: any) => {
    onChange({
      ...handoff,
      parts: parts.map((part) => part.id === partId ? { ...part, payload: { ...(part.payload || {}), [field]: value } } : part),
    })
  }
  const updatePartArray = (partId: string, field: string, value: string) => {
    updatePartPayload(partId, field, splitLines(value))
  }

  return (
    <div className="rounded-lg border border-[#d9e0ea] bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-black text-[#0f172a]">Chi tiết dữ liệu từ Module 2</div>
          <div className="mt-1 text-xs font-medium text-slate-500">Có thể chỉnh sửa trước khi tạo story/video ở Module 3.</div>
        </div>
        <button disabled={busy} onClick={onSave} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--success)] px-3 text-xs font-semibold text-white disabled:opacity-50">
          <Save size={16} /> Lưu chỉnh sửa
        </button>
      </div>

      <div className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Trạng thái">
            <select value={handoff.status || ''} onChange={(event) => updateRoot('status', event.target.value)} className={inputClass}>
              {['READY', 'IN_PROGRESS', 'DONE', 'CANCELLED'].map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <input type="number" value={String(payload.priority ?? '')} onChange={(event) => updatePayload('priority', Number(event.target.value) || 0)} className={inputClass} />
          </Field>
          <Field label="Số phần">
            <input type="number" value={String(payload.part_count ?? parts.length)} onChange={(event) => updatePayload('part_count', Number(event.target.value) || 0)} className={inputClass} />
          </Field>
        </div>

        <Field label="Ghi chú handoff">
          <textarea value={handoff.handoff_note || ''} onChange={(event) => updateRoot('handoff_note', event.target.value)} className={`${textareaClass} h-20`} />
        </Field>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="mb-3 text-sm font-black text-[#0f172a]">Kế hoạch nội dung</div>
            <div className="grid gap-3">
              <Field label="Tiêu đề plan"><input value={plan.title || payload.plan_title || ''} onChange={(event) => updatePayloadObject('plan', 'title', event.target.value)} className={inputClass} /></Field>
              <Field label="Góc khai thác"><textarea value={plan.content_angle || ''} onChange={(event) => updatePayloadObject('plan', 'content_angle', event.target.value)} className={`${textareaClass} h-24`} /></Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Audience"><input value={plan.target_audience || ''} onChange={(event) => updatePayloadObject('plan', 'target_audience', event.target.value)} className={inputClass} /></Field>
                <Field label="Tone"><input value={plan.tone || ''} onChange={(event) => updatePayloadObject('plan', 'tone', event.target.value)} className={inputClass} /></Field>
                <Field label="Format"><input value={plan.format || ''} onChange={(event) => updatePayloadObject('plan', 'format', event.target.value)} className={inputClass} /></Field>
                <Field label="Duration"><input type="number" value={String(plan.target_duration_seconds ?? '')} onChange={(event) => updatePayloadObject('plan', 'target_duration_seconds', Number(event.target.value) || null)} className={inputClass} /></Field>
              </div>
              <Field label="AI reasoning, mỗi dòng một ý"><textarea value={(plan.ai_reasoning || []).join('\n')} onChange={(event) => updatePayloadObject('plan', 'ai_reasoning', splitLines(event.target.value))} className={`${textareaClass} h-28`} /></Field>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <div className="mb-3 text-sm font-black text-[#0f172a]">{hasSeries ? 'Series & nguồn gốc' : 'Bài gốc'}</div>
            <div className="grid gap-3">
              {hasSeries && (
                <>
                  <Field label="Tên series"><input value={series.title || payload.series_title || ''} onChange={(event) => updatePayloadObject('series', 'title', event.target.value)} className={inputClass} /></Field>
                  <Field label="Mô tả series"><textarea value={series.description || ''} onChange={(event) => updatePayloadObject('series', 'description', event.target.value)} className={`${textareaClass} h-20`} /></Field>
                </>
              )}
              <Field label="Tiêu đề bài gốc"><input value={sourceContent.canonical_title || ''} onChange={(event) => updatePayloadObject('source_content', 'canonical_title', event.target.value)} className={inputClass} /></Field>
              <Field label="Tóm tắt / full text"><textarea value={sourceContent.full_text || sourceContent.summary || ''} onChange={(event) => updatePayloadObject('source_content', 'full_text', event.target.value)} className={`${textareaClass} h-40`} /></Field>
              <Field label="URL nguồn"><input value={sourceContent.source_url || sourceContent.canonical_url || ''} onChange={(event) => updatePayloadObject('source_content', 'source_url', event.target.value)} className={inputClass} /></Field>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-[#0f172a]">Timeline các phần</div>
          <div className="grid gap-4 p-4">
            {parts.length === 0 ? <div className="text-sm text-slate-500">Chưa có part nào trong handoff.</div> : parts.map((part) => {
              const data = (part.payload || {}) as Record<string, any>
              return (
                <div key={part.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="rounded bg-[#eff6ff] px-2 py-1 text-xs font-black text-[#1d4ed8]">T{part.part_number}</span>
                    <input value={data.title || ''} onChange={(event) => updatePartPayload(part.id, 'title', event.target.value)} className={`${inputClass} flex-1 font-bold`} />
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Hook"><textarea value={data.hook_direction || ''} onChange={(event) => updatePartPayload(part.id, 'hook_direction', event.target.value)} className={`${textareaClass} h-24`} /></Field>
                    <Field label="Ending"><textarea value={data.ending_direction || ''} onChange={(event) => updatePartPayload(part.id, 'ending_direction', event.target.value)} className={`${textareaClass} h-24`} /></Field>
                    <Field label="Goal"><textarea value={data.goal || ''} onChange={(event) => updatePartPayload(part.id, 'goal', event.target.value)} className={`${textareaClass} h-20`} /></Field>
                    <Field label="Tease tập sau"><textarea value={data.next_part_tease || ''} onChange={(event) => updatePartPayload(part.id, 'next_part_tease', event.target.value)} className={`${textareaClass} h-20`} /></Field>
                  </div>
                  <Field label="Main beats, mỗi dòng một beat">
                    <textarea value={(data.main_beats || []).join('\n')} onChange={(event) => updatePartArray(part.id, 'main_beats', event.target.value)} className={`${textareaClass} mt-2 h-32`} />
                  </Field>
                </div>
              )
            })}
          </div>
        </div>
      </div>
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
const textareaClass = 'w-full resize-y rounded-md border border-slate-200 p-3 text-sm font-medium leading-6 text-slate-700 outline-none focus:border-[var(--accent)]'

function splitLines(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
}

function JsonBox({ value, empty }: { value: any; empty: string }) {
  if (!value) {
    return <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">{empty}</div>
  }

  return (
    <pre className="max-h-[320px] overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-50">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

function VoicePicker({ selectedVoiceId, onSelect }: { selectedVoiceId: string; onSelect: (voiceId: string) => void }) {
  const [voices, setVoices] = useState<ElevenLabsSharedVoice[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadVoices(search.trim())
    }, 350)
    return () => window.clearTimeout(timeout)
  }, [search])

  const loadVoices = async (query: string) => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchElevenLabsSharedVoicesApi({ search: query || undefined, sort: 'trending', page_size: 30, page: 0 })
      setVoices(result.voices || [])
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || 'Không tải được danh sách voice ElevenLabs')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black text-[#0f172a]">ElevenLabs shared voices</div>
          <div className="mt-0.5 text-xs font-medium text-slate-500">Search, nghe thử, rồi chọn voice cho bước Generate voice.</div>
        </div>
        <button disabled={loading} onClick={() => void loadVoices(search.trim())} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-50">
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Tìm voice, ví dụ: ad, vietnamese, narrator..."
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#2563eb]"
      />
      {error && <div className="mt-2 rounded border border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</div>}
      {previewUrl && <audio key={previewUrl} src={previewUrl} controls autoPlay className="mt-3 w-full" />}
      <div className="mt-3 grid max-h-[360px] gap-2 overflow-auto pr-1">
        {voices.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500">
            {loading ? 'Đang tải voice...' : 'Chưa có voice để hiển thị.'}
          </div>
        ) : voices.map((voice) => {
          const preview = voice.preview_url || voice.verified_languages?.find((item) => item.preview_url)?.preview_url || ''
          const active = selectedVoiceId === voice.voice_id
          return (
            <div key={voice.voice_id} className={`rounded-lg border bg-white p-3 ${active ? 'border-[#2563eb] ring-1 ring-[#2563eb]' : 'border-slate-200'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-[#0f172a]">{voice.name}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {[voice.language || voice.locale, voice.gender, voice.age, voice.accent, voice.descriptive].filter(Boolean).map((item) => (
                      <span key={String(item)} className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{String(item)}</span>
                    ))}
                  </div>
                </div>
                <button onClick={() => onSelect(voice.voice_id)} className={`h-8 shrink-0 rounded-md px-3 text-xs font-semibold ${active ? 'bg-[var(--success)] text-white' : 'bg-[var(--accent)] text-white'}`}>
                  {active ? 'Đã chọn' : 'Chọn'}
                </button>
              </div>
              {voice.description && <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{voice.description}</p>}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <code className="rounded bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">{voice.voice_id}</code>
                <div className="flex gap-2">
                  <button disabled={!preview} onClick={() => setPreviewUrl(preview)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700 disabled:opacity-40">
                    Nghe thử
                  </button>
                  {preview && (
                    <a href={preview} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700">
                      Mở mp3
                    </a>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StoryDataEditor({
  story,
  sceneIndex,
  onSelectScene,
  onChange,
}: {
  story: Module3Story | null
  sceneIndex: number
  onSelectScene: (index: number) => void
  onChange: (story: Module3Story, nextIndex?: number) => void
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
  const updateMeta = (field: keyof NonNullable<Module3Story['meta']>, value: string) => onChange({ ...story, meta: { ...meta, [field]: value } })
  const updateVideo = (field: keyof Module3Story['video'], value: string | number) => onChange({ ...story, video: { ...video, [field]: value } })
  const updateAudioFields = (patch: Partial<NonNullable<Module3Story['audio']>>) => updateAudio(story, onChange, patch)

  return (
    <div className="mt-3 grid gap-4">
      <div className="rounded-lg border border-[#d9e0ea] bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-black text-[#0f172a]">Story data editor</div>
            <div className="mt-1 text-xs font-medium text-slate-500">{scenes.length} scene · chỉnh sửa xong bấm Save edits để lưu như logic cũ.</div>
          </div>
          <div className="rounded bg-[#eff6ff] px-3 py-1.5 text-xs font-black text-[#1d4ed8]">
            {(meta.source || 'module3').toUpperCase()}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <div className="grid gap-3">
            <Field label="Tiêu đề">
              <input value={meta.title || ''} onChange={(event) => updateMeta('title', event.target.value)} className={inputClass} />
            </Field>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Series ID"><input value={meta.series_id || ''} onChange={(event) => updateMeta('series_id', event.target.value)} className={inputClass} /></Field>
              <Field label="Plan ID"><input value={meta.plan_id || ''} onChange={(event) => updateMeta('plan_id', event.target.value)} className={inputClass} /></Field>
              <Field label="Handoff ID"><input value={meta.handoff_id || ''} onChange={(event) => updateMeta('handoff_id', event.target.value)} className={inputClass} /></Field>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Width"><input type="number" value={video.width} onChange={(event) => updateVideo('width', Number(event.target.value) || 1080)} className={inputClass} /></Field>
              <Field label="Height"><input type="number" value={video.height} onChange={(event) => updateVideo('height', Number(event.target.value) || 1920)} className={inputClass} /></Field>
              <Field label="FPS"><input type="number" value={video.fps} onChange={(event) => updateVideo('fps', Number(event.target.value) || 30)} className={inputClass} /></Field>
              <Field label="Background"><input value={video.background} onChange={(event) => updateVideo('background', event.target.value)} className={inputClass} /></Field>
            </div>
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
  onSave,
  onChange,
}: {
  story: Module3Story | null
  version: number
  audioSrc: string
  saving: boolean
  onSave: () => void
  onChange: (story: Module3Story) => void
}) {
  const scenes = story ? storyTimelineScenes(story) : []
  const [sceneIndex, setSceneIndex] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [editorMode, setEditorMode] = useState<'simple' | 'timeline'>('timeline')
  const [voiceDuration, setVoiceDuration] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
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
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      void audio.play().catch(() => setPlaying(false))
    } else {
      audio.pause()
    }
  }, [playing])

  const videoDuration = scenes.reduce((total, item) => total + Number(item.duration || 0), 0)

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
      const nextTime = Math.min(videoDuration, start.time + (performance.now() - start.clock) / 1000)
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
  }, [playing, videoDuration, scenes])

  const seekTo = (time: number) => {
    const nextTime = clampNumber(time, 0, videoDuration)
    setCurrentTime(nextTime)
    setSceneIndex(sceneIndexAtTime(scenes, nextTime))
    if (playing) {
      playStartRef.current = { clock: performance.now(), time: nextTime }
    }
    if (audioRef.current) {
      audioRef.current.currentTime = nextTime
    }
  }

  const togglePlayback = () => {
    if (!playing && audioRef.current) {
      audioRef.current.currentTime = currentTime >= videoDuration ? 0 : currentTime
    }
    setPlaying((value) => !value)
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
  const visibleSceneIndex = playing ? timelineSceneIndex : Math.min(sceneIndex, scenes.length - 1)
  const scene = scenes[visibleSceneIndex]
  const subtitleSceneIndex = activeSubtitleSceneIndexAtTime(scenes, currentTime)
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
  const imageClass = scene.effect === 'pan-right'
    ? 'scale-110 translate-x-3'
    : scene.effect === 'shake-reveal'
      ? 'scale-105 rotate-1'
      : 'scale-110'
  const isSimpleMode = editorMode === 'simple'
  const previewStage = (
    <div
      className="relative mx-auto aspect-[9/16] w-full max-w-[360px] overflow-hidden rounded-lg bg-slate-950"
      style={!isSimpleMode
        ? { width: 'clamp(180px, calc((100vh - 430px) * 9 / 16), 300px)' }
        : { maxHeight: 560 }}
    >
      <SceneMediaPreview
        key={`${version}-${visibleSceneIndex}`}
        scene={scene}
        playing={playing}
        imageClass={imageClass}
      />
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
          className="absolute cursor-grab rounded bg-black/45 px-3 py-2 text-center text-xl font-black leading-tight text-white shadow-lg active:cursor-grabbing"
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
        {visibleSceneIndex + 1}/{scenes.length} · {Number(scene.duration || 4)}s · {currentTime.toFixed(2)}s
      </div>
    </div>
  )
  return (
    <div className="grid gap-3">
      {isSimpleMode && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-2">
        <div className="text-sm font-black text-[#0f172a]">Preview editor</div>
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={saving || !story} onClick={onSave} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--success)] px-3 text-xs font-semibold text-white disabled:opacity-50">
            <Save size={14} /> {saving ? 'Saving...' : 'Save project'}
          </button>
          <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1">
            <button onClick={() => setEditorMode('simple')} className="rounded-md bg-white px-3 py-1.5 text-xs font-black text-[#2563eb] shadow-sm">
              Cơ bản
            </button>
            <button onClick={() => setEditorMode('timeline')} className="rounded-md px-3 py-1.5 text-xs font-black text-slate-600">
              Studio
            </button>
          </div>
        </div>
      </div>}

      {isSimpleMode ? previewStage : (
        <RemotionLikeEditor
          story={story}
          scenes={scenes}
          sceneIndex={sceneIndex}
          playing={playing}
          previewStage={previewStage}
          videoDuration={videoDuration}
          currentTime={currentTime}
          voiceDuration={voiceDuration}
          audioSrc={audioSrc}
          timelineRef={timelineRef}
          dragRef={dragRef}
          musicDragRef={musicDragRef}
          onSelect={setSceneIndex}
          onSeek={seekTo}
          onPlayToggle={togglePlayback}
          onSave={onSave}
          saving={saving}
          onChange={onChange}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            togglePlayback()
          }}
          className="h-8 rounded-md bg-[var(--primary)] px-3 text-xs font-semibold text-white"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        {scenes.map((_, index) => (
          <button
            key={index}
            onClick={() => {
              setSceneIndex(index)
              seekTo(sceneStartTime(scenes, index))
            }}
            className={`h-8 w-8 rounded text-xs font-black ${index === sceneIndex ? 'bg-[#2563eb] text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            {index + 1}
          </button>
        ))}
      </div>
      {isSimpleMode && <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <Metric label="Video" value={`${videoDuration.toFixed(2)}s`} />
          <Metric label="Voice" value={voiceDuration ? `${voiceDuration.toFixed(2)}s` : '--'} />
          <button
            disabled={!voiceDuration}
            onClick={() => {
              if (!story || !voiceDuration) return
              const weights = scenes.map((item) => Math.max(stripVoiceTags(item.subtitle).trim().length, 20))
              const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
              const targetDuration = Math.max(voiceDuration + 0.3, scenes.length * 0.75)
              onChange(updateRenderScenes(story, scenes.map((item, index) => ({
                ...item,
                duration: roundToQuarter((targetDuration * weights[index]) / totalWeight),
                timing: undefined,
              }))))
            }}
            className="h-8 rounded-md bg-[var(--warning)] px-3 text-xs font-semibold text-white disabled:opacity-40"
          >
            Khớp nhanh theo voice
          </button>
        </div>
        <Timeline
          fps={story?.video?.fps || 30}
          scenes={scenes}
          totalDuration={videoDuration}
          timelineRef={timelineRef}
          onSelect={setSceneIndex}
          onDragStart={(event, index) => {
            dragRef.current = {
              index,
              startX: event.clientX,
              leftDuration: Number(scenes[index].duration || 0),
              rightDuration: Number(scenes[index + 1].duration || 0),
              totalDuration: videoDuration,
              timelineWidth: timelineRef.current?.getBoundingClientRect().width || 1,
            }
          }}
          onDragMove={(event) => {
            if (!story || !dragRef.current) return
            const drag = dragRef.current
            const secondsPerPixel = drag.totalDuration / drag.timelineWidth
            const deltaSeconds = (event.clientX - drag.startX) * secondsPerPixel
            const combined = drag.leftDuration + drag.rightDuration
            const left = Math.min(combined - 0.5, Math.max(0.5, drag.leftDuration + deltaSeconds))
            const right = combined - left
            const nextScenes = scenes.map((item) => ({ ...item, timing: undefined }))
            nextScenes[drag.index].duration = roundToFrame(left, story.video?.fps || 30)
            nextScenes[drag.index + 1].duration = roundToFrame(right, story.video?.fps || 30)
            onChange(updateRenderScenes(story, nextScenes))
          }}
          onDragEnd={() => {
            dragRef.current = null
          }}
        />
        <BackgroundMusicEditor
          story={story}
          totalDuration={videoDuration}
          timelineRef={timelineRef}
          musicDragRef={musicDragRef}
          onChange={onChange}
        />
      </div>}
      {audioSrc ? (
        <audio
          ref={audioRef}
          key={audioSrc}
          controls
          src={audioSrc}
          className="w-full"
          onLoadedMetadata={(event) => {
            const duration = event.currentTarget.duration
            setVoiceDuration(Number.isFinite(duration) ? duration : null)
          }}
          onEnded={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
      ) : (
        <div className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-500">
          Chưa có voice. Tạo voice xong quay lại preview sẽ nghe được âm thanh.
        </div>
      )}
      {isSimpleMode && <SceneEditor
        story={story}
        scenes={scenes}
        sceneIndex={sceneIndex}
        onSelect={setSceneIndex}
        onChange={(nextStory, nextIndex = sceneIndex) => {
          onChange(nextStory)
          setSceneIndex(Math.max(0, Math.min(nextIndex, storyTimelineScenes(nextStory).length - 1)))
        }}
      />}
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
  timelineRef,
  dragRef,
  musicDragRef,
  onSelect,
  onSeek,
  onPlayToggle,
  onSave,
  saving,
  onChange,
}: {
  story: Module3Story | null
  scenes: Module3Scene[]
  sceneIndex: number
  playing: boolean
  previewStage: React.ReactNode
  videoDuration: number
  currentTime: number
  voiceDuration: number | null
  audioSrc: string
  timelineRef: React.RefObject<HTMLDivElement | null>
  dragRef: React.MutableRefObject<{ index: number; startX: number; leftDuration: number; rightDuration: number; totalDuration: number; timelineWidth: number } | null>
  musicDragRef: React.MutableRefObject<{ mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; totalDuration: number; timelineWidth: number } | null>
  onSelect: (index: number) => void
  onSeek: (time: number) => void
  onPlayToggle: () => void
  onSave: () => void
  saving: boolean
  onChange: (story: Module3Story) => void
}) {
  const trackDragRef = useRef<{ id: string; mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; timelineWidth: number } | null>(null)
  const subtitleDragRef = useRef<{ index: number; mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; timelineWidth: number } | null>(null)
  const [addAudioType, setAddAudioType] = useState<'voice' | 'music' | 'sfx' | null>(null)
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
  const musicTracks = audioTracks.filter((track) => track.type === 'music')
  const voiceTracks = audioTracks.filter((track) => track.type === 'voice')
  const sfxTracks = audioTracks.filter((track) => track.type === 'sfx')
  const musicSrc = audio.music ? module3MediaUrl(audio.music) : ''
  const musicStart = Number(audio.musicStart || 0)
  const musicDuration = Number(audio.musicDuration || Math.max(0, videoDuration - musicStart))
  const musicLeft = videoDuration ? (musicStart / videoDuration) * 100 : 0
  const musicWidth = videoDuration ? Math.max(4, (musicDuration / videoDuration) * 100) : 0
  const voiceWidth = videoDuration ? Math.min(100, ((voiceDuration || videoDuration) / Math.max(videoDuration, 1)) * 100) : 0
  const playheadLeft = videoDuration ? (currentTime / videoDuration) * 100 : 0

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
    onSeek(sceneStartTime(nextScenes, drag.index) + Number(nextScenes[drag.index].duration || 0))
  }
  const updateSubtitleTiming = (index: number, start: number, duration: number) => {
    const sceneStart = sceneStartTime(scenes, index)
    const sceneEnd = sceneStart + Number(scenes[index]?.duration || 0.1)
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

  const insertSceneAfter = (scenePatch: Partial<Module3Scene> = {}) => {
    const insertAt = Math.min(sceneIndex + 1, scenes.length)
    const nextScenes = [
      ...scenes.slice(0, insertAt),
      { ...emptyScene(), ...scenePatch },
      ...scenes.slice(insertAt),
    ]
    onChange(updateRenderScenes(story, nextScenes))
    onSelect(insertAt)
    onSeek(sceneStartTime(nextScenes, insertAt))
  }

  const insertFrameAtPlayhead = () => {
    const index = sceneIndexAtTime(scenes, currentTime)
    const current = scenes[index]
    if (!current) return

    const frame = emptyScene()
    const sceneStart = sceneStartTime(scenes, index)
    const sceneDuration = Number(current.duration || 0)
    const offset = roundToFrame(currentTime - sceneStart, fps)
    const insertDuration = Number(frame.duration || 3)
    let insertAt = index
    let nextScenes: Module3Scene[]

    if (offset <= 0.25) {
      nextScenes = [
        ...scenes.slice(0, index),
        frame,
        ...scenes.slice(index),
      ]
    } else if (offset >= sceneDuration - 0.25) {
      insertAt = index + 1
      nextScenes = [
        ...scenes.slice(0, insertAt),
        frame,
        ...scenes.slice(insertAt),
      ]
    } else {
      const leftDuration = roundToFrame(offset, fps)
      const rightDuration = roundToFrame(sceneDuration - offset, fps)
      const leftScene = { ...current, duration: leftDuration, timing: undefined }
      const rightScene = { ...current, duration: rightDuration, timing: undefined }
      insertAt = index + 1
      nextScenes = [
        ...scenes.slice(0, index),
        leftScene,
        frame,
        rightScene,
        ...scenes.slice(index + 1),
      ]
    }

    onChange(updateStoryAfterTimelineInsert(story, nextScenes, sceneStart + Math.max(0, offset), insertDuration))
    onSelect(insertAt)
    onSeek(sceneStartTime(nextScenes, insertAt))
  }

  const duplicateScene = () => {
    const current = scenes[sceneIndex]
    if (!current) return
    insertSceneAfter({ ...current, timing: undefined })
  }
  const openAddAudio = (type: 'voice' | 'music' | 'sfx') => {
    setAddAudioType(type)
    setAddAudioMode('local')
    setAddAudioLink('')
    setAddAudioFile(null)
    setAddAudioError('')
  }

  const createAudioTrack = (type: 'voice' | 'music' | 'sfx', src: string) => {
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
        const result = await uploadModule3AudioApi(addAudioFile)
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
    <div className="flex h-[calc(100vh-172px)] max-h-[900px] min-h-[680px] flex-col overflow-hidden border border-[#2d2d37] bg-[#111115] text-[#f1f1f6] shadow-sm" onClick={() => setAudioMenu(null)}>
      <ProCutTopToolbar
        fps={fps}
        saving={saving}
        story={story}
        videoDuration={videoDuration}
        onAddFrame={() => insertSceneAfter(emptyFrameScene())}
        onAddSfx={() => openAddAudio('sfx')}
        onAddTitle={() => insertSceneAfter({ ...emptyFrameScene(), image: 'assets/images/003-final-light.png', subtitle: 'Tiêu đề mới', duration: 3 })}
        onAddVideo={() => insertSceneAfter(emptyVideoScene())}
        onDuplicate={duplicateScene}
        onExport={onSave}
        onSave={onSave}
        onSplitFrame={insertFrameAtPlayhead}
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
          onSubmit={() => void submitAddAudio()}
        />
      )}

      <ProCutMainSplit
        audio={audio}
        currentScene={currentScene}
        currentTime={currentTime}
        fps={fps}
        playing={playing}
        previewStage={previewStage}
        sceneIndex={sceneIndex}
        scenes={scenes}
        story={story}
        videoDuration={videoDuration}
        onAddMusic={() => openAddAudio('music')}
        onAddSfx={() => openAddAudio('sfx')}
        onAddVoice={() => openAddAudio('voice')}
        onChange={onChange}
        onPlayToggle={onPlayToggle}
        onSeek={onSeek}
        onSplitFrame={insertFrameAtPlayhead}
      />

      <ProCutTimelinePanel
        audioMenu={audioMenu}
        audioSrc={audioSrc}
        dragRef={dragRef}
        musicDragRef={musicDragRef}
        musicDuration={musicDuration}
        musicLeft={musicLeft}
        musicSrc={musicSrc}
        musicStart={musicStart}
        musicTracks={musicTracks}
        musicWidth={musicWidth}
        playheadLeft={playheadLeft}
        sceneIndex={sceneIndex}
        scenes={scenes}
        sfxTracks={sfxTracks}
        story={story}
        subtitleDragRef={subtitleDragRef}
        timelineRef={timelineRef}
        trackDragRef={trackDragRef}
        videoDuration={videoDuration}
        voiceTracks={voiceTracks}
        voiceWidth={voiceWidth}
        onAudioMenuDelete={deleteAudioMenuTarget}
        onChange={onChange}
        onContextMenuTrack={openAudioMenu}
        onResizeScene={resizeScene}
        onSeek={onSeek}
        onSeekFromPointer={seekFromTimelinePointer}
        onSelect={onSelect}
        onUpdateSubtitleTiming={updateSubtitleTiming}
      />
    </div>
  )
}

function ProCutTopToolbar({
  fps,
  saving,
  story,
  videoDuration,
  onAddFrame,
  onAddSfx,
  onAddTitle,
  onAddVideo,
  onDuplicate,
  onExport,
  onSave,
  onSplitFrame,
}: {
  fps: number
  saving: boolean
  story: Module3Story
  videoDuration: number
  onAddFrame: () => void
  onAddSfx: () => void
  onAddTitle: () => void
  onAddVideo: () => void
  onDuplicate: () => void
  onExport: () => void
  onSave: () => void
  onSplitFrame: () => void
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
        <p className="text-[11px] text-[#626272]">{fps} fps · {Math.round(videoDuration * fps)} frames</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ToolbarIconButton label="Undo"><ArrowLeft size={14} /></ToolbarIconButton>
        <ToolbarIconButton label="Duplicate" onClick={onDuplicate}><Clapperboard size={14} /></ToolbarIconButton>
        <ToolbarActionButton onClick={onAddVideo} active icon={<Film size={14} />} label="Video" />
        <ToolbarActionButton onClick={onAddFrame} icon={<ImageIcon size={14} />} label="Frame" />
        <ToolbarActionButton onClick={onSplitFrame} icon={<Plus size={14} />} label="Split" />
        <ToolbarActionButton onClick={onAddTitle} icon={<Type size={14} />} label="Title" />
        <ToolbarIconButton label="Add SFX" onClick={onAddSfx}><Music size={14} /></ToolbarIconButton>
        <ToolbarActionButton disabled={saving} onClick={onSave} icon={<Download size={14} />} label={saving ? 'Saving' : 'Save'} />
        <ToolbarActionButton active onClick={onExport} icon={<UploadCloud size={14} />} label="Export" />
        <ToolbarIconButton label="Settings"><Settings size={18} /></ToolbarIconButton>
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
      className="flex h-7 min-w-7 items-center justify-center rounded border border-[#2d2d37] bg-[#1e1e24] px-2 text-[#f1f1f6] hover:border-[#3e3e4c] hover:bg-[#26262e]"
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
      className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[11px] font-semibold disabled:opacity-50 ${active ? 'bg-[#ff6200] text-white hover:bg-[#ea580c]' : 'border border-[#2d2d37] bg-[#1e1e24] text-[#f1f1f6] hover:bg-[#26262e]'}`}
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
  onSubmit,
}: {
  busy: boolean
  error: string
  file: File | null
  link: string
  mode: 'local' | 'link'
  type: 'voice' | 'music' | 'sfx'
  onCancel: () => void
  onFileChange: (file: File | null) => void
  onLinkChange: (value: string) => void
  onModeChange: (mode: 'local' | 'link') => void
  onSubmit: () => void
}) {
  return (
    <div className="shrink-0 border-b border-[#2d2d37] bg-[#17171c] p-3">
      <div className="mx-auto grid max-w-3xl gap-3 rounded border border-[#2d2d37] bg-[#111115] p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] font-bold uppercase text-[#9e9eae]">Add {type} Track</div>
          <button onClick={onCancel} className="h-7 rounded border border-[#2d2d37] bg-[#1e1e24] px-2 text-xs font-semibold text-white hover:bg-[#26262e]">Cancel</button>
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
  audio,
  currentScene,
  currentTime,
  fps,
  playing,
  previewStage,
  sceneIndex,
  scenes,
  story,
  videoDuration,
  onAddMusic,
  onAddSfx,
  onAddVoice,
  onChange,
  onPlayToggle,
  onSeek,
  onSplitFrame,
}: {
  audio: NonNullable<Module3Story['audio']>
  currentScene: Module3Scene | undefined
  currentTime: number
  fps: number
  playing: boolean
  previewStage: React.ReactNode
  sceneIndex: number
  scenes: Module3Scene[]
  story: Module3Story
  videoDuration: number
  onAddMusic: () => void
  onAddSfx: () => void
  onAddVoice: () => void
  onChange: (story: Module3Story) => void
  onPlayToggle: () => void
  onSeek: (time: number) => void
  onSplitFrame: () => void
}) {
  const progress = videoDuration ? Math.min(100, Math.max(0, (currentTime / videoDuration) * 100)) : 0
  return (
    <div className="grid h-[492px] shrink-0 grid-cols-[minmax(0,1fr)_380px]">
      <section className="flex min-w-0 flex-col border border-[#2d2d37]">
        <PaneHeader icon={<Monitor size={14} />} title="Program Monitor" />
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
            <span className="-ml-1 size-2.5 rounded-full bg-[#ff6200] opacity-90 group-hover:opacity-100" />
          </button>
          <div className="flex items-center justify-between">
            <p className="text-[14px] font-bold text-[#ff6200]">{formatTimelineClock(currentTime, fps)}</p>
            <div className="flex items-center gap-4 text-[#9e9eae]">
              <button aria-label="Skip back" onClick={() => onSeek(0)}><SkipBack size={16} /></button>
              <button aria-label="Rewind" onClick={() => onSeek(Math.max(0, currentTime - 1))}><Rewind size={16} /></button>
              <button aria-label={playing ? 'Pause' : 'Play'} onClick={onPlayToggle} className="flex size-9 items-center justify-center rounded-full bg-[#ff6200] text-white">
                {playing ? <span className="text-xs font-black">II</span> : <span className="ml-0.5 text-sm font-black">▶</span>}
              </button>
              <button aria-label="Forward" onClick={() => onSeek(Math.min(videoDuration, currentTime + 1))}><FastForward size={16} /></button>
              <button aria-label="Skip forward" onClick={() => onSeek(videoDuration)}><SkipForward size={16} /></button>
            </div>
            <p className="text-[13px] font-medium text-[#9e9eae]">{formatTimelineClock(videoDuration, fps)}</p>
          </div>
        </div>
      </section>

      <ProCutInspector
        audio={audio}
        currentScene={currentScene}
        sceneIndex={sceneIndex}
        scenes={scenes}
        story={story}
        videoDuration={videoDuration}
        onAddMusic={onAddMusic}
        onAddSfx={onAddSfx}
        onAddVoice={onAddVoice}
        onChange={onChange}
        onSplitFrame={onSplitFrame}
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
      <ChevronDown size={14} className="text-[#9e9eae]" />
    </div>
  )
}

function ProCutInspector({
  audio,
  currentScene,
  sceneIndex,
  scenes,
  story,
  videoDuration,
  onAddMusic,
  onAddSfx,
  onAddVoice,
  onChange,
  onSplitFrame,
}: {
  audio: NonNullable<Module3Story['audio']>
  currentScene: Module3Scene | undefined
  sceneIndex: number
  scenes: Module3Scene[]
  story: Module3Story
  videoDuration: number
  onAddMusic: () => void
  onAddSfx: () => void
  onAddVoice: () => void
  onChange: (story: Module3Story) => void
  onSplitFrame: () => void
}) {
  const musicStart = Number(audio.musicStart || 0)
  const musicDuration = Number(audio.musicDuration || Math.max(0, videoDuration - musicStart))
  const selectedName = currentScene?.image ? fileNameFromPath(currentScene.image) : `${getSceneMediaType(currentScene)} clip`
  const mediaType = getSceneMediaType(currentScene)
  return (
    <aside className="flex min-h-0 w-[380px] flex-col bg-[#17171c]">
      <PaneHeader icon={<Settings size={14} />} title="Inspector / Properties" />
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase text-[#626272]">Selected Clip</p>
          <p className="truncate text-[13px] font-bold text-[#f1f1f6]">{selectedName}</p>
        </div>
        <InspectorDivider />

        <InspectorSection title="Media">
          <label className="grid gap-1 text-[10px] text-[#626272]">
            Source
            <input value={currentScene?.image || ''} onChange={(event) => updateSceneAt(story, scenes, sceneIndex, { image: event.target.value, media_type: normalizeSceneMediaType(currentScene?.media_type, event.target.value) }, onChange)} className="h-8 rounded border border-[#2d2d37] bg-[#111115] px-2 text-[11px] text-[#f1f1f6] outline-none focus:border-[#ff6200]" />
          </label>
          <label className="grid gap-1 text-[10px] text-[#626272]">
            Clip type
            <select value={mediaType} onChange={(event) => updateSceneAt(story, scenes, sceneIndex, { media_type: event.target.value }, onChange)} className="h-8 rounded border border-[#2d2d37] bg-[#111115] px-2 text-[11px] text-[#f1f1f6] outline-none focus:border-[#ff6200]">
              <option value="image">Frame / Image</option>
              <option value="video">Video clip</option>
            </select>
          </label>
        </InspectorSection>

        <InspectorSection title="Transform">
          <div className="grid grid-cols-2 gap-3">
            <InspectorReadout label="Position X" value="960.0 px" />
            <InspectorReadout label="Position Y" value="540.0 px" />
          </div>
          <label className="grid gap-1 text-[10px] text-[#626272]">
            Duration
            <input type="number" min="0.5" step="0.1" value={currentScene?.duration || 0} onChange={(event) => updateSceneAt(story, scenes, sceneIndex, { duration: Number(event.target.value) || 0.5, timing: undefined }, onChange)} className="h-8 rounded border border-[#2d2d37] bg-[#111115] px-2 text-[11px] text-[#f1f1f6] outline-none focus:border-[#ff6200]" />
          </label>
          <label className="grid gap-1 text-[10px] text-[#626272]">
            Effect
            <select value={currentScene?.effect || 'slow-zoom'} onChange={(event) => updateSceneAt(story, scenes, sceneIndex, { effect: event.target.value }, onChange)} className="h-8 rounded border border-[#2d2d37] bg-[#111115] px-2 text-[11px] text-[#f1f1f6] outline-none focus:border-[#ff6200]">
              <option value="none">none</option>
              <option value="slow-zoom">slow-zoom</option>
              <option value="pan-right">pan-right</option>
              <option value="shake-reveal">shake-reveal</option>
            </select>
          </label>
        </InspectorSection>

        <InspectorDivider />
        <InspectorSection title="Text">
          <label className="grid gap-1 text-[10px] text-[#626272]">
            Subtitle
            <textarea value={currentScene?.subtitle || ''} onChange={(event) => updateSceneAt(story, scenes, sceneIndex, { subtitle: event.target.value }, onChange)} className="h-24 resize-none rounded border border-[#2d2d37] bg-[#111115] p-2 text-[11px] text-[#f1f1f6] outline-none focus:border-[#ff6200]" />
          </label>
          <button onClick={onSplitFrame} className="h-8 rounded bg-[#ff6200] px-3 text-[11px] font-semibold text-white">Split current + insert frame</button>
        </InspectorSection>

        <InspectorDivider />
        <InspectorSection title="Audio">
          <div className="grid grid-cols-3 gap-2">
            <button onClick={onAddVoice} className="h-8 rounded border border-[#2d2d37] bg-[#1e1e24] text-[11px] font-semibold text-[#f1f1f6]">Voice</button>
            <button onClick={onAddMusic} className="h-8 rounded border border-[#2d2d37] bg-[#1e1e24] text-[11px] font-semibold text-[#f1f1f6]">Music</button>
            <button onClick={onAddSfx} className="h-8 rounded border border-[#2d2d37] bg-[#1e1e24] text-[11px] font-semibold text-[#f1f1f6]">SFX</button>
          </div>
          <label className="grid gap-1 text-[10px] text-[#626272]">
            Music audio path
            <input value={audio.music || ''} onChange={(event) => updateAudio(story, onChange, { music: event.target.value })} placeholder="assets/audio/demo-ambient.wav" className="h-8 rounded border border-[#2d2d37] bg-[#111115] px-2 text-[11px] text-[#f1f1f6] outline-none focus:border-[#ff6200]" />
          </label>
          <InspectorSlider label="Voice volume" max={1.5} value={audio.voiceVolume ?? 1} onChange={(value) => updateAudio(story, onChange, { voiceVolume: value })} />
          <InspectorSlider label="Music volume" max={0.5} value={audio.musicVolume || 0} onChange={(value) => updateAudio(story, onChange, { musicVolume: value })} />
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-[10px] text-[#626272]">
              Music start
              <input type="number" min="0" step="0.1" value={musicStart} onChange={(event) => updateAudio(story, onChange, { musicStart: clampNumber(Number(event.target.value) || 0, 0, videoDuration) })} className="h-8 rounded border border-[#2d2d37] bg-[#111115] px-2 text-[11px] text-[#f1f1f6]" />
            </label>
            <label className="grid gap-1 text-[10px] text-[#626272]">
              Music duration
              <input type="number" min="0.5" step="0.1" value={musicDuration} onChange={(event) => updateAudio(story, onChange, { musicDuration: Math.max(0.5, Number(event.target.value) || 0.5) })} className="h-8 rounded border border-[#2d2d37] bg-[#111115] px-2 text-[11px] text-[#f1f1f6]" />
            </label>
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

function InspectorReadout({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] text-[#626272]">{label}</p>
      <div className="flex h-8 items-center rounded border border-[#2d2d37] bg-[#111115] px-2 text-[11px] text-[#f1f1f6]">{value}</div>
    </div>
  )
}

function InspectorSlider({ label, max, value, onChange }: { label: string; max: number; value: number; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-1 text-[10px] text-[#626272]">
      <span className="flex items-center justify-between">
        <span>{label}</span>
        <span className="text-[11px] text-[#f1f1f6]">{value.toFixed(2)}</span>
      </span>
      <input type="range" min="0" max={max} step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value))} style={{ accentColor: '#ff6200' }} />
    </label>
  )
}

function ProCutTimelinePanel({
  audioMenu,
  audioSrc,
  dragRef,
  musicDragRef,
  musicDuration,
  musicLeft,
  musicSrc,
  musicStart,
  musicTracks,
  musicWidth,
  playheadLeft,
  sceneIndex,
  scenes,
  sfxTracks,
  story,
  subtitleDragRef,
  timelineRef,
  trackDragRef,
  videoDuration,
  voiceTracks,
  voiceWidth,
  onAudioMenuDelete,
  onChange,
  onContextMenuTrack,
  onResizeScene,
  onSeek,
  onSeekFromPointer,
  onSelect,
  onUpdateSubtitleTiming,
}: {
  audioMenu: { x: number; y: number; kind: 'legacy-music' | 'track'; trackId?: string } | null
  audioSrc: string
  dragRef: React.MutableRefObject<{ index: number; startX: number; leftDuration: number; rightDuration: number; totalDuration: number; timelineWidth: number } | null>
  musicDragRef: React.MutableRefObject<{ mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; totalDuration: number; timelineWidth: number } | null>
  musicDuration: number
  musicLeft: number
  musicSrc: string
  musicStart: number
  musicTracks: NonNullable<NonNullable<Module3Story['audio']>['tracks']>
  musicWidth: number
  playheadLeft: number
  sceneIndex: number
  scenes: Module3Scene[]
  sfxTracks: NonNullable<NonNullable<Module3Story['audio']>['tracks']>
  story: Module3Story
  subtitleDragRef: React.MutableRefObject<{ index: number; mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; timelineWidth: number } | null>
  timelineRef: React.RefObject<HTMLDivElement | null>
  trackDragRef: React.MutableRefObject<{ id: string; mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; timelineWidth: number } | null>
  videoDuration: number
  voiceTracks: NonNullable<NonNullable<Module3Story['audio']>['tracks']>
  voiceWidth: number
  onAudioMenuDelete: () => void
  onChange: (story: Module3Story) => void
  onContextMenuTrack: (event: React.MouseEvent<HTMLElement>, item: { kind: 'legacy-music' | 'track'; trackId?: string }) => void
  onResizeScene: (event: React.PointerEvent<HTMLButtonElement>) => void
  onSeek: (time: number) => void
  onSeekFromPointer: (clientX: number) => void
  onSelect: (index: number) => void
  onUpdateSubtitleTiming: (index: number, start: number, duration: number) => void
}) {
  const fps = story.video?.fps || 30
  return (
    <section className="h-[360px] shrink-0 overflow-hidden border-t border-[#2d2d37] bg-[#111115]">
      <div className="relative h-full">
        <FrameRuler duration={videoDuration} fps={fps} headerWidth={142} onSeek={onSeek} />
        <div
          data-no-seek="true"
          className="absolute bottom-0 top-[30px] z-30 -ml-2 flex w-4 cursor-ew-resize justify-center"
          style={{ left: `calc(142px + (100% - 142px) * ${playheadLeft / 100})` }}
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
          <ProCutTrack label="Video 2" icon={<Film size={13} />} muted locked>
            <div className="relative h-12 border border-[#2d2d37] bg-[#141419]" />
          </ProCutTrack>
          <ProCutTrack label="Video 1" icon={<Film size={13} />} muted locked>
            <div ref={timelineRef} className="flex h-12 overflow-hidden border border-[#2d2d37] bg-[#141419]">
              {scenes.map((scene, index) => {
                const width = Math.max(7, videoDuration ? (Number(scene.duration || 0) / videoDuration) * 100 : 0)
                const mediaType = getSceneMediaType(scene)
                return (
                  <div key={`${scene.image}-${index}`} className={`relative border-r border-[#111115] bg-[#ff6200] ${index === sceneIndex ? 'ring-2 ring-inset ring-white' : ''}`} style={{ width: `${width}%` }}>
                    <button onClick={() => onSelect(index)} className="h-full w-full overflow-hidden text-left">
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

          <ProCutTrack label="Text 1" icon={<Type size={13} />} muted locked>
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
                      className="absolute left-2 top-1 z-20 max-w-[calc(100%-24px)] cursor-grab truncate rounded px-1.5 py-0.5 text-[10px] font-black uppercase text-[#111115] active:cursor-grabbing"
                    >
                      T Title: {scene.subtitle}
                    </button>
                    <input
                      data-no-seek="true"
                      value={scene.subtitle || ''}
                      onFocus={() => onSelect(index)}
                      onChange={(event) => updateSceneAt(story, scenes, index, { subtitle: event.target.value }, onChange)}
                      title={scene.subtitle || `Scene ${index + 1}`}
                      className="h-full w-full min-w-0 truncate border-0 bg-transparent px-3 pl-20 text-left text-[11px] font-semibold text-[#111115] outline-none"
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

          <ProCutTrack label="Audio 1" icon={<Volume2 size={13} />} muted locked>
            <div className="relative h-16 overflow-hidden border border-[#2d2d37] bg-[#141419]">
              {musicSrc ? (
                <div
                  onContextMenu={(event) => onContextMenuTrack(event, { kind: 'legacy-music' })}
                  className="absolute top-2 h-12 overflow-hidden rounded border border-[#00e5c9] bg-[#123232]"
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
                    <span className="absolute left-4 top-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-semibold text-[#00e5c9]">{fileNameFromPath(musicSrc)}</span>
                    <WaveformCanvas src={musicSrc} color="#00e5c9" className="h-full w-full pt-4" />
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

          <ProCutTrack label="Audio 2" icon={<Music size={13} />} muted locked>
            <div className="relative h-16 overflow-hidden border border-[#2d2d37] bg-[#141419]">
              {audioSrc ? <WaveformCanvas src={audioSrc} color="#00e5c9" className="absolute inset-y-2 left-0 rounded border border-[#00e5c9] bg-[#123232]" style={{ width: `${voiceWidth}%` }} /> : null}
            </div>
          </ProCutTrack>

          <AudioLane label="Voices" tracks={voiceTracks} story={story} videoDuration={videoDuration} timelineRef={timelineRef} trackDragRef={trackDragRef} onSeek={onSeek} onSelect={onSelect} scenes={scenes} onContextMenuTrack={onContextMenuTrack} onChange={onChange} allowLaneSeek={false} />
          <AudioLane label="Music" tracks={musicTracks} story={story} videoDuration={videoDuration} timelineRef={timelineRef} trackDragRef={trackDragRef} onSeek={onSeek} onSelect={onSelect} scenes={scenes} onContextMenuTrack={onContextMenuTrack} onChange={onChange} stacked allowLaneSeek={false} />
          <AudioLane label="SFX" tracks={sfxTracks} story={story} videoDuration={videoDuration} timelineRef={timelineRef} trackDragRef={trackDragRef} onSeek={onSeek} onSelect={onSelect} scenes={scenes} onContextMenuTrack={onContextMenuTrack} onChange={onChange} allowLaneSeek={false} />
        </div>
      </div>
    </section>
  )
}

function ProCutTrack({ children, icon, label, locked, muted }: { children: React.ReactNode; icon: React.ReactNode; label: string; locked?: boolean; muted?: boolean }) {
  return (
    <div className="grid grid-cols-[142px_minmax(0,1fr)]">
      <div className="flex h-full min-h-12 items-center justify-between border border-[#2d2d37] bg-[#17171c] px-3 text-[11px] font-bold text-[#9e9eae]">
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate">{label}</span>
        </span>
        <span className="flex items-center gap-2 text-[#626272]">
          {muted ? <Eye size={13} /> : null}
          {locked ? <Lock size={13} /> : null}
        </span>
      </div>
      {children}
    </div>
  )
}

function getStoryProjectName(story: Module3Story) {
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
  const ticks = Array.from({ length: Math.max(2, Math.min(12, Math.ceil(duration / 3) + 1)) })
  return (
    <div
      className="flex h-[30px] cursor-pointer items-end justify-between border-b border-[#2d2d37] pb-1 pr-3 text-[10px] font-medium text-[#626272]"
      style={{ marginLeft: headerWidth }}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        onSeek(((event.clientX - rect.left) / Math.max(1, rect.width)) * duration)
      }}
    >
      {ticks.map((_, index) => {
        const seconds = (duration * index) / Math.max(1, ticks.length - 1)
        return <span key={index}>{seconds.toFixed(1)}s · f{Math.round(seconds * fps)}</span>
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

function AudioLane({
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
  tracks: NonNullable<NonNullable<Module3Story['audio']>['tracks']>
  story: Module3Story
  videoDuration: number
  timelineRef: React.RefObject<HTMLDivElement | null>
  trackDragRef: React.MutableRefObject<{ id: string; mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; timelineWidth: number } | null>
  onSeek: (time: number) => void
  onSelect: (index: number) => void
  scenes: Module3Scene[]
  onContextMenuTrack: (event: React.MouseEvent<HTMLElement>, item: { kind: 'legacy-music' | 'track'; trackId?: string }) => void
  onChange: (story: Module3Story) => void
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
          const src = track.src ? module3MediaUrl(track.src) : ''
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
    const width = canvas.clientWidth || 600
    const height = canvas.clientHeight || 40
    canvas.width = width * window.devicePixelRatio
    canvas.height = height * window.devicePixelRatio
    context.scale(window.devicePixelRatio, window.devicePixelRatio)
    context.clearRect(0, 0, width, height)
    context.fillStyle = 'rgba(255,255,255,0.06)'
    context.fillRect(0, 0, width, height)

    fetch(src)
      .then((response) => response.arrayBuffer())
      .then(async (buffer) => {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
        const audioContext = new AudioContextClass()
        const decoded = await audioContext.decodeAudioData(buffer.slice(0))
        const data = decoded.getChannelData(0)
        const bars = Math.max(80, Math.floor(width / 4))
        context.clearRect(0, 0, width, height)
        context.fillStyle = 'rgba(255,255,255,0.05)'
        context.fillRect(0, 0, width, height)
        context.fillStyle = color
        for (let index = 0; index < bars; index += 1) {
          const start = Math.floor((index / bars) * data.length)
          const end = Math.floor(((index + 1) / bars) * data.length)
          let peak = 0
          for (let cursor = start; cursor < end; cursor += 1) {
            peak = Math.max(peak, Math.abs(data[cursor] || 0))
          }
          if (cancelled) return
          const barHeight = Math.max(2, peak * height * 0.9)
          const x = (index / bars) * width
          context.fillRect(x, (height - barHeight) / 2, Math.max(1, width / bars - 1), barHeight)
        }
        void audioContext.close()
      })
      .catch(() => {
        context.strokeStyle = color
        context.lineWidth = 2
        context.beginPath()
        for (let x = 0; x < width; x += 4) {
          const y = height / 2 + Math.sin(x / 8) * height * 0.28
          if (x === 0) context.moveTo(x, y)
          else context.lineTo(x, y)
        }
        context.stroke()
      })

    return () => {
      cancelled = true
    }
  }, [color, src])

  return <canvas ref={canvasRef} className={className} style={style} />
}

function SceneMediaPreview({ scene, playing, imageClass }: { scene: Module3Scene; playing: boolean; imageClass: string }) {
  const src = scene.image || defaultMediaForType(getSceneMediaType(scene))
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
        src={src}
        muted
        playsInline
        autoPlay={playing}
        loop
        className="h-full w-full object-cover"
      />
    )
  }
  return (
    <img
      src={src}
      alt=""
      className={`h-full w-full object-cover transition-transform duration-[4000ms] ease-linear ${playing ? imageClass : ''}`}
    />
  )
}

function SceneMediaThumb({ scene, className }: { scene: Module3Scene; className: string }) {
  const src = scene.image || defaultMediaForType(getSceneMediaType(scene))
  if (getSceneMediaType(scene) === 'video') {
    return (
      <div className={`relative overflow-hidden bg-black ${className}`}>
        {src ? <video src={src} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : null}
        <Film size={14} className="absolute left-1 top-1 text-white drop-shadow" />
      </div>
    )
  }
  return <img src={src} alt="" className={className} />
}

function updateSceneAt(story: Module3Story, scenes: Module3Scene[], index: number, patch: Partial<Module3Scene>, onChange: (story: Module3Story) => void) {
  onChange(updateRenderScenes(story, scenes.map((scene, currentIndex) => currentIndex === index ? { ...scene, ...patch } : scene)))
}

function storyTimelineScenes(story: Module3Story): Module3Scene[] {
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
    const textStart = typeof textClip?.start === 'number' ? textClip.start : Number(clip.start || 0)
    const textEnd = typeof textClip?.end === 'number' ? textClip.end : textStart + duration
    return {
      duration,
      image: String(clip.src || defaultMediaForType(mediaType)),
      media_type: mediaType,
      effect: String(clip.effect || 'slow-zoom'),
      subtitle: String(textClip?.text || ''),
      subtitle_start: textStart,
      subtitle_duration: Math.max(0.1, textEnd - textStart),
      text_style: textClip?.style || {},
      timing: textClip?.timing,
    }
  })
}

function storyAudioTracks(story: Module3Story, videoDuration: number) {
  const timelineTracks = (story.timeline?.audio || []).map((clip) => ({
    id: clip.id,
    type: clip.type as 'voice' | 'music' | 'sfx',
    src: clip.src || '',
    start: Number(clip.start || 0),
    duration: typeof clip.end === 'number' ? Math.max(0.1, clip.end - Number(clip.start || 0)) : Math.max(0.1, videoDuration - Number(clip.start || 0)),
    volume: typeof clip.volume === 'number' ? clip.volume : 1,
  }))
  const merged = new Map<string, NonNullable<NonNullable<Module3Story['audio']>['tracks']>[number]>()
  timelineTracks.forEach((track) => merged.set(track.id, track))
  ;(story.audio?.tracks || []).forEach((track) => merged.set(track.id, track))
  return Array.from(merged.values())
}

function storyAudioTimeline(story: Module3Story, fallbackDuration: number) {
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="text-xs font-black uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-black text-[#0f172a]">{value}</div>
    </div>
  )
}

function Timeline({
  fps,
  scenes,
  totalDuration,
  timelineRef,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  fps: number
  scenes: Module3Scene[]
  totalDuration: number
  timelineRef: React.RefObject<HTMLDivElement | null>
  onSelect: (index: number) => void
  onDragStart: (event: React.PointerEvent<HTMLButtonElement>, index: number) => void
  onDragMove: (event: PointerEvent) => void
  onDragEnd: () => void
}) {
  useEffect(() => {
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', onDragEnd)
    return () => {
      window.removeEventListener('pointermove', onDragMove)
      window.removeEventListener('pointerup', onDragEnd)
    }
  }, [onDragMove, onDragEnd])

  let frameStart = 0

  return (
    <div className="grid gap-2">
      <div ref={timelineRef} className="flex h-12 overflow-hidden rounded-lg bg-slate-100">
        {scenes.map((scene, index) => {
          const width = Math.max(5, totalDuration ? (Number(scene.duration || 0) / totalDuration) * 100 : 0)
          return (
            <div key={index} className="relative flex items-center justify-center border-r border-white bg-[#dbeafe] text-xs font-black text-[#1d4ed8]" style={{ width: `${width}%` }}>
              <button onClick={() => onSelect(index)} className="h-full w-full">S{index + 1}</button>
              {index < scenes.length - 1 && (
                <button
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId)
                    onDragStart(event, index)
                  }}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize bg-[#2563eb]"
                  aria-label={`Resize scene ${index + 1}`}
                />
              )}
            </div>
          )
        })}
      </div>
      <div className="grid gap-1 text-xs font-semibold text-slate-500 sm:grid-cols-2">
        {scenes.map((scene, index) => {
          const frames = Math.round(Number(scene.duration || 0) * fps)
          const endFrame = frameStart + frames - 1
          const label = `S${index + 1}: ${Number(scene.duration || 0).toFixed(2)}s · frames ${frameStart}-${endFrame}`
          frameStart += frames
          return <div key={index}>{label}</div>
        })}
      </div>
    </div>
  )
}

function BackgroundMusicEditor({
  story,
  totalDuration,
  timelineRef,
  musicDragRef,
  onChange,
}: {
  story: Module3Story | null
  totalDuration: number
  timelineRef: React.RefObject<HTMLDivElement | null>
  musicDragRef: React.MutableRefObject<{ mode: 'move' | 'trim-start' | 'trim-end'; startX: number; start: number; duration: number; totalDuration: number; timelineWidth: number } | null>
  onChange: (story: Module3Story) => void
}) {
  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      if (!story || !musicDragRef.current) return
      const drag = musicDragRef.current
      if (drag.mode !== 'move') return
      const secondsPerPixel = drag.totalDuration / Math.max(1, drag.timelineWidth)
      const nextStart = drag.start + (event.clientX - drag.startX) * secondsPerPixel
      updateAudio(story, onChange, { musicStart: clampNumber(nextStart, 0, Math.max(0, totalDuration - drag.duration)) })
    }
    const handleEnd = () => {
      musicDragRef.current = null
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleEnd)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleEnd)
    }
  }, [musicDragRef, onChange, story, totalDuration])

  if (!story) return null

  const audio = story.audio || {}
  const music = audio.music || ''
  const musicStart = Number(audio.musicStart || 0)
  const musicDuration = Number(audio.musicDuration || Math.max(0, totalDuration - musicStart))
  const left = totalDuration ? (musicStart / totalDuration) * 100 : 0
  const width = totalDuration ? Math.max(4, (musicDuration / totalDuration) * 100) : 0
  const musicSrc = music ? module3MediaUrl(music) : ''

  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-black text-[#0f172a]">Nhạc nền</div>
        <button
          onClick={() => updateAudio(story, onChange, { music: 'assets/audio/demo-ambient.wav', musicVolume: audio.musicVolume || 0.12, musicStart: audio.musicStart || 0, musicDuration: audio.musicDuration || totalDuration })}
          className="h-8 rounded-md bg-[var(--primary)] px-3 text-xs font-semibold text-white"
        >
          Chèn nhạc demo
        </button>
      </div>
      <input
        value={music}
        onChange={(event) => updateAudio(story, onChange, { music: event.target.value })}
        placeholder="assets/audio/demo-ambient.wav"
        className="h-9 rounded border border-slate-200 px-2 text-xs"
      />
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="grid gap-1 text-xs font-bold text-slate-600">
          Volume {(audio.musicVolume ?? 0).toFixed(2)}
          <input
            type="range"
            min="0"
            max="0.5"
            step="0.01"
            value={audio.musicVolume || 0}
            onChange={(event) => updateAudio(story, onChange, { musicVolume: Number(event.target.value) })}
          />
        </label>
        <label className="grid gap-1 text-xs font-bold text-slate-600">
          Start
          <input type="number" min="0" step="0.1" value={musicStart} onChange={(event) => updateAudio(story, onChange, { musicStart: clampNumber(Number(event.target.value) || 0, 0, totalDuration) })} className="h-8 rounded border border-slate-200 px-2" />
        </label>
        <label className="grid gap-1 text-xs font-bold text-slate-600">
          Duration
          <input type="number" min="0.5" step="0.1" value={musicDuration} onChange={(event) => updateAudio(story, onChange, { musicDuration: Math.max(0.5, Number(event.target.value) || 0.5) })} className="h-8 rounded border border-slate-200 px-2" />
        </label>
      </div>
      <div className="relative h-10 overflow-hidden rounded-lg bg-slate-200">
        <div className="absolute inset-y-0 left-0 w-px bg-slate-400" />
        {music ? (
          <button
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              musicDragRef.current = {
                mode: 'move',
                startX: event.clientX,
                start: musicStart,
                duration: musicDuration,
                totalDuration,
                timelineWidth: timelineRef.current?.getBoundingClientRect().width || event.currentTarget.parentElement?.getBoundingClientRect().width || 1,
              }
            }}
            className="absolute top-1 h-8 cursor-grab rounded bg-[#a855f7] px-2 text-left text-xs font-black text-white active:cursor-grabbing"
            style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
          >
            Music {musicStart.toFixed(1)}s
          </button>
        ) : null}
      </div>
      {musicSrc && <audio src={musicSrc} controls className="w-full" />}
    </div>
  )
}

function SceneEditor({
  story,
  scenes,
  sceneIndex,
  onSelect,
  onChange,
}: {
  story: Module3Story | null
  scenes: Module3Scene[]
  sceneIndex: number
  onSelect: (index: number) => void
  onChange: (story: Module3Story, nextIndex?: number) => void
}) {
  if (!story) return null

  const updateScene = (index: number, patch: Partial<Module3Scene>) => {
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

  const addScene = (scene: Module3Scene = emptyFrameScene()) => {
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
          <div key={index} className={`grid gap-2 rounded-lg border p-2 ${index === sceneIndex ? 'border-[#2563eb] bg-white' : 'border-slate-200 bg-white/70'}`}>
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
            <div className="grid gap-2 sm:grid-cols-[90px_1fr_120px]">
              <input type="number" min="1" step="0.5" value={scene.duration} onChange={(event) => updateScene(index, { duration: Number(event.target.value) || 4 })} className="h-8 rounded border border-slate-200 px-2 text-xs" />
              <input value={scene.subtitle} onChange={(event) => updateScene(index, { subtitle: event.target.value })} className="h-8 rounded border border-slate-200 px-2 text-xs" placeholder="Subtitle" />
              <select value={scene.effect} onChange={(event) => updateScene(index, { effect: event.target.value })} className="h-8 rounded border border-slate-200 px-2 text-xs">
                <option value="slow-zoom">slow-zoom</option>
                <option value="pan-right">pan-right</option>
                <option value="shake-reveal">shake-reveal</option>
              </select>
            </div>
            {scene.timing && (
              <div className="text-[11px] font-semibold text-slate-500">
                Voice timestamp: {Number(scene.timing.start || 0).toFixed(2)}s - {Number(scene.timing.end || 0).toFixed(2)}s
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function updateRenderScenes(story: Module3Story, scenes: Module3Scene[]): Module3Story {
  const fps = story.video?.fps || 30
  let cursor = 0
  let previousTextEnd = 0
  const video = scenes.map((scene, index) => {
    const duration = Math.max(1 / fps, Number(scene.duration || 4))
    const start = roundToFrame(cursor, fps)
    const end = roundToFrame(cursor + duration, fps)
    cursor = end
    const mediaType = getSceneMediaType(scene)
    return {
      id: story.timeline?.video?.[index]?.id || `video-${index + 1}`,
      type: mediaType,
      start,
      end,
      duration: roundToFrame(end - start, fps),
      src: scene.image || defaultMediaForType(mediaType),
      effect: scene.effect || 'slow-zoom',
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
  const { scenes: _legacyScenes, story_data: _legacyStoryData, ...rest } = story as Module3Story & { scenes?: Module3Scene[]; story_data?: Module3Scene[] }
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

function updateStoryAfterTimelineInsert(story: Module3Story, scenes: Module3Scene[], insertTime: number, insertedDuration: number): Module3Story {
  const audio = story.audio || {}
  const tracks = (audio.tracks || []).map((track) => {
    const start = Number(track.start || 0)
    const duration = Number(track.duration || 0)
    const end = start + duration
    if (start >= insertTime) {
      return { ...track, start: roundToQuarter(start + insertedDuration) }
    }
    if (duration && end > insertTime) {
      return { ...track, duration: roundToQuarter(duration + insertedDuration) }
    }
    return track
  })
  const nextAudio = {
    ...audio,
    tracks,
    musicStart: typeof audio.musicStart === 'number' && audio.musicStart >= insertTime
      ? roundToQuarter(audio.musicStart + insertedDuration)
      : audio.musicStart,
    musicDuration: audio.musicDuration && Number(audio.musicStart || 0) < insertTime && Number(audio.musicStart || 0) + audio.musicDuration > insertTime
      ? roundToQuarter(audio.musicDuration + insertedDuration)
      : audio.musicDuration,
  }
  return updateRenderScenes({ ...story, audio: nextAudio }, scenes)
}

function sceneStartTime(scenes: Module3Scene[], index: number) {
  return scenes.slice(0, Math.max(0, index)).reduce((total, scene) => total + Number(scene.duration || 0), 0)
}

function getSubtitleStart(scenes: Module3Scene[], index: number) {
  const scene = scenes[index] as any
  const value = scene?.subtitle_start ?? scene?.subtitleStart
  return typeof value === 'number' ? value : sceneStartTime(scenes, index)
}

function getSubtitleDuration(scenes: Module3Scene[], index: number) {
  const scene = scenes[index] as any
  const value = scene?.subtitle_duration ?? scene?.subtitleDuration
  return typeof value === 'number' ? Math.max(0.1, value) : Number(scenes[index]?.duration || 0.1)
}

function activeSubtitleSceneIndexAtTime(scenes: Module3Scene[], time: number) {
  return scenes.findIndex((scene, index) => {
    const subtitle = String(scene.subtitle || '').trim()
    if (!subtitle) return false
    const start = getSubtitleStart(scenes, index)
    const duration = getSubtitleDuration(scenes, index)
    return time >= start && time <= start + duration
  })
}

function sceneIndexAtTime(scenes: Module3Scene[], time: number) {
  let cursor = 0
  for (let index = 0; index < scenes.length; index += 1) {
    cursor += Number(scenes[index].duration || 0)
    if (time < cursor) return index
  }
  return Math.max(0, scenes.length - 1)
}

function updateAudio(story: Module3Story, onChange: (story: Module3Story) => void, patch: NonNullable<Module3Story['audio']>) {
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
  story: Module3Story,
  onChange: (story: Module3Story) => void,
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

function removeAudioTrack(story: Module3Story, onChange: (story: Module3Story) => void, trackId: string) {
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

function emptyScene(): Module3Scene {
  return emptyFrameScene()
}

function emptyFrameScene(): Module3Scene {
  return {
    duration: 4,
    image: 'assets/images/001-signal-room.png',
    media_type: 'image',
    effect: 'slow-zoom',
    subtitle: '',
  }
}

function emptyVideoScene(): Module3Scene {
  return {
    duration: 4,
    image: '',
    media_type: 'video',
    effect: 'none',
    subtitle: '',
  }
}

function getSceneMediaType(scene?: Partial<Module3Scene> | null) {
  return normalizeSceneMediaType(scene?.media_type, scene?.image)
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

function getProjectTitle(handoff: Module3Handoff | null) {
  if (!handoff) return 'Module 3 · Video Detail'
  const payload = handoff.payload || {}
  const sourceContent = payload.source_content && typeof payload.source_content === 'object'
    ? payload.source_content as Record<string, any>
    : null
  return (
    handoff.title ||
    String(payload.plan_title || '') ||
    String(payload.series_title || '') ||
    String(sourceContent?.canonical_title || '') ||
    handoff.handoff_note ||
    'Module 3 · Video Detail'
  )
}

function inferProjectStatus(handoff: Module3Handoff | null, story: Module3Story | null) {
  const projectStatus = handoff?.project_status || String(getVideoProjectPayload(handoff)?.project_status || '')
  if (projectStatus) return projectStatus
  if (getVideoArtifacts(handoff)?.final) return 'RENDERED'
  if (story?.audio?.voice) return 'VOICE_READY'
  if (story) return 'EDITING'
  return handoff?.status || 'READY'
}

function inferActiveStepFromProject(handoff: Module3Handoff | null, story: Module3Story | null): StepId {
  const artifacts = getVideoArtifacts(handoff)
  if (artifacts?.final) return 'preview'
  if (story) {
    if (story.audio?.voice || storyAudioTracks(story, story.timeline?.duration || 0).some((track) => track.type === 'voice')) return 'fit'
    return 'video'
  }
  return 'raw'
}

function getVideoProjectPayload(handoff: Module3Handoff | null) {
  const payload = handoff?.payload || {}
  const project = payload.video_project
  return project && typeof project === 'object' ? project as Record<string, any> : null
}

function getVideoArtifacts(handoff: Module3Handoff | null) {
  const artifacts = getVideoProjectPayload(handoff)?.video_artifacts
  return artifacts && typeof artifacts === 'object' ? artifacts as Record<string, any> : null
}

function getVideoTimelinePayload(handoff: Module3Handoff | null) {
  const timeline = getVideoProjectPayload(handoff)?.timeline
  return timeline && typeof timeline === 'object' ? timeline as Record<string, any> : null
}

function stripVoiceTags(text: string) {
  return text.replace(/\[[^\]]+\]\s*/g, '')
}

function roundToQuarter(value: number) {
  return Math.max(0.5, Math.round(value * 4) / 4)
}

function roundToFrame(value: number, fps: number) {
  return Math.max(0.5, Math.round(value * fps) / fps)
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function parseOptionalJson(value: string) {
  if (!value.trim()) return undefined
  return JSON.parse(value)
}
