import { AlertTriangle, Check, FileText, Film, Mic2, Sparkles } from 'lucide-react'
import type { VideoWorkflowProgress, VideoWorkflowTask } from '@/commons/apis/generateVideo'

type WorkflowProgressProps = {
  progress: VideoWorkflowProgress | null
  compact?: boolean
}

const phases = [
  { key: 'script', label: 'Kịch bản', icon: FileText },
  { key: 'draft', label: 'Draft', icon: Sparkles },
  { key: 'voice', label: 'Voice', icon: Mic2 },
  { key: 'render', label: 'Render', icon: Film },
  { key: 'done', label: 'Hoàn tất', icon: Check },
] as const

const stageLabels: Record<string, string> = {
  QUEUED_SCRIPT: 'Đang chờ tạo kịch bản',
  LOADING_SOURCE: 'Đang đọc nội dung nguồn',
  GENERATING_DRAFT: 'AI đang viết kịch bản & draft',
  NORMALIZING_DRAFT: 'Đang chuẩn hóa timeline',
  APPLYING_SERIES: 'Đang chọn & cập nhật series',
  SAVING_DRAFT: 'Đang lưu draft',
  DRAFT_READY: 'Draft đã sẵn sàng',
  DRAFT_REVIEW_REQUIRED: 'Draft cần người dùng duyệt',
  QUEUED_EDIT: 'Đang chờ AI chỉnh sửa',
  EDITING_DRAFT: 'AI đang chỉnh sửa draft',
  QUEUED_REVIEW: 'Đang chờ AI review',
  REVIEWING_DRAFT: 'AI đang kiểm tra kịch bản',
  REVIEW_COMPLETE: 'AI review hoàn tất',
  QUEUED_VOICE: 'Đang chờ tạo voice NamMinh',
  PREPARING_VOICE: 'Đang chuẩn bị nội dung đọc',
  GENERATING_VOICE: 'Đang tổng hợp voice NamMinh',
  ALIGNING_VOICE: 'Đang căn voice với timeline',
  SAVING_VOICE: 'Đang lưu voice & timing',
  VOICE_READY: 'Voice đã sẵn sàng',
  QUEUED_RENDER: 'Đang chờ render video',
  QUEUED_RENDER_AFTER_VOICE: 'Render chờ voice hoàn tất',
  QUEUED_RENDER_AFTER_DRAFT: 'Render chờ draft hoàn tất',
  PREPARING_RENDER: 'Đang chuẩn bị composition',
  RENDERING_VIDEO: 'Remotion đang render MP4',
  SAVING_VIDEO: 'Đang lưu video & artifact',
  RENDERED: 'Video MP4 đã sẵn sàng',
  FAILED: 'Tác vụ thất bại',
}

const activeTaskStatuses = new Set(['PENDING', 'RUNNING', 'PROCESSING'])
const activeTaskStatusPriority: Record<string, number> = { RUNNING: 3, PROCESSING: 2, PENDING: 1 }

