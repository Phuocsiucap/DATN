import { AlertTriangle, Loader2, Settings2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { fetchPlanningCandidateDiagnosticsApi } from '@/commons/apis/planning'
import type {
  PlanningCandidateDetail, PlanningDraftIssue, PlanningRun, PlanningRunDetail,
  PlanningTopic, PlanningTopicScore, PlanningWorkflowState,
  PlanningCandidateReviewResult,
  PlanningCandidateDiagnostics, PlanningCandidateSummary,
} from '@/commons/apis/planning'
import { Sheet, SheetContent } from '@/commons/component/ui/sheet'
import { CandidateReviewControls } from './CandidateReviewControls'
import { OpenDraftWorkspaceButton } from './OpenDraftWorkspaceButton'

const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString('vi-VN') : 'Chưa ghi nhận'
const shortId = (value: string) => value.slice(0, 8)
const displayNumber = (value: number | null | undefined, digits = 0) => value == null ? '—' : value.toFixed(digits)

const labels: Record<string, string> = {
  SUCCEEDED: 'Planning hoàn tất', FAILED: 'Thất bại', CANCELLED: 'Đã hủy',
  RUNNING: 'Đang chạy', PENDING: 'Đang chờ', PROCESSING: 'Đang xử lý',
  PRODUCE: 'Cho phép viết draft', SKIP: 'Không sản xuất',
  REVIEW_REQUIRED: 'Cần duyệt', DRAFT_REVIEW_REQUIRED: 'Draft cần duyệt',
  PRODUCTION_REJECTED: 'Không sản xuất', AI_APPROVED: 'Draft đạt kiểm tra',
  WORKFLOW_CREATED: 'Đã có workflow', EXISTING_AUTO_WORKFLOW: 'Đã có workflow',
  SKIPPED_NO_API_KEY: 'Thiếu cấu hình AI', AI_ERROR: 'Lỗi sinh draft',
  PASS: 'Đạt', DRAFT_READY: 'Draft sẵn sàng', VOICE_READY: 'Voice sẵn sàng',
  DRAFT_QUEUED: 'Đã duyệt, đang sinh draft', DRAFT_FAILED: 'Sinh draft thất bại',
  FILTERED: 'Không qua bộ lọc', ELIGIBLE: 'Qua bộ lọc đầu vào',
  CREATE_NEW: 'Đề xuất tạo series', USE_EXISTING: 'Đề xuất dùng series', NONE: 'Bài lẻ',
}

const issueLabels: Record<string, string> = {
  SCENE_REPETITION: 'Các cảnh lặp nội dung',
  UNSUPPORTED_ENTITY: 'Tên riêng chưa có trong fact được trích dẫn',
  UNSUPPORTED_NUMBER: 'Số liệu chưa có trong fact được trích dẫn',
  MISSING_EVIDENCE: 'Cảnh thiếu fact hỗ trợ', INVALID_EVIDENCE_ID: 'Mã fact không hợp lệ',
  NARRATION_TOO_LONG: 'Lời thoại vượt giới hạn từ', NARRATION_TOO_SHORT: 'Lời thoại quá ngắn',
  HIGH_RISK_FLAG: 'Draft có cảnh báo rủi ro cao', LOW_MODEL_CONFIDENCE: 'AI chưa đủ chắc chắn',
  RISK_EXCEEDS_PROFILE_TOLERANCE: 'Rủi ro vượt mức cho phép của profile',
}

function Badge({ value }: { value: string | null }) {
  const status = value || 'UNKNOWN'
  let color = 'bg-slate-100 text-slate-700'
  if (['SUCCEEDED', 'PASS', 'AI_APPROVED', 'DRAFT_READY', 'PRODUCE'].includes(status)) color = 'bg-emerald-100 text-emerald-800'
  if (['FAILED', 'AI_ERROR', 'SKIP', 'PRODUCTION_REJECTED'].includes(status)) color = 'bg-red-100 text-red-800'
  if (status.includes('REVIEW') || status === 'SKIPPED_NO_API_KEY') color = 'bg-amber-100 text-amber-800'
  return <span className={`inline-flex rounded-md px-2 py-1 text-xs font-bold ${color}`}>{labels[status] || status}</span>
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
    <div className="text-xs font-bold uppercase text-slate-500">{label}</div>
    <div className="mt-1 text-lg font-black tabular-nums text-slate-800">{value}</div>
  </div>
}

function TopicScores({ scores, topics }: { scores: PlanningTopicScore[]; topics: Map<string, PlanningTopic> }) {
  return <div className="flex flex-wrap gap-1.5">{scores.map((score, index) => {
    const topic = topics.get(score.topic_id)
    const color = score.matched
      ? topic?.kind === 'AVOID' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-slate-200 bg-white text-slate-600'
    return <span key={`${score.topic_id}-${index}`} title={topic?.description || topic?.key || undefined} className={`rounded border px-2 py-0.5 text-xs ${color}`}>
      {topic?.name || score.topic_id}: {displayNumber(score.similarity, 4)}
      {score.threshold != null && ` / ngưỡng ${displayNumber(score.threshold, 4)}`}
    </span>
  })}</div>
}

function Issue({ issue }: { issue: PlanningDraftIssue }) {
  return <li className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-950">
    <span className="font-semibold">{issueLabels[issue.code] || issue.message || issue.code}</span>
    {issue.scene_indexes.length > 0 && <span> — cảnh {issue.scene_indexes.map(index => index + 1).join(', ')}</span>}
    {typeof issue.details.actual_words === 'number' && typeof issue.details.maximum_words === 'number' &&
      <span> ({issue.details.actual_words}/{issue.details.maximum_words} từ)</span>}
    <span className="ml-1 text-xs text-amber-700">[{issue.code}]</span>
  </li>
}

function WorkflowInfo({ workflow, onOpenWorkflow }: { workflow: PlanningWorkflowState; onOpenWorkflow?: (id: string) => void }) {
  return <section className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs">
    <strong>Workflow hiện tại #{shortId(workflow.id)}</strong><Badge value={workflow.current_stage || workflow.status} />
    {workflow.series && <span>Series đang gắn: {workflow.series.name || shortId(workflow.series.id)}</span>}
    {workflow.pending_series && <span className="text-amber-700">Series đề xuất đang chờ duyệt draft.</span>}
    {workflow.series_error && <span className="text-amber-700">Không áp dụng được series: {workflow.series_error}</span>}
    <span className="text-xs text-slate-400">Cập nhật {formatDate(workflow.updated_at)}</span>
    <OpenDraftWorkspaceButton workflowId={workflow.id} onOpenWorkflow={onOpenWorkflow}
      reviewRequired={workflow.current_stage === 'DRAFT_REVIEW_REQUIRED'} rejected={workflow.status === 'REJECTED'} />
    {workflow.current_stage === 'DRAFT_REVIEW_REQUIRED' && workflow.status !== 'REJECTED' && <p className="w-full text-amber-800">
      Draft đã có nhưng đang chờ duyệt chất lượng. Mở để xem/sửa rồi chọn “Duyệt draft hiện tại”; không cần duyệt bài nguồn lần nữa.
    </p>}
  </section>
}

function CompactCandidateCard({ candidate, workflow, runId, onChanged, onOpenWorkflow }: {
  candidate: PlanningCandidateSummary; workflow?: PlanningWorkflowState; runId: string
  onChanged?: (result?: PlanningCandidateReviewResult) => Promise<void>; onOpenWorkflow?: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [snapshot, setSnapshot] = useState<{ revision: string; data: PlanningCandidateDiagnostics } | null>(null)
  const request = useRef<AbortController | null>(null)
  const revision = JSON.stringify([candidate.status, candidate.reason, candidate.workflow_id, candidate.review, workflow?.updated_at])
  const current = snapshot?.revision === revision ? snapshot.data : null
  useEffect(() => () => request.current?.abort(), [])

  async function loadDiagnostics() {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError('')
    try {
      const data = await fetchPlanningCandidateDiagnosticsApi(runId, candidate.id, controller.signal)
      if (!controller.signal.aborted) setSnapshot({ revision, data })
    } catch (cause) {
      if (!controller.signal.aborted) {
        const failure = cause as { response?: { data?: { detail?: string } }; message?: string }
        setError(failure.response?.data?.detail || failure.message || 'Không tải được chi tiết ứng viên.')
      }
    } finally { if (!controller.signal.aborted) setLoading(false) }
  }

  return <article className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2"><span className="text-xs text-slate-400">#{candidate.rank ?? '—'}</span><Badge value={candidate.status} /></div>
      {candidate.similarity != null && <span className="text-xs text-slate-500">Độ khớp {displayNumber(candidate.similarity, 4)}</span>}
    </div>
    <h3 className="text-sm font-bold text-slate-900">{candidate.title || 'Nội dung nguồn không còn khả dụng'}</h3>
    <p className="text-xs leading-5 text-slate-700">{candidate.reason}</p>
    {candidate.reason_code && <p className="text-xs text-slate-500">{candidate.reason_code}</p>}
    <CandidateReviewControls runId={runId} candidate={candidate} onChanged={onChanged} />
    {workflow && <WorkflowInfo workflow={workflow} onOpenWorkflow={onOpenWorkflow} />}
    {candidate.workflow_id && !workflow && <p className="text-xs text-slate-500">Workflow #{shortId(candidate.workflow_id)} không còn khả dụng.</p>}
    <button type="button" aria-expanded={open} className="text-xs font-semibold text-sky-700 underline"
      onClick={() => { setOpen(!open); if (!open && !current) void loadDiagnostics() }}>
      {open ? 'Thu gọn chi tiết' : 'Xem chi tiết quyết định'}
    </button>
    {open && <div className="space-y-2 border-t border-slate-100 pt-3">
      {loading && <p role="status" className="text-xs text-slate-500">Đang tải chi tiết bài này…</p>}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      {!loading && !current && <button type="button" onClick={() => void loadDiagnostics()} className="text-xs font-semibold text-sky-700 underline">Tải lại chi tiết</button>}
      {current && <CandidateCard diagnosticOnly candidate={current.candidate} runId={runId}
        workflow={workflow || current.workflow || undefined} topics={new Map(current.topics.map(topic => [topic.id, topic]))} />}
    </div>}
  </article>
}

function CandidateCard({ candidate, workflow, topics, runId, onChanged, onOpenWorkflow, diagnosticOnly = false }: {
  candidate: PlanningCandidateDetail; workflow?: PlanningWorkflowState; topics: Map<string, PlanningTopic>
  runId: string; onChanged?: (result?: PlanningCandidateReviewResult) => Promise<void>; onOpenWorkflow?: (id: string) => void
  diagnosticOnly?: boolean
}) {
  const { matching, decision } = candidate
  const production = decision?.production
  const draft = decision?.draft
  const quality = draft?.quality
  const series = decision?.series
  const usage = decision?.token_usage
  const status = decision?.status || (matching.eligible ? 'ELIGIBLE' : 'FILTERED')

  return <article className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
    {!diagnosticOnly && <><div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2"><span className="text-xs font-bold text-slate-400">#{candidate.rank ?? '—'}</span><Badge value={status} /></div>
      <span className="text-xs text-slate-500">Điểm khớp {displayNumber(matching.score, 1)} · Chất lượng nguồn {displayNumber(matching.source_quality_score, 1)}</span>
    </div>
    <h3 className="text-sm font-bold leading-6 text-slate-900">{candidate.title || 'Nội dung nguồn không còn khả dụng'}</h3></>}
    {candidate.summary && <p className="text-xs leading-5 text-slate-600">{candidate.summary}</p>}
    {!diagnosticOnly && <CandidateReviewControls runId={runId} candidate={candidate} onChanged={onChanged} />}

    {production && <section className="space-y-1 text-xs leading-5">
      <div className="flex flex-wrap items-center gap-2"><strong>Quyết định sản xuất</strong><Badge value={production.status} />
        <span className="text-slate-500">{production.source === 'HUMAN' ? 'Người dùng quyết định' : `${production.source || 'Chưa ghi nguồn'} · Confidence ${displayNumber(production.confidence_score, 1)}`}</span>
      </div>
      {production.reason && <p>{production.reason}</p>}
      {production.reason_code && <p className="text-xs text-slate-500">{production.reason_code}</p>}
    </section>}
    {decision?.legacy_reason && <p className="text-xs text-slate-600">{decision.legacy_reason}</p>}
    {decision && decision.notes.length > 0 && <ul className="ml-4 list-disc text-xs text-slate-600">{decision.notes.map(note => <li key={note}>{note}</li>)}</ul>}
    {decision?.error_message && <p className="rounded bg-red-50 p-2 text-xs text-red-800">{decision.error_message}</p>}

    {draft && <section className="space-y-2 border-t border-slate-100 pt-3 text-xs leading-5">
      <div className="flex flex-wrap items-center gap-2"><strong>Draft</strong>
        {quality && <><Badge value={quality.status} /><span>{displayNumber(quality.score)}/100 · {displayNumber(quality.word_count)} từ · {displayNumber(quality.scene_count)} cảnh · {displayNumber(quality.retry_count)} lần sửa</span></>}
      </div>
      {draft.title && <p className="font-semibold">{draft.title}</p>}
      {draft.angle && <p className="text-slate-600">{draft.angle}</p>}
      {quality && quality.issues.length > 0 && <ul className="space-y-1">{quality.issues.map((issue, index) => <Issue key={`${issue.code}-${index}`} issue={issue} />)}</ul>}
      {quality?.retry_error && <p className="text-red-700">Lỗi khi sửa draft: {quality.retry_error}</p>}
      {draft.risk_flags.length > 0 && <p className="text-slate-600">Rủi ro: {draft.risk_flags.map(flag => [flag.type, flag.severity, flag.message].filter(Boolean).join(' · ')).join('; ')}</p>}
      <details className="text-slate-500"><summary className="cursor-pointer">Thông số draft</summary>
        <div className="mt-1 space-y-1">
          <p>{[draft.format, draft.hook_type, draft.cta_mode, draft.tone].filter(Boolean).join(' · ') || 'Chưa ghi nhận cấu trúc'}</p>
          {draft.target_audience && <p>Đối tượng: {draft.target_audience}</p>}
          <p>Confidence draft: {displayNumber(draft.confidence_score, 1)}</p>
        </div>
      </details>
    </section>}

    {series && <section className="space-y-1 border-t border-slate-100 pt-3 text-xs leading-5">
      <strong>Series: {labels[series.action || ''] || series.action || 'Chưa có quyết định'}{series.title ? ` — ${series.title}` : ''}</strong>
      {workflow?.pending_series && <p className="font-semibold text-amber-700">Đề xuất đang chờ áp dụng sau khi duyệt draft; chưa tạo/gắn series.</p>}
      {series.description && <p className="text-slate-600">{series.description}</p>}
      {series.reason && <p className="text-slate-500">Lý do đề xuất: {series.reason}</p>}
      {series.followup_angles.length > 0 && <details><summary className="cursor-pointer text-slate-500">Các góc nội dung tiếp theo</summary>
        <ul className="ml-4 list-disc text-slate-600">{series.followup_angles.map(angle => <li key={angle}>{angle}</li>)}</ul>
      </details>}
    </section>}

    {!diagnosticOnly && workflow && <WorkflowInfo workflow={workflow} onOpenWorkflow={onOpenWorkflow} />}
    {!diagnosticOnly && candidate.workflow_id && !workflow && <p className="text-xs text-slate-500">Workflow #{shortId(candidate.workflow_id)} không còn khả dụng.</p>}

    <details className="border-t border-slate-100 pt-3 text-xs leading-5">
      <summary className="cursor-pointer font-semibold text-slate-600">Chi tiết bộ lọc · Cosine {displayNumber(matching.similarity, 4)} / ngưỡng {displayNumber(matching.similarity_threshold, 4)}</summary>
      <div className="mt-2 space-y-2">
        <p>{matching.eligible ? 'Qua bộ lọc đầu vào' : 'Không qua bộ lọc đầu vào'} · {matching.source || 'Chưa ghi nguồn'} · {matching.embedding_model || 'Chưa ghi model embedding'}</p>
        <TopicScores scores={matching.topics} topics={topics} />
        {matching.avoid_topics.length > 0 && <><p>Chủ đề tránh · ngưỡng {displayNumber(matching.avoid_threshold, 4)}</p><TopicScores scores={matching.avoid_topics} topics={topics} /></>}
        {matching.require_video != null && <p>Yêu cầu video nguồn: {matching.require_video ? 'Có' : 'Không'} · Đáp ứng: {matching.has_required_video == null ? 'Chưa ghi nhận' : matching.has_required_video ? 'Có' : 'Không'}</p>}
        {[...matching.selection_reasons, ...matching.rejection_reasons].map((reason, index) => <p key={index} className="text-slate-500">{reason}</p>)}
      </div>
    </details>
    {decision && <p className="text-xs leading-5 text-slate-400">
      {[decision.provider, decision.model].filter(Boolean).join(' · ')}
      {usage ? ` · Token đã ghi nhận: ${displayNumber(usage.input_tokens)} vào / ${displayNumber(usage.output_tokens)} ra · Creative ${displayNumber(usage.creative_call_count)} call · Fit Judge ${displayNumber(usage.fit_judge_call_count)} call` : ' · Chưa ghi nhận token cho quyết định này'}
    </p>}
  </article>
}

export function PlanningRunDetailSheet({ run, detail, loading, onClose, onOpenProfileSettings, onCandidateChanged, onOpenWorkflow }: {
  run: PlanningRun | null; detail: PlanningRunDetail | null; loading: boolean
  onClose: () => void; onOpenProfileSettings?: (profileId: string) => void
  onCandidateChanged?: (result?: PlanningCandidateReviewResult) => Promise<void>; onOpenWorkflow?: (id: string) => void
}) {
  if (!run) return null
  // Ignore a late response from a previously opened plan.
  const current = detail?.id === run.id ? detail : null
  const topics = new Map(current?.schema_version === 2 ? current.topics.map(topic => [topic.id, topic]) : [])
  const workflows = new Map(current?.workflows.map(workflow => [workflow.id, workflow]))
  const error = current?.error_message || run.error_message
  const unlinkedWorkflows = current?.workflows.filter(workflow => !current.candidates.some(candidate => candidate.workflow_id === workflow.id)) || []
  const openWorkflow = onOpenWorkflow ? (id: string) => { onClose(); onOpenWorkflow(id) } : undefined
  const invalidCompletionTime = !!current?.started_at && !!current.completed_at && !!current.updated_at &&
    new Date(current.completed_at).getTime() <= new Date(current.started_at).getTime() &&
    new Date(current.updated_at).getTime() > new Date(current.completed_at).getTime()

  return <Sheet open onOpenChange={open => { if (!open) onClose() }}>
    <SheetContent side="right" className="w-[calc(100vw-1rem)] max-w-[800px] overflow-y-auto bg-slate-50 p-6">
      <div className="space-y-5">
        <header className="space-y-2 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-2"><span className="font-mono text-xs text-slate-500">#{shortId(run.id)}</span><Badge value={current?.status || run.status} /></div>
          <h2 className="text-xl font-black text-slate-900">Chi tiết plan · {current?.profile?.name || run.profile_name}</h2>
          <p className="text-xs text-slate-500">{current?.planning_mode || run.planning_mode} · Crawl: {current?.crawl_job?.name || run.crawl_job_name || 'Không có'}</p>
          <p className="text-xs text-slate-500">Trạng thái planning không phải trạng thái hoàn tất video. Quyết định AI ban đầu được giữ trong lịch sử khi người dùng duyệt; workflow bên dưới là trạng thái hiện tại.</p>
        </header>
        {error && <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle size={16} className="shrink-0" /><p className="flex-1">{error}</p>
          {onOpenProfileSettings && <button onClick={() => { onClose(); onOpenProfileSettings(current?.profile?.id || run.profile_id) }} className="inline-flex items-center gap-1 font-bold"><Settings2 size={13} /> Cấu hình</button>}
        </div>}
        {loading && <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500"><Loader2 size={18} className="animate-spin" /> Đang tải chi tiết plan...</div>}
        {!loading && !current && <p className="p-5 text-center text-sm text-slate-500">Chưa tải được chi tiết plan. Hãy đóng và mở lại.</p>}
        {current && !loading && <>
          <div className="grid grid-cols-3 gap-3"><Metric label="Bài đầu vào" value={current.summary.candidate_count} /><Metric label="Qua bộ lọc" value={current.summary.eligible_count} /><Metric label="Workflow đã tạo" value={current.summary.workflow_count} /></div>
          <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-xs leading-5">
            <p><strong>Quyết định sản xuất:</strong> {Object.entries(current.summary.production).map(([status, count]) => `${labels[status] || status}: ${count}`).join(' · ') || 'Chưa ghi nhận'}</p>
            <p><strong>Kiểm tra draft:</strong> {Object.entries(current.summary.draft_quality).map(([status, count]) => `${labels[status] || status}: ${count}`).join(' · ') || 'Chưa ghi nhận'}</p>
            <p className="text-slate-500">{current.summary.filtered_count} bài không qua bộ lọc; {current.summary.selected_count} bài được chọn để lưu workflow.</p>
          </section>
          <details className="rounded-xl border border-slate-200 bg-white p-4 text-xs leading-6">
            <summary className="cursor-pointer font-semibold">Thông tin lần chạy</summary>
            <p>Thuật toán: {current.algorithm || 'Chưa ghi nhận'} · Trigger: {current.trigger || 'Chưa ghi nhận'}</p>
            <p>Ngưỡng chủ đề: {displayNumber(current.similarity_threshold, 4)}</p>
            <p>Bắt đầu: {formatDate(current.started_at)}</p><p>Hoàn tất ghi trong log: {formatDate(current.completed_at)}</p>
            {invalidCompletionTime && <p className="text-amber-700">Log cũ ghi thời gian hoàn tất trùng lúc bắt đầu, trước lần cập nhật cuối; chưa thể tính thời lượng đáng tin cậy.</p>}
            <p>Tạo: {formatDate(current.created_at)} · Cập nhật: {formatDate(current.updated_at)}</p>
          </details>
          <section className="space-y-3"><h3 className="text-sm font-bold text-slate-700">Chi tiết {current.candidates.length} bài ứng viên</h3>
            {current.candidates.length === 0 && <p className="text-xs text-slate-500">Plan này không lưu ứng viên chi tiết.</p>}
            {current.schema_version === 3
              ? current.candidates.map(candidate => <CompactCandidateCard key={`${current.id}:${candidate.id}`} runId={current.id} candidate={candidate} workflow={workflows.get(candidate.workflow_id || '')} onChanged={onCandidateChanged} onOpenWorkflow={openWorkflow} />)
              : current.candidates.map(candidate => <CandidateCard key={`${current.id}:${candidate.id}`} runId={current.id} candidate={candidate} workflow={workflows.get(candidate.workflow_id || '')} topics={topics} onChanged={onCandidateChanged} onOpenWorkflow={openWorkflow} />)}
          </section>
          {unlinkedWorkflows.length > 0 && <section className="space-y-2 text-xs"><h3 className="font-semibold">Workflow chưa có liên kết ứng viên trong log</h3>
            {unlinkedWorkflows.map(workflow => <div key={workflow.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
              <span>{workflow.title || shortId(workflow.id)}</span><Badge value={workflow.current_stage || workflow.status} />
              <OpenDraftWorkspaceButton workflowId={workflow.id} onOpenWorkflow={openWorkflow}
                reviewRequired={workflow.current_stage === 'DRAFT_REVIEW_REQUIRED'} rejected={workflow.status === 'REJECTED'} />
            </div>)}
          </section>}
        </>}
      </div>
    </SheetContent>
  </Sheet>
}
