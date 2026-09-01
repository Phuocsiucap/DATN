import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

let server, normalizeVideoWorkspaceList, hasActiveVideoTask, videoWorkspaceSeriesKey, VideoKanbanCard, VideoRenderingIndicator, DraftGenerationIndicator, VoiceGenerationIndicator, buildVideoKanbanColumns, classifyVideoWorkspace
before(async () => {
  server = await createServer({
    cacheDir: 'node_modules/.vite-workspace-list-tests',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom',
  })
  ;({ normalizeVideoWorkspaceList, hasActiveVideoTask, videoWorkspaceSeriesKey } = await server.ssrLoadModule('/src/commons/apis/videoWorkspaceList.ts'))
  ;({ buildVideoKanbanColumns, classifyVideoWorkspace } = await server.ssrLoadModule('/src/features/generate-video/videoKanban.ts'))
  ;({ VideoKanbanCard } = await server.ssrLoadModule('/src/features/generate-video/GenerateVideoProjectsPage.tsx'))
  ;({ default: VideoRenderingIndicator } = await server.ssrLoadModule('/src/commons/component/VideoRenderingIndicator.tsx'))
  ;({ default: DraftGenerationIndicator } = await server.ssrLoadModule('/src/commons/component/DraftGenerationIndicator.tsx'))
  ;({ default: VoiceGenerationIndicator } = await server.ssrLoadModule('/src/commons/component/VoiceGenerationIndicator.tsx'))
})
after(async () => { await server?.close() })

function fixture() {
  return { schema_version: 2, total: 50, limit: 1, offset: 2,
    profiles: { p: { name: 'Test profile', platform: 'tiktok', avatar: '/avatar' } },
    series: { s: { title: 'Test series' } },
    items: [{ id: 'w', profile_id: 'p', series_id: 's', title: 'Draft', status: 'EDITING',
      current_stage: 'DRAFT_REVIEW_REQUIRED', progress_percent: 0, task_status: 'COMPLETED',
      thumbnail_url: '/thumb', category: 'News', updated_at: '2026-08-31T00:00:00Z' }],
  }
}

test('hydrates cards from page catalogs without requests or mutating the response', () => {
  const input = fixture(), before = structuredClone(input)
  const result = normalizeVideoWorkspaceList(input)
  const card = result.items[0]
  assert.equal(card.id, 'w')
  assert.equal(card.profile.id, 'p')
  assert.equal(card.profile.avatar, '/avatar')
  assert.equal(card.series.id, 's')
  assert.equal(card.series.title, 'Test series')
  assert.equal(card.thumbnail_url, '/thumb')
  assert.equal(card.category, 'News')
  assert.equal(card.current_stage, 'DRAFT_REVIEW_REQUIRED')
  assert.equal(card.progress_percent, 0)
  assert.deepEqual([result.total, result.limit, result.offset], [50, 1, 2])
  assert.deepEqual(input, before)
})

test('absence of series or task does not fabricate either', () => {
  const input = fixture()
  delete input.items[0].series_id
  delete input.items[0].task_status
  input.series = {}
  const card = normalizeVideoWorkspaceList(input).items[0]
  assert.equal(card.series, null)
  assert.equal(hasActiveVideoTask(card), false)
})

test('all active statuses keep polling and action locks; terminal tasks do not', () => {
  for (const task_status of ['PENDING', 'RUNNING', 'PROCESSING']) assert.equal(hasActiveVideoTask({ task_status }), true)
  for (const task_status of ['FAILED', 'COMPLETED', 'CANCELLED', undefined]) assert.equal(hasActiveVideoTask({ task_status }), false)
})

test('failed task remains available for KPI even when workflow status is EDITING', () => {
  const input = fixture()
  input.items[0].task_status = 'FAILED'
  assert.equal(normalizeVideoWorkspaceList(input).items[0].task_status, 'FAILED')
})

test('legacy API is supported while the API process is being restarted', () => {
  const legacy = { total: 1, limit: 100, offset: 0, items: [{
    id: 'old', profile: { id: 'p', name: 'Profile', platform: 'tiktok' }, series: { id: 's', title: 'Series' },
    title: 'Old', status: 'RENDERING', progress_percent: 0, updated_at: 'now',
    primary_content: { thumbnailUrl: '/old-thumb', category: 'News', summary: 'Unneeded' },
    latest_task: { status: 'RUNNING', error_message: 'Unneeded' }, final_video: 'Unneeded',
  }] }
  const card = normalizeVideoWorkspaceList(legacy).items[0]
  assert.equal(card.thumbnail_url, '/old-thumb')
  assert.equal(card.series_id, 's')
  assert.equal(hasActiveVideoTask(card), true)
  assert.equal(card.progress_percent, 0)
  assert.equal(card.latest_task, undefined)
  assert.equal(card.primary_content, undefined)
  assert.equal(card.final_video, undefined)
})

