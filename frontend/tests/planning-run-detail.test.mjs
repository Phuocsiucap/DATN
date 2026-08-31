import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let server
let PlanningRunDetailSheet
let OpenDraftWorkspaceButton

before(async () => {
  // Load actual TSX without an API server or production writes; isolate test cache.
  server = await createServer({
    cacheDir: 'node_modules/.vite-planning-detail-tests',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  })
  ;({ PlanningRunDetailSheet } = await server.ssrLoadModule('/src/features/planning/PlanningRunDetailSheet.tsx'))
  ;({ OpenDraftWorkspaceButton } = await server.ssrLoadModule('/src/features/planning/OpenDraftWorkspaceButton.tsx'))
})
after(async () => { await server?.close() })

function fixture() {
  const run = { id: 'run-a', profile_id: 'profile-a', profile_name: 'Test profile', status: 'SUCCEEDED', planning_mode: 'AUTO' }
  const candidate = {
    id: 'candidate-a', title: 'Source article', summary: 'Source summary', rank: 1, selected: true, workflow_id: 'workflow-a',
    matching: { eligible: true, score: 52, source_quality_score: 95, similarity: 0.52, similarity_threshold: 0.35, topics: [], avoid_topics: [], selection_reasons: [], rejection_reasons: [] },
    decision: {
      status: 'DRAFT_REVIEW_REQUIRED', provider: 'test', model: 'test-model', notes: [],
      production: { status: 'PRODUCE', source: 'RULE', confidence_score: 99, reason_code: 'MATCH', reason: 'Source matched' },
      draft: { title: 'Draft title', quality: { status: 'REVIEW_REQUIRED', score: 83, word_count: 128, scene_count: 6, retry_count: 1,
        issues: [{ code: 'SCENE_REPETITION', scene_indexes: [4, 5], details: {} }] }, risk_flags: [] },
      series: { action: 'CREATE_NEW', title: 'Proposed series', followup_angles: [] },
      token_usage: null,
    },
  }
  const detail = {
    schema_version: 2, id: run.id, profile: { id: 'profile-a', name: 'Test profile' }, planning_mode: 'AUTO', status: 'SUCCEEDED',
    summary: { candidate_count: 1, eligible_count: 1, filtered_count: 0, selected_count: 1, workflow_count: 1,
      production: { PRODUCE: 1 }, draft_quality: { REVIEW_REQUIRED: 1 } },
    topics: [], candidates: [candidate],
    workflows: [{ id: 'workflow-a', status: 'EDITING', current_stage: 'DRAFT_REVIEW_REQUIRED', pending_series: true, series: null }],
  }
  return { run, detail, loading: false, onClose() {} }
}

const render = props => renderToStaticMarkup(createElement(PlanningRunDetailSheet, props))

test('shows real draft review, issue scene numbers and pending series instead of LLM approval', () => {
  const html = render(fixture())
  assert.match(html, /Draft cần duyệt/)
  assert.match(html, /83\/100/)
  assert.match(html, /cảnh 5, 6/)
  assert.match(html, /Đề xuất đang chờ áp dụng/)
  assert.match(html, /Chất lượng nguồn 95/)
  assert.doesNotMatch(html, /LLM DUYỆT|Quyết định AI cuối/)
})

test('separates a passing historical draft from a failed current workflow', () => {
  const props = fixture()
  props.detail.candidates[0].decision.status = 'AI_APPROVED'
  props.detail.candidates[0].decision.draft.quality.status = 'PASS'
  props.detail.workflows[0].current_stage = 'FAILED'
  const html = render(props)
  assert.match(html, /Draft đạt kiểm tra/)
  assert.match(html, /Thất bại/)
  assert.match(html, /workflow bên dưới là trạng thái hiện tại/)
})

test('never displays missing token accounting as zero usage', () => {
  assert.match(render(fixture()), /Chưa ghi nhận token cho quyết định này/)
  const props = fixture()
  props.detail.candidates[0].decision.token_usage = { input_tokens: 10, output_tokens: 5, creative_call_count: 2, fit_judge_call_count: 0 }
  assert.match(render(props), /Fit Judge 0 call/)
})

test('ignores a late detail response belonging to another plan', () => {
  const props = fixture()
  props.detail.id = 'run-b'
  const html = render(props)
  assert.doesNotMatch(html, /Source article|Draft title/)
  assert.match(html, /Chưa tải được chi tiết plan/)
})

