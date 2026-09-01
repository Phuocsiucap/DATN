import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let server, SocialProfileFilter
before(async () => {
  server = await createServer({
    cacheDir: 'node_modules/.vite-profile-filter-tests',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom',
  })
  ;({ SocialProfileFilter } = await server.ssrLoadModule('/src/commons/component/SocialProfileFilter.tsx'))
})
after(async () => { await server?.close() })

const profiles = [
  { id: 'p1', profile_name: 'SocialContentHub', platform: 'tiktok', username: 'first', status: 'active', avatar_url: '/avatar-one.png' },
  { id: 'p2', profile_name: 'SocialContentHub', platform: 'tiktok', username: '@second', status: 'expired' },
  { id: 'empty-channel', profile_name: 'Kênh chưa có bài', platform: 'youtube', status: 'inactive' },
]
const render = props => renderToStaticMarkup(createElement(SocialProfileFilter, { profiles, value: 'p2', onChange() {}, ...props }))

test('channel cards disambiguate identical names, preserve avatar and do not assume all channels are connected', () => {
  const html = render({ allOption: true })
  assert.match(html, /Lọc theo kênh social/)
  assert.match(html, /\/avatar-one.png/)
  assert.match(html, /@first/)
  assert.match(html, /@second/)
  assert.doesNotMatch(html, /@@second/)
  assert.match(html, /1\/3 đang hoạt động/)
  assert.match(html, /Hết hạn kết nối/)
  assert.match(html, /Chưa kết nối/)
  assert.match(html, /Kênh chưa có bài/)
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1)
})

test('single-account pages have no unsupported all-accounts option', () => {
  const html = render({})
  assert.doesNotMatch(html, /Tất cả kênh social/)
  assert.equal((html.match(/<button /g) || []).length, profiles.length)
})

test('the controlled picker emits profile IDs (not names) and all without changing its own value', () => {
  const selections = []
  const element = SocialProfileFilter({ profiles, value: 'p1', allOption: true, onChange: value => selections.push(value) })
  const cards = element.props.children.flat(Infinity).filter(Boolean)
  // Exercise the rendered card actions; no network or page state is involved.
  cards[2].props.onClick()
  cards[0].props.onClick()
  assert.deepEqual(selections, ['p2', 'all'])
  assert.equal(cards[1].props.active, true)
})

test('loading and empty states avoid fake channel choices; busy filters cannot be clicked', () => {
  assert.match(render({ profiles: [], loading: true }), /Đang tải kênh social/)
  const empty = render({ profiles: [], emptyLabel: 'Chưa có kênh TikTok' })
  assert.match(empty, /Chưa có kênh TikTok/)
  assert.doesNotMatch(empty, /<button /)
  const busy = render({ allOption: true, disabled: true })
  assert.equal((busy.match(/disabled=""/g) || []).length, profiles.length + 1)
})