export default function WorkflowProgress({ progress, compact = false }: WorkflowProgressProps) {
  if (!progress) return null
  const { task, running, failed, stage, activePhase, overallPercent, isPhaseCompleted } = computeWorkflowState(progress)

  if (compact) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-slate-200/80 bg-slate-50/70 p-2.5 backdrop-blur-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                failed
                  ? 'bg-rose-500 shadow-xs shadow-rose-400/50'
                  : running
                  ? 'bg-blue-500 workflow-status-pulse shadow-xs shadow-blue-400/50'
                  : 'bg-emerald-500'
              }`}
            />
            <span className="truncate text-xs font-bold text-slate-800">
              {stageLabels[String(stage || '').toUpperCase()] || humanizeStage(stage)}
            </span>
          </div>
          <span
            className={`shrink-0 text-xs font-extrabold tabular-nums ${
              failed ? 'text-rose-600' : running ? 'text-blue-600' : 'text-emerald-700'
            }`}
          >
            {Math.round(overallPercent)}%
          </span>
        </div>

        {/* Dynamic Progress Bar */}
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80">
          <div
            className={`absolute inset-y-0 left-0 transition-all duration-500 ease-out ${
              failed
                ? 'bg-gradient-to-r from-rose-500 to-red-600'
                : running
                ? 'bg-gradient-to-r from-blue-600 via-cyan-500 to-indigo-600'
                : 'bg-gradient-to-r from-emerald-500 to-teal-600'
            }`}
            style={{ width: `${overallPercent}%` }}
          />
          {running && !failed && (
            <span className="workflow-progress-scan absolute inset-y-0 w-16 bg-gradient-to-r from-transparent via-white/80 to-transparent" />
          )}
        </div>

        {/* Phase Node Stepper */}
        <div className="grid grid-cols-5 gap-1 pt-0.5">
          {phases.map((phase, index) => {
            const Icon = phase.icon
            const completed = isPhaseCompleted(index)
            const active = index === activePhase && !completed && !failed
            return (
              <div key={phase.key} className="flex flex-col items-center gap-0.5 text-center">
                <span
                  title={phase.label}
                  className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] transition-all ${
                    completed
                      ? 'bg-emerald-500 text-white shadow-xs'
                      : active
                      ? 'bg-blue-600 text-white workflow-active-node shadow-xs shadow-blue-400/40 ring-2 ring-blue-100'
                      : 'bg-slate-200 text-slate-400'
                  }`}
                >
                  {completed ? <Check size={10} strokeWidth={3} /> : <Icon size={9} />}
                </span>
                <span
                  className={`max-w-full truncate text-[9px] font-semibold leading-tight ${
                    active ? 'font-bold text-blue-700' : completed ? 'text-emerald-700' : 'text-slate-400'
                  }`}
                >
                  {phase.label}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <section
      className={`overflow-hidden rounded-xl border bg-white ${
        failed ? 'border-rose-200 shadow-rose-100/50' : 'border-slate-200/90 shadow-sm'
      } p-4`}
    >
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                failed
                  ? 'bg-rose-500 shadow-xs'
                  : running
                  ? 'bg-blue-600 workflow-status-pulse'
                  : 'bg-emerald-500'
              }`}
            />
            <strong className="truncate text-sm font-black text-slate-900">
              {stageLabels[String(stage || '').toUpperCase()] || humanizeStage(stage)}
            </strong>
          </div>
          <p className="mt-1 truncate text-xs text-slate-500">
            {task ? `${taskTypeLabel(task.task_type)} · ID ${task.id.slice(0, 8)}` : 'Chưa có tác vụ xử lý'}
          </p>
        </div>
        <div
          className={`shrink-0 text-base font-black tabular-nums ${
            failed ? 'text-rose-600' : 'text-slate-800'
          }`}
        >
          {Math.round(overallPercent)}%
        </div>
      </div>

      <div className="relative mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`absolute inset-y-0 left-0 transition-all duration-700 ${
            failed
              ? 'bg-rose-500'
              : 'bg-gradient-to-r from-blue-600 via-cyan-500 to-emerald-500'
          }`}
          style={{ width: `${overallPercent}%` }}
        />
        {running && !failed && (
          <span className="workflow-progress-scan absolute inset-y-0 w-20 bg-gradient-to-r from-transparent via-white/80 to-transparent" />
        )}
      </div>

      <div className="mt-4 grid grid-cols-5 gap-1">
        {phases.map((phase, index) => {
          const Icon = phase.icon
          const completed = isPhaseCompleted(index)
          const active = index === activePhase && !completed && !failed
          return (
            <div key={phase.key} className="relative flex min-w-0 flex-col items-center gap-1.5 text-center">
              {index > 0 && (
                <span
                  className={`absolute right-1/2 top-3 h-0.5 w-full ${
                    completed || active ? 'bg-emerald-400' : 'bg-slate-200'
                  }`}
                />
              )}
              <span
                className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full border transition-all ${
                  completed
                    ? 'border-emerald-500 bg-emerald-500 text-white shadow-xs'
                    : active
                    ? 'border-blue-600 bg-blue-50 text-blue-700 workflow-active-node shadow-xs'
                    : 'border-slate-200 bg-white text-slate-400'
                }`}
              >
                <Icon size={12} />
              </span>
              <span
                className={`max-w-full truncate text-[10px] font-bold ${
                  active ? 'text-blue-700' : completed ? 'text-emerald-700' : 'text-slate-400'
                }`}
              >
                {phase.label}
              </span>
            </div>
          )
        })}
      </div>

      {failed && task?.error_message && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-rose-500" />
          <span className="line-clamp-2">{task.error_message}</span>
        </div>
      )}

      {progress.tasks.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-slate-400">Hoạt động gần nhất</div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {progress.tasks.slice(0, 4).map((item) => (
              <div
                key={item.id}
                className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs"
              >
                <span className="truncate font-semibold text-slate-700">{taskTypeLabel(item.task_type)}</span>
                <span className={taskStatusClass(item.status)}>{taskStatusLabel(item.status)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function selectActiveTask(tasks: VideoWorkflowTask[]) {
  const active = tasks.filter((item) => activeTaskStatuses.has(item.status))
  if (!active.length) return null
  return active.reduce((best, item) => {
    const bestScore = activeTaskStatusPriority[best.status] || 0
    const itemScore = activeTaskStatusPriority[item.status] || 0
    if (itemScore !== bestScore) return itemScore > bestScore ? item : best
    return new Date(item.created_at).getTime() > new Date(best.created_at).getTime() ? item : best
  })
}

function computeWorkflowState(progress: VideoWorkflowProgress) {
  const activeTask = selectActiveTask(progress.tasks)
  const task = activeTask || progress.tasks[0] || null
  const running = Boolean(activeTask)
  const failed = task?.status === 'FAILED' || progress.status === 'FAILED'
  const stage = (activeTask?.current_stage || progress.current_stage || progress.status || '').toUpperCase()
  const wfStatus = (progress.status || '').toUpperCase()

  const isDone =
    ['RENDERED', 'VIDEO_APPROVED', 'QUEUED_FOR_PUBLISHING', 'PUBLISHED'].includes(wfStatus) ||
    stage === 'RENDERED'
  const isRendering = /RENDER/.test(stage) || activeTask?.task_type === 'GENERATE_VIDEO_RENDER'
  const isVoiceReady = stage === 'VOICE_READY'
  const isGeneratingVoice = /VOICE/.test(stage) || activeTask?.task_type === 'GENERATE_VIDEO_VOICE'
  const isDraftReady = stage === 'DRAFT_READY' || stage === 'REVIEW_COMPLETE'
  const isDrafting =
    /DRAFT|SCRIPT|EDIT|REVIEW/.test(stage) ||
    ['GENERATE_VIDEO_SCRIPT', 'GENERATE_VIDEO_EDIT', 'GENERATE_VIDEO_REVIEW'].includes(task?.task_type || '')

  let activePhase = 0
  let overallPercent = 0

  if (isDone) {
    activePhase = 4
    overallPercent = 100
  } else if (isRendering) {
    activePhase = 3
    const taskPct = Number(task?.progress_percent ?? 0)
    overallPercent = 60 + Math.round((taskPct / 100) * 35)
  } else if (isVoiceReady) {
    activePhase = 2
    overallPercent = 60
  } else if (isGeneratingVoice) {
    activePhase = 2
    const taskPct = Number(task?.progress_percent ?? 0)
    overallPercent = 25 + Math.round((taskPct / 100) * 35)
  } else if (isDraftReady) {
    activePhase = 1
    overallPercent = 25
  } else if (isDrafting) {
    activePhase = 1
    const taskPct = Number(task?.progress_percent ?? 0)
    overallPercent = Math.round((taskPct / 100) * 25)
  } else {
    activePhase = 0
    overallPercent = 0
  }

  const isPhaseCompleted = (index: number): boolean => {
    if (isDone) return true
    if (index === 0) return isDraftReady || isVoiceReady || isGeneratingVoice || isRendering || activePhase > 0
    if (index === 1) return isDraftReady || isVoiceReady || isRendering
    if (index === 2) return isVoiceReady || isRendering
    if (index === 3) return isDone
    if (index === 4) return isDone
    return false
  }

  return {
    activeTask,
    task,
    running,
    failed,
    stage,
    activePhase,
    overallPercent,
    isPhaseCompleted,
  }
}

function humanizeStage(value?: string | null) {
  return String(value || 'Sẵn sàng')
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase())
}

function taskTypeLabel(value: string) {
  const labels: Record<string, string> = {
    GENERATE_VIDEO_SCRIPT: 'Tạo draft',
    GENERATE_VIDEO_EDIT: 'Chỉnh sửa AI',
    GENERATE_VIDEO_REVIEW: 'AI review',
    GENERATE_VIDEO_VOICE: 'Tạo voice',
    GENERATE_VIDEO_RENDER: 'Render MP4',
  }
  return labels[value] || humanizeStage(value)
}

function taskStatusLabel(value: string) {
  const labels: Record<string, string> = {
    PENDING: 'Đang chờ',
    RUNNING: 'Đang chạy',
    PROCESSING: 'Đang chạy',
    COMPLETED: 'Hoàn tất',
    FAILED: 'Thất bại',
    CANCELLED: 'Đã hủy',
  }
  return labels[value] || value
}

function taskStatusClass(value: string) {
  if (value === 'FAILED') return 'shrink-0 font-bold text-rose-600'
  if (value === 'COMPLETED') return 'shrink-0 font-bold text-emerald-700'
  if (['PENDING', 'RUNNING', 'PROCESSING'].includes(value)) return 'shrink-0 font-bold text-blue-700'
  return 'shrink-0 font-bold text-slate-500'
}