test('missing reference fails clearly instead of assigning another profile or series', () => {
  const input = fixture()
  input.profiles = {}
  assert.throws(() => normalizeVideoWorkspaceList(input), /Thiếu dữ liệu/)
  input.profiles = fixture().profiles
  input.series = {}
  assert.throws(() => normalizeVideoWorkspaceList(input), /Thiếu dữ liệu/)
})

test('empty pages preserve total and offset', () => {
  const input = fixture()
  input.items = []; input.profiles = {}; input.series = {}
  assert.deepEqual(normalizeVideoWorkspaceList(input), { items: [], total: 50, limit: 1, offset: 2 })
})

test('card renders compact profile, series, category and draft-review state', () => {
  const item = normalizeVideoWorkspaceList(fixture()).items[0]
  const html = renderToStaticMarkup(createElement(VideoKanbanCard, { item, copied: false, busy: false, disabled: false }))
  for (const text of ['Test profile', 'Test series', 'News', 'Cần duyệt draft', '/thumb']) assert.ok(html.includes(text), text)
  assert.doesNotMatch(html, /01:15|00:57|01:04/)
})

test('running card preserves zero progress and disables destructive actions', () => {
  const input = fixture()
  input.items[0].status = 'RENDERING'
  input.items[0].task_status = 'RUNNING'
  const item = normalizeVideoWorkspaceList(input).items[0]
  const html = renderToStaticMarkup(createElement(VideoKanbanCard, { item, copied: false, busy: false, disabled: hasActiveVideoTask(item) }))
  assert.match(html, /0%/)
  assert.match(html, /Đang render video/)
  assert.match(html, /role="progressbar"[^>]*aria-valuenow="0"/)
  assert.doesNotMatch(html, /45%|width:8%|01:04/)
  assert.match(html, /disabled=""[^>]*title="Xóa workflow này"/)
  assert.match(html, /disabled=""[^>]*title="Tạo lại draft"/)
})

test('render placeholder distinguishes queued jobs from running and legacy rendering jobs', () => {
  const base = normalizeVideoWorkspaceList(fixture()).items[0]
  for (const task_status of ['PENDING', 'RUNNING', 'PROCESSING', null]) {
    const item = { ...base, status: 'RENDERING', task_status, progress_percent: 32 }
    const html = renderToStaticMarkup(createElement(VideoKanbanCard, { item, copied: false, busy: false, disabled: true }))
    assert.ok(html.includes(task_status === 'PENDING' ? 'Đang chờ render' : 'Đang render video'))
    assert.ok(html.includes(`data-state="${task_status === 'PENDING' ? 'queued' : 'rendering'}"`))
    assert.match(html, /aria-valuenow="32"/)
    assert.match(html, /32%/)
  }
})

test('render placeholder is removed for terminal jobs and does not animate scripting or voice work', () => {
  const base = normalizeVideoWorkspaceList(fixture()).items[0]
  for (const [status, task_status] of [
    ['RENDERING', 'FAILED'], ['RENDERING', 'CANCELLED'], ['RENDERING', 'COMPLETED'],
    ['FAILED', 'RUNNING'], ['RENDERED', 'RUNNING'], ['VIDEO_APPROVED', 'RUNNING'],
    ['QUEUED_FOR_PUBLISHING', 'RUNNING'], ['PUBLISHED', 'RUNNING'],
    ['SCRIPTING', 'RUNNING'], ['EDITING', 'RUNNING'], ['VOICE_READY', 'RUNNING'],
  ]) {
    const item = { ...base, status, task_status }
    const html = renderToStaticMarkup(createElement(VideoKanbanCard, { item, copied: false, busy: false, disabled: false }))
    assert.doesNotMatch(html, /Đang render video|Đang chờ render|role="progressbar"/, `${status}/${task_status}`)
    assert.match(html, /src="\/thumb"/)
  }
})

test('all generation indicators bound actual progress and never invent a percentage for missing progress', () => {
  for (const Indicator of [VideoRenderingIndicator, DraftGenerationIndicator, VoiceGenerationIndicator]) {
    for (const [progress, expected] of [[0, 0], [32.4, 32], [-10, 0], [150, 100]]) {
      const html = renderToStaticMarkup(createElement(Indicator, { progress }))
      assert.ok(html.includes(`aria-valuenow="${expected}"`))
      assert.ok(html.includes(`width:${expected}%`))
    }
    for (const progress of [undefined, null, NaN, Infinity]) {
      const html = renderToStaticMarkup(createElement(Indicator, { progress }))
      assert.match(html, /role="progressbar"/)
      assert.match(html, /Đang xử lý/)
      assert.doesNotMatch(html, /aria-valuenow|NaN|Infinity|\d+%/)
    }
  }
})

