import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, ShieldCheck, Trash2, UserPlus, UsersRound } from 'lucide-react'
import {
  createAdminUserApi,
  deleteAdminUserApi,
  fetchAdminUsersApi,
  updateAdminUserApi,
} from '@/commons/apis/api'

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

export default function UsersPage({ currentUser }: UsersPageProps) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [createForm, setCreateForm] = useState(emptyCreateForm)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const totalActive = useMemo(() => users.filter((user) => user.is_active).length, [users])
  const totalSystem = useMemo(() => users.filter((user) => user.roles.includes('system')).length, [users])

  const loadUsers = async () => {
    setLoading(true)
    setMessage('')
    try {
      const data = await fetchAdminUsersApi()
      setUsers(data.items || [])
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể tải danh sách user')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadUsers()
  }, [])

  const rolePayload = (role: string) => (role === 'system' ? ['system', 'user'] : ['user'])

  const handleCreateUser = async () => {
    setLoading(true)
    setMessage('')
    try {
      await createAdminUserApi({
        email: createForm.email,
        password: createForm.password,
        roles: rolePayload(createForm.role),
        is_active: createForm.is_active,
      })
      setCreateForm(emptyCreateForm)
      await loadUsers()
      setMessage('Đã tạo user mới.')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể tạo user')
    } finally {
      setLoading(false)
    }
  }

  const handleToggleActive = async (user: AdminUser) => {
    setLoading(true)
    setMessage('')
    try {
      await updateAdminUserApi(user.id, { is_active: !user.is_active })
      await loadUsers()
      setMessage(user.is_active ? 'Đã khóa user.' : 'Đã mở khóa user.')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể cập nhật trạng thái')
    } finally {
      setLoading(false)
    }
  }

  const handleChangeRole = async (user: AdminUser, role: string) => {
    setLoading(true)
    setMessage('')
    try {
      await updateAdminUserApi(user.id, { roles: rolePayload(role) })
      await loadUsers()
      setMessage('Đã cập nhật quyền user.')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể cập nhật quyền')
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async (user: AdminUser) => {
    const password = window.prompt(`Nhập mật khẩu mới cho ${user.email}`)
    if (!password) return

    setLoading(true)
    setMessage('')
    try {
      await updateAdminUserApi(user.id, { password })
      await loadUsers()
      setMessage('Đã đổi mật khẩu và thu hồi refresh token cũ.')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể đổi mật khẩu')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteUser = async (user: AdminUser) => {
    const confirmed = window.confirm(`Xóa user ${user.email}?`)
    if (!confirmed) return

    setLoading(true)
    setMessage('')
    try {
      await deleteAdminUserApi(user.id)
      await loadUsers()
      setMessage('Đã xóa user.')
    } catch (error: any) {
      setMessage(error?.response?.data?.detail || 'Không thể xóa user')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--on-surface)' }}>
            User Management
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--on-surface-variant)' }}>
            Quản lý tài khoản đăng nhập dashboard, phân quyền system/user và khóa truy cập khi cần.
          </p>
        </div>
        <button
          onClick={() => void loadUsers()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
          style={{ color: 'var(--on-surface)', borderColor: 'var(--outline-variant)' }}
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {message && (
        <div className="bento-card rounded-xl p-4 text-sm" style={{ color: 'var(--on-surface)' }}>
          {message}
        </div>
      )}

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
            <option value="user">User</option>
            <option value="system">System</option>
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
                <th className="px-5 py-3 font-medium">Ngày tạo</th>
                <th className="px-5 py-3 font-medium text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isSelf = user.id === currentUser.id
                const primaryRole = user.roles.includes('system') ? 'system' : 'user'
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
                        <option value="user">User</option>
                        <option value="system">System</option>
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
    </div>
  )
}
