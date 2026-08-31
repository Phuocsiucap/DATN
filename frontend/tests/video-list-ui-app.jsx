// Isolated browser fixture: no credentials, real API, paid jobs or external images.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import { api } from '../src/commons/apis/client'
import GenerateVideoProjectsPage from '../src/features/generate-video/GenerateVideoProjectsPage'
import '../src/index.css'

const profile = { id: 'mock-profile', profile_name: 'Profile giả lập', name: 'Profile giả lập', platform: 'tiktok' }
let series = { id: 'mock-series', profile_id: profile.id, title: 'Series giả lập', status: 'ACTIVE', current_part: 1, total_parts: 3 }
const thumb = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="160"%3E%3Crect width="300" height="160" fill="%236366f1"/%3E%3C/svg%3E'
let completed = false, log = [], notify = () => {}
const record = line => { log.push(line); notify() }
function payload(params) {
  const base = { profile_id: profile.id, progress_percent: 0, updated_at: '2026-08-31T00:00:00Z', thumbnail_url: thumb, category: 'Công nghệ' }
  let items = [
    { ...base, id: 'mock-review', title: 'Draft cần duyệt giả lập', series_id: series.id, status: 'EDITING', current_stage: 'DRAFT_REVIEW_REQUIRED', task_status: 'COMPLETED' },
    { ...base, id: 'mock-running', title: 'Video đang render giả lập', status: completed ? 'RENDERED' : 'RENDERING', current_stage: completed ? 'RENDERED' : 'RENDERING', task_status: completed ? 'COMPLETED' : 'RUNNING', progress_percent: completed ? 100 : 0 },
    { ...base, id: 'mock-queued', title: 'Video chờ đăng giả lập', status: 'QUEUED_FOR_PUBLISHING', current_stage: 'QUEUED_FOR_PUBLISHING', task_status: 'COMPLETED', progress_percent: 100 },
    { ...base, id: 'mock-failed', title: 'Video lỗi giả lập', status: 'FAILED', current_stage: 'FAILED', task_status: 'FAILED' },
  ]
  if (params.status) items = items.filter(item => params.status.split(',').includes(item.status))
  if (params.series_id) items = items.filter(item => item.series_id === params.series_id)
  if (params.search) items = items.filter(item => item.title.includes(params.search))
  return { schema_version: 2, items, profiles: items.length ? { [profile.id]: { name: profile.name, platform: profile.platform } } : {},
    series: items.some(item => item.series_id) ? { [series.id]: { title: series.title } } : {}, total: items.length, limit: 100, offset: 0 }
}

api.interceptors.request.clear()
api.defaults.adapter = async config => {
  record(`${config.method.toUpperCase()} ${config.url} ${JSON.stringify(config.params || {})}`)
  const ok = data => ({ data: structuredClone(data), status: 200, statusText: 'OK', headers: {}, config })
  if (config.method !== 'get') throw new Error('Writes disabled in this fixture')
  if (config.url === '/social-profiles') return ok({ items: [profile] })
  if (config.url === '/profile/mock-profile/content-series') return ok([series])
  if (config.url === '/media-workflows/video-workspace') return ok(payload(config.params || {}))
  throw new Error(`Unmocked API: ${config.url}`)
}

function Harness() {
  const [, refresh] = useState(0)
  const [opened, setOpened] = useState('')
  notify = () => queueMicrotask(() => refresh(value => value + 1))
  return <>
    <nav className="flex gap-4 bg-slate-900 p-3 text-white">
      <strong>CHỈ DỮ LIỆU GIẢ LẬP</strong>
      <button onClick={() => { completed = true; record('MOCK RENDER COMPLETED') }}>Hoàn tất job giả lập</button>
      <button onClick={() => { series = { ...series, id: 'mock-series-new', title: 'Series tự sinh mới' }; record('MOCK NEW SERIES') }}>Giả lập series mới</button>
      <output aria-label="Workflow được mở">{opened}</output>
    </nav>
    <GenerateVideoProjectsPage onOpenProject={id => { record(`OPEN ${id}`); setOpened(id) }} />
    <pre aria-label="Mock API calls" className="fixed bottom-0 left-0 z-[200] max-h-28 w-96 max-w-[30vw] overflow-auto bg-slate-900 p-2 text-[10px] text-white">{log.join('\n')}</pre>
    <Toaster />
  </>
}
createRoot(document.getElementById('root')).render(<Harness />)
