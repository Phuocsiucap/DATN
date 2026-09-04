import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'


let server
let CreatorHero
let CreatorActions
let RecentProjects
let PublishingJourney

before(async () => {
  server = await createServer({
    cacheDir: 'node_modules/.vite-creator-dashboard-tests',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  })
  ;({ CreatorHero, CreatorActions, RecentProjects, PublishingJourney } = await server.ssrLoadModule('/src/features/dashboard/CreatorDashboardPage.tsx'))
})

after(async () => { await server?.close() })

const overview = {
  generated_at: '2026-09-03T01:00:00Z',
  recommendations_ready: 8,
  profiles: { total: 3, active: 2 },
  projects: { total: 12, in_progress: 4 },
  publishing: { needs_approval: 2, scheduled: 3, published: 19, failed: 1 },
}

const projects = {
  generated_at: '2026-09-03T01:00:00Z',
  status_counts: { rendering: 1 },
  recent_projects: [{
    id: 'workflow-1',
    title: 'Video của Creator',
    status: 'RENDERING',
    current_stage: 'ENCODING_VIDEO',
    progress_percent: 72,
    profile_name: 'Kênh TikTok của tôi',
    platform: 'tiktok',
    updated_at: '2026-09-03T00:55:00Z',
  }],
}

const publishing = {
  generated_at: '2026-09-03T01:00:00Z',
  status_counts: { needs_approval: 2, approved: 1, queued: 3, publishing: 0, published: 19, failed: 1 },
  upcoming: [{
    id: 'queue-1',
    title: 'Bài sắp đăng của tôi',
    platform: 'tiktok',
    profile_name: 'Kênh TikTok của tôi',
    status: 'queued',
    scheduled_at: '2026-09-03T03:00:00Z',
  }],
}

test('creator dashboard is a creative workspace, not an admin operations view', () => {
  const noop = () => {}
  const html = renderToStaticMarkup(createElement(Fragment, null,
    createElement(CreatorHero, { data: overview, onNavigate: noop }),
    createElement(CreatorActions, { data: overview, onNavigate: noop }),
    createElement(RecentProjects, { data: projects, onOpenProject: noop, onNavigate: noop }),
    createElement(PublishingJourney, { data: publishing, onNavigate: noop }),
  ))

  for (const text of [
    'CREATOR WORKSPACE',
    'Biến ý tưởng thành nội dung sẵn sàng xuất bản',
    'Gợi ý chưa khai thác',
    'Video của Creator',
    'Kênh TikTok của tôi',
    'Hành trình xuất bản',
    'Bài sắp đăng của tôi',
  ]) assert.ok(html.includes(text), text)

  for (const adminOnlyText of ['Sức khỏe hạ tầng', 'Task đang thực thi', 'Crawl jobs', 'Publish Scheduler']) {
    assert.ok(!html.includes(adminOnlyText), adminOnlyText)
  }
})

test('admin and creator dashboards have separate routes and API namespaces', async () => {
  const [navigation, creatorApi, adminApi, creatorPage] = await Promise.all([
    readFile(new URL('../src/commons/component/navigation.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/commons/apis/creatorDashboard.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/commons/apis/dashboard.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/dashboard/CreatorDashboardPage.tsx', import.meta.url), 'utf8'),
  ])

  assert.match(navigation, /ADMIN_DASHBOARD_PATH = '\/admin\/dashboard'/)
  assert.match(navigation, /CREATOR_DASHBOARD_PATH = '\/creator\/dashboard'/)
  assert.match(creatorApi, /\/creator\/dashboard\/overview/)
  assert.match(adminApi, /\/admin\/system\/dashboard\/summary/)
  for (const skeleton of [
    'creator-hero-skeleton',
    'creator-actions-skeleton',
    'creator-projects-skeleton',
    'creator-publishing-skeleton',
  ]) assert.ok(creatorPage.includes(skeleton), skeleton)
})
