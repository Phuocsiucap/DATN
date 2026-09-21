import { AlertTriangle, ChevronDown, Loader2, Settings2 } from 'lucide-react'
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
  SKIPPED_NO_API_KEY: 'Thiếu cấu hình hệ thống', AI_ERROR: 'Lỗi sinh draft',
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
  HIGH_RISK_FLAG: 'Draft có cảnh báo rủi ro cao', LOW_MODEL_CONFIDENCE: 'Hệ thống chưa đủ chắc chắn',
  RISK_EXCEEDS_PROFILE_TOLERANCE: 'Rủi ro vượt mức cho phép của profile',
}

/** Nhãn tiếng Việt cho reason_code — dùng khi backend chưa trả reason_code_label */
const reasonCodeLabels: Record<string, string> = {
  HIGH_CONFIDENCE_MATCH: 'Bài phù hợp rõ ràng với chủ đề kênh, đủ điều kiện sản xuất tự động.',
  BORDERLINE_MATCH: 'Bài nằm ở ranh giới phù hợp; hệ thống cần thêm đánh giá.',
  BELOW_SIMILARITY_THRESHOLD: 'Nội dung bài không đủ liên quan đến chủ đề kênh.',
  AVOID_TOPIC: 'Bài chứa chủ đề bị cấm hoặc cần tránh theo cấu hình kênh.',
  LOW_TOPIC_SIMILARITY: 'Nội dung bài không khớp với bất kỳ chủ đề nào của kênh.',
  VIDEO_REQUIRED: 'Kênh yêu cầu video nguồn nhưng bài này không có.',
  CONTENT_NOT_READY: 'Bài nguồn chưa sẵn sàng (đang xử lý hoặc có lỗi).',
  INSUFFICIENT_SOURCE: 'Bài nguồn có quá ít dữ kiện xác minh được.',
  FIT_JUDGE_ERROR: 'Hệ thống gặp lỗi khi đánh giá; cần người dùng xem lại.',
  FIT_JUDGE_UNCERTAIN: 'Hệ thống chưa đủ chắc chắn để tự quyết định; cần bạn xem lại.',
  CONFLICTING_INFO: 'Bài chứa thông tin mâu thuẫn giữa các nguồn; cần kiểm tra tính xác thực.',
  CONFLICTING_CONTENT: 'Nội dung bài có thông tin đối lập; cần xác minh trước khi sản xuất.',
  SENSITIVE_CONTENT: 'Bài chứa nội dung nhạy cảm (y tế, pháp luật, tài chính...).',
  HUMAN_APPROVED: 'Người dùng đã cho phép sản xuất bài này.',
  HUMAN_REJECTED: 'Người dùng đã quyết định không sản xuất bài này.',
  MISSING_REQUIRED_VIDEO: 'Bài nguồn thiếu video bắt buộc.',
  DRAFT_PASSED: 'Draft đã đạt kiểm tra chất lượng.',
  DRAFT_REVIEW_REQUIRED: 'Draft cần được duyệt trước khi tiếp tục.',
  FILTERED: 'Không qua bộ lọc đầu vào.',
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

function KeyValue({ label, value }: { label: string; value: string | number | null | undefined; digits?: number }) {
  return <div className="flex items-baseline justify-between gap-2 py-1">
    <span className="text-slate-500">{label}</span>
    <span className="font-semibold tabular-nums text-slate-700">{value == null ? '—' : value}</span>
  </div>
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

function CompactCandidateCard({ candidate, workflow, runId, onChanged, onOpenWorkflow, isSystemUser = false }: {
  candidate: PlanningCandidateSummary; workflow?: PlanningWorkflowState; runId: string
  onChanged?: (result?: PlanningCandidateReviewResult) => Promise<void>; onOpenWorkflow?: (id: string) => void
  isSystemUser?: boolean
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

    </div>
    <h3 className="text-sm font-bold text-slate-900">{candidate.title || 'Nội dung nguồn không còn khả dụng'}</h3>
    <p className="text-xs leading-5 text-slate-700">{candidate.reason}</p>
    {candidate.reason_code && !reasonCodeLabels[candidate.reason_code] && (
      <p className="text-xs text-slate-400 italic">{candidate.reason_code}</p>
    )}
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
        workflow={workflow || current.workflow || undefined} topics={new Map(current.topics.map(topic => [topic.id, topic]))} isSystemUser={isSystemUser} />}
    </div>}
  </article>
}

function CandidateCard({ candidate, workflow, topics, runId, onChanged, onOpenWorkflow, diagnosticOnly = false, isSystemUser = false }: {
  candidate: PlanningCandidateDetail; workflow?: PlanningWorkflowState; topics: Map<string, PlanningTopic>
  runId: string; onChanged?: (result?: PlanningCandidateReviewResult) => Promise<void>; onOpenWorkflow?: (id: string) => void
  diagnosticOnly?: boolean; isSystemUser?: boolean
}) {
  const { matching, decision } = candidate
  const production = decision?.production
  const draft = decision?.draft
  const quality = draft?.quality
  const series = decision?.series
  const usage = decision?.token_usage
  const status = decision?.status || (matching.eligible ? 'ELIGIBLE' : 'FILTERED')
  const matchedTopics = matching.topics.filter(s => s.matched)

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
        <span className="text-slate-500">{production.source === 'HUMAN' ? 'Người dùng quyết định' : production.source === 'RULE' ? 'Hệ thống tự quyết định' : production.source === 'FIT_JUDGE' ? 'AI đánh giá' : production.source || 'Chưa ghi nguồn'}</span>
      </div>
      {production.reason && <p>{production.reason}</p>}
    </section>}
    {decision?.legacy_reason && <p className="text-xs text-slate-600">{decision.legacy_reason}</p>}
    {decision && decision.notes.length > 0 && <ul className="ml-4 list-disc text-xs text-slate-600">{decision.notes.map(note => <li key={note}>{note}</li>)}</ul>}
    {decision?.error_message && <p className="rounded bg-red-50 p-2 text-xs text-red-800">{decision.error_message}</p>}

    {/* ── User View: Lý do & Chủ đề tương đồng (chỉ cho creator) ── */}
    {!isSystemUser && <section className="space-y-3 border-t border-slate-100 pt-3 text-xs leading-5">
      {production?.reason_code && reasonCodeLabels[production.reason_code] && (
        <div className="rounded-lg bg-slate-50 px-3 py-2.5">
          <div className="font-semibold text-slate-700">Lý do quyết định</div>
          <p className="mt-1 text-slate-600">{reasonCodeLabels[production.reason_code]}</p>
        </div>
      )}
      <div className="flex items-baseline gap-2">
        <span className="text-slate-500">Độ tương đồng:</span>
        <span className="font-bold text-slate-800">{displayNumber(matching.similarity, 4)}</span>
        <span className="text-slate-400">/ ngưỡng {displayNumber(matching.similarity_threshold, 4)}</span>
      </div>
      {matchedTopics.length > 0 && <div>
        <div className="mb-1.5 font-semibold text-slate-600">Chủ đề khớp</div>
        <TopicScores scores={matchedTopics} topics={topics} />
      </div>}
      {matching.topics.length > 0 && matching.topics.length !== matchedTopics.length && <details className="group/topics">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-slate-500 hover:text-slate-700 [&::-webkit-details-marker]:hidden">
          <ChevronDown size={14} className="transition-transform group-open/topics:rotate-180" />
          Tất cả chủ đề ({matching.topics.length})
        </summary>
        <div className="mt-1.5"><TopicScores scores={matching.topics} topics={topics} /></div>
      </details>}
      {matching.avoid_topics.length > 0 && <div>
        <div className="mb-1.5 font-semibold text-red-700">Chủ đề cần tránh</div>
        <TopicScores scores={matching.avoid_topics} topics={topics} />
      </div>}
    </section>}

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

    {/* ── Admin View: Chi tiết kỹ thuật (chỉ cho admin) ── */}
    {isSystemUser && <details className="group/tech border-t border-slate-100 pt-3 text-xs leading-5">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold text-slate-400 hover:text-slate-600 [&::-webkit-details-marker]:hidden">
        <ChevronDown size={14} className="transition-transform group-open/tech:rotate-180" />
        🔧 Chi tiết kỹ thuật
      </summary>
      <div className="mt-3 space-y-4">
        {/* Embedding & Similarity */}
        <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Embedding & Similarity</h4>
          <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
            <KeyValue label="Cosine Similarity" value={displayNumber(matching.similarity, 4)} />
            <KeyValue label="Ngưỡng" value={displayNumber(matching.similarity_threshold, 4)} />
            <KeyValue label="Bộ lọc đầu vào" value={matching.eligible ? 'Qua' : 'Không qua'} />
            <KeyValue label="Model embedding" value={matching.embedding_model || '—'} />
            <KeyValue label="Nguồn matching" value={matching.source || '—'} />
          </div>
          <div className="mt-2"><TopicScores scores={matching.topics} topics={topics} /></div>
          {matching.avoid_topics.length > 0 && <>
            <p className="mt-2 text-xs text-slate-500">Chủ đề tránh · ngưỡng {displayNumber(matching.avoid_threshold, 4)}</p>
            <TopicScores scores={matching.avoid_topics} topics={topics} />
          </>}
          {matching.require_video != null && <p className="mt-2 text-slate-500">Video nguồn: {matching.require_video ? 'Bắt buộc' : 'Không'} · Đáp ứng: {matching.has_required_video == null ? '—' : matching.has_required_video ? 'Có' : 'Không'}</p>}
        </div>

        {/* Selection / Rejection Reasons */}
        {[...matching.selection_reasons, ...matching.rejection_reasons].length > 0 && (
          <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Lý do chọn / loại</h4>
            <ul className="space-y-1 text-slate-600">{[...matching.selection_reasons, ...matching.rejection_reasons].map((reason, index) => <li key={index}>{reason}</li>)}</ul>
          </div>
        )}

        {/* Model & Token */}
        {decision && <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Model & Token</h4>
          <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
            <KeyValue label="Provider" value={decision.provider || '—'} />
            <KeyValue label="Model" value={decision.model || '—'} />
            {usage && <>
              <KeyValue label="Input tokens" value={displayNumber(usage.input_tokens)} />
              <KeyValue label="Output tokens" value={displayNumber(usage.output_tokens)} />
              <KeyValue label="Creative calls" value={displayNumber(usage.creative_call_count)} />
              <KeyValue label="Fit Judge calls" value={displayNumber(usage.fit_judge_call_count)} />
            </>}
          </div>
        </div>}

        {/* Gate Decisions */}
        {(production?.reason_code || production?.confidence_score != null || draft?.confidence_score != null) && (
          <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Quyết định</h4>
            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
              {production?.reason_code && <KeyValue label="Mã quyết định" value={production.reason_code} />}
              {production?.confidence_score != null && <KeyValue label="Confidence" value={displayNumber(production.confidence_score, 1)} />}
              {draft?.confidence_score != null && <KeyValue label="Confidence draft" value={displayNumber(draft.confidence_score, 1)} />}
            </div>
          </div>
        )}
      </div>
    </details>}
  </article>
}

