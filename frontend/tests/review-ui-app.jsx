/* eslint-disable react-refresh/only-export-components */
// All data and API behavior in this harness are synthetic. Exercise the real
// PlanningPage and editor, with an adapter that refuses every unspecified call.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import { api } from '../src/commons/apis/client'
import PlanningPage from '../src/features/planning/PlanningPage'
import VideoProductionWorkspace from '../src/features/generate-video/VideoProductionWorkspace'
import '../src/index.css'

const stamp = '2026-08-31T01:00:00Z'
const profile = { id: 'mock-profile', profile_name: 'Profile giả lập', name: 'Profile giả lập', platform: 'tiktok' }
const run = { id: 'mock-run', profile_id: profile.id, profile_name: profile.name, status: 'SUCCEEDED', planning_mode: 'AUTO', candidate_count: 2, eligible_count: 2, selected_count: 1, progress_percent: 100, current_stage: 'COMPLETED', workflow_title: 'Plan giả lập: hai loại review', created_at: stamp }
const source = { id: 'mock-source', canonical_title: 'Bài nguồn giả lập', title: 'Bài nguồn giả lập', full_text: 'Toàn văn giả lập để đối chiếu kịch bản. Đây không phải bài thật.', quality_score: 90, media: [], sources: [], content_type: 'ARTICLE', status: 'READY', language: 'vi', created_at: stamp }
const quality = { status: 'REVIEW_REQUIRED', score: 83, word_count: 30, scene_count: 2, retry_count: 1, issues: [{ code: 'SCENE_REPETITION', message: 'Hai đoạn lặp ý: hãy đọc và sửa trước khi duyệt.', scene_indexes: [0, 1], details: {} }] }
const production = { status: 'REVIEW_REQUIRED', source: 'LLM', reason_code: 'TOPIC_RELEVANCE', reason: 'Cần người dùng kiểm tra độ phù hợp chủ đề.', confidence_score: 70 }
const topics = Array.from({ length: 8 }, (_, index) => ({ id: `t${index}`, kind: 'CONTENT', name: `Chủ đề giả lập ${index + 1}`, description: 'Mô tả chỉ tải khi mở chẩn đoán.' }))
const matching = { eligible: true, score: 52, source_quality_score: 90, similarity: 0.4, similarity_threshold: 0.35,
  topics: topics.map((topic, index) => ({ topic_id: topic.id, similarity: index === 0 ? 0.4 : 0.2, matched: index === 0, threshold: 0.35 })),
  avoid_topics: [], selection_reasons: [], rejection_reasons: [] }
let review = { status: null, can_approve: true, can_reject: true, can_retry: false }
let workflowStatus = 'EDITING'
let draftApproved = false
let failApproval = false
let failRefresh = false
let failDiagnostics = false
let savedSignature = ''
let story = {
  meta: { workflow_id: 'mock-workflow', draft_generation_mode: 'compact-v2', title: 'Draft giả lập' },
  video: { width: 1080, height: 1920, fps: 30, background: '#121212' }, audio: {}, compact_scenes: [],
  timeline: {
    video: [{ id: 'visual-1', type: 'image', src: '', start: 0, end: 10, text_ids: ['text-1', 'text-2'] }],
    text: [
      { id: 'text-1', text: 'Đoạn đầu cần người dùng xem lại.', voice_text: 'Đoạn đầu cần người dùng xem lại.', start: 0, end: 5, video_ids: ['visual-1'] },
      { id: 'text-2', text: 'Đoạn sau dùng chung hình minh họa.', voice_text: 'Đoạn sau dùng chung hình minh họa.', start: 5, end: 10, video_ids: ['visual-1'] },
    ], audio: [],
  },
}
let log = []
let notify = () => {}
const record = message => { log.push(message); notify() }
const stage = () => draftApproved ? 'DRAFT_READY' : 'DRAFT_REVIEW_REQUIRED'
const workflow = () => ({ id: 'mock-workflow', title: 'Draft giả lập', profile, primary_content_id: source.id, status: workflowStatus, current_stage: stage(), progress_percent: 80, metadata: { selection_mode: 'AUTO', draft_quality: quality }, source_content: source, draft: story, tasks: [], capabilities: { can_edit: true, can_approve_draft: !draftApproved && workflowStatus !== 'REJECTED', can_generate_voice: draftApproved, can_render: false, can_approve: false, can_queue: false }, created_at: stamp, updated_at: stamp })
function detail() {
  const draftDecision = { status: 'DRAFT_REVIEW_REQUIRED', notes: [], production: { ...production, status: 'PRODUCE', source: 'RULE' }, draft: { title: 'Draft giả lập', quality, risk_flags: [] }, series: { action: 'NONE', followup_angles: [] } }
  return {
    schema_version: 2, id: run.id, profile, status: 'SUCCEEDED', planning_mode: 'AUTO', topics,
    summary: { candidate_count: 2, eligible_count: 2, filtered_count: 0, selected_count: 1, workflow_count: 1, production: { REVIEW_REQUIRED: 1, PRODUCE: 1 }, draft_quality: { REVIEW_REQUIRED: 1 } },
    candidates: [
      { id: 'mock-candidate', content_id: source.id, title: 'Bài chưa có draft cần duyệt nguồn', selected: review.status === 'COMPLETED', workflow_id: review.status === 'COMPLETED' ? 'mock-workflow' : null, matching, review, decision: review.status === 'COMPLETED' ? draftDecision : { status: 'REVIEW_REQUIRED', production, notes: [] } },
      { id: 'mock-existing', content_id: source.id, title: 'Bài đã có draft cần duyệt chất lượng', selected: true, workflow_id: 'mock-workflow', matching, review: {}, decision: draftDecision },
    ],
    workflows: [{ id: 'mock-workflow', title: 'Draft giả lập', current_stage: stage(), status: workflowStatus, updated_at: stamp }],
  }
}

