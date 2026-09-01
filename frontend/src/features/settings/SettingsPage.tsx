import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'

import { AlertTriangle, Check, CircleUserRound, ExternalLink, Plus, QrCode, RefreshCw, Save, SlidersHorizontal, Trash2, Zap } from 'lucide-react'
import {
  fetchSocialProfilesApi,
  createSocialProfileApi,
  startPendingTikTokQrLoginApi,
  getPendingTikTokQrLoginStatusApi,
  stopPendingTikTokQrLoginApi,
  startTikTokQrLoginApi,
  getTikTokQrLoginStatusApi,
  stopTikTokQrLoginApi,
  deleteSocialProfileApi,
  syncSocialProfileApi,
  fetchAdminSchedulerSettingsApi,
  runPublishQueueSchedulerOnceApi,
  startAdminSchedulerApi,
  stopAdminSchedulerApi,
  updateAdminSchedulerSettingsApi,
  fetchSocialProfileStrategyApi,
  updateSocialProfileStrategyApi,
  type SchedulerSettingsStatus,
  type SchedulerSettings,
} from '@/commons/apis/api'
import { AppButton, AppCard, FilterChip, MetricCard, PageLayout, SearchField, SocialProfileAvatar, StatusPill, TabStrip } from '@/commons/component/social-ui'
import { SocialProfileStrategyDialog, type SocialProfile } from './SocialProfileStrategyDialog'
import { AddTikTokProfileDialog } from './components/AddTikTokProfileDialog'
import {
  getTikTokQrHelpText,
  getTikTokQrStatusLabel,
  isTikTokQrProcessingStatus,
  resolveTikTokQrStatus,
  TIKTOK_QR_SIZE,
} from './tiktokQr'

type CurrentUser = {
  id: string | number
  email: string
  roles: string[]
  is_system_admin?: boolean
}

type TabMode = 'profiles' | 'scheduler'
type SettingsNavigationState = { openProfileId?: string; openTab?: string } | null

const DEFAULT_SETTINGS: SchedulerSettings = {
  vnexpress_interval_minutes: 30,
  bilibili_interval_minutes: 30,
  publish_queue_interval_minutes: 5,
}
const TIKTOK_QR_WARMUP_MS = 5000

function resolveProfileMetric(profile: SocialProfile, key: 'follower_count' | 'following_count' | 'likes_count' | 'video_count') {
  const directValue = profile[key]
  const metadata = profile.metadata || {}
  const metadataUser = metadata.user && typeof metadata.user === 'object' ? metadata.user : {}
  const metadataValue = metadataUser[key] ?? metadata[key]
  const value = directValue ?? metadataValue
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(numeric, 0) : null
}