function productionReviewFixture(status = null) {
  const props = fixture()
  const candidate = props.detail.candidates[0]
  candidate.content_id = 'content-a'
  candidate.selected = false
  candidate.workflow_id = null
  candidate.decision = { status: 'REVIEW_REQUIRED', notes: [], draft: null, series: null,
    production: { status: 'REVIEW_REQUIRED', source: 'LLM', reason_code: 'TOPIC_RELEVANCE', reason: 'Cần kiểm tra độ phù hợp' } }
  candidate.review = { status, action: status ? 'APPROVE' : null, can_approve: !status,
    can_reject: !status || status === 'FAILED', can_retry: status === 'FAILED',
    original_production: status ? candidate.decision.production : null }
  props.detail.workflows = []
  props.onCandidateChanged = async () => {}
  return props
}

test('unproduced review offers approve, reject and source without claiming a draft exists', () => {
  const html = render(productionReviewFixture())
  assert.match(html, /Cho phép sinh draft/)
  assert.match(html, /Không sản xuất/)
  assert.match(html, /Xem bài nguồn/)
  assert.match(html, /Draft vẫn phải qua kiểm tra chất lượng/)
  assert.doesNotMatch(html, /83\/100|Mở workflow/)
})

test('queued review hides mutation buttons and displays durable job status', () => {
  const html = render(productionReviewFixture('QUEUED'))
  assert.match(html, /Job đang chờ hoặc đang sinh draft/)
  assert.match(html, /Quyết định ban đầu/)
  assert.doesNotMatch(html, />Cho phép sinh draft<|>Không sản xuất<|>Thử sinh draft lại</)
})

test('failed generation exposes an explicit paid retry and the saved error', () => {
  const props = productionReviewFixture('FAILED')
  props.detail.candidates[0].review.error_message = 'Model timeout'
  const html = render(props)
  assert.match(html, /Thử sinh draft lại/)
  assert.match(html, /có thể phát sinh token/)
  assert.match(html, /Model timeout/)
  assert.match(html, /Không sản xuất/)
})

test('completed review opens the workflow without claiming video approval', () => {
  const props = productionReviewFixture('COMPLETED')
  props.detail.candidates[0].workflow_id = 'workflow-a'
  props.detail.workflows = [{ id: 'workflow-a', status: 'EDITING', current_stage: 'DRAFT_READY' }]
  props.onOpenWorkflow = () => {}
  const html = render(props)
  assert.match(html, /Mở workflow/)
  assert.match(html, /không phải phê duyệt video để đăng/)
  assert.doesNotMatch(html, />Cho phép sinh draft<|>Thử sinh draft lại</)
})

test('existing draft-review workflows never show pre-draft approval buttons', () => {
  const props = { ...fixture(), onOpenWorkflow() {} }
  const html = render(props)
  assert.doesNotMatch(html, />Cho phép sinh draft<|Duyệt bài nguồn — trước khi sinh draft/)
  assert.match(html, /Mở để duyệt draft/)
  assert.match(html, /không cần duyệt bài nguồn lần nữa/)
})

test('opening a draft is navigation only, using the supplied workflow id', () => {
  const events = []
  const button = OpenDraftWorkspaceButton({ workflowId: 'workflow-not-plan-id', reviewRequired: true, onOpenWorkflow: id => events.push(id) })
  button.props.onClick({ stopPropagation() { events.push('stopPropagation') } })
  assert.deepEqual(events, ['stopPropagation', 'workflow-not-plan-id'])
  assert.equal(button.props.disabled, false)
  assert.match(button.props.title, /chưa phê duyệt hay chạy sản xuất/)
})

test('navigation is disabled when the host does not provide an editor callback', () => {
  const button = OpenDraftWorkspaceButton({ workflowId: 'workflow-a' })
  assert.equal(button.props.disabled, true)
})

test('navigation label follows current workflow state, not historical draft quality', () => {
  const props = { ...fixture(), onOpenWorkflow() {} }
  props.detail.workflows[0].current_stage = 'VOICE_READY'
  const html = render(props)
  assert.match(html, /Mở workflow/)
  assert.doesNotMatch(html, /Mở để duyệt draft/)
})

test('rejected workflows are viewable but not presented as ready for draft approval', () => {
  const props = { ...fixture(), onOpenWorkflow() {} }
  props.detail.workflows[0].status = 'REJECTED'
  const html = render(props)
  assert.match(html, /Xem workflow bị từ chối/)
  assert.doesNotMatch(html, /Mở để duyệt draft/)
})

