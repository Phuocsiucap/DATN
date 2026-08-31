import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server
let storyTimelineScenes, updateRenderScenes, updateSceneAt, storyTimelineDuration
before(async () => {
  server = await createServer({
    cacheDir: 'node_modules/.vite-draft-links-tests',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom',
  })
  ;({ storyTimelineScenes, updateRenderScenes, updateSceneAt, storyTimelineDuration } = await server.ssrLoadModule('/src/features/generate-video/VideoProductionWorkspace.tsx'))
})
after(async () => { await server?.close() })

function fixture() {
  return {
    video: { width: 1080, height: 1920, fps: 30, background: '#000' },
    timeline: {
      version: 1, duration: 12, metadata: { draft_generation_mode: 'compact-v2' }, audio: [],
      video: [
        { id: 'a', type: 'image', src: 'a.jpg', start: 0, end: 8, text_ids: ['first', 'second'], text_weights: { first: 1, second: 1 } },
        { id: 'b', type: 'video', src: 'b.mp4', start: 8, end: 10, text_ids: ['third'], text_weights: { third: .5 } },
        { id: 'c', type: 'image', src: 'c.jpg', start: 10, end: 12, text_ids: ['third'], text_weights: { third: .5 } },
      ],
      text: [
        { id: 'first', type: 'subtitle', text: 'First line', start: 0, end: 4, video_ids: ['a'] },
        { id: 'second', type: 'subtitle', text: 'Second line', start: 4, end: 8, video_ids: ['a'] },
        { id: 'third', type: 'subtitle', text: 'Shared line', start: 8, end: 12, video_ids: ['b', 'c'] },
      ],
    },
  }
}

test('editor expands actual links instead of zipping arrays by position', () => {
  const rows = storyTimelineScenes(fixture())
  assert.deepEqual(rows.map(row => [row.video_id, row.text_id]), [['a', 'first'], ['a', 'second'], ['b', 'third'], ['c', 'third']])
  assert.equal(storyTimelineDuration(fixture(), rows), 12)
})

test('saving preserves both independent tracks, timing, weights and metadata', () => {
  const story = fixture()
  const saved = updateRenderScenes(story, storyTimelineScenes(story))
  assert.equal(saved.timeline.video.length, 3)
  assert.equal(saved.timeline.text.length, 3)
  assert.deepEqual(saved.timeline.video.map(v => v.text_ids), [['first', 'second'], ['third'], ['third']])
  assert.deepEqual(saved.timeline.text.map(t => t.video_ids), [['a'], ['a'], ['b', 'c']])
  assert.deepEqual(saved.timeline.text.map(t => [t.start, t.end]), [[0, 4], [4, 8], [8, 12]])
  assert.deepEqual(saved.timeline.video.map(v => [v.start, v.end]), [[0, 8], [8, 10], [10, 12]])
  assert.equal(saved.timeline.video[1].type, 'video')
  assert.equal(saved.timeline.video[1].text_weights.third, .5)
  assert.deepEqual(saved.timeline.metadata, story.timeline.metadata)
})

test('links supplied in only one direction are preserved through edit/save', () => {
  for (const direction of ['forward', 'reverse']) {
    const story = fixture()
    if (direction === 'forward') story.timeline.text.forEach(t => delete t.video_ids)
    else story.timeline.video.forEach(v => delete v.text_ids)
    const saved = updateRenderScenes(story, storyTimelineScenes(story))
    assert.deepEqual(saved.timeline.text.map(t => t.video_ids), [['a'], ['a'], ['b', 'c']])
    assert.deepEqual(saved.timeline.video.map(v => v.text_ids), [['first', 'second'], ['third'], ['third']])
  }
})

test('editing shared text from its later visual updates it once, not twice', () => {
  const story = fixture()
  let saved
  updateSceneAt(story, storyTimelineScenes(story), 3, { subtitle: 'Updated line', voice_text: 'Updated narration' }, value => { saved = value })
  assert.equal(saved.timeline.text.length, 3)
  assert.equal(saved.timeline.text[2].text, 'Updated line')
  assert.equal(saved.timeline.text[2].voice_text, 'Updated narration')
  assert.deepEqual(saved.timeline.text[2].video_ids, ['b', 'c'])
})

test('editing shared media from its second text keeps one visual clip', () => {
  const story = fixture()
  let saved
  updateSceneAt(story, storyTimelineScenes(story), 1, { image: 'replacement.jpg' }, value => { saved = value })
  assert.equal(saved.timeline.video.length, 3)
  assert.equal(saved.timeline.video[0].src, 'replacement.jpg')
  assert.deepEqual(saved.timeline.video[0].text_ids, ['first', 'second'])
})

test('mixed many-to-many links survive repeated editor save cycles', () => {
  let story = fixture()
  story.timeline.video = [
    { id: 'a', type: 'image', src: 'a.jpg', start: 0, end: 6, text_ids: ['first', 'second'] },
    { id: 'b', type: 'video', src: 'b.mp4', start: 6, end: 12, text_ids: ['second', 'third'] },
  ]
  story.timeline.text[1].video_ids = ['a', 'b']
  story.timeline.text[2].video_ids = ['b']
  for (let i = 0; i < 4; i++) story = updateRenderScenes(story, storyTimelineScenes(story))
  assert.deepEqual(story.timeline.video.map(v => v.text_ids), [['first', 'second'], ['second', 'third']])
  assert.deepEqual(story.timeline.text.map(t => [t.id, t.start, t.end]), [['first', 0, 4], ['second', 4, 8], ['third', 8, 12]])
})
