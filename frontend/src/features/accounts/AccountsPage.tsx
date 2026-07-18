import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Link, PlusCircle, QrCode, RefreshCw, ShieldCheck, CircleUserRound, Trash2, X, Settings } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  createSocialPostApi,
  createSocialPostMetricApi,
  deleteSocialProfileApi,
  deleteSocialPostApi,
  fetchSocialProfilesApi,
  fetchSocialProfileStrategyApi,
  fetchSocialPostOverviewApi,
  fetchSocialPostsApi,
  getPendingTikTokQrLoginStatusApi,
  getTikTokQrLoginStatusApi,
  startPendingTikTokQrLoginApi,
  startTikTokQrLoginApi,
  stopPendingTikTokQrLoginApi,
  stopTikTokQrLoginApi,
  updateSocialProfileStrategyApi,
} from '@/commons/apis/api'

type CurrentUser = {
  id: number
  email: string
  roles: string[]
}

type SocialProfile = {
  id: number
  platform: string
  profile_name: string
  username?: string | null
  folder_path: string
  status: string
  created_at: string
}

type SocialProfileStrategy = {
  content_topics: string
  avoid_topics: string
  tone: string
  target_audience: string
  post_frequency_per_day: number
  active_hours: string
  schedule_enabled: boolean
  schedule_days: string
  schedule_times: string
  schedule_timezone: string
  approval_mode: string
  risk_level: string
  min_score: number
  require_video: boolean
  auto_queue_enabled: boolean
  auto_publish_enabled: boolean
}

type SocialPostMetric = {
  id: number
  views: number
  likes: number
  comments: number
  shares: number
  captured_at: string
}

type SocialPost = {
  id: number
  profile_id: number
  title: string
  post_url?: string | null
  caption?: string | null
  status: string
  published_at: string
  latest_metric?: SocialPostMetric | null
  growth: {
    views_1h?: number | null
    views_24h?: number | null
    views_7d?: number | null
  }
  metrics: SocialPostMetric[]
}

type SocialPostOverview = {
  key: string
  title: string
  posts: Array<SocialPost & { profile: SocialProfile }>
  chart_data: Array<{
    account: string
    profile_id: number
    post_id: number
    views: number
    likes: number
    comments: number
    shares: number
  }>
  total_views: number
  account_count: number
}

const emptyPlatformForm = { platform: 'tiktok', profile_name: '', username: '' }
const emptyPostForm = { title: '', post_url: '', caption: '' }
const emptyMetricForm = { views: '', likes: '', comments: '', shares: '' }
const emptyStrategyForm: SocialProfileStrategy = {
  content_topics: '',
  avoid_topics: '',
  tone: '',
  target_audience: '',
  post_frequency_per_day: 2,
  active_hours: '08:00-11:00,19:00-22:00',
  schedule_enabled: true,
  schedule_days: '0,1,2,3,4,5,6',
  schedule_times: '08:30,20:30',
  schedule_timezone: 'Asia/Bangkok',
  approval_mode: 'manual',
  risk_level: 'medium',
  min_score: 70,
  require_video: true,
  auto_queue_enabled: true,
  auto_publish_enabled: false,
}

type PlatformForm = typeof emptyPlatformForm
const weekDays = [
  { value: '0', label: 'T2' },
  { value: '1', label: 'T3' },
  { value: '2', label: 'T4' },
  { value: '3', label: 'T5' },
  { value: '4', label: 'T6' },
  { value: '5', label: 'T7' },
  { value: '6', label: 'CN' },
]

