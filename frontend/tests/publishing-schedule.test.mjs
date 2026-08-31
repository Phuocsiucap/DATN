import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server
let api
let approveAndScheduleQueueItemApi
let approveGenerateVideoProjectApi
let queueGenerateVideoProjectApi
let request

before(async () => {
  server = await createServer({
    cacheDir: 'node_modules/.vite-schedule-tests',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  })
  ;({ api } = await server.ssrLoadModule('/src/commons/apis/client.ts'))
  // Capture real API wrapper requests without browser storage, auth or network.
  api.interceptors.request.clear()
  api.defaults.adapter = async (config) => {
    request = config
    return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config }
  }
  ;({ approveAndScheduleQueueItemApi } = await server.ssrLoadModule('/src/commons/apis/socialProfiles.ts'))
  ;({ approveGenerateVideoProjectApi, queueGenerateVideoProjectApi } = await server.ssrLoadModule('/src/commons/apis/generateVideo.ts'))
})

after(async () => { await server?.close() })

test('automatic schedule leaves timezone to the profile and allows AI response time', async () => {
  await approveAndScheduleQueueItemApi('queue-1', { schedule_mode: 'ai' })
  assert.equal(request.url, '/social-profiles/queue/items/queue-1/approve-schedule')
  assert.equal(request.timeout, 60000)
  assert.deepEqual(JSON.parse(request.data), { schedule_mode: 'ai' })
})

test('manual schedule keeps the explicit timestamp and timezone', async () => {
  const payload = { schedule_mode: 'manual', scheduled_at: '2026-09-02T10:00:00Z', timezone: 'Europe/Paris' }
  await approveAndScheduleQueueItemApi('queue-2', payload)
  assert.deepEqual(JSON.parse(request.data), payload)
})

test('video approval and queue creation allow automatic scheduling to finish', async () => {
  await approveGenerateVideoProjectApi('workflow-1')
  assert.match(request.url, /\/projects\/workflow-1\/approve-video$/)
  assert.equal(request.timeout, 60000)
  await queueGenerateVideoProjectApi('workflow-2')
  assert.match(request.url, /\/projects\/workflow-2\/queue-post$/)
  assert.equal(request.timeout, 60000)
})
