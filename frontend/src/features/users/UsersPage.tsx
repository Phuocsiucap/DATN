import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, ShieldCheck, UserPlus, UsersRound, Search, Activity, CheckCircle2, XCircle, Database, Coins, FilterX, Edit } from 'lucide-react'
import { toast } from 'sonner'
import {
  fetchAdminUsersApi,
  fetchUsersAiUsageSummaryApi,
  type AdminUserFilterParams,
} from '@/commons/apis/api'
import { PageLayout } from '@/commons/component/social-ui'
import { cn } from '@/commons/lib/utils'
import CreateUserDialog from './CreateUserDialog'
import EditUserDialog from './EditUserDialog'

type AdminUser = {
  id: string | number
  email: string
  full_name?: string | null
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

const hasSystemRole = (roles: string[]) =>
  roles.some((role) => {
    const normalized = role.toUpperCase()
    return normalized === 'SYSTEM' || normalized === 'SYSTEM_ADMIN' || normalized === 'ADMIN'
  })

export default function UsersPage({ currentUser }: UsersPageProps) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [usageSummary, setUsageSummary] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterRole, setFilterRole] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<string>('')

  // Dialog states
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)

  const totalActive = useMemo(() => users.filter((user) => user.is_active).length, [users])
  const totalSystem = useMemo(() => users.filter((user) => hasSystemRole(user.roles)).length, [users])

  // Client-side filter for instant feedback
  const filteredUsers = useMemo(() => {
    let result = users
    if (searchQuery) {
      const lower = searchQuery.toLowerCase()
      result = result.filter(
        (u) => u.email.toLowerCase().includes(lower) || (u.full_name ?? '').toLowerCase().includes(lower),
      )
    }
    if (filterRole) {
      result = result.filter((u) => (filterRole === 'system' ? hasSystemRole(u.roles) : !hasSystemRole(u.roles)))
    }
    if (filterStatus !== '') {
      const active = filterStatus === 'active'
      result = result.filter((u) => u.is_active === active)
    }
    return result
  }, [users, searchQuery, filterRole, filterStatus])

  const hasActiveFilters = searchQuery || filterRole || filterStatus !== ''

  const resetFilters = () => {
    setSearchQuery('')
    setFilterRole('')
    setFilterStatus('')
  }

  const loadUsers = async (filters?: AdminUserFilterParams) => {
    setLoading(true)
    try {
      const [data, usageData] = await Promise.all([
        fetchAdminUsersApi(filters),
        fetchUsersAiUsageSummaryApi().catch(() => []),
      ])

      setUsers(data.items || [])

      const usageMap: Record<string, any> = {}
      for (const item of usageData || []) {
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

  return (
    <>
      <PageLayout
        title="User Management"
        description="Quản lý tài khoản truy cập hệ thống, phân quyền và kiểm soát hoạt động."
        actions={
          <button
            onClick={() => void loadUsers()}
            disabled={loading}
            className="group relative inline-flex items-center gap-2 overflow-hidden rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm outline-none ring-1 ring-slate-200 transition-all hover:bg-slate-50 hover:shadow-md hover:ring-slate-300 disabled:opacity-50"
          >
            <RefreshCw size={16} className={cn('transition-transform duration-500', loading && 'animate-spin')} />
            <span className="relative z-10">Làm mới dữ liệu</span>
          </button>
        }
      >
        {/* 1. HERO STATS */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="group relative overflow-hidden rounded-3xl border border-blue-100 bg-gradient-to-br from-blue-50/50 to-blue-100/30 p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md">
            <div className="absolute -right-6 -top-6 h-32 w-32 rounded-full bg-blue-500/10 blur-2xl transition-transform duration-500 group-hover:scale-150" />
            <div className="relative flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-blue-600/80">
                  <UsersRound size={14} /> Tổng người dùng
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-4xl font-black tracking-tight text-slate-900">{users.length}</span>
                  <span className="text-sm font-bold text-slate-500">tài khoản</span>
                </div>
              </div>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/30">
                <UsersRound size={28} />
              </div>
            </div>
          </div>

          <div className="group relative overflow-hidden rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50/50 to-purple-100/30 p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md">
            <div className="absolute -right-6 -top-6 h-32 w-32 rounded-full bg-indigo-500/10 blur-2xl transition-transform duration-500 group-hover:scale-150" />
            <div className="relative flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-indigo-600/80">
                  <ShieldCheck size={14} /> System Admin
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-4xl font-black tracking-tight text-slate-900">{totalSystem}</span>
                  <span className="text-sm font-bold text-slate-500">quản trị viên</span>
                </div>
              </div>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/30">
                <ShieldCheck size={28} />
              </div>
            </div>
          </div>

          <div className="group relative overflow-hidden rounded-3xl border border-emerald-100 bg-gradient-to-br from-emerald-50/50 to-teal-100/30 p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md">
            <div className="absolute -right-6 -top-6 h-32 w-32 rounded-full bg-emerald-500/10 blur-2xl transition-transform duration-500 group-hover:scale-150" />
            <div className="relative flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-emerald-600/80">
                  <Activity size={14} /> Đang hoạt động
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-4xl font-black tracking-tight text-slate-900">{totalActive}</span>
                  <span className="text-sm font-bold text-slate-500">tài khoản</span>
                </div>
              </div>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-lg shadow-emerald-500/30">
                <Activity size={28} />
              </div>
            </div>
          </div>
        </div>

        {/* 2. CREATE BUTTON */}
        <div className="overflow-hidden rounded-3xl border border-slate-200/60 bg-white shadow-sm ring-1 ring-slate-900/5">
          <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
                  <UserPlus size={20} />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">Thêm người dùng mới</h3>
                  <p className="text-xs font-medium text-slate-500">Cấp quyền truy cập hệ thống cho thành viên mới.</p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateDialog(true)}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-blue-700 active:scale-95 disabled:opacity-50"
              >
                <UserPlus size={16} /> Tạo tài khoản
              </button>
            </div>
          </div>
        </div>

        {/* 3. USER LIST */}
        <div className="rounded-3xl border border-slate-200/60 bg-white shadow-sm ring-1 ring-slate-900/5">
          <div className="flex flex-col gap-4 border-b border-slate-100 p-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900">Danh sách người dùng</h3>
                <p className="text-sm font-medium text-slate-500">
                  {hasActiveFilters
                    ? `Đang hiển thị ${filteredUsers.length} / ${users.length} tài khoản`
                    : `${users.length} tài khoản trong hệ thống`}
                </p>
              </div>
              {hasActiveFilters && (
                <button
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                >
                  <FilterX size={14} /> Xóa bộ lọc
                </button>
              )}
            </div>

            {/* Filter bar */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="relative sm:col-span-1">
                <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Tìm theo email hoặc tên..."
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm font-semibold text-slate-700 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="relative">
                <ShieldCheck size={15} className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-slate-400" />
                <select
                  className="w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm font-semibold text-slate-700 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                    backgroundPosition: 'right 0.75rem center',
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: '1.1em 1.1em',
                  }}
                  value={filterRole}
                  onChange={(e) => setFilterRole(e.target.value)}
                >
                  <option value="">Tất cả vai trò</option>
                  <option value="creator">Creator</option>
                  <option value="system">System Admin</option>
                </select>
              </div>

              <div className="relative">
                <Activity size={15} className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-slate-400" />
                <select
                  className="w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm font-semibold text-slate-700 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                    backgroundPosition: 'right 0.75rem center',
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: '1.1em 1.1em',
                  }}
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                >
                  <option value="">Tất cả trạng thái</option>
                  <option value="active">Đang hoạt động</option>
                  <option value="locked">Đã khóa</option>
                </select>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50/50">
                <tr>
                  <th className="px-6 py-5 text-xs font-black uppercase tracking-wider text-slate-500">Tài khoản</th>
                  <th className="px-6 py-5 text-xs font-black uppercase tracking-wider text-slate-500">Vai trò</th>
                  <th className="px-6 py-5 text-xs font-black uppercase tracking-wider text-slate-500">Trạng thái</th>
                  <th className="px-6 py-5 text-right text-xs font-black uppercase tracking-wider text-slate-500">
                    Token hệ thống đã dùng
                  </th>
                  <th className="px-6 py-5 text-right text-xs font-black uppercase tracking-wider text-slate-500">Ngày tham gia</th>
                  <th className="px-6 py-5 text-right text-xs font-black uppercase tracking-wider text-slate-500">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-20 text-center">
                      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 text-slate-400">
                        <UsersRound size={32} />
                      </div>
                      <h3 className="text-lg font-black text-slate-900">Không tìm thấy tài khoản</h3>
                      <p className="mt-1 text-sm font-medium text-slate-500">
                        Chưa có dữ liệu hoặc không khớp với từ khóa tìm kiếm.
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => {
                    const isSelf = user.id === currentUser.id
                    const primaryRole = hasSystemRole(user.roles) ? 'system' : 'creator'
                    const usage = usageSummary[user.id] || {}

                    return (
                      <tr key={user.id} className="group transition-colors hover:bg-blue-50/30">
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-3">
                            <div
                              className={cn(
                                'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-black uppercase text-white shadow-sm',
                                isSelf
                                  ? 'bg-gradient-to-br from-blue-500 to-indigo-600'
                                  : 'bg-gradient-to-br from-slate-400 to-slate-600',
                              )}
                            >
                              {(user.full_name ?? user.email).charAt(0)}
                            </div>
                            <div>
                              <div className="flex items-center gap-2 font-bold text-slate-900">
                                {user.email}
                                {isSelf && (
                                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-blue-700">
                                    Tài khoản của bạn
                                  </span>
                                )}
                              </div>
                              {user.full_name && <div className="mt-0.5 text-xs font-semibold text-slate-600">{user.full_name}</div>}
                              <div className="mt-0.5 text-xs font-semibold text-slate-400">ID: {user.id}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-black uppercase tracking-wider',
                              primaryRole === 'system'
                                ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                                : 'border-slate-200 bg-white text-slate-700',
                            )}
                          >
                            {primaryRole === 'system' ? 'SYSTEM ADMIN' : 'CREATOR'}
                          </span>
                        </td>
                        <td className="px-6 py-5">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-wider ring-1',
                              user.is_active
                                ? 'bg-emerald-100 text-emerald-700 ring-emerald-200/50'
                                : 'bg-rose-100 text-rose-700 ring-rose-200/50',
                            )}
                          >
                            {user.is_active ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                            {user.is_active ? 'Active' : 'Locked'}
                          </span>
                        </td>
                        <td className="px-6 py-5 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <div className="inline-flex items-center gap-1 font-black text-slate-700">
                              <Database size={12} className="text-slate-400" />
                              {usage.total_tokens?.toLocaleString() || 0}
                            </div>
                            <div className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-bold text-emerald-600">
                              <Coins size={10} />
                              ${usage.total_cost_usd?.toFixed(4) || '0.0000'}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-5 text-right">
                          <div className="text-sm font-bold text-slate-600">
                            {new Date(user.created_at).toLocaleDateString('vi-VN')}
                          </div>
                          <div className="mt-0.5 text-xs font-semibold text-slate-400">
                            {new Date(user.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </td>
                        <td className="px-6 py-5 text-right">
                          <button
                            onClick={() => setEditingUser(user)}
                            disabled={loading}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                          >
                            <Edit size={14} /> Chỉnh sửa
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </PageLayout>

      {/* Dialogs */}
      <CreateUserDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} onSuccess={() => void loadUsers()} />
      <EditUserDialog
        open={!!editingUser}
        onOpenChange={(open) => !open && setEditingUser(null)}
        user={editingUser}
        currentUserId={currentUser.id}
        onSuccess={() => void loadUsers()}
      />
    </>
  )
}
