import { useState } from 'react'
import { toast } from 'sonner'
import { Save, UserRound, Lock } from 'lucide-react'
import { PageLayout, AppCard, AppButton, UserAvatar } from '@/commons/component/social-ui'
import { updateMyProfileApi } from '@/commons/apis/auth'

type CurrentUser = {
  id: string | number
  email: string
  full_name?: string | null
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
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    if (password && password !== confirmPassword) {
      toast.error('Mật khẩu xác nhận không khớp.')
      return
    }
    if (password && password.length < 6) {
      toast.error('Mật khẩu phải có ít nhất 6 ký tự.')
      return
    }

    setLoading(true)
    try {
      const payload: any = {}
      if (fullName !== currentUser?.full_name) {
        payload.full_name = fullName
      }
      if (password) {
        payload.password = password
      }

      if (Object.keys(payload).length === 0) {
        toast.info('Không có thay đổi nào.')
        setLoading(false)
        return
      }

      await updateMyProfileApi(payload)
      toast.success('Cập nhật thông tin cá nhân thành công.')
      setPassword('')
      setConfirmPassword('')
      onProfileUpdated()
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Cập nhật thất bại.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageLayout
      title="Thông tin cá nhân"
      description="Xem và cập nhật thông tin tài khoản của bạn."
      actions={
        <AppButton icon={<Save size={16} />} onClick={() => void handleSave()} disabled={loading}>
          Lưu thay đổi
        </AppButton>
      }
    >
      <div className="mx-auto max-w-3xl space-y-6">
        <AppCard className="p-6">
          <div className="mb-6 flex items-center gap-4 border-b border-slate-100 pb-6">
            <UserAvatar src={null} name={currentUser?.full_name || currentUser?.email || 'User'} size="lg" />
            <div>
              <h2 className="text-lg font-bold text-slate-900">{currentUser?.full_name || 'Người dùng'}</h2>
              <p className="text-sm font-medium text-slate-500">{currentUser?.email}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {currentUser?.roles.map(role => (
                  <span key={role} className="rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                    {role}
                  </span>
                ))}
              </div>
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

              <label className="block space-y-1.5 opacity-60">
                <span className="text-xs font-bold text-slate-700">Email (Không thể thay đổi)</span>
                <input
                  type="email"
                  value={currentUser?.email || ''}
                  disabled
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none"
                />
              </label>
            </div>
          </div>

          <div className="mt-8 space-y-4 border-t border-slate-100 pt-6">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <Lock size={16} className="text-indigo-500" />
              Đổi mật khẩu
            </h3>
            <p className="text-xs text-slate-500">Bỏ trống nếu bạn không muốn thay đổi mật khẩu.</p>
            
            <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
        </AppCard>
      </div>
    </PageLayout>
  )
}
