import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, CheckCircle2, RefreshCw, SkipForward, Wand2 } from 'lucide-react'
import { fetchPublishingQueueApi, updatePublishingQueueItemApi } from '@/commons/apis/api'

type PublishingQueueItem = {
  id: string
  profile_id: string
  profile_name?: string | null
  article_link: string
  article_title: string
  platform: string
  generated_content?: string | null
  ai_reason?: string | null
  status: string
  scheduled_at?: string | null
  published_at?: string | null
  error?: string | null
}

const statusOptions = [
  { value: 'upcoming', label: 'Sắp đăng' },
  { value: 'needs_approval', label: 'Cần duyệt' },
  { value: 'queued', label: 'Đã xếp hàng' },
  { value: 'approved', label: 'Đã duyệt' },
  { value: 'published', label: 'Đã đăng' },
  { value: 'skipped', label: 'Đã bỏ qua' },
  { value: 'failed', label: 'Lỗi' },
]

export default function ApprovalsPage() {
  const [items, setItems] = useState<PublishingQueueItem[]>([])
  const [statusFilter, setStatusFilter] = useState('upcoming')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const title = useMemo(() => {
    return statusOptions.find((item) => item.value === statusFilter)?.label ?? 'Tất cả'
  }, [statusFilter])

  const loadQueue = async () => {
    setLoading(true)
    try {
      const data = await fetchPublishingQueueApi(statusFilter || undefined)
      const sorted = [...(data.items || [])].sort((a, b) => {
        const left = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER
        const right = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER
        return left - right
      })
      setItems(sorted)
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể tải danh sách cần duyệt')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadQueue()
  }, [statusFilter])

  const handleStatus = async (queueItemId: string, nextStatus: string) => {
    setLoading(true)
    setMessage('')
    try {
      await updatePublishingQueueItemApi(queueItemId, nextStatus)
      await loadQueue()
      setMessage(nextStatus === 'approved' ? 'Đã duyệt bài. Scheduler sẽ đăng khi đến giờ.' : 'Đã cập nhật bài.')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể cập nhật bài')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--on-surface)' }}>
            AI Queue
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--on-surface-variant)' }}>
            Xem bài sắp đăng và duyệt các bài AI đã chọn cho từng social account.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void loadQueue()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
            style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface)' }}
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      <div className="bento-card rounded-xl p-2 flex gap-2 overflow-x-auto">
        {statusOptions.map((option) => {
          const active = statusFilter === option.value
          return (
            <button
              key={option.value}
              onClick={() => setStatusFilter(option.value)}
              className="px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all"
              style={{
                backgroundColor: active ? 'var(--secondary)' : 'transparent',
                color: active ? 'var(--on-secondary)' : 'var(--on-surface-variant)',
              }}
            >
              {option.label}
            </button>
          )
        })}
        <button
          onClick={() => setStatusFilter('')}
          className="px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all"
          style={{
            backgroundColor: statusFilter === '' ? 'var(--secondary)' : 'transparent',
            color: statusFilter === '' ? 'var(--on-secondary)' : 'var(--on-surface-variant)',
          }}
        >
          Tất cả
        </button>
      </div>

      {message && (
        <div className="bento-card rounded-xl p-4 text-sm" style={{ color: 'var(--on-surface)' }}>
          {message}
        </div>
      )}

      <div className="bento-card rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          {statusFilter === 'upcoming' ? <CalendarClock size={20} /> : <Wand2 size={20} />}
          <div>
            <h3 className="text-lg font-semibold">{title}</h3>
            <p className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>
              {items.length} bài trong danh sách
            </p>
          </div>
        </div>

        {items.length === 0 && (
          <div className="text-sm rounded-xl border p-4" style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface-variant)' }}>
            Không có bài nào trong danh sách này.
          </div>
        )}

        <div className="grid gap-4">
          {items.map((item) => (
            <div key={item.id} className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--outline-variant)' }}>
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                <div>
                  <div className="font-semibold" style={{ color: 'var(--on-surface)' }}>{item.article_title}</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs mt-1" style={{ color: 'var(--on-surface-variant)' }}>
                    <span>{item.profile_name || `Profile #${item.profile_id}`}</span>
                    <span>|</span>
                    <span>{item.platform}</span>
                    <span>|</span>
                    <span>{item.status}</span>
                    <span>|</span>
                    <span>{item.scheduled_at ? `Sẽ đăng: ${new Date(item.scheduled_at).toLocaleString()}` : 'chưa xếp lịch'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {item.status === 'needs_approval' && (
                    <button
                      onClick={() => void handleStatus(item.id, 'approved')}
                      disabled={loading}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                      style={{ backgroundColor: 'var(--secondary)', color: 'var(--on-secondary)' }}
                    >
                      <CheckCircle2 size={15} />
                      Duyệt
                    </button>
                  )}
                  {item.status !== 'published' && item.status !== 'skipped' && (
                    <button
                      onClick={() => void handleStatus(item.id, 'skipped')}
                      disabled={loading}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
                      style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface)' }}
                    >
                      <SkipForward size={15} />
                      Bỏ qua
                    </button>
                  )}
                </div>
              </div>

              {item.ai_reason && (
                <p className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>{item.ai_reason}</p>
              )}
              {item.generated_content && (
                <p className="text-sm whitespace-pre-line rounded-lg border p-3" style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface-variant)' }}>
                  {item.generated_content}
                </p>
              )}
              {item.error && <p className="text-sm text-red-700">{item.error}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
