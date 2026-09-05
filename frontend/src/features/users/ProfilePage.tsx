import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { Save, UserRound, Lock, Upload, Camera } from 'lucide-react'
import { PageLayout, AppCard, AppButton, UserAvatar } from '@/commons/component/social-ui'
import { updateMyProfileApi, uploadAvatarApi } from '@/commons/apis/auth'

type CurrentUser = {
  id: string | number
  email: string
  full_name?: string | null
  avatar_url?: string | null
  roles: string[]
  is_system_admin?: boolean
}

export default function ProfilePage({
  currentUser,
  onProfileUpdated,
}: {
  currentUser: CurrentUser | null
  onProfileUpdated: () => void
}) {
  const [fullName, setFullName] = useState(currentUser?.full_name || '')
  const [email, setEmail] = useState(currentUser?.email || '')
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    currentUser?.avatar_url ?? null
  )
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  const [oldPassword, setOldPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [loadingPassword, setLoadingPassword] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    if (!validTypes.includes(file.type)) {
      toast.error('Định dạng file không hợp lệ. Chỉ chấp nhận: JPG, PNG, GIF, WEBP')
      return
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Kích thước file quá lớn. Tối đa 5MB')
      return
    }

    setAvatarFile(file)
    
    // Create preview
    const reader = new FileReader()
    reader.onloadend = () => {
      setAvatarPreview(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleAvatarUpload = async () => {
    if (!avatarFile) {
      toast.error('Vui lòng chọn ảnh để tải lên')
      return
    }

    setUploadingAvatar(true)
    try {
      await uploadAvatarApi(avatarFile)
      toast.success('Cập nhật ảnh đại diện thành công')
      setAvatarFile(null)
      onProfileUpdated()
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Tải ảnh lên thất bại')
    } finally {
      setUploadingAvatar(false)
    }
  }

  const handleSaveProfile = async () => {
    setLoadingProfile(true)
    try {
      const payload: any = {}
      if (fullName !== currentUser?.full_name) {
        payload.full_name = fullName
      }
      if (email !== currentUser?.email) {
        if (!email || !email.includes('@')) {
          toast.error('Email không hợp lệ')
          setLoadingProfile(false)
          return
        }
        payload.email = email
      }

      if (Object.keys(payload).length === 0) {
        toast.info('Không có thay đổi nào.')
        setLoadingProfile(false)
        return
      }

      await updateMyProfileApi(payload)
      toast.success('Cập nhật thông tin cá nhân thành công.')
      onProfileUpdated()
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Cập nhật thất bại.')
    } finally {
      setLoadingProfile(false)
    }
  }

  const handleSavePassword = async () => {
    if (!oldPassword) {
      toast.error('Vui lòng nhập mật khẩu cũ.')
      return
    }
    if (!password) {
      toast.error('Vui lòng nhập mật khẩu mới.')
      return
    }
    if (password !== confirmPassword) {
      toast.error('Mật khẩu xác nhận không khớp.')
      return
    }
    if (password.length < 6) {
      toast.error('Mật khẩu phải có ít nhất 6 ký tự.')
      return
    }

    setLoadingPassword(true)
    try {
      await updateMyProfileApi({
        old_password: oldPassword,
        password: password
      })
      toast.success('Đổi mật khẩu thành công.')
      setOldPassword('')
      setPassword('')
      setConfirmPassword('')
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Đổi mật khẩu thất bại.')
    } finally {
      setLoadingPassword(false)
    }
  }

  return (
    <PageLayout
      title="Thông tin cá nhân"
      description="Xem và cập nhật thông tin tài khoản của bạn."
    >
      <div className="mx-auto max-w-3xl space-y-6">
        <AppCard className="p-6">
          <div className="mb-6 flex items-center gap-4 border-b border-slate-100 pb-6">
            <div className="relative">
              <UserAvatar 
                src={avatarPreview} 
                name={currentUser?.full_name || currentUser?.email || 'User'} 
                size="lg" 
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 text-white shadow-lg transition hover:bg-indigo-600"
                title="Thay đổi ảnh đại diện"
              >
                <Camera size={14} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                onChange={handleAvatarSelect}
                className="hidden"
              />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-slate-900">{currentUser?.full_name || 'Người dùng'}</h2>
              <p className="text-sm font-medium text-slate-500">{currentUser?.email}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {currentUser?.roles.map(role => (
                  <span key={role} className="rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                    {role}
                  </span>
                ))}
              </div>
              {avatarFile && (
                <div className="mt-2">
                  <AppButton 
                    icon={<Upload size={14} />} 
                    onClick={() => void handleAvatarUpload()} 
                    disabled={uploadingAvatar}
                  >
                    {uploadingAvatar ? 'Đang tải lên...' : 'Lưu ảnh mới'}
                  </AppButton>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <UserRound size={16} className="text-indigo-500" />
              Thông tin chung
            </h3>
            
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-bold text-slate-700">Họ và tên</span>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Nhập họ tên của bạn"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition hover:border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-bold text-slate-700">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Nhập email của bạn"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition hover:border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </label>
            </div>
            
            <div className="mt-4 flex justify-end">
              <AppButton icon={<Save size={16} />} onClick={() => void handleSaveProfile()} disabled={loadingProfile}>
                Lưu thông tin
              </AppButton>
            </div>
          </div>
        </AppCard>

        <AppCard className="p-6">
          <div className="space-y-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <Lock size={16} className="text-indigo-500" />
              Đổi mật khẩu
            </h3>
            
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5 sm:col-span-2">
                <span className="text-xs font-bold text-slate-700">Mật khẩu cũ</span>
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder="Nhập mật khẩu cũ"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition hover:border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-bold text-slate-700">Mật khẩu mới</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Nhập mật khẩu mới"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition hover:border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-bold text-slate-700">Xác nhận mật khẩu mới</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Nhập lại mật khẩu mới"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition hover:border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </label>
            </div>

            <div className="mt-4 flex items-center justify-between pt-2">
              <a 
                href="#" 
                onClick={(e) => { e.preventDefault(); toast.info('Vui lòng liên hệ quản trị viên để cấp lại mật khẩu.') }} 
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                Quên mật khẩu?
              </a>
              <AppButton icon={<Save size={16} />} onClick={() => void handleSavePassword()} disabled={loadingPassword}>
                Đổi mật khẩu
              </AppButton>
            </div>
          </div>
        </AppCard>
      </div>
    </PageLayout>
  )
}
