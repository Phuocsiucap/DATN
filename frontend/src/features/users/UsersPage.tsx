import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, ShieldCheck, Trash2, UserPlus, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import {
  createAdminUserApi,
  deleteAdminUserApi,
  fetchAdminUsersApi,
  fetchUsersAiUsageSummaryApi,
  updateAdminUserApi,
} from '@/commons/apis/api'
import { PageLayout } from '@/commons/component/social-ui'

type AdminUser = {
  id: string | number
  email: string
  roles: string[]
  is_active: boolean
  created_at: string
}

type CurrentUser = {
  id: string | number
  email: string
  roles: string[]
  is_system_admin?: boolean
}

type UsersPageProps = {
  currentUser: CurrentUser
}

const emptyCreateForm = {
  email: '',
  password: '',
  role: 'user',
  is_active: true,
}

const hasSystemRole = (roles: string[]) => roles.some((role) => {
  const normalized = role.toUpperCase()
  return normalized === 'SYSTEM' || normalized === 'SYSTEM_ADMIN' || normalized === 'ADMIN'
})

export default function UsersPage({ currentUser }: UsersPageProps) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [usageSummary, setUsageSummary] = useState<Record<string, any>>({})
  const [createForm, setCreateForm] = useState(emptyCreateForm)
  const [loading, setLoading] = useState(false)

  const totalActive = useMemo(() => users.filter((user) => user.is_active).length, [users])
  const totalSystem = useMemo(() => users.filter((user) => hasSystemRole(user.roles)).length, [users])

  const loadUsers = async () => {
    setLoading(true)
    try {
      const [data, usageData] = await Promise.all([
        fetchAdminUsersApi(),
        fetchUsersAiUsageSummaryApi().catch(() => [])
      ])
      
      setUsers(data.items || [])
      
      const usageMap: Record<string, any> = {}
      for (const item of (usageData || [])) {
        usageMap[item.user_id] = item
      }
      setUsageSummary(usageMap)
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể tải danh sách user')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadUsers()
  }, [])

  const rolePayload = (role: string) => (role === 'system' ? ['SYSTEM_ADMIN'] : ['CREATOR'])

  const handleCreateUser = async () => {
    setLoading(true)
    try {
      await createAdminUserApi({
        email: createForm.email,
        password: createForm.password,
        roles: rolePayload(createForm.role),
        is_active: createForm.is_active,
      })
      setCreateForm(emptyCreateForm)
      await loadUsers()
      toast.success('Đã tạo user mới.')
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể tạo user')
    } finally {
      setLoading(false)
    }
  }

  const handleToggleActive = async (user: AdminUser) => {
    setLoading(true)
    try {
      await updateAdminUserApi(user.id, { is_active: !user.is_active })
      await loadUsers()
      toast.success(user.is_active ? 'Đã khóa user.' : 'Đã mở khóa user.')
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể cập nhật trạng thái')
    } finally {
      setLoading(false)
    }
  }

  const handleChangeRole = async (user: AdminUser, role: string) => {
    setLoading(true)
    try {
      await updateAdminUserApi(user.id, { roles: rolePayload(role) })
      await loadUsers()
      toast.success('Đã cập nhật quyền user.')
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể cập nhật quyền')
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async (user: AdminUser) => {
    const password = window.prompt(`Nhập mật khẩu mới cho ${user.email}`)
    if (!password) return

    setLoading(true)
    try {
      await updateAdminUserApi(user.id, { password })
      await loadUsers()
      toast.success('Đã đổi mật khẩu và thu hồi refresh token cũ.')
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể đổi mật khẩu')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteUser = async (user: AdminUser) => {
    const confirmed = window.confirm(`Xóa user ${user.email}?`)
    if (!confirmed) return

    setLoading(true)
    try {
      await deleteAdminUserApi(user.id)
      await loadUsers()
      toast.success('Đã xóa user.')
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể xóa user')
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageLayout
      title="User Management"
      description="Quản lý tài khoản đăng nhập dashboard, phân quyền system/user và khóa truy cập khi cần."
      actions={
        <button
          onClick={() => void loadUsers()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
          style={{ color: 'var(--on-surface)', borderColor: 'var(--outline-variant)' }}
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      }
    >

      <div className="grid gap-4 md:grid-cols-3">
        <div className="bento-card rounded-xl p-5">
          <UsersRound size={20} style={{ color: 'var(--secondary)' }} />
          <div className="mt-3 text-2xl font-semibold" style={{ color: 'var(--on-surface)' }}>{users.length}</div>
          <div className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>Tổng user</div>
        </div>
        <div className="bento-card rounded-xl p-5">
          <ShieldCheck size={20} style={{ color: 'var(--secondary)' }} />
          <div className="mt-3 text-2xl font-semibold" style={{ color: 'var(--on-surface)' }}>{totalSystem}</div>
          <div className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>System admin</div>
        </div>
        <div className="bento-card rounded-xl p-5">
          <UserPlus size={20} style={{ color: 'var(--secondary)' }} />
          <div className="mt-3 text-2xl font-semibold" style={{ color: 'var(--on-surface)' }}>{totalActive}</div>
          <div className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>Đang hoạt động</div>
        </div>
      </div>

      <div className="bento-card rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <UserPlus size={20} />
          <h3 className="text-lg font-semibold" style={{ color: 'var(--on-surface)' }}>Tạo user mới</h3>
        </div>
        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr_160px_140px_auto]">
          <input
            className="px-4 py-2 rounded-lg border outline-none"
            style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
            value={createForm.email}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, email: event.target.value }))}
            placeholder="email@example.com"
          />
          <input
            className="px-4 py-2 rounded-lg border outline-none"
            style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
            type="password"
            value={createForm.password}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, password: event.target.value }))}
            placeholder="Mật khẩu"
          />
          <select
            className="px-4 py-2 rounded-lg border outline-none"
            style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
            value={createForm.role}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, role: event.target.value }))}
          >
            <option value="creator">Content Creator (CREATOR)</option>
            <option value="system">System Admin (SYSTEM_ADMIN)</option>
          </select>
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--outline-variant)' }}>
            <input
              type="checkbox"
              checked={createForm.is_active}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, is_active: event.target.checked }))}
            />
            Active
          </label>
          <button
            onClick={() => void handleCreateUser()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--primary)', color: 'var(--on-primary)' }}
          >
            <UserPlus size={16} />
            Tạo
          </button>
        </div>
      </div>

      <div className="bento-card rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ backgroundColor: 'var(--surface-container-low)' }}>
              <tr className="text-left" style={{ color: 'var(--on-surface-variant)' }}>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Trạng thái</th>
                <th className="px-5 py-3 font-medium text-right">Tokens đã dùng</th>
                <th className="px-5 py-3 font-medium text-right">Chi phí AI ($)</th>
                <th className="px-5 py-3 font-medium">Ngày tạo</th>
                <th className="px-5 py-3 font-medium text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isSelf = user.id === currentUser.id
                const primaryRole = hasSystemRole(user.roles) ? 'system' : 'user'
                return (
                  <tr key={user.id} className="border-t" style={{ borderColor: 'var(--outline-variant)' }}>
                    <td className="px-5 py-4">
                      <div className="font-medium" style={{ color: 'var(--on-surface)' }}>{user.email}</div>
                      {isSelf && <div className="text-xs mt-1" style={{ color: 'var(--on-surface-variant)' }}>Tài khoản hiện tại</div>}
                    </td>
                    <td className="px-5 py-4">
                      <select
                        className="px-3 py-2 rounded-lg border outline-none"
                        style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
                        value={primaryRole}
                        onChange={(event) => void handleChangeRole(user, event.target.value)}
                        disabled={loading}
                      >
                        <option value="creator">Content Creator (CREATOR)</option>
                        <option value="system">System Admin (SYSTEM_ADMIN)</option>
                      </select>
                    </td>
                    <td className="px-5 py-4">
                      <button
                        onClick={() => void handleToggleActive(user)}
                        disabled={loading || isSelf}
                        className="px-3 py-1.5 rounded-full text-xs font-semibold disabled:opacity-50"
                        style={{
                          backgroundColor: user.is_active ? 'rgba(0,164,114,0.12)' : 'rgba(185,28,28,0.12)',
                          color: user.is_active ? 'rgb(0,120,83)' : 'rgb(185,28,28)',
                        }}
                      >
                        {user.is_active ? 'Active' : 'Locked'}
                      </button>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="font-medium" style={{ color: 'var(--on-surface)' }}>
                        {usageSummary[user.id]?.total_tokens?.toLocaleString() || 0}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="font-semibold text-emerald-600">
                        ${usageSummary[user.id]?.total_cost_usd?.toFixed(4) || '0.0000'}
                      </div>
                    </td>
                    <td className="px-5 py-4" style={{ color: 'var(--on-surface-variant)' }}>
                      {new Date(user.created_at).toLocaleString()}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => void handleResetPassword(user)}
                          disabled={loading}
                          className="px-3 py-2 rounded-lg border text-sm font-medium disabled:opacity-50"
                          style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface)' }}
                        >
                          Đổi mật khẩu
                        </button>
                        <button
                          onClick={() => void handleDeleteUser(user)}
                          disabled={loading || isSelf}
                          className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border text-sm font-medium disabled:opacity-50"
                          style={{ borderColor: 'rgba(185,28,28,0.35)', color: 'rgb(185,28,28)' }}
                        >
                          <Trash2 size={14} />
                          Xóa
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {users.length === 0 && (
                <tr>
                  <td className="px-5 py-8 text-center" colSpan={5} style={{ color: 'var(--on-surface-variant)' }}>
                    Chưa có user nào.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PageLayout>
  )
}