test('draft and voice cards show the correct activity throughout their processing stages', () => {
  const base = normalizeVideoWorkspaceList(fixture()).items[0]
  const cases = [
    ...['LOADING_SOURCE', 'GENERATING_DRAFT', 'NORMALIZING_DRAFT', 'APPLYING_SERIES', 'SAVING_DRAFT'].map(current_stage => ({
      status: 'SCRIPTING', current_stage, label: 'Đang tạo draft',
    })),
    ...['PREPARING_VOICE', 'GENERATING_VOICE', 'ALIGNING_VOICE', 'SAVING_VOICE'].map(current_stage => ({
      status: 'EDITING', current_stage, label: 'Đang tạo voice',
    })),
    { status: 'RENDERING', current_stage: 'GENERATING_VOICE', label: 'Đang tạo voice' },
  ]
  for (const { status, current_stage, label } of cases) {
    for (const task_status of ['RUNNING', 'PROCESSING', null]) {
      const item = { ...base, status, current_stage, task_status, progress_percent: 30 }
      const html = renderToStaticMarkup(createElement(VideoKanbanCard, { item, disabled: true }))
      assert.ok(html.includes(`aria-label="${label}"`), `${status}/${current_stage}/${task_status}`)
      assert.match(html, /aria-valuenow="30"/)
      assert.equal((html.match(/role="progressbar"/g) || []).length, 1)
      assert.doesNotMatch(html, /Đang render video/)
    }
  }
})

test('queued draft and voice jobs show a waiting placeholder until their worker starts', () => {
  const base = normalizeVideoWorkspaceList(fixture()).items[0]
  for (const [status, current_stage, label] of [
    ['SCRIPTING', 'QUEUED_SCRIPT', 'Đang chờ tạo draft'],
    ['EDITING', 'QUEUED_VOICE', 'Đang chờ tạo voice'],
    ['EDITING', 'GENERATING_VOICE', 'Đang chờ tạo voice'],
  ]) {
    const item = { ...base, status, current_stage, task_status: 'PENDING' }
    const html = renderToStaticMarkup(createElement(VideoKanbanCard, { item, disabled: true }))
    assert.match(html, /data-state="queued"/)
    assert.ok(html.includes(`aria-label="${label}"`))
    assert.match(html, /aria-valuenow="0"/)
  }
})

test('draft and voice illustrations stop after completion, failure or cancellation even with stale stages', () => {
  const base = normalizeVideoWorkspaceList(fixture()).items[0]
  for (const [status, current_stage] of [['SCRIPTING', 'GENERATING_DRAFT'], ['EDITING', 'GENERATING_VOICE']]) {
    for (const task_status of ['COMPLETED', 'FAILED', 'CANCELLED']) {
      const item = { ...base, status, current_stage, task_status }
      const html = renderToStaticMarkup(createElement(VideoKanbanCard, { item }))
      assert.doesNotMatch(html, /role="progressbar"|Đang tạo draft|Đang tạo voice/)
      assert.match(html, /src="\/thumb"/)
    }
  }
  for (const status of ['FAILED', 'RENDERED', 'VIDEO_APPROVED', 'QUEUED_FOR_PUBLISHING', 'PUBLISHED']) {
    const item = { ...base, status, current_stage: 'GENERATING_VOICE', task_status: 'RUNNING' }
    assert.doesNotMatch(renderToStaticMarkup(createElement(VideoKanbanCard, { item })), /role="progressbar"/)
  }
})

test('manual editing, AI review and ready-to-review or ready-voice states are not displayed as generation', () => {
  const base = normalizeVideoWorkspaceList(fixture()).items[0]
  for (const [status, current_stage] of [
    ['EDITING', 'DRAFT_REVIEW_REQUIRED'], ['SCRIPTING', 'DRAFT_READY'],
    ['EDITING', 'EDITING_DRAFT'], ['EDITING', 'NORMALIZING_DRAFT'],
    ['REVIEWING', 'REVIEWING_DRAFT'], ['REVIEWING', 'REVIEW_COMPLETE'],
    ['VOICE_READY', 'VOICE_READY'], ['EDITING', null],
  ]) {
    const item = { ...base, status, current_stage, task_status: 'RUNNING' }
    const html = renderToStaticMarkup(createElement(VideoKanbanCard, { item }))
    assert.doesNotMatch(html, /role="progressbar"/, `${status}/${current_stage}`)
  }
})

