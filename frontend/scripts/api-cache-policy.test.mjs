import assert from 'node:assert/strict'
import test from 'node:test'
import { configureStore } from '@reduxjs/toolkit'
import {
  getInvalidationForMutation,
  getTagsForGet,
  isVolatileGetPath,
  normalizeApiPath,
} from '../src/commons/store/apiCachePolicy.ts'

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
}

test('normalizes relative and absolute API URLs before assigning tags', () => {
  assert.equal(normalizeApiPath('/api/v1/social-profiles?platform=tiktok'), '/social-profiles')
  assert.equal(
    normalizeApiPath('https://example.test/api/v1/media-workflows/video-workspace?limit=20'),
    '/media-workflows/video-workspace',
  )
})

test('assigns GET cache tags by related API domain', () => {
  assert.deepEqual(getTagsForGet('/social-profiles'), ['SocialProfiles'])
  assert.deepEqual(getTagsForGet('/social-profiles/42/strategy'), ['ProfileStrategy'])
  assert.deepEqual(getTagsForGet('/social-profiles/queue/items'), ['PublishingQueue'])
  assert.deepEqual(getTagsForGet('/profile/42/content-series'), ['ContentSeries'])
  assert.deepEqual(getTagsForGet('/media-workflows/abc/workspace'), ['MediaWorkflows'])
})

test('queue mutations invalidate publishing data without evicting unrelated users', () => {
  const tags = getInvalidationForMutation('/social-profiles/queue/items/9/approve-schedule')
  assert.notEqual(tags, 'all')
  assert.ok(tags.includes('PublishingQueue'))
  assert.ok(tags.includes('SocialPosts'))
  assert.ok(tags.includes('MediaWorkflows'))
  assert.ok(!tags.includes('Users'))
  assert.ok(!tags.includes('Scheduler'))
})

test('workflow mutations invalidate all workflow consumers', () => {
  const tags = getInvalidationForMutation('/generate-video/projects/abc/queue-post')
  assert.notEqual(tags, 'all')
  assert.ok(tags.includes('GenerateVideo'))
  assert.ok(tags.includes('MediaWorkflows'))
  assert.ok(tags.includes('ContentSeries'))
  assert.ok(tags.includes('PlanningRuns'))
  assert.ok(tags.includes('PublishingQueue'))
})

test('running the publish scheduler invalidates both scheduler and queue consumers', () => {
  const tags = getInvalidationForMutation('/admin/settings/scheduler/publish-queue/run-once')
  assert.notEqual(tags, 'all')
  assert.ok(tags.includes('Scheduler'))
  assert.ok(tags.includes('PublishingQueue'))
  assert.ok(tags.includes('SocialPosts'))
  assert.ok(tags.includes('Stats'))
})

test('authentication and unknown mutations safely reset the entire cache', () => {
  assert.equal(getInvalidationForMutation('/auth/logout'), 'all')
  assert.equal(getInvalidationForMutation('/new-cross-cutting-command'), 'all')
})

test('polling endpoints always refetch while still using RTK request deduplication', () => {
  assert.equal(isVolatileGetPath('/planning-runs?status=RUNNING'), true)
  assert.equal(isVolatileGetPath('/generate-video/render-jobs/job-1'), true)
  assert.equal(isVolatileGetPath('/media-workflows/abc/progress'), true)
  assert.equal(isVolatileGetPath('/social-profiles/tiktok/qr/session/status'), true)
  assert.equal(isVolatileGetPath('/social-profiles'), false)
})

test('RTK Query deduplicates GETs, reuses cache and refetches invalidated tags', async () => {
  const { api } = await import('../src/commons/apis/client.ts')
  const { apiCache } = await import('../src/commons/store/apiCache.ts')
  const store = configureStore({
    reducer: { [apiCache.reducerPath]: apiCache.reducer },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(apiCache.middleware),
  })

  let calls = 0
  let releaseFirst
  const firstGate = new Promise((resolve) => { releaseFirst = resolve })
  api.defaults.adapter = async (config) => {
    calls += 1
    if (calls === 1) await firstGate
    return {
      data: { call: calls },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }

  const args = { url: '/social-profiles', config: {} }
  const first = store.dispatch(apiCache.endpoints.get.initiate(args, { subscribe: false, forceRefetch: true }))
  const duplicate = store.dispatch(apiCache.endpoints.get.initiate(args, { subscribe: false, forceRefetch: true }))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls, 1)

  releaseFirst()
  assert.deepEqual((await first.unwrap()).data, { call: 1 })
  assert.deepEqual((await duplicate.unwrap()).data, { call: 1 })

  const cached = await store.dispatch(apiCache.endpoints.get.initiate(args, { subscribe: false })).unwrap()
  assert.deepEqual(cached.data, { call: 1 })
  assert.equal(calls, 1)

  store.dispatch(apiCache.util.invalidateTags(['SocialProfiles']))
  const refreshed = await store.dispatch(apiCache.endpoints.get.initiate(args, { subscribe: false })).unwrap()
  assert.deepEqual(refreshed.data, { call: 2 })
  assert.equal(calls, 2)
  store.dispatch(apiCache.util.resetApiState())
})
