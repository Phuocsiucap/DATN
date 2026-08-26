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
  GENERATING_DRAFT: 'AI đang viết kịch bản và draft',
  NORMALIZING_DRAFT: 'Đang chuẩn hóa timeline',
  APPLYING_SERIES: 'Đang chọn và cập nhật series',
  SAVING_DRAFT: 'Đang lưu draft',
  DRAFT_READY: 'Draft đã sẵn sàng',
  QUEUED_EDIT: 'Đang chờ chỉnh sửa bằng AI',
  EDITING_DRAFT: 'AI đang chỉnh sửa draft',
  QUEUED_REVIEW: 'Đang chờ AI review',
  REVIEWING_DRAFT: 'AI đang kiểm tra kịch bản',
  REVIEW_COMPLETE: 'AI review hoàn tất',
  QUEUED_VOICE: 'Đang chờ tạo voice NamMinh',
  PREPARING_VOICE: 'Đang chuẩn bị nội dung đọc',
  GENERATING_VOICE: 'Đang tổng hợp voice NamMinh',
  ALIGNING_VOICE: 'Đang căn voice với timeline',
  SAVING_VOICE: 'Đang lưu voice và timing',
  VOICE_READY: 'Voice đã sẵn sàng',
  QUEUED_RENDER: 'Đang chờ render video',
  QUEUED_RENDER_AFTER_VOICE: 'Render sẽ chạy sau khi voice hoàn tất',
  QUEUED_RENDER_AFTER_DRAFT: 'Render sẽ chạy sau khi draft hoàn tất',
  PREPARING_RENDER: 'Đang chuẩn bị composition',
  RENDERING_VIDEO: 'Remotion đang render MP4',
  SAVING_VIDEO: 'Đang lưu video và artifact',
  RENDERED: 'Video MP4 đã sẵn sàng',
  FAILED: 'Tác vụ thất bại',
}

const activeTaskStatuses = new Set(['PENDING', 'RUNNING', 'PROCESSING'])
const activeTaskStatusPriority: Record<string, number> = { RUNNING: 3, PROCESSING: 2, PENDING: 1 }

export default function WorkflowProgress({ progress, compact = false }: WorkflowProgressProps) {
  if (!progress) return null
  const activeTask = selectActiveTask(progress.tasks)
  const task = activeTask || progress.tasks[0] || null
  const running = Boolean(activeTask)
  const failed = task?.status === 'FAILED' || progress.status === 'FAILED'
  const percent = Math.max(0, Math.min(100, Number(task?.progress_percent ?? progress.progress_percent ?? 0)))
  const stage = task?.current_stage || progress.current_stage || progress.status
  const activePhase = resolvePhase(task, progress.status)

  return (
    <section className={`overflow-hidden rounded-md border bg-white ${failed ? 'border-red-200' : 'border-slate-200'} ${compact ? 'px-3 py-2' : 'p-4 shadow-sm'}`}>
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${failed ? 'bg-red-500' : running ? 'bg-emerald-500 workflow-status-pulse' : 'bg-slate-400'}`} />
            <strong className="truncate text-xs text-slate-900">{stageLabels[String(stage || '').toUpperCase()] || humanizeStage(stage)}</strong>
          </div>
          {!compact && (
            <p className="mt-1 truncate text-[11px] text-slate-500">
              {task ? `${taskTypeLabel(task.task_type)} · ${task.id.slice(0, 8)}` : 'Chưa có tác vụ xử lý'}
            </p>
          )}
        </div>
        <div className={`shrink-0 font-black tabular-nums ${failed ? 'text-red-600' : 'text-slate-800'} ${compact ? 'text-xs' : 'text-sm'}`}>
          {Math.round(percent)}%
        </div>
      </div>

      <div className="relative mt-3 h-2 overflow-hidden rounded-sm bg-slate-100">
        <div
          className={`absolute inset-y-0 left-0 transition-[width] duration-700 ${failed ? 'bg-red-500' : 'bg-gradient-to-r from-blue-600 via-cyan-500 to-emerald-500'}`}
          style={{ width: `${percent}%` }}
        />
        {running && !failed && <span className="workflow-progress-scan absolute inset-y-0 w-20 bg-gradient-to-r from-transparent via-white/80 to-transparent" />}
      </div>

      {!compact && (
        <>
          <div className="mt-4 grid grid-cols-5 gap-1">
            {phases.map((phase, index) => {
              const Icon = phase.icon
              const completed = index < activePhase || (!running && percent >= 100)
              const active = index === activePhase && !failed
              return (
                <div key={phase.key} className="relative flex min-w-0 flex-col items-center gap-1.5 text-center">
                  {index > 0 && <span className={`absolute right-1/2 top-3 h-px w-full ${completed || active ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
                  <span className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full border ${completed ? 'border-emerald-500 bg-emerald-500 text-white' : active ? 'border-blue-500 bg-blue-50 text-blue-700 workflow-active-node' : 'border-slate-200 bg-white text-slate-400'}`}>
                    <Icon size={12} />
                  </span>
                  <span className={`max-w-full truncate text-[10px] font-bold ${active ? 'text-blue-700' : completed ? 'text-emerald-700' : 'text-slate-400'}`}>{phase.label}</span>
                </div>
              )
            })}
          </div>

          {failed && task?.error_message && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span className="line-clamp-2">{task.error_message}</span>
            </div>
          )}

          {progress.tasks.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <div className="mb-2 text-[10px] font-black uppercase text-slate-400">Hoạt động gần nhất</div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {progress.tasks.slice(0, 4).map((item) => (
                  <div key={item.id} className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-2 text-[11px]">
                    <span className="truncate font-semibold text-slate-700">{taskTypeLabel(item.task_type)}</span>
                    <span className={taskStatusClass(item.status)}>{taskStatusLabel(item.status)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
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

function resolvePhase(task: VideoWorkflowTask | null, workflowStatus: string) {
  const value = `${task?.task_type || ''} ${task?.current_stage || ''} ${workflowStatus}`.toUpperCase()
  if (/RENDER|VIDEO_APPROVED|QUEUED_FOR_PUBLISHING|PUBLISHED/.test(value)) return /RENDERED|VIDEO_APPROVED|QUEUED_FOR_PUBLISHING|PUBLISHED/.test(value) ? 4 : 3
  if (/VOICE/.test(value)) return 2
  if (/DRAFT|EDIT|REVIEW/.test(value)) return 1
  return 0
}

function humanizeStage(value?: string | null) {
  return String(value || 'Sẵn sàng').replaceAll('_', ' ').toLowerCase().replace(/^./, (letter) => letter.toUpperCase())
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
  const labels: Record<string, string> = { PENDING: 'Đang chờ', RUNNING: 'Đang chạy', PROCESSING: 'Đang chạy', COMPLETED: 'Hoàn tất', FAILED: 'Thất bại', CANCELLED: 'Đã hủy' }
  return labels[value] || value
}

function taskStatusClass(value: string) {
  if (value === 'FAILED') return 'shrink-0 font-bold text-red-600'
  if (value === 'COMPLETED') return 'shrink-0 font-bold text-emerald-700'
  if (['PENDING', 'RUNNING', 'PROCESSING'].includes(value)) return 'shrink-0 font-bold text-blue-700'
  return 'shrink-0 font-bold text-slate-500'
}