function overview() {
  const { topics: _topics, candidates, ...info } = detail()
  return { ...info, schema_version: 3, candidates: candidates.map(candidate => ({
    id: candidate.id, content_id: candidate.content_id, title: candidate.title, rank: 1,
    status: ({ QUEUED: 'DRAFT_QUEUED', FAILED: 'DRAFT_FAILED', REJECTED: 'PRODUCTION_REJECTED' })[candidate.review.status] || candidate.decision.status,
    reason: candidate.decision.production.reason, similarity: candidate.matching.similarity,
    workflow_id: candidate.workflow_id, ...(candidate.review.can_approve || candidate.review.status ? { review: candidate.review } : {}),
  })) }
}

// Isolate auth as well: no browser credentials are needed or read by these tests.
api.interceptors.request.clear()
api.defaults.adapter = async config => {
  const method = config.method.toUpperCase()
  const url = config.url
  const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data
  record(`${method} ${url}${method === 'POST' ? ` ${JSON.stringify(body)}` : ''}`)
  const ok = data => ({ data: structuredClone(data), status: 200, statusText: 'OK', headers: {}, config })
  const fail = text => { throw { response: { status: 409, data: { detail: text } } } }
  if (url === '/social-profiles') return ok({ items: [profile] })
  if (url === '/planning-runs') return ok({ items: [run], total: 1 })
  if (url === '/planning-runs/mock-run') {
    if (failRefresh) { failRefresh = false; return fail('Giả lập lỗi tải lại trạng thái') }
    return ok(overview())
  }
  if (url.endsWith('/diagnostics')) {
    if (failDiagnostics) { failDiagnostics = false; return fail('Giả lập lỗi tải chẩn đoán') }
    const candidate = detail().candidates.find(item => url.includes(`/candidates/${item.id}/`))
    if (!candidate) return fail('Không có ứng viên giả lập')
    return ok({ schema_version: 3, run_id: run.id, candidate, topics: detail().topics,
      workflow: candidate.workflow_id ? detail().workflows[0] : null })
  }
  if (url.endsWith('/candidates/mock-candidate/source')) return ok({ ...source, full_text: source.full_text })
  if (url.endsWith('/candidates/mock-candidate/review') && method === 'POST') {
    review = { status: body.action === 'REJECT' ? 'REJECTED' : 'QUEUED', action: body.action === 'REJECT' ? 'REJECT' : 'APPROVE', reason: body.reason, reviewed_by: 'Người thử', reviewed_at: stamp, can_approve: false, can_reject: false, can_retry: false, original_production: production }
    return ok({ candidate_id: 'mock-candidate', review })
  }
  if (url === '/profile/mock-profile/series-review') return ok([{ series: { id: 'mock-series', title: 'Nhóm xem thử', status: 'ACTIVE', series_type: 'NEWS', created_at: stamp }, articles: [{ plan: { ...workflow(), workflow_id: 'mock-workflow', id: 'plan-id-not-workflow-id', ai_reasoning: [], story_data: [] }, source_content: source }] }])
  if (url === '/media-workflows/mock-workflow/workspace') return ok(workflow())
  if (url === '/media-workflows/mock-workflow/progress') return ok({ workflow_id: 'mock-workflow', status: workflowStatus, current_stage: stage(), tasks: [], progress_percent: 80 })
  if (url === '/generate-video/save-story' && method === 'POST') {
    story = body.story
    savedSignature = `mock-saved-version-${log.length}`
    record(`SAVED TEXT: ${story.timeline.text.map(item => item.voice_text || item.text).join(' | ')}`)
    return ok({ story, script_signature: savedSignature })
  }
  if (url === '/generate-video/projects/mock-workflow/approve-draft' && method === 'POST') {
    if (failApproval) return fail('Giả lập: draft đã đổi phiên bản, cần tải lại.')
    if (body.script_signature !== savedSignature) return fail('Sai signature')
    draftApproved = true
    return ok({ workflow_id: 'mock-workflow', current_stage: stage(), job: null, series_applied: false })
  }
  if (url === '/media-workflows/mock-workflow/approve' && method === 'POST' && workflowStatus === 'REJECTED') {
    workflowStatus = 'APPROVED'; return ok({ plan: workflow(), media_workflows: [] })
  }
  if (url === '/media-workflows/mock-workflow/reject' && method === 'POST') { workflowStatus = 'REJECTED'; return ok(workflow()) }
  if (url === '/contents/mock-source/detail') return ok(source)
  return fail(`Chặn request ngoài fixture: ${method} ${url}`)
}

