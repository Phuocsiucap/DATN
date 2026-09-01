// Synthetic approvals only. The adapter refuses every real or unspecified call.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import { api } from '../src/commons/apis/client'
import ApprovalsPage from '../src/features/approvals/ApprovalsPage'
import '../src/index.css'

let log = [], notify = () => {}
const record = line => { log.push(line); notify() }
const initial = () => [
  { id: 'mock-plain', article_title: 'Video kiểm tra duyệt đơn', scheduled_at: '2099-01-02T00:00:00Z' },
  { id: 'mock-manual', article_title: 'Video kiểm tra chọn lịch thủ công', scheduled_at: null },
  { id: 'mock-ai', article_title: 'Video kiểm tra chọn lịch AI', scheduled_at: null },
  { id: 'mock-auto', article_title: 'Video tự duyệt — chờ lên lịch', status: 'approved', scheduled_at: null },
  { id: 'mock-scheduled', article_title: 'Video đã có lịch đăng', status: 'approved', scheduled_at: '2099-01-04T01:30:00Z' },
  { id: 'mock-published', article_title: 'Video đã đăng thành công', status: 'published', scheduled_at: '2026-01-01T01:30:00Z' },
  { id: 'mock-failed', article_title: 'Video đăng thất bại', status: 'failed', scheduled_at: '2026-01-02T01:30:00Z' },
].map(item => ({
  profile_id: 'mock-profile', profile_name: 'Profile giả lập', platform: 'tiktok',
  status: 'needs_approval', generated_content: 'Chỉ dữ liệu giả lập, không đăng TikTok.',
  created_at: '2026-08-31T00:00:00Z', can_publish_direct: false, can_upload_inbox: false,
  profile_strategy: { approval_mode: 'auto', auto_queue_enabled: false, auto_publish_enabled: false },
  ...item,
}))
let items = initial()
api.interceptors.request.clear()
api.defaults.adapter = async config => {
  const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data
  record(`${config.method.toUpperCase()} ${config.url}${body ? ` ${JSON.stringify(body)}` : ''}`)
  const ok = data => ({ data: structuredClone(data), status: 200, statusText: 'OK', headers: {}, config })
  if (config.method === 'get' && config.url === '/social-profiles') return ok({ items: [
    { id: 'mock-profile', profile_name: 'Profile giả lập', username: 'mock', platform: 'tiktok', status: 'active' },
    { id: 'mock-empty', profile_name: 'Kênh chưa có video', username: 'empty', platform: 'tiktok', status: 'active' },
  ] })
  if (config.method === 'get' && config.url === '/social-profiles/queue/items') return ok({ items })
  const match = config.url.match(/^\/social-profiles\/queue\/items\/(mock-[a-z]+)(?:\/(approve|approve-schedule))?$/)
  const item = items.find(row => row.id === match?.[1])
  if (!item) throw new Error(`Unmocked API: ${config.url}`)
  if (config.method === 'get' && !match[2]) return ok(item)
  if (config.method === 'post' && match[2] === 'approve') {
    Object.assign(item, { status: 'approved', scheduled_at: null, scheduled_at_local: null })
    return ok(item)
  }
  if (config.method === 'post' && match[2] === 'approve-schedule') {
    if (body.schedule_mode === 'manual' && !body.scheduled_at) throw new Error('Manual schedule requires a time')
    Object.assign(item, { status: 'approved', scheduled_at: body.schedule_mode === 'manual' ? body.scheduled_at : '2099-01-03T01:30:00Z' })
    item.scheduled_at_local = item.scheduled_at
    return ok(item)
  }
  throw new Error(`Unmocked API: ${config.method} ${config.url}`)
}

function Harness() {
  const [, refresh] = useState(0)
  const [version, setVersion] = useState(0)
  notify = () => queueMicrotask(() => refresh(value => value + 1))
  return <>
    <nav className="flex gap-4 bg-slate-900 p-3 text-sm text-white">
      <strong>CHỈ DỮ LIỆU GIẢ LẬP — KHÔNG GỬI TIKTOK</strong>
      <button onClick={() => { items = initial(); log = []; setVersion(value => value + 1) }}>Đặt lại dữ liệu giả lập</button>
    </nav>
    <ApprovalsPage key={version} />
    <details className="bg-slate-900 p-3 text-xs text-white" open>
      <summary>Nhật ký API giả lập</summary>
      <pre aria-label="Mock API calls">{log.join('\n')}</pre>
    </details>
    <Toaster />
  </>
}
createRoot(document.getElementById('root')).render(<Harness />)