export default function AccountsPage({ currentUser }: { currentUser: CurrentUser }) {
  const [profiles, setProfiles] = useState<SocialProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null)
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [postOverview, setPostOverview] = useState<SocialPostOverview[]>([])
  const [selectedOverviewKey, setSelectedOverviewKey] = useState<string>('')
  const [postForm, setPostForm] = useState(emptyPostForm)
  const [strategyForm, setStrategyForm] = useState<SocialProfileStrategy>(emptyStrategyForm)
  const [metricForms, setMetricForms] = useState<Record<number, typeof emptyMetricForm>>({})
  const [activeProfileId, setActiveProfileId] = useState<number | null>(null)
  const [activeQrSessionId, setActiveQrSessionId] = useState<string | null>(null)
  const [qrImage, setQrImage] = useState<string | null>(null)
  const [sessionStatus, setSessionStatus] = useState<string>('idle')
  const [message, setMessage] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [platformForm, setPlatformForm] = useState<PlatformForm>(emptyPlatformForm)
  const [showPlatformForm, setShowPlatformForm] = useState(false)
  const [configProfileId, setConfigProfileId] = useState<number | null>(null)

  const isSystemUser = useMemo(() => currentUser?.roles.includes('system') ?? false, [currentUser])
  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  )
  const selectedOverview = useMemo(
    () => postOverview.find((item) => item.key === selectedOverviewKey) ?? postOverview[0] ?? null,
    [postOverview, selectedOverviewKey],
  )
  const configProfile = useMemo(
    () => profiles.find((profile) => profile.id === configProfileId) ?? null,
    [profiles, configProfileId],
  )

  const loadProfiles = async () => {
    try {
      const data = await fetchSocialProfilesApi('tiktok')
      const items = data.items || []
      setProfiles(items)
      setSelectedProfileId((current) => current ?? items[0]?.id ?? null)
    } catch {
      setProfiles([])
    }
  }

  const loadPosts = async (profileId: number) => {
    try {
      const data = await fetchSocialPostsApi(profileId)
      setPosts(data.items || [])
    } catch {
      setPosts([])
    }
  }

  const loadAutomation = async (profileId: number) => {
    try {
      const strategyData = await fetchSocialProfileStrategyApi(profileId)
      setStrategyForm({ ...emptyStrategyForm, ...strategyData })
    } catch {
      setStrategyForm(emptyStrategyForm)
    }
  }

  const loadPostOverview = async () => {
    try {
      const data = await fetchSocialPostOverviewApi()
      const items = data.items || []
      setPostOverview(items)
      setSelectedOverviewKey((current) => current || items[0]?.key || '')
    } catch {
      setPostOverview([])
    }
  }

  useEffect(() => {
    void loadProfiles()
    void loadPostOverview()
  }, [])

  useEffect(() => {
    if (!selectedProfileId) {
      setPosts([])
      return
    }
    void loadPosts(selectedProfileId)
  }, [selectedProfileId])

  useEffect(() => {
    if (!activeProfileId) return

    const timer = setInterval(async () => {
      try {
        const data = await getTikTokQrLoginStatusApi(activeProfileId)
        setProfiles((prev) => prev.map((item) => item.id === activeProfileId ? data.profile : item))
        if (data.qr_image) {
          setQrImage(data.qr_image)
        }
        setSessionStatus(data.authenticated ? 'authenticated' : data.session_active ? 'waiting_for_scan' : 'stopped')
        if (data.authenticated) {
          setMessage('TikTok account đã đăng nhập xong và profile đã được đánh dấu active.')
        }
      } catch (error) {
        console.error(error)
      }
    }, 4000)

    return () => clearInterval(timer)
  }, [activeProfileId])

  useEffect(() => {
    if (!activeQrSessionId) return

    const timer = setInterval(async () => {
      try {
        const data = await getPendingTikTokQrLoginStatusApi(activeQrSessionId, {
          profile_name: platformForm.profile_name || undefined,
          username: platformForm.username || undefined,
        })
        if (data.qr_image) {
          setQrImage(data.qr_image)
        }
        setSessionStatus(data.authenticated ? 'authenticated' : data.session_active ? 'waiting_for_scan' : 'stopped')
        if (data.authenticated && data.profile) {
          setActiveQrSessionId(null)
          setActiveProfileId(data.profile.id)
          setShowPlatformForm(false)
          setPlatformForm(emptyPlatformForm)
          await loadProfiles()
          setMessage('TikTok đã đăng nhập thành công. Profile và thư mục session đã được tạo cho user hiện tại.')
        }
      } catch (error) {
        console.error(error)
      }
    }, 4000)

    return () => clearInterval(timer)
  }, [activeQrSessionId, platformForm.profile_name, platformForm.username])

  const handleCreateProfile = async () => {
    setLoading(true)
    setMessage('')
    try {
      if (platformForm.platform !== 'tiktok') {
        throw new Error('Hiện tại mới hỗ trợ TikTok QR login')
      }

      const data = await startPendingTikTokQrLoginApi({
        profile_name: platformForm.profile_name || undefined,
        username: platformForm.username || undefined,
      })
      setActiveProfileId(null)
      setActiveQrSessionId(data.session_id)
      setQrImage(data.qr_image)
      setSessionStatus(data.authenticated ? 'authenticated' : 'waiting_for_scan')
      setMessage('Đã lấy mã QR TikTok. Hãy quét bằng app TikTok; profile sẽ tự tạo sau khi đăng nhập thành công.')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || error?.message || 'Không thể mở QR login')
    } finally {
      setLoading(false)
    }
  }

  const handleClosePlatformForm = async () => {
    if (activeQrSessionId) {
      try {
        await stopPendingTikTokQrLoginApi(activeQrSessionId)
      } catch (error) {
        console.error(error)
      }
    }
    setActiveQrSessionId(null)
    setQrImage(null)
    setSessionStatus('idle')
    setShowPlatformForm(false)
    setPlatformForm(emptyPlatformForm)
  }

  const handleStartQr = async (profileId: number) => {
    setLoading(true)
    setMessage('')
    try {
      const data = await startTikTokQrLoginApi(profileId)
      setActiveProfileId(profileId)
      setActiveQrSessionId(null)
      setQrImage(data.qr_image)
      setSessionStatus(data.authenticated ? 'authenticated' : 'waiting_for_scan')
      await loadProfiles()
      setMessage('Đã mở QR login TikTok. Hãy quét bằng app TikTok trên điện thoại.')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể mở QR login')
    } finally {
      setLoading(false)
    }
  }

  const handleRefreshStatus = async (profileId: number) => {
    try {
      const data = await getTikTokQrLoginStatusApi(profileId)
      setActiveProfileId(profileId)
      setQrImage(data.qr_image)
      setSessionStatus(data.authenticated ? 'authenticated' : data.session_active ? 'waiting_for_scan' : 'stopped')
      await loadProfiles()
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể kiểm tra trạng thái')
    }
  }

  const handleStopQr = async (profileId: number) => {
    await stopTikTokQrLoginApi(profileId)
    if (activeProfileId === profileId) {
      setActiveProfileId(null)
      setQrImage(null)
      setSessionStatus('stopped')
    }
    await loadProfiles()
    setMessage('Đã dừng phiên QR.')
  }

  const handleDeleteProfile = async (profile: SocialProfile) => {
    const confirmed = window.confirm(`Xóa tài khoản ${profile.profile_name}? Thao tác này sẽ xóa cả thư mục session đã lưu.`)
    if (!confirmed) return

    setLoading(true)
    setMessage('')
    try {
      await deleteSocialProfileApi(profile.id)
      if (activeProfileId === profile.id) {
        setActiveProfileId(null)
        setQrImage(null)
        setSessionStatus('idle')
      }
      await loadProfiles()
      setMessage(`Đã xóa tài khoản ${profile.profile_name}.`)
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể xóa tài khoản')
    } finally {
      setLoading(false)
    }
  }

  const handleCreatePost = async () => {
    if (!selectedProfileId) return

    setLoading(true)
    setMessage('')
    try {
      if (!postForm.title.trim()) {
        throw new Error('Vui lòng nhập tiêu đề bài đăng')
      }
      await createSocialPostApi(selectedProfileId, {
        title: postForm.title,
        post_url: postForm.post_url || undefined,
        caption: postForm.caption || undefined,
      })
      setPostForm(emptyPostForm)
      await loadPosts(selectedProfileId)
      await loadPostOverview()
      setMessage('Đã thêm bài đăng vào account.')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || error?.message || 'Không thể thêm bài đăng')
    } finally {
      setLoading(false)
    }
  }

  const handleOpenConfig = async (profileId: number) => {
    setConfigProfileId(profileId)
    await loadAutomation(profileId)
  }

  const handleSaveStrategy = async () => {
    if (!configProfileId) return
    setLoading(true)
    setMessage('')
    try {
      const saved = await updateSocialProfileStrategyApi(configProfileId, strategyForm)
      setStrategyForm({ ...emptyStrategyForm, ...saved })
      setMessage('Đã lưu chiến lược AI riêng cho account này.')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể lưu chiến lược AI')
    } finally {
      setLoading(false)
    }
  }

  const toggleScheduleDay = (day: string) => {
    setStrategyForm((prev) => {
      const selected = new Set(prev.schedule_days.split(',').map((item) => item.trim()).filter(Boolean))
      if (selected.has(day)) {
        selected.delete(day)
      } else {
        selected.add(day)
      }
      const nextDays = weekDays.map((item) => item.value).filter((value) => selected.has(value))
      return { ...prev, schedule_days: nextDays.length ? nextDays.join(',') : day }
    })
  }

  const handleDeletePost = async (post: SocialPost) => {
    const confirmed = window.confirm(`Xóa bài "${post.title}" khỏi account này?`)
    if (!confirmed || !selectedProfileId) return

    setLoading(true)
    setMessage('')
    try {
      await deleteSocialPostApi(post.id)
      await loadPosts(selectedProfileId)
      await loadPostOverview()
      setMessage('Đã xóa bài đăng.')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể xóa bài đăng')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateMetric = async (postId: number) => {
    if (!selectedProfileId) return

    const form = metricForms[postId] || emptyMetricForm
    setLoading(true)
    setMessage('')
    try {
      await createSocialPostMetricApi(postId, {
        views: Number(form.views || 0),
        likes: Number(form.likes || 0),
        comments: Number(form.comments || 0),
        shares: Number(form.shares || 0),
      })
      setMetricForms((prev) => ({ ...prev, [postId]: emptyMetricForm }))
      await loadPosts(selectedProfileId)
      await loadPostOverview()
      setMessage('Đã lưu snapshot chỉ số cho bài đăng.')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể lưu chỉ số')
    } finally {
      setLoading(false)
    }
  }

  const formatGrowth = (value?: number | null) => {
    if (value === null || value === undefined) return '—'
    return value >= 0 ? `+${value}` : `${value}`
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--on-surface)' }}>
            Social Accounts
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--on-surface-variant)' }}>
            Quản lý tài khoản mạng xã hội của từng user hệ thống, tạo profile TikTok mới, và mở nhiều QR session riêng.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowPlatformForm(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--on-primary)' }}
          >
            <PlusCircle size={16} />
            Thêm trang mạng xã hội
          </button>
          <button
            onClick={() => {
              void loadProfiles()
              void loadPostOverview()
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all"
            style={{ color: 'var(--on-surface)', borderColor: 'var(--outline-variant)' }}
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

      {showPlatformForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6" style={{ backgroundColor: 'rgba(9,20,38,0.5)' }}>
          <div className="w-full max-w-3xl rounded-[28px] bento-card p-6 md:p-8" style={{ backgroundColor: 'var(--surface-container-lowest)' }}>
            <div className="flex items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="text-2xl font-semibold" style={{ color: 'var(--on-surface)' }}>Thêm trang mạng xã hội</h3>
                <p className="text-sm mt-1" style={{ color: 'var(--on-surface-variant)' }}>
                  TikTok sẽ chỉ hiển thị mã QR. Sau khi quét và xác nhận thành công, hệ thống mới tạo profile và thư mục session.
                </p>
              </div>
              <button
                onClick={() => void handleClosePlatformForm()}
                className="p-2 rounded-full border"
                style={{ borderColor: 'var(--outline-variant)' }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-3 mb-6">
              {[
                { id: 'tiktok', label: 'TikTok', description: 'QR login + lưu session' },
                { id: 'facebook', label: 'Facebook', description: 'Sẽ triển khai sau' },
                { id: 'youtube', label: 'YouTube', description: 'Sẽ triển khai sau' },
              ].map((platform) => (
                <button
                  key={platform.id}
                  onClick={() => setPlatformForm((prev) => ({ ...prev, platform: platform.id }))}
                  className="rounded-2xl border p-4 text-left transition-all"
                  style={{
                    borderColor: platformForm.platform === platform.id ? 'var(--secondary)' : 'var(--outline-variant)',
                    backgroundColor: platformForm.platform === platform.id ? 'rgba(33,112,228,0.08)' : 'var(--surface-container-lowest)',
                  }}
                >
                  <div className="font-semibold" style={{ color: 'var(--on-surface)' }}>{platform.label}</div>
                  <div className="text-sm mt-1" style={{ color: 'var(--on-surface-variant)' }}>{platform.description}</div>
                </button>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span>Tên tài khoản</span>
                <input
                  className="w-full px-4 py-3 rounded-xl border outline-none"
                  style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                  value={platformForm.profile_name}
                  onChange={(e) => setPlatformForm((prev) => ({ ...prev, profile_name: e.target.value }))}
                  placeholder="TikTok account"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span>Username</span>
                <input
                  className="w-full px-4 py-3 rounded-xl border outline-none"
                  style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                  value={platformForm.username}
                  onChange={(e) => setPlatformForm((prev) => ({ ...prev, username: e.target.value }))}
                  placeholder="@username"
                />
              </label>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => void handleClosePlatformForm()}
                className="px-4 py-2 rounded-xl border text-sm font-medium"
                style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface)' }}
              >
                Hủy
              </button>
              <button
                onClick={() => void handleCreateProfile()}
                disabled={loading}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: 'var(--secondary)', color: 'var(--on-secondary)' }}
              >
                <PlusCircle size={16} />
                Lấy mã QR
              </button>
            </div>

            {activeQrSessionId && (
              <div className="mt-6 grid gap-4 md:grid-cols-[220px_1fr] items-center rounded-2xl border p-4" style={{ borderColor: 'var(--outline-variant)' }}>
                {qrImage ? (
                  <img src={qrImage} alt="TikTok QR login" className="w-full rounded-xl border bg-white" style={{ borderColor: 'var(--outline-variant)' }} />
                ) : (
                  <div className="aspect-square rounded-xl border flex items-center justify-center text-sm" style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface-variant)' }}>
                    Đang lấy QR...
                  </div>
                )}
                <div>
                  <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--on-surface-variant)' }}>
                    Status: {sessionStatus}
                  </div>
                  <p className="mt-2 text-sm" style={{ color: 'var(--on-surface-variant)' }}>
                    Mở TikTok trên điện thoại, quét QR và xác nhận đăng nhập. Khi thành công, profile sẽ tự xuất hiện trong danh sách.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-6">
        <div className="space-y-6">
          <div className="bento-card rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <CircleUserRound size={20} />
              <div>
                <h3 className="text-lg font-semibold">Current session</h3>
                <p className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>
                  {currentUser ? `${currentUser.email} • ${currentUser.roles.join(', ')}` : 'Chưa có session đăng nhập'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-emerald-600 font-medium text-sm">
              <ShieldCheck size={16} />
              {isSystemUser ? 'System account' : 'User account'}
            </div>
          </div>

          <div className="bento-card rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <QrCode size={20} />
              <h3 className="text-lg font-semibold">TikTok profiles</h3>
            </div>
            <div className="grid gap-3">
              {profiles.length === 0 && (
                <div className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>
                  Chưa có profile nào.
                </div>
              )}
              {profiles.map((profile) => (
                <div key={profile.id} className="rounded-xl border p-4 flex flex-col md:flex-row md:items-center justify-between gap-4" style={{ borderColor: 'var(--outline-variant)' }}>
                  <div>
                    <div className="font-semibold" style={{ color: 'var(--on-surface)' }}>{profile.profile_name}</div>
                    <div className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>
                      {profile.username || '—'} | {profile.status} | {profile.folder_path}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => void handleOpenConfig(profile.id)}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium border"
                      style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface)' }}
                    >
                      <Settings size={14} />
                      Config
                    </button>
                    <button
                      onClick={() => void handleStartQr(profile.id)}
                      className="px-3 py-2 rounded-lg text-sm font-medium"
                      style={{ backgroundColor: 'var(--secondary)', color: 'var(--on-secondary)' }}
                    >
                      Open QR
                    </button>
                    <button
                      onClick={() => void handleRefreshStatus(profile.id)}
                      className="px-3 py-2 rounded-lg text-sm font-medium border"
                      style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface)' }}
                    >
                      Refresh
                    </button>
                    <button
                      onClick={() => void handleStopQr(profile.id)}
                      className="px-3 py-2 rounded-lg text-sm font-medium border"
                      style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface)' }}
                    >
                      Stop
                    </button>
                    <button
                      onClick={() => void handleDeleteProfile(profile)}
                      disabled={loading}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
                      style={{ borderColor: 'rgba(185,28,28,0.35)', color: 'rgb(185,28,28)' }}
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

      {configProfileId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6" style={{ backgroundColor: 'rgba(9,20,38,0.5)' }}>
          <div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl bento-card p-6 md:p-8" style={{ backgroundColor: 'var(--surface-container-lowest)' }}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <ShieldCheck size={20} />
                <div>
                  <h3 className="text-lg font-semibold">AI config</h3>
                  <p className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>
                    {configProfile ? `${configProfile.profile_name} - ${configProfile.username || configProfile.status}` : 'Cấu hình account'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setConfigProfileId(null)}
                className="p-2 rounded-lg border"
                style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface)' }}
              >
                <X size={16} />
              </button>
            </div>

            {configProfile ? (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span>Chủ đề ưu tiên</span>
                    <textarea
                      className="w-full min-h-20 px-3 py-2 rounded-lg border outline-none"
                      style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                      value={strategyForm.content_topics}
                      onChange={(event) => setStrategyForm((prev) => ({ ...prev, content_topics: event.target.value }))}
                      placeholder="AI, công nghệ, startup"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>Chủ đề tránh</span>
                    <textarea
                      className="w-full min-h-20 px-3 py-2 rounded-lg border outline-none"
                      style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                      value={strategyForm.avoid_topics}
                      onChange={(event) => setStrategyForm((prev) => ({ ...prev, avoid_topics: event.target.value }))}
                      placeholder="tai nạn, bạo lực, chính trị"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>Giọng văn</span>
                    <input
                      className="w-full px-3 py-2 rounded-lg border outline-none"
                      style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                      value={strategyForm.tone}
                      onChange={(event) => setStrategyForm((prev) => ({ ...prev, tone: event.target.value }))}
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>Đối tượng xem</span>
                    <input
                      className="w-full px-3 py-2 rounded-lg border outline-none"
                      style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                      value={strategyForm.target_audience}
                      onChange={(event) => setStrategyForm((prev) => ({ ...prev, target_audience: event.target.value }))}
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>Số bài/ngày</span>
                    <input
                      type="number"
                      min="1"
                      className="w-full px-3 py-2 rounded-lg border outline-none"
                      style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                      value={strategyForm.post_frequency_per_day}
                      onChange={(event) => setStrategyForm((prev) => ({ ...prev, post_frequency_per_day: Number(event.target.value || 1) }))}
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>Giờ được phép đăng</span>
                    <input
                      className="w-full px-3 py-2 rounded-lg border outline-none"
                      style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                      value={strategyForm.active_hours}
                      onChange={(event) => setStrategyForm((prev) => ({ ...prev, active_hours: event.target.value }))}
                      placeholder="08:00-11:00,19:00-22:00"
                    />
                  </label>
                  <div className="md:col-span-2 rounded-xl border p-4 space-y-4" style={{ borderColor: 'var(--outline-variant)' }}>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold" style={{ color: 'var(--on-surface)' }}>Posting schedule</div>
                        <div className="text-xs mt-1" style={{ color: 'var(--on-surface-variant)' }}>
                          Lịch đăng riêng cho account này; queue mới sẽ tự rơi vào slot gần nhất.
                        </div>
                      </div>
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={strategyForm.schedule_enabled}
                          onChange={(event) => setStrategyForm((prev) => ({ ...prev, schedule_enabled: event.target.checked }))}
                        />
                        Bật lịch đăng
                      </label>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="space-y-1 text-sm">
                        <span>Slot giờ đăng</span>
                        <input
                          className="w-full px-3 py-2 rounded-lg border outline-none"
                          style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                          value={strategyForm.schedule_times}
                          onChange={(event) => setStrategyForm((prev) => ({ ...prev, schedule_times: event.target.value }))}
                          placeholder="08:30,20:30"
                        />
                      </label>
                      <label className="space-y-1 text-sm">
                        <span>Timezone</span>
                        <input
                          className="w-full px-3 py-2 rounded-lg border outline-none"
                          style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                          value={strategyForm.schedule_timezone}
                          onChange={(event) => setStrategyForm((prev) => ({ ...prev, schedule_timezone: event.target.value }))}
                          placeholder="Asia/Bangkok"
                        />
                      </label>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {weekDays.map((day) => {
                        const active = strategyForm.schedule_days.split(',').map((item) => item.trim()).includes(day.value)
                        return (
                          <button
                            key={day.value}
                            type="button"
                            onClick={() => toggleScheduleDay(day.value)}
                            className="h-9 w-10 rounded-lg border text-sm font-medium transition-all"
                            style={{
                              borderColor: active ? 'var(--secondary)' : 'var(--outline-variant)',
                              backgroundColor: active ? 'rgba(33,112,228,0.12)' : 'var(--surface-container-lowest)',
                              color: active ? 'var(--secondary)' : 'var(--on-surface-variant)',
                            }}
                          >
                            {day.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <label className="space-y-1 text-sm">
                    <span>Chế độ duyệt</span>
                    <select
                      className="w-full px-3 py-2 rounded-lg border outline-none"
                      style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                      value={strategyForm.approval_mode}
                      onChange={(event) => setStrategyForm((prev) => ({
                        ...prev,
                        approval_mode: event.target.value,
                        auto_publish_enabled: event.target.value === 'auto' ? prev.auto_publish_enabled : false,
                      }))}
                    >
                      <option value="manual">Manual approval</option>
                      <option value="auto">Auto approval</option>
                    </select>
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>Điểm tối thiểu</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      className="w-full px-3 py-2 rounded-lg border outline-none"
                      style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                      value={strategyForm.min_score}
                      onChange={(event) => setStrategyForm((prev) => ({ ...prev, min_score: Number(event.target.value || 0) }))}
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-4 text-sm">
                  {[
                    ['auto_queue_enabled', 'AI tự đưa vào queue'],
                    ['require_video', 'Yêu cầu video'],
                    ['auto_publish_enabled', 'Tự đăng khi đến giờ'],
                  ].map(([field, label]) => (
                    <label key={field} className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(strategyForm[field as keyof SocialProfileStrategy])}
                        disabled={field === 'auto_publish_enabled' && strategyForm.approval_mode !== 'auto'}
                        onChange={(event) => setStrategyForm((prev) => ({ ...prev, [field]: event.target.checked }))}
                      />
                      {label}
                    </label>
                  ))}
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => void handleSaveStrategy()}
                    disabled={loading}
                    className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                    style={{ backgroundColor: 'var(--primary)', color: 'var(--on-primary)' }}
                  >
                    Lưu chiến lược AI
                  </button>
                </div>

              </>
            ) : (
              <div className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>
                Hãy chọn một account để cấu hình AI.
              </div>
            )}
          </div>
        </div>
      )}

          <div className="bento-card rounded-xl p-6 space-y-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <BarChart3 size={20} />
                <div>
                  <h3 className="text-lg font-semibold">Bài viết đa account</h3>
                  <p className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>
                    Một bài có thể được đăng trên nhiều account; biểu đồ hiển thị latest views theo từng account.
                  </p>
                </div>
              </div>
              <select
                className="px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                value={selectedOverview?.key ?? ''}
                onChange={(event) => setSelectedOverviewKey(event.target.value)}
              >
                {postOverview.length === 0 && <option value="">Chưa có bài</option>}
                {postOverview.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.title}
                  </option>
                ))}
              </select>
            </div>

            {selectedOverview ? (
              <div className="grid gap-5">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl border p-4" style={{ borderColor: 'var(--outline-variant)' }}>
                    <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--on-surface-variant)' }}>Accounts</div>
                    <div className="text-2xl font-semibold mt-1" style={{ color: 'var(--on-surface)' }}>{selectedOverview.account_count}</div>
                  </div>
                  <div className="rounded-xl border p-4" style={{ borderColor: 'var(--outline-variant)' }}>
                    <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--on-surface-variant)' }}>Total views</div>
                    <div className="text-2xl font-semibold mt-1" style={{ color: 'var(--on-surface)' }}>{selectedOverview.total_views}</div>
                  </div>
                  <div className="rounded-xl border p-4" style={{ borderColor: 'var(--outline-variant)' }}>
                    <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--on-surface-variant)' }}>Post records</div>
                    <div className="text-2xl font-semibold mt-1" style={{ color: 'var(--on-surface)' }}>{selectedOverview.posts.length}</div>
                  </div>
                </div>

                <div className="h-72 rounded-xl border p-3" style={{ borderColor: 'var(--outline-variant)' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={selectedOverview.chart_data}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="account" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="views" fill="var(--secondary)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="grid gap-2">
                  {selectedOverview.posts.map((post) => (
                    <div key={post.id} className="rounded-xl border p-3 flex flex-col md:flex-row md:items-center justify-between gap-3" style={{ borderColor: 'var(--outline-variant)' }}>
                      <div>
                        <div className="font-medium" style={{ color: 'var(--on-surface)' }}>{post.profile.profile_name}</div>
                        <div className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>
                          views {post.latest_metric?.views ?? 0} | likes {post.latest_metric?.likes ?? 0} | comments {post.latest_metric?.comments ?? 0} | shares {post.latest_metric?.shares ?? 0}
                        </div>
                      </div>
                      {post.post_url && (
                        <a href={post.post_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-[var(--secondary)] font-medium">
                          <Link size={14} />
                          Mở bài
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>
                Chưa có bài nào để so sánh. Hãy thêm cùng một tiêu đề bài ở nhiều account.
              </div>
            )}
          </div>

          <div className="bento-card rounded-xl p-6 space-y-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <BarChart3 size={20} />
                <div>
                  <h3 className="text-lg font-semibold">Quản lý bài đăng theo account</h3>
                  <p className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>
                    Theo dõi view hiện tại và view tăng theo 1h / 24h / 7d.
                  </p>
                </div>
              </div>
              <select
                className="px-3 py-2 rounded-lg border text-sm outline-none"
                style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                value={selectedProfileId ?? ''}
                onChange={(event) => setSelectedProfileId(event.target.value ? Number(event.target.value) : null)}
              >
                <option value="">Chọn account</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.profile_name}
                  </option>
                ))}
              </select>
            </div>

            {selectedProfile ? (
              <>
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                  <input
                    className="px-4 py-2 rounded-lg border outline-none"
                    style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                    value={postForm.title}
                    onChange={(event) => setPostForm((prev) => ({ ...prev, title: event.target.value }))}
                    placeholder="Tiêu đề bài đăng"
                  />
                  <input
                    className="px-4 py-2 rounded-lg border outline-none"
                    style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                    value={postForm.post_url}
                    onChange={(event) => setPostForm((prev) => ({ ...prev, post_url: event.target.value }))}
                    placeholder="Link bài đăng TikTok"
                  />
                  <button
                    onClick={() => void handleCreatePost()}
                    disabled={loading}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                    style={{ backgroundColor: 'var(--primary)', color: 'var(--on-primary)' }}
                  >
                    <PlusCircle size={16} />
                    Thêm bài
                  </button>
                </div>

                <div className="grid gap-3">
                  {posts.length === 0 && (
                    <div className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>
                      Account này chưa có bài đăng nào.
                    </div>
                  )}

                  {posts.map((post) => {
                    const metricForm = metricForms[post.id] || emptyMetricForm
                    return (
                      <div key={post.id} className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--outline-variant)' }}>
                        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold" style={{ color: 'var(--on-surface)' }}>{post.title}</div>
                            <div className="text-sm mt-1" style={{ color: 'var(--on-surface-variant)' }}>
                              {post.status} | views: {post.latest_metric?.views ?? 0} | 1h {formatGrowth(post.growth.views_1h)} | 24h {formatGrowth(post.growth.views_24h)} | 7d {formatGrowth(post.growth.views_7d)}
                            </div>
                            {post.post_url && (
                              <a href={post.post_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm mt-2 text-[var(--secondary)] font-medium">
                                <Link size={14} />
                                Mở bài đăng
                              </a>
                            )}
                          </div>
                          <button
                            onClick={() => void handleDeletePost(post)}
                            disabled={loading}
                            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
                            style={{ borderColor: 'rgba(185,28,28,0.35)', color: 'rgb(185,28,28)' }}
                          >
                            <Trash2 size={14} />
                            Xóa
                          </button>
                        </div>

                        <div className="grid gap-2 md:grid-cols-5">
                          {(['views', 'likes', 'comments', 'shares'] as const).map((field) => (
                            <input
                              key={field}
                              className="px-3 py-2 rounded-lg border outline-none text-sm"
                              style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                              type="number"
                              min="0"
                              value={metricForm[field]}
                              onChange={(event) => setMetricForms((prev) => ({
                                ...prev,
                                [post.id]: { ...(prev[post.id] || emptyMetricForm), [field]: event.target.value },
                              }))}
                              placeholder={field}
                            />
                          ))}
                          <button
                            onClick={() => void handleCreateMetric(post.id)}
                            disabled={loading}
                            className="px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                            style={{ backgroundColor: 'var(--secondary)', color: 'var(--on-secondary)' }}
                          >
                            Lưu chỉ số
                          </button>
                        </div>

                        <div className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>
                          Snapshots: {post.metrics.length}
                          {post.latest_metric ? ` | mới nhất: ${new Date(post.latest_metric.captured_at).toLocaleString()}` : ''}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>
                Hãy tạo hoặc chọn một account để quản lý bài đăng.
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