export function PlanningRunDetailSheet({ run, detail, loading, onClose, onOpenProfileSettings, onCandidateChanged, onOpenWorkflow, isSystemUser = false }: {
  run: PlanningRun | null; detail: PlanningRunDetail | null; loading: boolean
  onClose: () => void; onOpenProfileSettings?: (profileId: string) => void
  onCandidateChanged?: (result?: PlanningCandidateReviewResult) => Promise<void>; onOpenWorkflow?: (id: string) => void
  isSystemUser?: boolean
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
  const profileId = current?.profile?.id || run.profile?.profile_id || run.profile_id

  return <Sheet open onOpenChange={open => { if (!open) onClose() }}>
    <SheetContent side="right" className="w-[calc(100vw-1rem)] max-w-[1200px] overflow-y-auto bg-slate-50 p-6">
      <div className="space-y-5">
        <header className="space-y-2 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-2"><span className="font-mono text-xs text-slate-500">#{shortId(run.id)}</span><Badge value={current?.status || run.status} /></div>
          <h2 className="text-xl font-black text-slate-900">Chi tiết plan · {current?.profile?.name || run.profile?.profile_name || run.profile_name || 'Không rõ profile'}</h2>
          <p className="text-xs text-slate-500">{current?.planning_mode || run.planning_mode} · Crawl: {current?.crawl_job?.name || run.crawl_job?.name || run.crawl_job_name || 'Không có'}</p>
          <p className="text-xs text-slate-500">Trạng thái planning không phải trạng thái hoàn tất video. Quyết định hệ thống ban đầu được giữ trong lịch sử khi người dùng duyệt; workflow bên dưới là trạng thái hiện tại.</p>
        </header>
        {error && <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle size={16} className="shrink-0" /><p className="flex-1">{error}</p>
          {onOpenProfileSettings && profileId && <button onClick={() => { onClose(); onOpenProfileSettings(profileId) }} className="inline-flex items-center gap-1 font-bold"><Settings2 size={13} /> Cấu hình</button>}
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
          {(() => {
            const isReview = (c: typeof current.candidates[number]) => {
              const s = 'status' in c ? (c as any).status : null
              const r = 'review' in c ? (c as any).review : null
              return s?.includes('REVIEW') || r?.can_approve
            }
            const isPassed = (c: typeof current.candidates[number]) => {
              const s = ('status' in c ? (c as any).status : null) || ((c as any).decision?.status) || ((c as any).matching?.eligible ? 'ELIGIBLE' : 'FILTERED')
              return ['AI_APPROVED', 'DRAFT_PASSED', 'WORKFLOW_CREATED', 'EXISTING_AUTO_WORKFLOW', 'DRAFT_READY', 'VOICE_READY', 'DRAFT_QUEUED'].includes(s) || !!(c as any).workflow_id
            }
            const needsReview = current.candidates.filter(c => isReview(c))
            const passed = current.candidates.filter(c => !isReview(c) && isPassed(c))
            const filtered = current.candidates.filter(c => !isReview(c) && !isPassed(c))

            const renderCard = (candidate: typeof current.candidates[number]) => current.schema_version === 3
              ? <CompactCandidateCard key={`${current.id}:${candidate.id}`} runId={current.id} candidate={candidate as any} workflow={workflows.get((candidate as any).workflow_id || '')} onChanged={onCandidateChanged} onOpenWorkflow={openWorkflow} isSystemUser={isSystemUser} />
              : <CandidateCard key={`${current.id}:${candidate.id}`} runId={current.id} candidate={candidate as any} workflow={workflows.get((candidate as any).workflow_id || '')} topics={topics} onChanged={onCandidateChanged} onOpenWorkflow={openWorkflow} isSystemUser={isSystemUser} />

            return <section className="space-y-5">
              {current.candidates.length === 0 && <p className="text-xs text-slate-500">Plan này không lưu ứng viên chi tiết.</p>}
              {needsReview.length > 0 && <div className="space-y-3">
                <h3 className="text-sm font-bold text-amber-800">⚠️ Cần bạn duyệt ({needsReview.length})</h3>
                {needsReview.map(renderCard)}
              </div>}
              {passed.length > 0 && <div className="space-y-3">
                <h3 className="text-sm font-bold text-emerald-800">✅ Đã xử lý ({passed.length})</h3>
                {passed.map(renderCard)}
              </div>}
              {filtered.length > 0 && <details>
                <summary className="cursor-pointer text-sm font-bold text-slate-500">Bị loại ({filtered.length})</summary>
                <div className="mt-3 space-y-3">{filtered.map(renderCard)}</div>
              </details>}
            </section>
          })()}
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
