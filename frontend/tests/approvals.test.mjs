import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

let server, buildApprovalSchedulePayload, toDateTimeInputValue, ApprovalDetail, ApprovalListCard, approvalBucket, approvalStatusLabel, approvalTabs, approvePublishingQueueItemApi, request
before(async () => {
  server = await createServer({
    cacheDir: 'node_modules/.vite-approval-tests',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom',
  })
  ;({ buildApprovalSchedulePayload, toDateTimeInputValue } = await server.ssrLoadModule('/src/features/approvals/approvalSchedule.ts'))
  ;({ ApprovalDetail, ApprovalListCard } = await server.ssrLoadModule('/src/features/approvals/ApprovalsPage.tsx'))
  ;({ approvalBucket, approvalStatusLabel, approvalTabs } = await server.ssrLoadModule('/src/features/approvals/approvalStatus.ts'))
  const { api } = await server.ssrLoadModule('/src/commons/apis/client.ts')
  api.interceptors.request.clear()
  api.defaults.adapter = async config => {
    request = config
    return { data: { status: 'approved', scheduled_at: null }, status: 200, statusText: 'OK', headers: {}, config }
  }
  ;({ approvePublishingQueueItemApi } = await server.ssrLoadModule('/src/commons/apis/socialProfiles.ts'))
})
after(async () => { await server?.close() })

test('plain approval sends no scheduling or publishing request', async () => {
  const result = await approvePublishingQueueItemApi('item-1')
  assert.equal(request.url, '/social-profiles/queue/items/item-1/approve')
  assert.equal(request.method, 'post')
  assert.equal(request.data, undefined)
  assert.equal(result.scheduled_at, null)
})

test('manual input is required, valid and in the future', () => {
  const now = Date.parse('2026-08-31T00:00:00Z')
  for (const value of ['', 'invalid', '2000-01-01T08:00']) {
    assert.throws(() => buildApprovalSchedulePayload('manual', value, 'Asia/Bangkok', now))
  }
  assert.equal(toDateTimeInputValue(null), '')
  assert.equal(toDateTimeInputValue('invalid'), '')
})

test('manual schedule preserves the selected wall time with a precise UTC timestamp', () => {
  const oldTimezone = process.env.TZ
  try {
    process.env.TZ = 'Asia/Bangkok'
    assert.deepEqual(buildApprovalSchedulePayload('manual', '2099-01-02T20:15', 'Asia/Bangkok', 0), {
      schedule_mode: 'manual', scheduled_at: '2099-01-02T13:15:00.000Z', timezone: 'Asia/Bangkok',
    })
    assert.equal(toDateTimeInputValue('2099-01-02T13:15:00Z'), '2099-01-02T20:15')
    process.env.TZ = 'America/New_York'
    assert.deepEqual(buildApprovalSchedulePayload('manual', '2099-01-02T20:15', 'America/New_York', 0), {
      schedule_mode: 'manual', scheduled_at: '2099-01-03T01:15:00.000Z', timezone: 'America/New_York',
    })
    assert.throws(() => buildApprovalSchedulePayload('manual', '2027-03-14T02:30', 'America/New_York', 0), /không tồn tại/)
    assert.throws(() => buildApprovalSchedulePayload('manual', '2099-02-30T12:00', 'America/New_York', 0), /không tồn tại/)
  } finally {
    if (oldTimezone === undefined) delete process.env.TZ
    else process.env.TZ = oldTimezone
  }
})

test('explicit AI scheduling leaves both time and timezone to the profile', () => {
  assert.deepEqual(buildApprovalSchedulePayload('ai', '2000-01-01T08:00', 'America/New_York', 0), { schedule_mode: 'ai' })
})

test('pending review shows a separate approval and does not open schedule inputs automatically', () => {
  const html = renderToStaticMarkup(createElement(ApprovalDetail, {
    item: { id: 'item', profile_id: 'p', article_title: 'Video giả lập', platform: 'tiktok', status: 'needs_approval', scheduled_at: null },
    detailLoading: false, scheduleMode: 'manual', manualScheduledAt: '', loading: false,
  }))
  assert.match(html, />Duyệt<\/button>/)
  assert.match(html, /Duyệt &amp; lên lịch/)
  assert.match(html, /Chưa lên lịch/)
  assert.doesNotMatch(html, /datetime-local/)
})