function Harness() {
  const [view, setView] = useState('jobs')
  const [version, setVersion] = useState(0)
  const [, refreshLog] = useState(0)
  notify = () => queueMicrotask(() => refreshLog(value => value + 1))
  const show = next => { setView(next); setVersion(value => value + 1) }
  return <>
    <nav className="relative z-[200] flex flex-wrap gap-2 bg-slate-900 p-3 text-sm text-white">
      <strong>CHỈ DỮ LIỆU GIẢ LẬP</strong>
      <button onClick={() => show('jobs')}>Lịch sử plan (test)</button>
      <button onClick={() => show('plans')}>Danh sách draft (test)</button>
      <button onClick={() => { review = { ...review, status: 'FAILED', error_message: 'Lỗi model giả lập', can_retry: true, can_reject: true }; record('MOCK worker FAILED') }}>Giả lập job lỗi</button>
      <button onClick={() => { review = { ...review, status: 'COMPLETED', can_retry: false, can_reject: false, error_message: null }; record('MOCK worker COMPLETED') }}>Giả lập job xong</button>
      <button onClick={() => { failApproval = !failApproval; record(`MOCK approval conflict: ${failApproval}`) }}>Bật/tắt lỗi duyệt</button>
      <button onClick={() => { failRefresh = true; record('MOCK next detail GET fails') }}>Lỗi lần tải kế tiếp</button>
      <button onClick={() => { failDiagnostics = true; record('MOCK next diagnostics GET fails') }}>Lỗi tải chẩn đoán</button>
      <button onClick={() => { review = { status: null, can_approve: true, can_reject: true }; draftApproved = false; workflowStatus = 'EDITING'; log = []; show('jobs') }}>Đặt lại fixture</button>
    </nav>
    <main className="p-4 pb-44">
      {view === 'editor' ? <VideoProductionWorkspace key={version} workflowId="mock-workflow" onBackToList={() => show('jobs')} />
        : <PlanningPage key={`${view}-${version}`} initialStep={view} onOpenGenerateVideo={id => { record(`OPEN ${id}`); show('editor') }} />}
    </main>
    <pre aria-label="Mock API calls" className="fixed bottom-0 left-0 z-[200] max-h-36 w-96 max-w-[30vw] overflow-auto bg-slate-900 p-2 text-[10px] text-white">{log.join('\n')}</pre>
    <Toaster />
  </>
}
createRoot(document.getElementById('root')).render(<Harness />)