function formatProfileMetric(value: number | null) {
  if (value === null) return '-'
  return new Intl.NumberFormat('vi-VN', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

export default function SettingsPage({ currentUser }: { currentUser: CurrentUser | null }) {
  const isSystemUser = Boolean(
    currentUser?.is_system_admin ||
    currentUser?.roles?.some((r) => {
      const lower = r.toLowerCase()
      return lower === 'system' || lower === 'system_admin' || lower === 'admin'
    })
  )
  
  const [activeTab, setActiveTab] = useState<TabMode>('profiles')
  const [profiles, setProfiles] = useState<SocialProfile[]>([])
  const [loading, setLoading] = useState(true)

  // QR Session state
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  const [qrImage, setQrImage] = useState<string | null>(null)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [qrReady, setQrReady] = useState(false)
  const [sessionStatus, setSessionStatus] = useState<string>('idle')

  // Add profile state
  const [addProfileOpen, setAddProfileOpen] = useState(false)
  const [newProfileName, setNewProfileName] = useState('')
  const [newProfileUsername, setNewProfileUsername] = useState('')
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null)
  const [pendingQrImage, setPendingQrImage] = useState<string | null>(null)
  const [pendingQrUrl, setPendingQrUrl] = useState<string | null>(null)
  const [pendingQrReady, setPendingQrReady] = useState(false)
  const [addingProfile, setAddingProfile] = useState(false)

  // Scheduler state
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerSettingsStatus | null>(null)
  const [schedulerForm, setSchedulerForm] = useState<SchedulerSettings>(DEFAULT_SETTINGS)
  const [syncingProfileId, setSyncingProfileId] = useState<string | null>(null)

  // Strategy Modal state
  const [activeStrategyProfile, setActiveStrategyProfile] = useState<SocialProfile | null>(null)
  const [strategyDialogOpen, setStrategyDialogOpen] = useState(false)
  const [savingStrategy, setSavingStrategy] = useState(false)
  const [strategyForm, setStrategyForm] = useState<any>({
    content_topics: '',
    content_topic_descriptions: {},
    avoid_topics: '',
    avoid_topic_descriptions: {},
    tone: 'Professional & Authoritative',
    target_audience: '',
    approval_mode: 'manual',
    schedule_days: '0,1,2,3,4,5,6',
    schedule_times: '08:30,20:30',
    schedule_timezone: 'Asia/Bangkok',
    min_similarity: 0.62,
    avoid_similarity_threshold: 0.72,
    max_system_recommendations: 20,
    auto_project_queue_enabled: false,
    video_render_mode: 'manual',
    auto_queue_enabled: true,
    auto_publish_enabled: false,
    receive_system_content: true
  })
  const [strategyLoading, setStrategyLoading] = useState(false)

  const loadProfiles = async () => {
    setLoading(true)
    try {
      const data = await fetchSocialProfilesApi()
      setProfiles(data.items || [])
    } catch {
      setProfiles([])
    } finally {
      setLoading(false)
    }
  }

  const loadSchedulerSettings = async () => {
    try {
      const data = await fetchAdminSchedulerSettingsApi()
      setSchedulerStatus(data)
      setSchedulerForm(data.settings)
    } catch (error) {
      console.error(error)
    }
  }

  useEffect(() => {
    void loadProfiles()
    if (isSystemUser) void loadSchedulerSettings()
  }, [isSystemUser])

  // Auto-select & open strategy dialog when navigating from PlanningPage
  useEffect(() => {
    const state = window.history.state as SettingsNavigationState
    if (!state?.openProfileId || profiles.length === 0) return
    const target = profiles.find((p) => p.id === state.openProfileId)
    if (target) {
      void openProfileStrategyDialog(target)
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [profiles])

  useEffect(() => {
    if (!activeProfileId) return

    const timer = setInterval(async () => {
      try {
        const data = await getTikTokQrLoginStatusApi(activeProfileId)
        if (data.qr_image) setQrImage(data.qr_image)
        if (data.qr_url) setQrUrl(data.qr_url)
        setSessionStatus(resolveTikTokQrStatus(data))
        
        if (data.authenticated) {
          setActiveProfileId(null)
          setQrImage(null)
          setQrUrl(null)
          setQrReady(false)
          await loadProfiles()
          toast.success('Đăng nhập TikTok thành công.')
        }
      } catch (error: any) {
        console.error(error)
        toast.error(error?.response?.data?.detail || 'Không kiểm tra được trạng thái QR TikTok')
      }
    }, 4000)

    return () => clearInterval(timer)
  }, [activeProfileId])

  useEffect(() => {
    if (!activeProfileId || (!qrImage && !qrUrl)) {
      setQrReady(false)
      return
    }

    setQrReady(false)
    const timer = window.setTimeout(() => setQrReady(true), TIKTOK_QR_WARMUP_MS)
    return () => window.clearTimeout(timer)
  }, [activeProfileId, qrImage, qrUrl])

  useEffect(() => {
    if (!pendingSessionId) return

    const timer = setInterval(async () => {
      try {
        const data = await getPendingTikTokQrLoginStatusApi(pendingSessionId, {
          profile_name: newProfileName || 'TikTok account',
          username: newProfileUsername || undefined,
        })
        if (data.qr_image) setPendingQrImage(data.qr_image)
        if (data.qr_url) setPendingQrUrl(data.qr_url)
        setSessionStatus(resolveTikTokQrStatus(data))

        if (data.authenticated) {
          setPendingSessionId(null)
          setPendingQrImage(null)
          setPendingQrUrl(null)
          setPendingQrReady(false)
          setAddProfileOpen(false)
          setNewProfileName('')
          setNewProfileUsername('')
          await loadProfiles()
          toast.success('Đã thêm và đăng nhập TikTok profile thành công.')
        }
      } catch (error: any) {
        console.error(error)
        toast.error(error?.response?.data?.detail || 'Không kiểm tra được trạng thái QR TikTok')
      }
    }, 4000)

    return () => clearInterval(timer)
  }, [pendingSessionId, newProfileName, newProfileUsername])

  useEffect(() => {
    if (!pendingSessionId || (!pendingQrImage && !pendingQrUrl)) {
      setPendingQrReady(false)
      return
    }

    setPendingQrReady(false)
    const timer = window.setTimeout(() => setPendingQrReady(true), TIKTOK_QR_WARMUP_MS)
    return () => window.clearTimeout(timer)
  }, [pendingSessionId, pendingQrImage, pendingQrUrl])

  const openProfileStrategyDialog = async (profile: SocialProfile) => {
    setActiveStrategyProfile(profile)
    setStrategyDialogOpen(true)
    setStrategyLoading(true)
    try {
      const data = await fetchSocialProfileStrategyApi(profile.id)
      if (data) setStrategyForm(data)
    } catch (err) {
      console.error(err)
      toast.error('Không thể tải cấu hình chiến lược.')
    } finally {
      setStrategyLoading(false)
    }
  }

  const handleUpdateStrategyField = (key: string, value: any) => {
    setStrategyForm((prev: any) => ({ ...prev, [key]: value }))
  }

  const handleSaveStrategy = async () => {
    if (!activeStrategyProfile) return
    setSavingStrategy(true)
    try {
      const data = await updateSocialProfileStrategyApi(activeStrategyProfile.id, strategyForm)
      setStrategyForm(data)
      toast.success('Lưu cấu hình Chiến lược thành công')
      setStrategyDialogOpen(false)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Không thể lưu Chiến lược')
    } finally {
      setSavingStrategy(false)
    }
  }

  const closeAddProfile = async () => {
    if (pendingSessionId) {
      try {
        await stopPendingTikTokQrLoginApi(pendingSessionId)
      } catch (error) {
        console.error(error)
      }
    }
    setAddProfileOpen(false)
    setPendingSessionId(null)
    setPendingQrImage(null)
    setPendingQrUrl(null)
    setPendingQrReady(false)
    setSessionStatus('idle')
  }

  const handleCreateProfile = async () => {
    const profileName = newProfileName.trim()
    if (!profileName) {
      toast.warning('Vui lòng nhập tên profile.')
      return
    }
    setAddingProfile(true)
    try {
      await createSocialProfileApi({
        platform: 'tiktok',
        profile_name: profileName,
        username: newProfileUsername.trim() || undefined,
      })
      setAddProfileOpen(false)
      setNewProfileName('')
      setNewProfileUsername('')
      await loadProfiles()
      toast.success('Đã thêm profile TikTok. Bạn có thể mở QR để đăng nhập.')
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể thêm profile')
    } finally {
      setAddingProfile(false)
    }
  }

  const handleStartPendingQr = async () => {
    if (addingProfile) return
    const profileName = newProfileName.trim() || 'TikTok account'
    setAddingProfile(true)
    try {
      const data = await startPendingTikTokQrLoginApi({
        profile_name: profileName,
        username: newProfileUsername.trim() || undefined,
      })
      setPendingSessionId(data.session_id)
      setPendingQrImage(data.qr_image)
      setPendingQrUrl(data.qr_url)
      setPendingQrReady(false)
      setSessionStatus(resolveTikTokQrStatus(data))
      toast.info('Đã tạo QR TikTok. Chờ vài giây để mã sẵn sàng rồi quét bằng app TikTok.')
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể mở QR thêm profile')
    } finally {
      setAddingProfile(false)
    }
  }

  const handleStartQr = async (profileId: string) => {
    setLoading(true)
    try {
      const data = await startTikTokQrLoginApi(profileId)
      setActiveProfileId(profileId)
      setQrImage(data.qr_image)
      setQrUrl(data.qr_url)
      setQrReady(false)
      setSessionStatus(resolveTikTokQrStatus(data))
      toast.info('Đã tạo QR TikTok. Chờ vài giây để mã sẵn sàng rồi quét bằng app TikTok.')
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể mở QR login')
    } finally {
      setLoading(false)
    }
  }

  const handleStopQr = async (profileId: string) => {
    await stopTikTokQrLoginApi(profileId)
    if (activeProfileId === profileId) {
      setActiveProfileId(null)
      setQrImage(null)
      setQrUrl(null)
      setQrReady(false)
      setSessionStatus('stopped')
    }
    await loadProfiles()
  }

  const handleSyncProfile = async (profileId: string) => {
    setSyncingProfileId(profileId)
    try {
      const res = await syncSocialProfileApi(profileId)
      const syncedProfile = (res as any)?.profile || res
      setProfiles((prev) => prev.map((profile) => (profile.id === profileId ? syncedProfile : profile)))
      if (activeStrategyProfile?.id === profileId) {
        setActiveStrategyProfile((prev) => (prev ? { ...prev, ...syncedProfile } : null))
      }
      const videoMsg = res.synced_videos_count !== undefined ? ` và ${res.synced_videos_count} video` : ''
      const snapshotMsg = res.snapshot_created ? 'Đã ghi nhận snapshot chỉ số mới.' : 'Không có thay đổi chỉ số tài khoản.'
      toast.success(`Đã đồng bộ thông tin TikTok profile${videoMsg}. ${snapshotMsg}`)
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể đồng bộ TikTok profile')
    } finally {
      setSyncingProfileId(null)
    }
  }

  const handleDeleteProfile = async (profileId: string) => {
    if (!window.confirm('Xóa kênh social này?')) return
    setLoading(true)
    try {
      await deleteSocialProfileApi(profileId)
      if (activeProfileId === profileId) {
        setActiveProfileId(null)
        setQrImage(null)
        setQrUrl(null)
        setQrReady(false)
        setSessionStatus('idle')
      }
      await loadProfiles()
      toast.success('Đã xóa kênh social.')
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể xóa kênh social')
    } finally {
      setLoading(false)
    }
  }

  const updateSchedulerField = (key: keyof SchedulerSettings, value: string) => {
    const num = Number(value)
    setSchedulerForm(prev => ({
      ...prev,
      [key]: Number.isFinite(num) ? Math.max(1, Math.min(1440, num)) : 1
    }))
  }

  const saveSchedulerSettings = async () => {
    setLoading(true)
    try {
      const data = await updateAdminSchedulerSettingsApi(schedulerForm)
      setSchedulerStatus(data)
      setSchedulerForm(data.settings)
      toast.success('Đã lưu cấu hình scheduler')
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Không lưu được')
    } finally {
      setLoading(false)
    }
  }

  const startScheduler = async () => {
    setLoading(true)
    try {
      const data = await startAdminSchedulerApi()
      setSchedulerStatus(data)
      toast.success('Đã bật scheduler publish queue.')
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Không bật được scheduler')
    } finally {
      setLoading(false)
    }
  }

  const stopScheduler = async () => {
    setLoading(true)
    try {
      const data = await stopAdminSchedulerApi()
      setSchedulerStatus(data)
      toast.success('Đã dừng scheduler publish queue.')
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Không dừng được scheduler')
    } finally {
      setLoading(false)
    }
  }

  const runPublishQueueOnce = async () => {
    setLoading(true)
    try {
      const data = await runPublishQueueSchedulerOnceApi()
      setSchedulerStatus(data)
      toast.success('Đã chạy publish queue scheduler một lượt.')
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Không chạy được publish queue')
    } finally {
      setLoading(false)
    }
  }

  const activeProfiles = profiles.filter((profile) => String(profile.status || '').toLowerCase() === 'active').length
  const connectedPlatforms = new Set(profiles.map((profile) => String(profile.platform || '').toLowerCase()).filter(Boolean)).size

  return (
    <PageLayout
      title="Quản lý kênh social"
      description="Kết nối các kênh mạng xã hội, quản lý thông tin profile và cấu hình chiến lược AI tự động hóa."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <SearchField placeholder="Tìm kiếm (Ctrl + K)" className="hidden w-[300px] lg:flex" />
          <AppButton variant="secondary" icon={<RefreshCw size={15} />} onClick={() => void loadProfiles()} disabled={loading}>
            Tải lại
          </AppButton>
          <AppButton icon={<Plus size={16} />} onClick={() => setAddProfileOpen(true)}>
            Thêm kênh social
          </AppButton>
        </div>
      }
    >

      <TabStrip
        tabs={[
          { value: 'profiles' as const, label: 'Kênh mạng xã hội', count: profiles.length },
          ...(isSystemUser ? [{ value: 'scheduler' as const, label: 'Scheduler admin' }] : []),
        ]}
        value={activeTab}
        onChange={(value) => setActiveTab(value)}
      />

      {activeTab === 'profiles' && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={<CircleUserRound size={18} />} label="Kênh social đã kết nối" value={profiles.length} tint="#2556ea" />
            <MetricCard icon={<Check size={18} />} label="Đang hoạt động" value={activeProfiles} tint="#16a34a" />
            <MetricCard icon={<AlertTriangle size={18} />} label="Cần xác thực" value={Math.max(profiles.length - activeProfiles, 0)} tint="#f97316" />
            <MetricCard icon={<Zap size={18} />} label="Kênh social" value={connectedPlatforms} tint="#7c3aed" />
          </div>

          <AppCard className="p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <FilterChip active label="Tất cả" count={profiles.length} />
                <FilterChip label="TikTok" />
                <FilterChip label="Facebook" />
                <FilterChip label="Instagram" />
                <FilterChip label="YouTube" />
              </div>
              <span className="text-xs text-slate-500 font-medium">Click "Cấu hình chiến lược AI" để chỉnh sửa định hướng từng kênh</span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {profiles.length === 0 && (
                <div className="col-span-full rounded-xl border border-dashed border-[var(--outline-variant)] p-12 text-center text-sm text-[var(--on-surface-variant)] bg-slate-50/50">
                  Chưa kết nối kênh social nào. Bấm "Thêm kênh social" ở góc trên để bắt đầu.
                </div>
              )}
              {profiles.map((profile) => (
                <SocialProfileCard
                  key={profile.id}
                  profile={profile}
                  qrActive={activeProfileId === profile.id}
                  syncing={syncingProfileId === profile.id}
                  onOpenStrategy={() => void openProfileStrategyDialog(profile)}
                  onSync={() => void handleSyncProfile(profile.id)}
                  onQr={() => void handleStartQr(profile.id)}
                  onStopQr={() => void handleStopQr(profile.id)}
                  onDelete={() => void handleDeleteProfile(profile.id)}
                />
              ))}

              <button
                onClick={() => setAddProfileOpen(true)}
                className="flex flex-col items-center justify-center min-h-[220px] rounded-xl border-2 border-dashed border-[var(--outline-variant)] bg-white p-6 text-center transition hover:border-[var(--accent)] hover:bg-indigo-50/30 group"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--outline-variant)] text-[var(--accent)] group-hover:scale-110 transition-transform">
                  <Plus size={24} />
                </span>
                <span className="mt-3 block text-sm font-bold text-[var(--accent)]">Kết nối thêm kênh social</span>
                <span className="mt-1 block text-xs text-[var(--on-surface-variant)]">Thêm kênh TikTok / Social mới vào hệ thống.</span>
              </button>
            </div>
          </AppCard>

          {activeProfileId && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-6 flex flex-col items-center justify-center text-center max-w-md mx-auto">
              <h4 className="font-bold text-blue-900 mb-2">Mã QR Đăng Nhập TikTok</h4>
              <p className="text-xs text-blue-800 mb-4">
                {qrReady ? getTikTokQrHelpText(sessionStatus, false) : 'Đang chuẩn bị mã QR, vui lòng chờ vài giây.'}
              </p>
              {!qrReady ? (
                <div className="flex h-64 w-64 animate-pulse items-center justify-center rounded-xl bg-blue-100 text-sm font-semibold text-blue-800">Đang chuẩn bị QR...</div>
              ) : qrImage ? (
                <img src={qrImage} alt="QR Code" className="h-64 w-64 rounded-xl border-2 border-white bg-white p-2 shadow-sm" />
              ) : qrUrl ? (
                <div className="rounded-xl border-2 border-white bg-white p-2 shadow-sm">
                  <QRCodeSVG value={qrUrl} size={TIKTOK_QR_SIZE} level="M" includeMargin />
                </div>
              ) : (
                <div className="flex h-64 w-64 animate-pulse items-center justify-center rounded-xl bg-blue-100">Đang tải...</div>
              )}
              {qrReady && qrUrl && (
                <a href={qrUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-blue-200 bg-white px-3 text-xs font-bold text-blue-700 hover:bg-blue-50">
                  <ExternalLink size={14} /> Mở link QR
                </a>
              )}
              <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-blue-700">
                {qrReady && isTikTokQrProcessingStatus(sessionStatus) && <RefreshCw size={14} className="animate-spin" />}
                Trạng thái: {getTikTokQrStatusLabel(qrReady ? sessionStatus : 'preparing_qr')}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'scheduler' && isSystemUser && (
        <div className="workspace-card p-5">
           <div className="flex items-center justify-between gap-3 mb-6">
            <div>
              <h2 className="text-base font-bold text-[#0f172a]">Cấu Hình Scheduler Admin</h2>
              <p className="mt-1 text-xs text-[#64748b]">Trạng thái: <span className="font-semibold">{schedulerStatus?.status || '...'}</span></p>
            </div>
            <button onClick={() => void loadSchedulerSettings()} disabled={loading} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0ea] px-3 text-xs font-semibold text-[#475569] hover:bg-slate-50">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Tải lại
            </button>
          </div>

          <div className="grid gap-6 md:grid-cols-3 mb-8">
            <label className="space-y-2 text-sm">
              <span className="font-bold text-slate-700">VNExpress Crawl (phút)</span>
              <input type="number" min={1} value={schedulerForm.vnexpress_interval_minutes} onChange={e => updateSchedulerField('vnexpress_interval_minutes', e.target.value)} className="w-full rounded-lg border border-[#d9e0ea] px-3 py-2 outline-none focus:border-[#3525cd]" />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-bold text-slate-700">Bilibili Crawl (phút)</span>
              <input type="number" min={1} value={schedulerForm.bilibili_interval_minutes} onChange={e => updateSchedulerField('bilibili_interval_minutes', e.target.value)} className="w-full rounded-lg border border-[#d9e0ea] px-3 py-2 outline-none focus:border-[#3525cd]" />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-bold text-slate-700">Publish Queue (phút)</span>
              <input type="number" min={1} value={schedulerForm.publish_queue_interval_minutes} onChange={e => updateSchedulerField('publish_queue_interval_minutes', e.target.value)} className="w-full rounded-lg border border-[#d9e0ea] px-3 py-2 outline-none focus:border-[#3525cd]" />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={() => void saveSchedulerSettings()} disabled={loading} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-xs font-semibold text-white transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-60">
              <Save size={14} /> Lưu cấu hình
            </button>
            <button onClick={() => void startScheduler()} disabled={loading} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60">
              <RefreshCw size={14} /> Bật scheduler
            </button>
            <button onClick={() => void stopScheduler()} disabled={loading} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0ea] px-3 text-xs font-semibold text-[#475569] hover:bg-slate-50 disabled:opacity-60">
              Dừng scheduler
            </button>
            <button onClick={() => void runPublishQueueOnce()} disabled={loading} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-60">
              Chạy publish queue
            </button>
          </div>
        </div>
      )}

      <AddTikTokProfileDialog
        open={addProfileOpen}
        name={newProfileName}
        username={newProfileUsername}
        adding={addingProfile}
        sessionId={pendingSessionId}
        qrImage={pendingQrImage}
        qrUrl={pendingQrUrl}
        qrReady={pendingQrReady}
        sessionStatus={sessionStatus}
        onNameChange={setNewProfileName}
        onUsernameChange={setNewProfileUsername}
        onClose={() => void closeAddProfile()}
        onCreate={() => void handleCreateProfile()}
        onStartQr={() => void handleStartPendingQr()}
      />
      {/* Social Profile Strategy Modal */}
      <SocialProfileStrategyDialog
        open={strategyDialogOpen}
        profile={activeStrategyProfile}
        strategyForm={strategyForm}
        strategyLoading={strategyLoading}
        saving={savingStrategy}
        onClose={() => setStrategyDialogOpen(false)}
        onChange={handleUpdateStrategyField}
        onSave={() => void handleSaveStrategy()}
      />
    </PageLayout>
  )
}

function SocialProfileCard({
  profile,
  qrActive,
  syncing,
  onOpenStrategy,
  onSync,
  onQr,
  onStopQr,
  onDelete,
}: {
  profile: SocialProfile
  qrActive: boolean
  syncing: boolean
  onOpenStrategy: () => void
  onSync: () => void
  onQr: () => void
  onStopQr: () => void
  onDelete: () => void
}) {
  const stats = [
    { label: 'Follower', value: resolveProfileMetric(profile, 'follower_count') },
    { label: 'Lượt thích', value: resolveProfileMetric(profile, 'likes_count') },
    { label: 'Bài viết', value: resolveProfileMetric(profile, 'video_count') },
  ].filter((item) => item.value !== null)

  return (
    <div className="rounded-xl border border-[var(--outline-variant)] bg-white p-5 shadow-sm transition hover:shadow-md hover:border-slate-300 flex flex-col justify-between space-y-4">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <SocialProfileAvatar
              avatarUrl={profile.avatar_url}
              name={profile.profile_name}
              platform={profile.platform}
              size="xl"
            />
            <div className="min-w-0 space-y-1">
              <div className="truncate text-base font-bold text-[var(--on-surface)]" title={profile.profile_name}>
                {profile.profile_name}
              </div>
              <div className="truncate text-xs font-medium text-[var(--on-surface-variant)]">
                {profile.username ? `@${profile.username}` : profile.platform}
              </div>
              <div className="flex items-center gap-2 pt-0.5">
                <StatusPill value={profile.status || 'active'} />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onDelete}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 transition"
            title="Xóa kênh social"
          >
            <Trash2 size={16} />
          </button>
        </div>

        {stats.length > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center text-xs">
            {stats.map((stat) => (
              <div key={stat.label}>
                <div className="font-extrabold text-slate-800">{formatProfileMetric(stat.value)}</div>
                <div className="text-xs text-slate-500">{stat.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2 pt-2 border-t border-slate-100">
        <AppButton
          className="w-full justify-center text-xs font-bold"
          icon={<SlidersHorizontal size={15} />}
          onClick={onOpenStrategy}
        >
          Cấu hình chiến lược AI
        </AppButton>

        <div className="grid grid-cols-2 gap-2">
          <AppButton
            variant="secondary"
            className="w-full justify-center text-xs"
            icon={<RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />}
            disabled={syncing}
            onClick={onSync}
          >
            {syncing ? 'Đang sync' : 'Đồng bộ'}
          </AppButton>

          {String(profile.platform || '').toLowerCase() === 'tiktok' && (
            <AppButton
              variant="secondary"
              className="w-full justify-center text-xs"
              icon={<QrCode size={13} />}
              onClick={qrActive ? onStopQr : onQr}
            >
              {qrActive ? 'Dừng QR' : 'Mở QR'}
            </AppButton>
          )}
        </div>
      </div>
    </div>
  )
}