test('already approved video offers scheduling instead of another approval', () => {
  const html = renderToStaticMarkup(createElement(ApprovalDetail, {
    item: { id: 'item', profile_id: 'p', article_title: 'Video giả lập', platform: 'tiktok', status: 'approved', scheduled_at: null },
    detailLoading: false, scheduleMode: 'manual', manualScheduledAt: '', loading: false,
  }))
  assert.doesNotMatch(html, />Duyệt<\/button>/)
  assert.match(html, /Lên lịch đăng/)
})

test('auto-approved unscheduled videos are separate from scheduled, published and failed videos', () => {
  assert.deepEqual(approvalTabs.map(tab => tab.value), ['needs_approval', 'approved', 'attention'])
  const items = [
    { status: 'needs_approval', scheduled_at: '2099-01-01T00:00:00Z' },
    { status: 'approved', scheduled_at: null },
    { status: 'approved', scheduled_at: '2099-01-01T00:00:00Z' },
    { status: 'queued', scheduled_at: null },
    { status: 'queued', scheduled_at: '2099-01-01T00:00:00Z' },
    { status: 'publishing', scheduled_at: '2099-01-01T00:00:00Z' },
    { status: 'published', scheduled_at: '2026-01-01T00:00:00Z' },
    { status: 'failed', scheduled_at: '2026-01-01T00:00:00Z' },
  ]
  assert.deepEqual(items.map(approvalBucket), ['needs_approval', 'approved', 'scheduled', 'approved', 'scheduled', 'scheduled', 'published', 'attention'])
  assert.equal(approvalStatusLabel(items[1]), 'Đã duyệt · chưa lên lịch')
  assert.equal(approvalStatusLabel(items[2]), 'Đã lên lịch')
  const shownInApprovals = items.filter(item => approvalTabs.some(tab => tab.value === approvalBucket(item)))
  assert.deepEqual(shownInApprovals, [items[0], items[1], items[3], items[7]])
})

test('approved rows expose a schedule action without nesting buttons or re-approving', () => {
  const item = { id: 'item', profile_id: 'p', article_title: 'Video tự duyệt', platform: 'tiktok', status: 'approved', scheduled_at: null }
  const html = renderToStaticMarkup(createElement(ApprovalListCard, { item, index: 0, active: false, disabled: false }))
  assert.match(html, />Lên lịch<\/button>/)
  assert.match(html, /Đã duyệt · chưa lên lịch/)
  assert.doesNotMatch(html, /<button\b(?:(?!<\/button>)[\s\S])*<button\b/)
  const scheduledHtml = renderToStaticMarkup(createElement(ApprovalListCard, { item: { ...item, scheduled_at: '2099-01-01T00:00:00Z' }, index: 0 }))
  assert.doesNotMatch(scheduledHtml, />Lên lịch<\/button>/)
})

test('strategy flags and an explicitly opened manual schedule are visible for an approved video', () => {
  const html = renderToStaticMarkup(createElement(ApprovalDetail, {
    item: { id: 'item', profile_id: 'p', article_title: 'Video tự duyệt', platform: 'tiktok', status: 'approved', scheduled_at: null,
      profile_strategy: { approval_mode: 'auto', auto_queue_enabled: false, auto_publish_enabled: false } },
    detailLoading: false, scheduleMode: 'manual', manualScheduledAt: '', scheduleOpen: true, loading: false,
  }))
  assert.match(html, /datetime-local/)
  assert.match(html, /Tắt — có lịch vẫn chưa tự gửi lên TikTok/)
  assert.match(html, /Tự lên lịch sau tự duyệt: Tắt/)
  assert.match(html, /không cần duyệt lại/)
  assert.match(html, /disabled=""[^>]*>[\s\S]*?Xác nhận lịch đăng/)
})
