import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'

let server, api, fetchLogs
before(async () => {
  globalThis.localStorage = { getItem: () => null }
  server = await createServer({
    cacheDir: 'node_modules/.vite-audit-pagination-tests',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom',
  })
  ;({ api } = await server.ssrLoadModule('/src/commons/apis/client.ts'))
  ;({ fetchAdminAuditLogsApi: fetchLogs } = await server.ssrLoadModule('/src/commons/apis/auditLogs.ts'))
})
after(async () => { await server?.close(); delete globalThis.localStorage })
const summary = { unique_actors: 1, unique_actions: 1 }
const pagination = { page: 2, limit: 25, total: 61, totalPages: 3 }
function respond(data) {
  api.defaults.adapter = async config => ({ data, status: 200, statusText: 'OK', headers: {}, config })
}
test('preserves pagination beside the API envelope data', async () => {
  respond({ success: true, message: 'OK', data: { items: [], summary }, pagination })
  assert.deepEqual((await fetchLogs()).pagination, pagination)
})
test('accepts pagination nested in domain data', async () => {
  respond({ success: true, message: 'OK', data: { items: [], summary, pagination } })
  assert.deepEqual((await fetchLogs()).pagination, pagination)
})
test('normalizes legacy flat fields without losing totals or page size', async () => {
  respond({ items: [], summary, page: 2, page_size: 25, total: 61 })
  assert.deepEqual((await fetchLogs()).pagination, pagination)
})
test('empty results have one disabled navigation page; malformed responses reject before rendering', async () => {
  respond({ items: [], summary, page: 1, limit: 25, total: 0 })
  assert.equal((await fetchLogs()).pagination.totalPages, 1)
  respond({ items: [], summary })
  await assert.rejects(fetchLogs(), /không đúng định dạng/)
  respond(null)
  await assert.rejects(fetchLogs(), /không đúng định dạng/)
})
