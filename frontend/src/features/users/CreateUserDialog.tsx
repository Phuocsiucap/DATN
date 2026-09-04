import { useState } from 'react'
import { Mail, Key, Shield, User, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter } from '@/commons/component/ui/dialog'
import { createAdminUserApi } from '@/commons/apis/api'
import { cn } from '@/commons/lib/utils'

type CreateUserDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

type CreateUserForm = {
  full_name: string
  email: string
  password: string
  role: 'creator' | 'system'
  is_active: boolean
}

const emptyForm: CreateUserForm = {
  full_name: '',
  email: '',
  password: '',
  role: 'creator',
  is_active: true,
}

const rolePayload = (role: string) => (role === 'system' ? ['SYSTEM_ADMIN'] : ['CREATOR'])

export default function CreateUserDialog({ open, onOpenChange, onSuccess }: CreateUserDialogProps) {
  const [form, setForm] = useState<CreateUserForm>(emptyForm)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.email || !form.password) {
      toast.error('Email và mật khẩu không được để trống')
      return
    }

    setLoading(true)
    try {
      await createAdminUserApi({
        full_name: form.full_name.trim() || null,
        email: form.email.trim(),
        password: form.password,
        roles: rolePayload(form.role),
        is_active: form.is_active,
      })
      toast.success('Đã tạo tài khoản người dùng mới.')
      setForm(emptyForm)
      onOpenChange(false)
      onSuccess()
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể tạo tài khoản')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => {
    if (!loading) {
      setForm(emptyForm)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Tạo tài khoản mới</DialogTitle>
          <DialogDescription>
            Cấp quyền truy cập hệ thống cho người dùng mới. Nhập thông tin bên dưới.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <DialogBody className="space-y-4">
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

            {/* Mật khẩu */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">
                Mật khẩu <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Key size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  required
                  minLength={6}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-3 pl-11 pr-4 text-sm font-semibold text-slate-800 outline-none transition-all focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 hover:border-slate-300"
                  value={form.password}
                  onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="Tối thiểu 6 ký tự"
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
                  className="relative w-full appearance-none rounded-xl border border-slate-200 bg-slate-50/50 py-3 pl-11 pr-4 text-sm font-semibold text-slate-800 outline-none transition-all focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10 hover:border-slate-300"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                    backgroundPosition: 'right 0.75rem center',
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: '1.2em 1.2em',
                  }}
                  value={form.role}
                  onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value as 'creator' | 'system' }))}
                  disabled={loading}
                >
                  <option value="creator">Creator (Người sử dụng)</option>
                  <option value="system">System Admin (Quản trị viên)</option>
                </select>
              </div>
            </div>

            {/* Trạng thái kích hoạt */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500">
                Trạng thái ban đầu
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-bold text-slate-700 transition-all hover:border-slate-300 hover:bg-white">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-600 focus:ring-offset-0"
                  checked={form.is_active}
                  onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                  disabled={loading}
                />
                <CheckCircle2 size={16} className={cn('transition-colors', form.is_active ? 'text-emerald-600' : 'text-slate-400')} />
                <span>Kích hoạt tài khoản ngay lập tức</span>
              </label>
              {!form.is_active && (
                <p className="mt-2 text-xs text-amber-600 font-semibold">
                  ⚠️ Tài khoản sẽ bị khóa sau khi tạo, admin cần mở khóa thủ công
                </p>
              )}
            </div>
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
              disabled={loading || !form.email || !form.password}
              className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-blue-700 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
            >
              {loading ? 'Đang tạo...' : 'Tạo tài khoản'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