test('missing workflows do not expose a dead navigation action', () => {
  const props = { ...fixture(), onOpenWorkflow() {} }
  props.detail.workflows = []
  const html = render(props)
  assert.match(html, /không còn khả dụng/)
  assert.doesNotMatch(html, /Mở để duyệt draft|Mở workflow|Mở \/ duyệt draft/)
})

test('older runs with unlinked workflows still offer an editor entry', () => {
  const props = { ...fixture(), onOpenWorkflow() {} }
  props.detail.candidates = []
  const html = render(props)
  assert.match(html, /Workflow chưa có liên kết ứng viên/)
  assert.match(html, /Mở để duyệt draft/)
})

test('supports empty runs, loading and missing selection', () => {
  assert.equal(render({ ...fixture(), run: null }), '')
  assert.match(render({ ...fixture(), detail: null, loading: true }), /Đang tải chi tiết plan/)
  const props = fixture()
  props.detail.candidates = []
  props.detail.workflows = []
  assert.match(render(props), /Plan này không lưu ứng viên chi tiết/)
})

test('does not invent duration from old invalid completion timestamps', () => {
  const props = fixture()
  props.detail.started_at = props.detail.completed_at = '2026-08-30T15:35:08Z'
  props.detail.updated_at = '2026-08-30T15:36:31Z'
  assert.match(render(props), /chưa thể tính thời lượng đáng tin cậy/)
})

function compactFixture() {
  const props = fixture()
  const { topics: _topics, candidates: _candidates, ...metadata } = props.detail
  props.detail = { ...metadata, schema_version: 3, candidates: [{
    id: 'candidate-a', content_id: 'content-a', title: 'Compact article', rank: 1,
    status: 'DRAFT_REVIEW_REQUIRED', reason: 'Draft cần duyệt: hai đoạn lặp ý.', similarity: 0.4,
    workflow_id: 'workflow-a',
  }] }
  props.onOpenWorkflow = () => {}
  return props
}

test('compact overview renders without matching, decisions or a shared topic catalog', () => {
  const html = render(compactFixture())
  assert.match(html, /Compact article/)
  assert.match(html, /hai đoạn lặp ý/)
  assert.match(html, /Xem chi tiết quyết định/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /Mở để duyệt draft/)
  assert.doesNotMatch(html, /Chi tiết bộ lọc|Thông số draft|Source summary|Confidence draft/)
})

test('compact overview retains source approval without downloading diagnostics', () => {
  const props = compactFixture()
  props.detail.candidates[0] = { id: 'candidate-a', content_id: 'content-a', status: 'REVIEW_REQUIRED', reason: 'Cần kiểm tra chủ đề.',
    review: { can_approve: true, can_reject: true, can_retry: false } }
  props.detail.workflows = []
  const html = render(props)
  assert.match(html, /Cho phép sinh draft/)
  assert.match(html, /Không sản xuất/)
  assert.match(html, /Xem bài nguồn/)
  assert.doesNotMatch(html, /Mở để duyệt draft|Đang tải chi tiết bài này/)
})

test('compact polling can show a queued job with only sparse review fields', () => {
  const props = compactFixture()
  props.detail.candidates[0] = { id: 'candidate-a', status: 'DRAFT_QUEUED', reason: 'Đã duyệt bài.',
    review: { status: 'QUEUED', can_approve: false, can_reject: false, can_retry: false } }
  props.detail.workflows = []
  assert.match(render(props), /Job đang chờ hoặc đang sinh draft/)
  assert.doesNotMatch(render(props), />Cho phép sinh draft<|>Không sản xuất</)
})

test('compact filtered rows explain their threshold without empty review controls', () => {
  const props = compactFixture()
  props.detail.candidates[0] = { id: 'filtered', title: 'Filtered article', status: 'FILTERED',
    reason: 'Độ khớp 0.2000 dưới ngưỡng 0.35.', reason_code: 'BELOW_SIMILARITY_THRESHOLD', similarity: 0.2 }
  props.detail.workflows = []
  const html = render(props)
  assert.match(html, /Độ khớp 0.2000 dưới ngưỡng 0.35/)
  assert.doesNotMatch(html, /Duyệt bài nguồn|Cho phép sinh draft|Mở workflow/)
})

test('stale compact responses do not render candidates from another run', () => {
  const props = compactFixture()
  props.detail.id = 'wrong-run'
  const html = render(props)
  assert.doesNotMatch(html, /Compact article/)
  assert.match(html, /Chưa tải được chi tiết plan/)
})
