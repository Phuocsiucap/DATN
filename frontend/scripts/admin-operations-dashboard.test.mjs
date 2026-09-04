import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let server
let AdminOperationsContent

before(async () => {
  server = await createServer({
    cacheDir: 'node_modules/.vite-admin-dashboard-tests',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  })
  ;({ AdminOperationsContent } = await server.ssrLoadModule('/src/features/dashboard/DashboardPage.tsx'))
})

after(async () => { await server?.close() })

const fixture = {
  generated_at: '2026-09-02T12:00:00Z',
  totals: {
    crawl_jobs: 14,
    crawl_jobs_completed: 12,
    contents: 1280,
    videos_rendered: 48,
    audio_generated: 52,
    published_posts: 31,
    tasks: 180,
    tasks_completed: 160,
  },
  active: {
    crawl: 3,
    crawl_jobs: 2,
    draft: 4,
    voice: 1,
    render: 2,
    publishing: 1,
    other: 0,
    total: 11,
  },
  errors: { last_24h: 3, tasks: 1, crawl: 1, publishing: 1, ai: 0 },
  running_tasks: [{
    id: 'task-1',
    task_type: 'GENERATE_VIDEO_RENDER',
    label: 'Render video',
    status: 'RUNNING',
    stage: 'ENCODING_VIDEO',
    progress_percent: 64,
    reference_title: 'Video thử nghiệm',
    worker: 'remotion-worker-1',
    attempt_count: 1,
    created_at: '2026-09-02T11:55:00Z',
  }],
  services: [
    { key: 'api', name: 'API Service', kind: 'core', status: 'online', latency_ms: 4, detail: 'OK' },
    { key: 'remotion', name: 'Remotion Worker', kind: 'service', status: 'offline', latency_ms: 2000, detail: 'Timeout' },
  ],
  scheduler: { status: 'running' },
}

const section = (data) => ({
  data,
  loading: false,
  refreshing: false,
  error: '',
  refresh: async () => {},
})

const loadingSection = () => ({
  data: null,
  loading: true,
  refreshing: false,
  error: '',
  refresh: async () => {},
})

test('renders operational totals, active stages, running tasks and service health', () => {
  const html = renderToStaticMarkup(createElement(AdminOperationsContent, {
    summary: section({ generated_at: fixture.generated_at, totals: fixture.totals }),
    pipeline: section({ generated_at: fixture.generated_at, active: fixture.active, running_tasks: fixture.running_tasks }),
    errors: section({ generated_at: fixture.generated_at, errors: fixture.errors }),
    services: section({ generated_at: fixture.generated_at, services: fixture.services }),
    scheduler: section(fixture.scheduler),
    actionBusy: null,
    onToggleScheduler: async () => {},
  }))

  for (const text of [
    'Crawl jobs',
    'Tổng content',
    'Video đã render',
    'Audio đã sinh',
    'Task đang hoạt động',
    'Lỗi trong 24h',
    'Sinh draft',
    'Sinh voice',
    'Render video',
    'Đang push',
    'Video thử nghiệm',
    'ENCODING VIDEO',
    'Remotion Worker',
    'OFFLINE',
  ]) assert.ok(html.includes(text), text)

  assert.match(html, /width:64%/)
  assert.match(html, /CRITICAL/)
  assert.doesNotMatch(html, /Publish Scheduler.*ONLINE/s)
})

test('renders a dedicated skeleton for every dashboard section', () => {
  const html = renderToStaticMarkup(createElement(AdminOperationsContent, {
    summary: loadingSection(),
    pipeline: loadingSection(),
    errors: loadingSection(),
    services: loadingSection(),
    scheduler: loadingSection(),
    actionBusy: null,
    onToggleScheduler: async () => {},
  }))

  for (const testId of [
    'summary-card-skeleton',
    'pipeline-skeleton',
    'tasks-skeleton',
    'services-summary-skeleton',
    'services-list-skeleton',
    'scheduler-skeleton',
    'error-card-skeleton',
  ]) assert.ok(html.includes(`data-testid="${testId}"`), testId)
})
