import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CalendarDays, CheckCircle, Clock3, RefreshCw, Send } from 'lucide-react'
import { fetchPublishingQueueApi, fetchSocialProfilesApi } from '@/commons/apis/api'

type SocialProfile = {
  id: number
  platform: string
  profile_name: string
  username?: string | null
  status: string
}

type QueueItem = {
  id: number
  profile_id: number
  profile_name?: string | null
  article_title: string
  platform: string
  generated_content?: string | null
  ai_reason?: string | null
  status: string
  scheduled_at?: string | null
  published_at?: string | null
  error?: string | null
}

const statusMeta: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  queued: { label: 'Đã xếp lịch', color: 'var(--secondary)', icon: <Clock3 size={14} /> },
  approved: { label: 'Đã duyệt', color: '#0f766e', icon: <CheckCircle size={14} /> },
  needs_approval: { label: 'Cần duyệt', color: '#b45309', icon: <AlertCircle size={14} /> },
  published: { label: 'Đã đăng', color: '#15803d', icon: <CheckCircle size={14} /> },
  failed: { label: 'Lỗi', color: '#b91c1c', icon: <AlertCircle size={14} /> },
  skipped: { label: 'Đã bỏ qua', color: 'var(--on-surface-variant)', icon: <AlertCircle size={14} /> },
}

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Chưa xếp lịch'
  return new Date(value).toLocaleString()
}

const dateKey = (value?: string | null) => {
  if (!value) return 'Chưa xếp lịch'
  return new Date(value).toLocaleDateString()
}

export default function SchedulePage() {
  const [profiles, setProfiles] = useState<SocialProfile[]>([])
  const [items, setItems] = useState<QueueItem[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string>('all')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const loadData = async () => {
    setLoading(true)
    setMessage('')
    try {
      const [profileData, queueData] = await Promise.all([
        fetchSocialProfilesApi(),
        fetchPublishingQueueApi(),
      ])
      setProfiles(profileData.items || [])
      setItems(queueData.items || [])
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể tải posting schedule')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const visibleItems = useMemo(() => {
    const filtered = selectedProfileId === 'all'
      ? items
      : items.filter((item) => item.profile_id === Number(selectedProfileId))
    return [...filtered].sort((a, b) => {
      const left = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER
      const right = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Number.MAX_SAFE_INTEGER
      return left - right
    })
  }, [items, selectedProfileId])

  const grouped = useMemo(() => {
    return visibleItems.reduce<Record<string, QueueItem[]>>((acc, item) => {
      const key = dateKey(item.scheduled_at)
      acc[key] = acc[key] || []
      acc[key].push(item)
      return acc
    }, {})
  }, [visibleItems])

  const next24h = useMemo(() => {
    const now = Date.now()
    const tomorrow = now + 24 * 60 * 60 * 1000
    return visibleItems.filter((item) => {
      if (!item.scheduled_at || !['queued', 'approved'].includes(item.status)) return false
      const time = new Date(item.scheduled_at).getTime()
      return time >= now && time <= tomorrow
    })
  }, [visibleItems])

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--on-surface)' }}>
            Posting Schedule
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--on-surface-variant)' }}>
            Xem lịch đăng thật theo từng social account và các bài AI đã đưa vào hàng đợi.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <select
            className="px-3 py-2 rounded-lg border text-sm outline-none"
            style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
            value={selectedProfileId}
            onChange={(event) => setSelectedProfileId(event.target.value)}
          >
            <option value="all">Tất cả account</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.profile_name} · {profile.platform}
              </option>
            ))}
          </select>
          <button
            onClick={() => void loadData()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
            style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface)' }}
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      {message && (
        <div className="bento-card rounded-xl p-4 text-sm" style={{ color: 'var(--on-surface)' }}>
          {message}
        </div>
      )}

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-8 space-y-4">
          <div className="bento-card rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <CalendarDays size={20} />
                <div>
                  <h3 className="text-lg font-semibold" style={{ color: 'var(--on-surface)' }}>Timeline</h3>
                  <p className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>
                    {visibleItems.length} bài trong lịch hiện tại
                  </p>
                </div>
              </div>
            </div>

            {Object.keys(grouped).length === 0 && (
              <div className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>
                Chưa có bài nào trong posting schedule.
              </div>
            )}

            {Object.entries(grouped).map(([day, dayItems]) => (
              <div key={day} className="space-y-3">
                <div className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--on-surface-variant)' }}>
                  {day}
                </div>
                <div className="grid gap-3">
                  {dayItems.map((item) => {
                    const meta = statusMeta[item.status] || statusMeta.queued
                    return (
                      <div key={item.id} className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--outline-variant)' }}>
                        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold" style={{ color: 'var(--on-surface)' }}>{item.article_title}</div>
                            <div className="text-sm mt-1" style={{ color: 'var(--on-surface-variant)' }}>
                              {item.profile_name || `Account #${item.profile_id}`} · {item.platform} · {formatDateTime(item.scheduled_at)}
                            </div>
                          </div>
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium" style={{ color: meta.color, backgroundColor: 'var(--surface-container-low)' }}>
                            {meta.icon}
                            {meta.label}
                          </span>
                        </div>
                        {item.generated_content && (
                          <p className="text-sm line-clamp-2" style={{ color: 'var(--on-surface-variant)' }}>
                            {item.generated_content}
                          </p>
                        )}
                        {item.error && (
                          <p className="text-sm" style={{ color: '#b91c1c' }}>
                            {item.error}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-5">
          <div className="bento-card rounded-xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold" style={{ color: 'var(--on-surface)' }}>
                Next 24 Hours
              </h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(33,112,228,0.1)', color: 'var(--secondary)' }}>
                {next24h.length} POSTS
              </span>
            </div>

            <div className="space-y-4">
              {next24h.length === 0 && (
                <div className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>
                  Không có bài sắp đăng trong 24 giờ tới.
                </div>
              )}
              {next24h.map((item) => (
                <div key={item.id} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'rgba(33,112,228,0.1)', color: 'var(--secondary)' }}>
                    <Send size={14} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold" style={{ color: 'var(--primary)' }}>{formatDateTime(item.scheduled_at)}</div>
                    <div className="text-sm font-semibold truncate" style={{ color: 'var(--on-surface)' }}>{item.article_title}</div>
                    <div className="text-xs truncate" style={{ color: 'var(--on-surface-variant)' }}>
                      {item.profile_name || `Account #${item.profile_id}`} · {item.platform}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bento-card rounded-xl p-6 space-y-3">
            <h3 className="text-base font-semibold" style={{ color: 'var(--on-surface)' }}>Account schedule</h3>
            <div className="grid gap-2">
              {profiles.map((profile) => {
                const count = items.filter((item) => item.profile_id === profile.id && ['queued', 'approved'].includes(item.status)).length
                return (
                  <button
                    key={profile.id}
                    onClick={() => setSelectedProfileId(String(profile.id))}
                    className="w-full rounded-xl border p-3 text-left transition-all"
                    style={{
                      borderColor: selectedProfileId === String(profile.id) ? 'var(--secondary)' : 'var(--outline-variant)',
                      backgroundColor: selectedProfileId === String(profile.id) ? 'rgba(33,112,228,0.08)' : 'transparent',
                    }}
                  >
                    <div className="font-medium" style={{ color: 'var(--on-surface)' }}>{profile.profile_name}</div>
                    <div className="text-xs mt-1" style={{ color: 'var(--on-surface-variant)' }}>
                      {profile.platform} · {count} bài sắp đăng
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