test('series refresh key ignores card order/count but changes for new or renamed series', () => {
  const a = { series: { id: 'a', title: 'A' } }, b = { series: { id: 'b', title: 'B' } }
  assert.equal(videoWorkspaceSeriesKey([a, b, a]), videoWorkspaceSeriesKey([b, a]))
  assert.notEqual(videoWorkspaceSeriesKey([a]), videoWorkspaceSeriesKey([a, b]))
  assert.notEqual(videoWorkspaceSeriesKey([a]), videoWorkspaceSeriesKey([{ series: { id: 'a', title: 'Changed' } }]))
  assert.equal(videoWorkspaceSeriesKey([{ series: null }]), '[]')
})

test('production board has exactly four columns and completed videos stop at the fourth', () => {
  const input = {
    schema_version: 2,
    total: 4,
    limit: 100,
    offset: 0,
    profiles: { p: { name: 'SocialContentHub', platform: 'tiktok', avatar: '/avatar' } },
    series: { s: { title: 'Chiến tranh thương mại và chính trị' } },
    items: [
      { id: 'queued', profile_id: 'p', title: 'Triều Tiên miễn nhiệm Bộ trưởng Quốc phòng', status: 'QUEUED_FOR_PUBLISHING', current_stage: 'QUEUED_FOR_PUBLISHING', progress_percent: 100, task_status: 'COMPLETED', updated_at: '2026-08-31T05:55:56Z' },
      { id: 'failed-1', profile_id: 'p', series_id: 's', title: 'Tòa án ngăn ông Trump trục xuất sinh viên nước ngoài chỉ trích Israel', status: 'FAILED', current_stage: 'FAILED', progress_percent: 30, task_status: 'FAILED', updated_at: '2026-08-31T05:54:50Z' },
      { id: 'failed-2', profile_id: 'p', series_id: 's', title: 'Đảng Cộng hòa nguy cơ trả giá vì đòn thuế của ông Trump với Canada', status: 'FAILED', current_stage: 'FAILED', progress_percent: 30, task_status: 'FAILED', updated_at: '2026-08-31T05:54:50Z' },
      { id: 'failed-3', profile_id: 'p', title: 'Cuộc gặp giữa ông Putin và ông Tập', status: 'FAILED', current_stage: 'FAILED', progress_percent: 30, task_status: 'FAILED', updated_at: '2026-08-31T05:54:50Z' },
    ],
  }
  const items = normalizeVideoWorkspaceList(input).items
  const columns = buildVideoKanbanColumns(items)
  const byId = Object.fromEntries(columns.map((column) => [column.id, column.items.map((item) => item.id)]))

  assert.deepEqual(byId.draft, [])
  assert.deepEqual(columns.map(column => column.id), ['draft', 'editing', 'rendering', 'review', 'failed'])
  assert.deepEqual(byId.review, ['queued'])
  assert.deepEqual(byId.failed, ['failed-1', 'failed-2', 'failed-3'])
  assert.deepEqual(items.filter(item => classifyVideoWorkspace(item) === 'failed').map(item => item.id), ['failed-1', 'failed-2', 'failed-3'])
  assert.equal(columns.flatMap(column => column.items).length, items.length)
})

test('approved and published videos remain visible without publishing columns', () => {
  const base = normalizeVideoWorkspaceList(fixture()).items[0]
  const items = ['RENDERED', 'VIDEO_APPROVED', 'QUEUED_FOR_PUBLISHING', 'PUBLISHED'].map(status => ({ ...base, id: status, status }))
  const columns = buildVideoKanbanColumns(items)
  assert.deepEqual(columns[3].items.map(item => item.id), items.map(item => item.id))
  const html = renderToStaticMarkup(createElement(VideoKanbanCard, { item: items[0], copied: false, busy: false, disabled: false }))
  assert.match(html, /href="\/approvals\?profile_id=p"/)
  const scheduledHtml = renderToStaticMarkup(createElement(VideoKanbanCard, { item: items[2], copied: false, busy: false, disabled: false }))
  assert.match(scheduledHtml, /href="\/schedule\?profile_id=p"/)
  const publishedHtml = renderToStaticMarkup(createElement(VideoKanbanCard, { item: items[3], copied: false, busy: false, disabled: false }))
  assert.match(publishedHtml, /href="\/published-posts\?profile_id=p"/)
})

test('kanban classifies known terminal statuses before active task fallback', () => {
  const item = normalizeVideoWorkspaceList(fixture()).items[0]
  item.status = 'QUEUED_FOR_PUBLISHING'
  item.task_status = 'COMPLETED'
  assert.equal(classifyVideoWorkspace(item), 'queued')

  item.status = 'PUBLISHED'
  item.task_status = 'RUNNING'
  assert.equal(classifyVideoWorkspace(item), 'published')

  item.status = 'EDITING'
  item.task_status = 'FAILED'
  assert.equal(classifyVideoWorkspace(item), 'failed')

  item.status = 'BACKEND_NEW_STATUS'
  item.task_status = 'COMPLETED'
  assert.equal(classifyVideoWorkspace(item), 'unknown')
})
