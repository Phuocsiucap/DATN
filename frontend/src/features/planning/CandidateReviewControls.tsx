import { useRef, useState } from 'react'
import { fetchPlanningCandidateSourceApi, reviewPlanningCandidateApi } from '@/commons/apis/planning'
import type { PlanningCandidateDetail, PlanningCandidateSource, PlanningCandidateReviewResult } from '@/commons/apis/planning'

function message(error: unknown) {
  const value = error as { response?: { data?: { detail?: string } }; message?: string }
  return value.response?.data?.detail || value.message || 'Không thể xử lý yêu cầu. Hãy thử lại.'
}

export function CandidateReviewControls({ runId, candidate, onChanged }: {
  runId: string; candidate: Pick<PlanningCandidateDetail, 'id' | 'review'> & { content_id?: string | null }
  onChanged?: (result?: PlanningCandidateReviewResult) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const [error, setError] = useState('')
  const [source, setSource] = useState<PlanningCandidateSource | null>(null)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [sourceLoading, setSourceLoading] = useState(false)
  const [localReview, setLocalReview] = useState<{ base: PlanningCandidateDetail['review']; value: PlanningCandidateDetail['review'] } | null>(null)
  const review = localReview && candidate.review === localReview.base ? localReview.value : candidate.review
  const actionable = review?.can_approve || review?.can_reject || review?.can_retry

  async function act(action: 'APPROVE' | 'REJECT' | 'RETRY') {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      const result = await reviewPlanningCandidateApi(runId, candidate.id, action, reason)
      setLocalReview({ base: candidate.review, value: result.review })
      try { await onChanged?.(result) }
      catch { setError('Quyết định đã lưu nhưng chưa tải được trạng thái mới. Hãy tải lại trạng thái hoặc mở lại plan.') }
    } catch (cause) { setError(message(cause)) }
    finally { submitting.current = false; setBusy(false) }
  }

  async function openSource() {
    if (sourceLoading) return
    setSourceOpen(true)
    if (source) return
    setSourceLoading(true)
    setError('')
    try { setSource(await fetchPlanningCandidateSourceApi(runId, candidate.id)) }
    catch (cause) { setError(message(cause)) }
    finally { setSourceLoading(false) }
  }

  async function refreshStatus() {
    if (submitting.current || !onChanged) return
    submitting.current = true
    setBusy(true)
    setError('')
    try { await onChanged() }
    catch (cause) { setError(message(cause)) }
    finally { submitting.current = false; setBusy(false) }
  }

  if (!review?.status && !actionable) return null
  return <section className="space-y-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs leading-5">
    <strong>Duyệt bài nguồn — trước khi sinh draft</strong>
    {!candidate.content_id && <p>Không còn bài nguồn để sinh draft. Bạn vẫn có thể chọn không sản xuất để kết thúc chờ duyệt.</p>}
    {review?.status === 'QUEUED' && <p role="status">Đã duyệt bài. Job đang chờ hoặc đang sinh draft; bạn có thể đóng cửa sổ này.</p>}
    {review?.status === 'COMPLETED' && <p>Đã xử lý quyết định duyệt và liên kết workflow. Kết quả kiểm tra draft nằm bên dưới; đây không phải phê duyệt video để đăng.</p>}
    {review?.status === 'REJECTED' && <p>Người dùng đã quyết định không sản xuất bài này.</p>}
    {review?.status === 'FAILED' && <p>Đã duyệt bài nhưng chưa sinh được draft. Thử lại sẽ chạy lại bước sinh draft và có thể phát sinh token.</p>}
    {review?.reviewed_at && <p className="text-slate-600">{new Date(review.reviewed_at).toLocaleString('vi-VN')} · Người duyệt: {review.reviewed_by}</p>}
    {review?.reason && <p>Lý do: {review.reason}</p>}
    {review?.error_message && <p role="alert" className="text-red-700">{review.error_message}</p>}
    {review?.status && review.original_production && <details className="text-slate-600">
      <summary className="cursor-pointer">Quyết định ban đầu trước khi người dùng duyệt</summary>
      <p>{review.original_production.reason} [{review.original_production.reason_code}]</p>
    </details>}
    {actionable && <>
      <p>Cho phép sinh draft chỉ giải quyết bước chọn bài. Draft vẫn phải qua kiểm tra chất lượng trước khi tạo voice/video.</p>
      <label className="block">Ghi chú quyết định (không bắt buộc)
        <textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} disabled={busy}
          className="mt-1 block w-full rounded border border-slate-300 bg-white p-2" rows={2} />
      </label>
    </>}
    <div className="flex flex-wrap gap-2">
      {review?.status && onChanged && <button type="button" disabled={busy} onClick={() => void refreshStatus()} className="rounded border border-slate-300 bg-white px-3 py-1.5">Tải lại trạng thái</button>}
      {candidate.content_id && <button type="button" disabled={sourceLoading} onClick={() => void openSource()} className="rounded border border-slate-300 bg-white px-3 py-1.5">{sourceLoading ? 'Đang tải nguồn…' : 'Xem bài nguồn'}</button>}
      {review?.can_approve && <button type="button" disabled={busy} onClick={() => void act('APPROVE')} className="rounded bg-emerald-700 px-3 py-1.5 text-white disabled:opacity-50">{busy ? 'Đang xử lý…' : 'Cho phép sinh draft'}</button>}
      {review?.can_retry && <button type="button" disabled={busy} onClick={() => void act('RETRY')} className="rounded bg-sky-700 px-3 py-1.5 text-white disabled:opacity-50">Thử sinh draft lại</button>}
      {review?.can_reject && <button type="button" disabled={busy} onClick={() => void act('REJECT')} className="rounded border border-red-300 bg-white px-3 py-1.5 text-red-700 disabled:opacity-50">Không sản xuất</button>}
    </div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {sourceOpen && source && <div className="space-y-2 rounded border bg-white p-3">
      <div className="flex items-start justify-between gap-3"><strong>{source.title}</strong><button type="button" onClick={() => setSourceOpen(false)}>Đóng nguồn</button></div>
      {source.summary && <p>{source.summary}</p>}
      <div className="max-h-96 overflow-y-auto whitespace-pre-wrap">{source.full_text || 'Không có toàn văn được lưu; chỉ có phần mô tả nguồn.'}</div>
      {source.source_url && /^https?:\/\//i.test(source.source_url) && <a href={source.source_url} target="_blank" rel="noopener noreferrer" className="text-sky-700 underline">Mở trang nguồn</a>}
    </div>}
  </section>
}
