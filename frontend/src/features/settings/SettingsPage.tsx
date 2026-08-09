import { useEffect, useState } from 'react'

import { CircleUserRound, ShieldCheck, QrCode, Settings, Trash2, PlusCircle, RefreshCw, X, Save, CheckCircle2 } from 'lucide-react'
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
  fetchAdminSchedulerSettingsApi,
  updateAdminSchedulerSettingsApi,
  fetchSocialProfileStrategyApi,
  updateSocialProfileStrategyApi,
  type SchedulerSettingsStatus,
  type SchedulerSettings
} from '@/commons/apis/api'

type CurrentUser = {
  id: string | number
  email: string
  roles: string[]
  is_system_admin?: boolean
}

type SocialProfile = {
  id: string
  platform: string
  profile_name: string
  username?: string | null
  status: string
}

type TabMode = 'profiles' | 'scheduler'
type SettingsNavigationState = { openProfileId?: string; openTab?: string } | null

const DEFAULT_SETTINGS: SchedulerSettings = {
  vnexpress_interval_minutes: 30,
  bilibili_interval_minutes: 30,
  publish_queue_interval_minutes: 5,
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
  const [message, setMessage] = useState('')

  // QR Session state
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  const [qrImage, setQrImage] = useState<string | null>(null)
  const [sessionStatus, setSessionStatus] = useState<string>('idle')

  // Add profile state
  const [addProfileOpen, setAddProfileOpen] = useState(false)
  const [newProfileName, setNewProfileName] = useState('')
  const [newProfileUsername, setNewProfileUsername] = useState('')
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null)
  const [pendingQrImage, setPendingQrImage] = useState<string | null>(null)
  const [addingProfile, setAddingProfile] = useState(false)

  // Scheduler state
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerSettingsStatus | null>(null)
  const [schedulerForm, setSchedulerForm] = useState<SchedulerSettings>(DEFAULT_SETTINGS)

  // Strategy Modal state
  const [strategyModalOpen, setStrategyModalOpen] = useState(false)
  const [activeStrategyProfile, setActiveStrategyProfile] = useState<SocialProfile | null>(null)
  const [strategyForm, setStrategyForm] = useState<any>({
    content_topics: '',
    avoid_topics: '',
    tone: 'Professional & Authoritative',
    target_audience: '',
    min_score: 75,
    max_recommendations_per_day: 15,
    auto_handoff_enabled: false,
    auto_planning_enabled: false,
    system_content_enabled: true,
    relevance_weight: 1.5,
    freshness_decay: 0.8,
    authority_base: 85
  })
  const [strategyLoading, setStrategyLoading] = useState(false)

  const loadProfiles = async () => {
    setLoading(true)
    try {
      const data = await fetchSocialProfilesApi('tiktok')
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

  // Auto-open strategy modal khi navigate tu PlanningPage
  useEffect(() => {
    const state = window.history.state as SettingsNavigationState
    if (!state?.openProfileId || profiles.length === 0) return
    const target = profiles.find((p) => p.id === state.openProfileId)
    if (target) {
      void openStrategyModal(target)
      // Xoa state khoi history de khong re-trigger neu user quay lai
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [profiles])

  useEffect(() => {
    if (!activeProfileId) return

    const timer = setInterval(async () => {
      try {
        const data = await getTikTokQrLoginStatusApi(activeProfileId)
        if (data.qr_image) setQrImage(data.qr_image)
        setSessionStatus(data.authenticated ? 'authenticated' : data.session_active ? 'waiting_for_scan' : 'stopped')
        
        if (data.authenticated) {
          setActiveProfileId(null)
          setQrImage(null)
          await loadProfiles()
          setMessage('Đăng nhập TikTok thành công.')
        }
      } catch (error) {
        console.error(error)
      }
    }, 4000)

    return () => clearInterval(timer)
  }, [activeProfileId])

  useEffect(() => {
    if (!pendingSessionId) return

    const timer = setInterval(async () => {
      try {
        const data = await getPendingTikTokQrLoginStatusApi(pendingSessionId, {
          profile_name: newProfileName || 'TikTok account',
          username: newProfileUsername || undefined,
        })
        if (data.qr_image) setPendingQrImage(data.qr_image)
        setSessionStatus(data.authenticated ? 'authenticated' : data.session_active ? 'waiting_for_scan' : 'stopped')

        if (data.authenticated) {
          setPendingSessionId(null)
          setPendingQrImage(null)
          setAddProfileOpen(false)
          setNewProfileName('')
          setNewProfileUsername('')
          await loadProfiles()
          setMessage('Đã thêm và đăng nhập TikTok profile thành công.')
        }
      } catch (error) {
        console.error(error)
      }
    }, 4000)

    return () => clearInterval(timer)
  }, [pendingSessionId, newProfileName, newProfileUsername])

  const openStrategyModal = async (profile: SocialProfile) => {
    setActiveStrategyProfile(profile)
    setStrategyModalOpen(true)
    setStrategyLoading(true)
    try {
      const data = await fetchSocialProfileStrategyApi(profile.id)
      if (data) setStrategyForm(data)
    } catch (err) {
      console.error(err)
    } finally {
      setStrategyLoading(false)
    }
  }

  const handleUpdateStrategyField = (key: string, value: any) => {
    setStrategyForm((prev: any) => ({ ...prev, [key]: value }))
  }

  const handleSaveStrategy = async () => {
    if (!activeStrategyProfile) return
    setLoading(true)
    setMessage('')
    try {
      const data = await updateSocialProfileStrategyApi(activeStrategyProfile.id, strategyForm)
      setStrategyForm(data)
      setMessage('Lưu cấu hình Chiến lược thành công')
      setStrategyModalOpen(false)
    } catch (err: any) {
      setMessage(err?.response?.data?.detail || 'Không thể lưu Chiến lược')
    } finally {
      setLoading(false)
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
    setSessionStatus('idle')
  }

  const handleCreateProfile = async () => {
    const profileName = newProfileName.trim()
    if (!profileName) {
      setMessage('Vui lòng nhập tên profile.')
      return
    }
    setAddingProfile(true)
    setMessage('')
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
      setMessage('Đã thêm profile TikTok. Bạn có thể mở QR để đăng nhập.')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể thêm profile')
    } finally {
      setAddingProfile(false)
    }
  }

  const handleStartPendingQr = async () => {
    const profileName = newProfileName.trim() || 'TikTok account'
    setAddingProfile(true)
    setMessage('')
    try {
      const data = await startPendingTikTokQrLoginApi({
        profile_name: profileName,
        username: newProfileUsername.trim() || undefined,
      })
      setPendingSessionId(data.session_id)
      setPendingQrImage(data.qr_image)
      setSessionStatus(data.authenticated ? 'authenticated' : 'waiting_for_scan')
      setMessage('Đã mở QR để thêm TikTok profile. Hãy quét bằng app TikTok trên điện thoại.')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể mở QR thêm profile')
    } finally {
      setAddingProfile(false)
    }
  }

  const handleStartQr = async (profileId: string) => {
    setLoading(true)
    setMessage('')
    try {
      const data = await startTikTokQrLoginApi(profileId)
      setActiveProfileId(profileId)
      setQrImage(data.qr_image)
      setSessionStatus(data.authenticated ? 'authenticated' : 'waiting_for_scan')
      setMessage('Đã mở QR login TikTok. Hãy quét bằng app TikTok trên điện thoại.')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể mở QR login')
    } finally {
      setLoading(false)
    }
  }

  const handleStopQr = async (profileId: string) => {
    await stopTikTokQrLoginApi(profileId)
    if (activeProfileId === profileId) {
      setActiveProfileId(null)
      setQrImage(null)
      setSessionStatus('stopped')
    }
    await loadProfiles()
  }

  const handleDeleteProfile = async (profileId: string) => {
    if (!window.confirm('Xóa tài khoản này?')) return
    setLoading(true)
    try {
      await deleteSocialProfileApi(profileId)
      if (activeProfileId === profileId) {
        setActiveProfileId(null)
        setQrImage(null)
        setSessionStatus('idle')
      }
      await loadProfiles()
      setMessage('Đã xóa tài khoản.')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể xóa tài khoản')
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
    setMessage('')
    try {
      const data = await updateAdminSchedulerSettingsApi(schedulerForm)
      setSchedulerStatus(data)
      setSchedulerForm(data.settings)
      setMessage('Đã lưu cấu hình scheduler')
    } catch (err: any) {
      setMessage(err?.response?.data?.detail || 'Không lưu được')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#d9e0ea] bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-[#0f172a]">Cài Đặt & Tài Khoản</h2>
        <p className="mt-1 text-sm text-[#64748b]">Quản lý thông tin đăng nhập, profile mạng xã hội và cấu hình hệ thống.</p>
        
        <div className="mt-6 flex gap-2 border-t border-[#eef2f7] pt-4">
          <button onClick={() => setActiveTab('profiles')} className={`h-9 rounded-lg border px-4 text-sm font-semibold transition-colors ${activeTab === 'profiles' ? 'border-[#091426] bg-[#f5f2ff] text-[#091426]' : 'border-[#d9e0ea] bg-white text-[#64748b]'}`}>
            Kênh Mạng Xã Hội
          </button>
          {isSystemUser && (
            <button onClick={() => setActiveTab('scheduler')} className={`h-9 rounded-lg border px-4 text-sm font-semibold transition-colors ${activeTab === 'scheduler' ? 'border-[#091426] bg-[#f5f2ff] text-[#091426]' : 'border-[#d9e0ea] bg-white text-[#64748b]'}`}>
              Cấu hình Scheduler (Admin)
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800 flex items-center gap-2">
          <CheckCircle2 size={16} /> {message}
        </div>
      )}

      {activeTab === 'profiles' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-[#d9e0ea] bg-white p-6 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
              <CircleUserRound size={24} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[#0f172a]">{currentUser?.email || 'Người dùng'}</h3>
              <div className="flex items-center gap-2 text-sm text-[#64748b] mt-1">
                <ShieldCheck size={16} className={isSystemUser ? 'text-amber-500' : 'text-emerald-500'} />
                {isSystemUser ? 'System Administrator' : 'Content Creator'}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[#d9e0ea] bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <QrCode size={20} className="text-[#091426]" />
                <h3 className="text-lg font-bold text-[#0f172a]">TikTok Profiles</h3>
              </div>
              <button onClick={() => setAddProfileOpen(true)} className="flex items-center gap-2 text-sm font-bold text-[#091426] hover:text-[#1e293b]">
                <PlusCircle size={16} /> Thêm tài khoản
              </button>
            </div>

            <div className="grid gap-3">
              {profiles.length === 0 && <div className="text-center p-8 text-sm text-slate-500 border rounded-xl border-dashed">Chưa kết nối tài khoản nào</div>}
              {profiles.map(profile => (
                <div key={profile.id} className="rounded-xl border border-[#eef2f7] p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <div className="font-bold text-[#0f172a]">{profile.profile_name}</div>
                    <div className="text-xs text-[#64748b] mt-1">{profile.username || '—'} | {profile.status}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => openStrategyModal(profile)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-[#091426] border border-[#d9e0ea] hover:bg-slate-200 flex items-center gap-1"><Settings size={14}/> Config</button>
                    <button onClick={() => void handleStartQr(profile.id)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#f5f2ff] text-[#091426] border border-[#e0e7ff] hover:bg-[#e0e7ff]">Open QR</button>
                    {activeProfileId === profile.id && <button onClick={() => void handleStopQr(profile.id)} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-[#d9e0ea] text-[#64748b]">Stop</button>}
                    <button onClick={() => void handleDeleteProfile(profile.id)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-600 border border-red-100 hover:bg-red-100"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>

            {activeProfileId && (
              <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-6 flex flex-col items-center justify-center text-center">
                <h4 className="font-bold text-blue-900 mb-2">Mã QR Đăng Nhập</h4>
                <p className="text-xs text-blue-800 mb-4">Sử dụng ứng dụng TikTok trên điện thoại để quét mã này.</p>
                {qrImage ? (
                  <img src={qrImage} alt="QR Code" className="w-48 h-48 rounded-xl border-2 border-white shadow-sm" />
                ) : (
                  <div className="w-48 h-48 rounded-xl bg-blue-100 animate-pulse flex items-center justify-center">Đang tải...</div>
                )}
                <div className="mt-4 text-xs font-bold uppercase tracking-wider text-blue-700">Trạng thái: {sessionStatus}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'scheduler' && isSystemUser && (
        <div className="rounded-xl border border-[#d9e0ea] bg-white p-6 shadow-sm">
           <div className="flex items-center justify-between gap-3 mb-6">
            <div>
              <h2 className="text-lg font-bold text-[#0f172a]">Cấu Hình Scheduler</h2>
              <p className="text-sm text-[#64748b] mt-1">Trạng thái: <span className="font-semibold">{schedulerStatus?.status || '...'}</span></p>
            </div>
            <button onClick={() => void loadSchedulerSettings()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-[#d9e0ea] px-3 py-2 text-sm font-semibold text-[#475569] hover:bg-slate-50">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Tải lại
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

          <button onClick={() => void saveSchedulerSettings()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg bg-[#091426] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#1e293b] transition-colors shadow-sm">
            <Save size={16} /> Lưu cấu hình
          </button>
        </div>
      )}

      {addProfileOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#eef2f7] px-6 py-4">
              <div>
                <h3 className="text-lg font-bold text-[#0f172a]">Thêm TikTok Profile</h3>
                <p className="mt-1 text-sm text-[#64748b]">Tạo profile social content mới và kết nối TikTok bằng QR.</p>
              </div>
              <button onClick={() => void closeAddProfile()} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 p-6">
              <label className="block space-y-2 text-sm">
                <span className="font-bold text-slate-700">Tên profile</span>
                <input
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="VD: TikTok Storytelling Channel"
                  className="w-full rounded-lg border border-[#d9e0ea] px-3 py-2 outline-none focus:border-[#3525cd]"
                />
              </label>

              <label className="block space-y-2 text-sm">
                <span className="font-bold text-slate-700">Username TikTok</span>
                <input
                  value={newProfileUsername}
                  onChange={(e) => setNewProfileUsername(e.target.value)}
                  placeholder="@username hoặc để trống"
                  className="w-full rounded-lg border border-[#d9e0ea] px-3 py-2 outline-none focus:border-[#3525cd]"
                />
              </label>

              {pendingSessionId && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-center">
                  <h4 className="font-bold text-blue-900">Quét QR để hoàn tất</h4>
                  <p className="mb-4 mt-1 text-xs text-blue-800">Sau khi TikTok xác thực, profile sẽ được tạo tự động.</p>
                  {pendingQrImage ? (
                    <img src={pendingQrImage} alt="QR Code" className="mx-auto h-48 w-48 rounded-xl border-2 border-white shadow-sm" />
                  ) : (
                    <div className="mx-auto flex h-48 w-48 items-center justify-center rounded-xl bg-blue-100 text-sm text-blue-800">Đang tải...</div>
                  )}
                  <div className="mt-4 text-xs font-bold uppercase tracking-wider text-blue-700">Trạng thái: {sessionStatus}</div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-3 border-t border-[#eef2f7] bg-slate-50 px-6 py-4">
              {pendingSessionId ? (
                <button onClick={() => void closeAddProfile()} className="rounded-lg border border-[#d9e0ea] px-4 py-2 text-sm font-bold text-[#475569] hover:bg-white">
                  Dừng QR
                </button>
              ) : (
                <>
                  <button onClick={() => void handleCreateProfile()} disabled={addingProfile} className="rounded-lg border border-[#d9e0ea] px-4 py-2 text-sm font-bold text-[#475569] hover:bg-white disabled:opacity-60">
                    Tạo trước, đăng nhập sau
                  </button>
                  <button onClick={() => void handleStartPendingQr()} disabled={addingProfile} className="inline-flex items-center gap-2 rounded-lg bg-[#091426] px-4 py-2 text-sm font-bold text-white hover:bg-[#1e293b] disabled:opacity-60">
                    <QrCode size={16} /> Thêm bằng QR
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Strategy Configuration Modal */}
      {strategyModalOpen && activeStrategyProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-5xl my-8 overflow-hidden flex flex-col max-h-[90vh] shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#eef2f7] sticky top-0 bg-white z-10">
              <div>
                <h3 className="text-xl font-bold text-[#0f172a]">Cấu Hình Chiến Lược (Strategy)</h3>
                <p className="text-sm text-[#64748b]">Profile: <span className="font-bold text-[#3525cd]">{activeStrategyProfile.profile_name}</span></p>
              </div>
              <button onClick={() => setStrategyModalOpen(false)} className="text-slate-400 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-full p-2">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 bg-[#fcf8ff]">
              {strategyLoading ? (
                <div className="py-12 flex justify-center text-[#64748b]">
                  <RefreshCw className="animate-spin mr-2" /> Đang tải cấu hình...
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Left Column: Strategy & Defaults */}
                  <div className="lg:col-span-7 flex flex-col gap-6">
                    {/* Content Strategy Card */}
                    <section className="bg-white rounded-xl border border-[#d9e0ea] p-5 shadow-sm">
                      <h4 className="text-md font-bold text-[#0f172a] mb-4 border-b border-[#eef2f7] pb-2">Content Strategy</h4>
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-[#0f172a] mb-1">Preferred Topics</label>
                            <textarea 
                              className="w-full rounded-lg border-[#d9e0ea] focus:border-[#3525cd] focus:ring-[#3525cd] text-sm p-2.5" 
                              placeholder="e.g., Enterprise AI, Automation..." 
                              rows={2}
                              value={strategyForm.content_topics || ''}
                              onChange={e => handleUpdateStrategyField('content_topics', e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-[#0f172a] mb-1">Topics to Avoid</label>
                            <textarea 
                              className="w-full rounded-lg border-[#d9e0ea] focus:border-red-500 focus:ring-red-500 text-sm p-2.5" 
                              placeholder="e.g., Politics, Controversial..." 
                              rows={2}
                              value={strategyForm.avoid_topics || ''}
                              onChange={e => handleUpdateStrategyField('avoid_topics', e.target.value)}
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-[#0f172a] mb-1">Primary Tone</label>
                            <select 
                              className="w-full rounded-lg border-[#d9e0ea] focus:border-[#3525cd] focus:ring-[#3525cd] text-sm p-2.5"
                              value={strategyForm.tone || ''}
                              onChange={e => handleUpdateStrategyField('tone', e.target.value)}
                            >
                              <option value="Professional & Authoritative">Professional & Authoritative</option>
                              <option value="Dramatic & Urgent">Dramatic & Urgent</option>
                              <option value="Mystery & Intrigue">Mystery & Intrigue</option>
                              <option value="Casual & Approachable">Casual & Approachable</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-[#0f172a] mb-1">Target Audience Persona</label>
                            <input 
                              type="text"
                              className="w-full rounded-lg border-[#d9e0ea] focus:border-[#3525cd] focus:ring-[#3525cd] text-sm p-2.5" 
                              placeholder="e.g., C-Level Executives..."
                              value={strategyForm.target_audience || ''}
                              onChange={e => handleUpdateStrategyField('target_audience', e.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                    </section>

                    {/* Private Crawl Defaults */}
                    <section className="bg-white rounded-xl border border-[#d9e0ea] p-5 shadow-sm">
                      <h4 className="text-md font-bold text-[#0f172a] mb-4 border-b border-[#eef2f7] pb-2">Private Crawl Defaults</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="bg-slate-50 border border-[#d9e0ea] p-3 rounded-lg">
                          <label className="block text-[10px] font-bold text-[#64748b] mb-1 uppercase">Relevance Weight</label>
                          <input 
                            type="number" step="0.1" 
                            className="w-full bg-transparent border-b border-slate-300 focus:border-[#3525cd] focus:ring-0 px-0 py-1 font-mono text-sm"
                            value={strategyForm.relevance_weight || 1.0}
                            onChange={e => handleUpdateStrategyField('relevance_weight', parseFloat(e.target.value))}
                          />
                        </div>
                        <div className="bg-slate-50 border border-[#d9e0ea] p-3 rounded-lg">
                          <label className="block text-[10px] font-bold text-[#64748b] mb-1 uppercase">Freshness Decay</label>
                          <input 
                            type="number" step="0.1" 
                            className="w-full bg-transparent border-b border-slate-300 focus:border-[#3525cd] focus:ring-0 px-0 py-1 font-mono text-sm"
                            value={strategyForm.freshness_decay || 1.0}
                            onChange={e => handleUpdateStrategyField('freshness_decay', parseFloat(e.target.value))}
                          />
                        </div>
                        <div className="bg-slate-50 border border-[#d9e0ea] p-3 rounded-lg">
                          <label className="block text-[10px] font-bold text-[#64748b] mb-1 uppercase">Authority Base</label>
                          <input 
                            type="number" 
                            className="w-full bg-transparent border-b border-slate-300 focus:border-[#3525cd] focus:ring-0 px-0 py-1 font-mono text-sm"
                            value={strategyForm.authority_base || 50}
                            onChange={e => handleUpdateStrategyField('authority_base', parseInt(e.target.value))}
                          />
                        </div>
                      </div>
                    </section>
                  </div>

                  {/* Right Column: System & Automation */}
                  <div className="lg:col-span-5 flex flex-col gap-6">
                    {/* System Content */}
                    <section className="bg-gradient-to-br from-indigo-50 to-white rounded-xl p-5 border border-indigo-100 shadow-sm">
                      <h4 className="text-md font-bold text-[#0f172a] mb-4 border-b border-indigo-100 pb-2">System Content</h4>
                      <div className="space-y-5">
                        <div className="flex items-center justify-between">
                          <div>
                            <label className="font-semibold text-sm text-[#0f172a] block">Receive System Content</label>
                            <span className="text-[11px] text-[#64748b]">Opt-in to global AI suggestions</span>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input 
                              type="checkbox" className="sr-only peer" 
                              checked={strategyForm.system_content_enabled || false}
                              onChange={e => handleUpdateStrategyField('system_content_enabled', e.target.checked)}
                            />
                            <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#3525cd]"></div>
                          </label>
                        </div>
                        
                        <div>
                          <div className="flex justify-between mb-1">
                            <label className="font-semibold text-xs text-[#0f172a]">Minimum Score Threshold</label>
                            <span className="font-mono text-xs text-[#3525cd] bg-indigo-100 px-1.5 rounded">{strategyForm.min_score || 0}%</span>
                          </div>
                          <input 
                            type="range" min="0" max="100" 
                            className="w-full accent-[#3525cd]" 
                            value={strategyForm.min_score || 0}
                            onChange={e => handleUpdateStrategyField('min_score', parseInt(e.target.value))}
                          />
                        </div>
                        
                        <div>
                          <label className="block font-semibold text-xs text-[#0f172a] mb-1">Max Recommendations / Day</label>
                          <input 
                            type="number" 
                            className="w-full rounded-lg border-[#d9e0ea] focus:border-[#3525cd] focus:ring-[#3525cd] text-sm p-2"
                            value={strategyForm.max_recommendations_per_day || 0}
                            onChange={e => handleUpdateStrategyField('max_recommendations_per_day', parseInt(e.target.value))}
                          />
                        </div>
                      </div>
                    </section>

                    {/* Automation */}
                    <section className="bg-white rounded-xl border border-[#d9e0ea] p-5 shadow-sm">
                      <h4 className="text-md font-bold text-[#0f172a] mb-4 border-b border-[#eef2f7] pb-2">Automation</h4>
                      <div className="space-y-4">
                        <div className="flex items-start justify-between">
                          <div className="pr-2">
                            <label className="font-semibold text-sm text-[#0f172a] block">Auto Create Handoff</label>
                            <span className="text-[11px] text-[#64748b]">Automatically draft posts from high-scoring content.</span>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer mt-1 shrink-0">
                            <input 
                              type="checkbox" className="sr-only peer" 
                              checked={strategyForm.auto_handoff_enabled || false}
                              onChange={e => handleUpdateStrategyField('auto_handoff_enabled', e.target.checked)}
                            />
                            <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#3525cd]"></div>
                          </label>
                        </div>
                        
                        <div className="h-px bg-[#eef2f7] w-full"></div>
                        
                        <div className="flex items-start justify-between">
                          <div className="pr-2">
                            <label className="font-semibold text-sm text-[#0f172a] block">Auto Planning Job</label>
                            <span className="text-[11px] text-[#64748b]">Schedule approved handoffs to queue automatically.</span>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer mt-1 shrink-0">
                            <input 
                              type="checkbox" className="sr-only peer" 
                              checked={strategyForm.auto_planning_enabled || false}
                              onChange={e => handleUpdateStrategyField('auto_planning_enabled', e.target.checked)}
                            />
                            <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#3525cd]"></div>
                          </label>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-[#eef2f7] bg-slate-50 flex justify-end gap-3 rounded-b-2xl sticky bottom-0 z-10">
              <button 
                onClick={() => setStrategyModalOpen(false)}
                className="px-5 py-2.5 rounded-lg border border-slate-300 text-slate-700 font-bold text-sm hover:bg-slate-100 transition-colors"
              >
                Hủy (Cancel)
              </button>
              <button 
                onClick={handleSaveStrategy}
                disabled={loading}
                className="px-6 py-2.5 rounded-lg bg-[#3525cd] text-white font-bold text-sm hover:bg-blue-800 transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
              >
                <Save size={16} />
                Lưu Cấu Hình (Save)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
