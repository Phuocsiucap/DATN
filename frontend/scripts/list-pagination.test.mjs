import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let server, PaginatedList, ListPagination
before(async () => {
  server = await createServer({
    cacheDir: 'node_modules/.vite-list-pagination-tests',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom',
  })
  ;({ PaginatedList } = await server.ssrLoadModule('/src/commons/component/ui/paginated-list.tsx'))
  ;({ ListPagination } = await server.ssrLoadModule('/src/commons/component/ui/list-pagination.tsx'))
})
after(async () => { await server?.close() })

test('empty lists keep a footer after the content with both directions disabled', () => {
  const html = renderToStaticMarkup(createElement(PaginatedList, { items: [] }, () => createElement('p', null, 'Empty list')))
  assert.ok(html.indexOf('app-list-footer') > html.indexOf('Empty list'))
  assert.match(html, /0<!-- --> \/ <!-- -->0|0 \/ 0/)
  assert.equal((html.match(/aria-disabled="true"/g) || []).length, 2)
  assert.match(html, /aria-current="page"/)
})

test('only the first page is rendered while totals reflect all loaded items', () => {
  const html = renderToStaticMarkup(createElement(PaginatedList, { items: Array.from({ length: 45 }, (_, i) => i), pageSize: 20 },
    items => createElement('ul', null, items.map(i => createElement('li', { key: i }, `item-${i}`)))))
  assert.equal((html.match(/<li>/g) || []).length, 20)
  assert.ok(html.includes('item-19'))
  assert.ok(!html.includes('item-20'))
  assert.ok(html.includes('1–20 / 45'))
})

test('loading disables every page link, retaining the navigation footer', () => {
  const html = renderToStaticMarkup(createElement(PaginatedList, { items: Array.from({ length: 50 }, (_, i) => i), loading: true }, () => 'Loading'))
  assert.match(html, /aria-busy="true"/)
  assert.ok(html.includes('app-list-footer'))
  assert.equal((html.match(/aria-disabled="false"/g) || []).length, 0)
})

test('pagination bounds sparse page links and clamps an invalid current page', () => {
  const middle = renderToStaticMarkup(createElement(ListPagination, { page: 50, totalPages: 100, onPageChange() {} }))
  assert.equal((middle.match(/data-slot="pagination-link"/g) || []).length, 7)
  assert.equal((middle.match(/data-slot="pagination-ellipsis"/g) || []).length, 2)
  const empty = renderToStaticMarkup(createElement(ListPagination, { page: 20, totalPages: 0, onPageChange() {} }))
  assert.match(empty, /aria-label="Trang 1"/)
  assert.equal((empty.match(/aria-disabled="true"/g) || []).length, 2)
})
