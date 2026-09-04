import { useEffect, useState } from 'react'
import { Mail, User, Shield, Activity, Key, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter } from '@/commons/component/ui/dialog'
import { updateAdminUserApi, deleteAdminUserApi } from '@/commons/apis/api'
import { cn } from '@/commons/lib/utils'

type AdminUser = {
  id: string | number
  email: string
  full_name?: string | null
  roles: string[]
  is_active: boolean
  created_at: string
}

type EditUserDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: AdminUser | null
  currentUserId: string | number
  onSuccess: () => void
}

type EditUserForm = {
  full_name: string
  email: string
  role: 'creator' | 'system'
  is_active: boolean
  new_password: string
}

const hasSystemRole = (roles: string[]) =>
  roles.some((role) => {
    const normalized = role.toUpperCase()
    return normalized === 'SYSTEM' || normalized === 'SYSTEM_ADMIN' || normalized === 'ADMIN'
  })

const rolePayload = (role: string) => (role === 'system' ? ['SYSTEM_ADMIN'] : ['CREATOR'])

export default function EditUserDialog({ open, onOpenChange, user, currentUserId, onSuccess }: EditUserDialogProps) {
  const [form, setForm] = useState<EditUserForm>({
    full_name: '',
    email: '',
    role: 'creator',
    is_active: true,
    new_password: '',
  })
  const [loading, setLoading] = useState(false)
  const [showPasswordField, setShowPasswordField] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const isSelf = user?.id === currentUserId

  useEffect(() => {
    if (user) {
      setForm({
        full_name: user.full_name || '',
        email: user.email,
        role: hasSystemRole(user.roles) ? 'system' : 'creator',
        is_active: user.is_active,
        new_password: '',
      })
      setShowPasswordField(false)
      setShowDeleteConfirm(false)
    }
  }, [user])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return

    if (!form.email.trim()) {
      toast.error('Email không được để trống')
      return
    }

    if (showPasswordField && form.new_password && form.new_password.length < 6) {
      toast.error('Mật khẩu phải có ít nhất 6 ký tự')
      return
    }

    setLoading(true)
    try {
      const payload: any = {
        full_name: form.full_name.trim() || null,
        email: form.email.trim(),
        roles: rolePayload(form.role),
        is_active: form.is_active,
      }

      if (showPasswordField && form.new_password) {
        payload.password = form.new_password
      }

      await updateAdminUserApi(user.id, payload)
      toast.success('Đã cập nhật thông tin người dùng.')
      onOpenChange(false)
      onSuccess()
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể cập nhật thông tin')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!user || !showDeleteConfirm) return

    setLoading(true)
    try {
      await deleteAdminUserApi(user.id)
      toast.success('Đã xóa tài khoản người dùng.')
      onOpenChange(false)
      onSuccess()
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể xóa tài khoản')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    if (!loading) {
      onOpenChange(false)
    }
  }

  if (!user) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Chỉnh sửa người dùng</DialogTitle>
          <DialogDescription>
            Cập nhật thông tin, phân quyền và trạng thái tài khoản {user.email}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <DialogBody className="space-y-4">
            {isSelf && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} />
                  <span>Bạn đang chỉnh sửa tài khoản của chính mình</span>
                </div>
              </div>
            )}

            {/* Họ tên */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">
                Họ và tên <span className="text-slate-400">(tùy chọn)</span>
              </label>
              <div className="relative">
                <User size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-3 pl-11 pr-4 text-sm font-semibold text-slate-800 outline-none transition-all focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 hover:border-slate-300"
                  value={form.full_name}
                  onChange={(e) => setForm((prev) => ({ ...prev, full_name: e.target.value }))}
                  placeholder="Nguyễn Văn A"
                  disabled={loading}
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">
                Email <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Mail size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  required
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-3 pl-11 pr-4 text-sm font-semibold text-slate-800 outline-none transition-all focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 hover:border-slate-300"
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="user@company.com"
                  disabled={loading}
                />
              </div>
            </div>

            {/* Vai trò */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">
                Phân quyền <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Shield size={16} className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-slate-400" />
                <select
                  className="relative w-full appearance-none rounded-xl border border-slate-200 bg-slate-50/50 py-3 pl-11 pr-4 text-sm font-semibold text-slate-800 outline-none transition-all focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                    backgroundPosition: 'right 0.75rem center',
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: '1.2em 1.2em',
                  }}
                  value={form.role}
                  onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value as 'creator' | 'system' }))}
                  disabled={loading || isSelf}
                >
                  <option value="creator">Creator (Người sử dụng)</option>
                  <option value="system">System Admin (Quản trị viên)</option>
                </select>
              </div>
              {isSelf && (
                <p className="mt-2 text-xs text-amber-600 font-semibold">
                  ⚠️ Không thể tự thay đổi quyền của chính mình
                </p>
              )}
            </div>

            {/* Trạng thái */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">
                Trạng thái tài khoản
              </label>
              <label
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-bold text-slate-700 transition-all hover:border-slate-300 hover:bg-white',
                  (loading || isSelf) && 'cursor-not-allowed opacity-50',
                )}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-600 focus:ring-offset-0"
                  checked={form.is_active}
                  onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                  disabled={loading || isSelf}
                />
                {form.is_active ? (
                  <>
                    <CheckCircle2 size={16} className="text-emerald-600" />
                    <span>Tài khoản đang hoạt động</span>
                  </>
                ) : (
                  <>
                    <XCircle size={16} className="text-rose-600" />
                    <span>Tài khoản bị khóa</span>
                  </>
                )}
              </label>
              {isSelf && (
                <p className="mt-2 text-xs text-amber-600 font-semibold">
                  ⚠️ Không thể tự khóa tài khoản của chính mình
                </p>
              )}
            </div>

            {/* Đổi mật khẩu */}
            <div className="border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={() => setShowPasswordField(!showPasswordField)}
                className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-blue-600 transition hover:text-blue-700"
                disabled={loading}
              >
                <Key size={14} />
                {showPasswordField ? 'Hủy đổi mật khẩu' : 'Đặt lại mật khẩu'}
              </button>

              {showPasswordField && (
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">
                    Mật khẩu mới <span className="text-slate-400">(tối thiểu 6 ký tự)</span>
                  </label>
                  <div className="relative">
                    <Key size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="password"
                      minLength={6}
                      className="w-full rounded-xl border border-amber-200 bg-amber-50/50 py-3 pl-11 pr-4 text-sm font-semibold text-slate-800 outline-none transition-all focus:border-amber-500 focus:bg-white focus:ring-4 focus:ring-amber-500/10 hover:border-amber-300"
                      value={form.new_password}
                      onChange={(e) => setForm((prev) => ({ ...prev, new_password: e.target.value }))}
                      placeholder="Nhập mật khẩu mới"
                      disabled={loading}
                    />
                  </div>
                  <p className="mt-2 text-xs text-amber-600 font-semibold">
                    🔒 Mật khẩu sẽ được cập nhật và tất cả refresh token cũ sẽ bị thu hồi
                  </p>
                </div>
              )}
            </div>

            {/* Xóa tài khoản */}
            {!isSelf && (
              <div className="border-t border-slate-200 pt-4">
                {!showDeleteConfirm ? (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="inline-flex items-center gap-2 text-sm font-bold text-rose-600 transition hover:text-rose-700"
                    disabled={loading}
                  >
                    <AlertTriangle size={14} />
                    Xóa tài khoản này
                  </button>
                ) : (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
                    <p className="text-sm font-bold text-rose-800 mb-3">
                      ⚠️ Hành động này không thể hoàn tác. Xác nhận xóa?
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(false)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                        disabled={loading}
                      >
                        Hủy
                      </button>
                      <button
                        type="button"
                        onClick={handleDelete}
                        className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-rose-700 active:scale-95"
                        disabled={loading}
                      >
                        {loading ? 'Đang xóa...' : 'Xóa vĩnh viễn'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </DialogBody>

          <DialogFooter>
            <button
              type="button"
              onClick={handleCancel}
              disabled={loading}
              className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              disabled={loading || !form.email}
              className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-blue-700 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
            >
              {loading ? 'Đang lưu...' : 'Lưu thay đổi'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
