import { ListPagination } from '@/commons/component/ui/list-pagination'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/commons/component/ui/table'
import { useEffect, useMemo, useState } from 'react'
import {
  RefreshCw,
  ShieldCheck,
  UserPlus,
  UsersRound,
  Search,
  Activity,
  Database,
  Coins,
  FilterX,
  Edit,
  Eye,
  MoreVertical,
  Trash2,
  Power,
  PowerOff,
} from 'lucide-react'
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
import UserDetailsDialog from '../admin/UserDetailsDialog'

type AdminUser = {
  id: string | number
  email: string
  full_name?: string | null
  avatar_url?: string | null
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

  // Filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [filterRole, setFilterRole] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<string>('')

  // Pagination states
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  })

  // Dialog states
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [viewingUserId, setViewingUserId] = useState<string | null>(null)
  const [openMenuUserId, setOpenMenuUserId] = useState<string | null>(null)

  const hasActiveFilters = searchQuery || filterRole || filterStatus !== ''

  const resetFilters = () => {
    setSearchQuery('')
    setFilterRole('')
    setFilterStatus('')
    setPage(1)
  }

  const loadUsers = async (customPage = page, customLimit = limit) => {
    setLoading(true)
    try {
      const activeParam = filterStatus === '' ? undefined : filterStatus === 'active'
      const roleParam = filterRole === 'system' ? 'SYSTEM_ADMIN' : filterRole === 'creator' ? 'CREATOR' : undefined

      const params: AdminUserFilterParams = {
        search: searchQuery,
        role: roleParam,
        is_active: activeParam,
        page: customPage,
        limit: customLimit,
      }

      const [data, usageData] = await Promise.all([
        fetchAdminUsersApi(params),
        fetchUsersAiUsageSummaryApi().catch(() => []),
      ])

      setUsers(data.items || [])
      setPagination(
        data.pagination || {
          page: customPage,
          limit: customLimit,
          total: (data.items || []).length,
          totalPages: 1,
        },
      )

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

  // Load when pagination or filters change
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadUsers(page, limit)
    }, 250)
    return () => clearTimeout(timer)
  }, [page, limit, searchQuery, filterRole, filterStatus])

  return (
    <>
      <PageLayout
        title="User Management"
        description="Quản lý tài khoản truy cập hệ thống, phân quyền và kiểm soát hoạt động."
        actions={
          <button
            onClick={() => void loadUsers(page, limit)}
            disabled={loading}
            className="group relative inline-flex items-center gap-2 overflow-hidden rounded-lg bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm outline-none ring-1 ring-slate-200 transition-all hover:bg-slate-50 hover:shadow-md hover:ring-slate-300 disabled:opacity-50"
          >
            <RefreshCw size={16} className={cn('transition-transform duration-500', loading && 'animate-spin')} />
            <span className="relative z-10">Làm mới dữ liệu</span>
          </button>
        }
      >
        {/* MAIN CONTENT (LIST + ACTIONS) */}
        <div className="app-list-panel app-table-card relative border border-slate-200/60 bg-white shadow-xl shadow-slate-200/40">
          
          {/* Header & Filters */}
          <div className="flex flex-col gap-5 border-b border-slate-100 bg-slate-50/50 p-6 md:p-8">
            {/* <div className="flex justify-end">
              <button
                onClick={() => setShowCreateDialog(true)}
                disabled={loading}
                className="group inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-slate-800 active:scale-95 disabled:opacity-50"
              >
                <UserPlus size={16} className="transition-transform group-hover:scale-110" /> Thêm
              </button>
            </div> */}

            {/* Filter bar */}
            <div className="grid gap-3 md:grid-cols-5 items-center">
              <div className="relative md:col-span-1">
                <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input data-filter-control
                  type="text"
                  placeholder="Tìm theo email hoặc tên..."
                  className="w-full rounded-2xl border-0 bg-white py-3 pl-11 pr-4 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-200 transition-all placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-600"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value)
                    setPage(1)
                  }}
                />
              </div>

              <div className="relative md:col-span-1">
                <ShieldCheck size={16} className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-slate-400" />
                <select data-filter-control
                  className="w-full appearance-none rounded-2xl border-0 bg-white py-3 pl-11 pr-4 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-200 transition-all focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-600"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                    backgroundPosition: 'right 1rem center',
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: '1.2em 1.2em',
                  }}
                  value={filterRole}
                  onChange={(e) => {
                    setFilterRole(e.target.value)
                    setPage(1)
                  }}
                >
                  <option value="">Tất cả vai trò</option>
                  <option value="creator">Creator</option>
                  <option value="system">System Admin</option>
                </select>
              </div>

              <div className="relative md:col-span-1">
                <Activity size={16} className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-slate-400" />
                <select data-filter-control
                  className="w-full appearance-none rounded-2xl border-0 bg-white py-3 pl-11 pr-4 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-200 transition-all focus:bg-white focus:ring-2 focus:ring-inset focus:ring-blue-600"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                    backgroundPosition: 'right 1rem center',
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: '1.2em 1.2em',
                  }}
                  value={filterStatus}
                  onChange={(e) => {
                    setFilterStatus(e.target.value)
                    setPage(1)
                  }}
                >
                  <option value="">Tất cả trạng thái</option>
                  <option value="active">Đang hoạt động</option>
                  <option value="locked">Đã khóa</option>
                </select>
              </div>

              <div className="md:col-span-1">
                <button
                  onClick={resetFilters}
                  disabled={!hasActiveFilters}
                  className={cn(
                    'group flex w-full items-center justify-center gap-2 rounded-2xl py-3 px-4 text-sm font-bold shadow-sm ring-1 transition-all',
                    hasActiveFilters
                      ? 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50 hover:text-slate-900 cursor-pointer'
                      : 'bg-slate-100/60 text-slate-400 opacity-50 ring-slate-200/50 cursor-not-allowed',
                  )}
                >
                  <FilterX size={16} className={cn('transition-transform', hasActiveFilters && 'group-hover:rotate-12')} />
                  <span>Xóa bộ lọc</span>
                </button>
              </div>

              <div className="md:col-span-1">
                <button
                  onClick={() => setShowCreateDialog(true)}
                  disabled={loading}
                  className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 py-3 px-4 text-sm font-bold text-white shadow-sm transition-all hover:bg-slate-800 active:scale-95 disabled:opacity-50"
                >
                  <UserPlus size={16} className="transition-transform group-hover:scale-110" />
                  <span>Thêm</span>
                </button>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="app-list-scroll">
            <Table className="w-full min-w-[800px] text-left text-sm">
              <TableHeader className="bg-white">
                <TableRow>
                  <TableHead className="border-b border-slate-100 px-6 py-5 text-xs font-black uppercase tracking-widest text-slate-400">Tài khoản</TableHead>
                  <TableHead className="border-b border-slate-100 px-6 py-5 text-xs font-black uppercase tracking-widest text-slate-400">Vai trò</TableHead>
                  <TableHead className="border-b border-slate-100 px-6 py-5 text-xs font-black uppercase tracking-widest text-slate-400">Trạng thái</TableHead>
                  <TableHead className="border-b border-slate-100 px-6 py-5 text-right text-xs font-black uppercase tracking-widest text-slate-400">Sử dụng</TableHead>
                  <TableHead className="border-b border-slate-100 px-6 py-5 text-right text-xs font-black uppercase tracking-widest text-slate-400">Ngày tham gia</TableHead>
                  <TableHead className="border-b border-slate-100 px-6 py-5 text-right text-xs font-black uppercase tracking-widest text-slate-400">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-slate-50">
                {users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="px-6 py-24 text-center">
                      <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-slate-50 text-slate-300 ring-1 ring-slate-100">
                        <UsersRound size={40} />
                      </div>
                      <h3 className="text-xl font-black text-slate-900">Không có dữ liệu</h3>
                      <p className="mt-2 text-sm font-medium text-slate-500">
                        Chưa có tài khoản nào hoặc không khớp với bộ lọc của bạn.
                      </p>
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((user) => {
                    const isSelf = user.id === currentUser.id
                    const primaryRole = hasSystemRole(user.roles) ? 'system' : 'creator'
                    const usage = usageSummary[user.id] || {}

                    return (
                      <TableRow 
                        key={user.id} 
                        className="group cursor-pointer transition-all hover:bg-slate-50/80"
                        onClick={() => setViewingUserId(String(user.id))}
                      >
                        <TableCell className="px-6 py-4">
                          <div className="flex items-center gap-4">
                            <div
                              className={cn(
                                'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-black uppercase text-white shadow-sm ring-2 ring-white overflow-hidden',
                                !user.avatar_url && (isSelf
                                  ? 'bg-gradient-to-br from-blue-500 to-indigo-600 shadow-blue-500/20'
                                  : 'bg-gradient-to-br from-slate-400 to-slate-600'),
                              )}
                            >
                              {user.avatar_url
                                ? <img src={user.avatar_url!} alt={user.full_name || user.email} className="h-full w-full object-cover" />
                                : (user.full_name ?? user.email).charAt(0)
                              }
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900">{user.email}</span>
                                {isSelf && (
                                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-blue-700 ring-1 ring-blue-500/20">
                                    Bạn
                                  </span>
                                )}
                              </div>
                              {user.full_name && <div className="mt-0.5 text-xs font-semibold text-slate-500">{user.full_name}</div>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-6 py-4">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-wider ring-1',
                              primaryRole === 'system'
                                ? 'bg-indigo-50 text-indigo-700 ring-indigo-200'
                                : 'bg-slate-50 text-slate-700 ring-slate-200',
                            )}
                          >
                            {primaryRole === 'system' ? 'System Admin' : 'Creator'}
                          </span>
                        </TableCell>
                        <TableCell className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <span className="relative flex h-3 w-3">
                              {user.is_active && (
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                              )}
                              <span
                                className={cn(
                                  'relative inline-flex h-3 w-3 rounded-full',
                                  user.is_active ? 'bg-emerald-500' : 'bg-rose-500',
                                )}
                              ></span>
                            </span>
                            <span className={cn('text-xs font-bold', user.is_active ? 'text-emerald-700' : 'text-rose-700')}>
                              {user.is_active ? 'Active' : 'Locked'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="px-6 py-4 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <div className="inline-flex items-center gap-1.5 font-bold text-slate-700">
                              <Database size={14} className="text-slate-400" />
                              {usage.total_tokens?.toLocaleString() || 0}
                            </div>
                            <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-black tracking-wide text-slate-600">
                              <Coins size={12} />
                              ${usage.total_cost_usd?.toFixed(4) || '0.0000'}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-6 py-4 text-right">
                          <div className="text-sm font-bold text-slate-700">
                            {new Date(user.created_at).toLocaleDateString('vi-VN')}
                          </div>
                          <div className="mt-0.5 text-xs font-semibold text-slate-400">
                            {new Date(user.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </TableCell>
                        <TableCell className="px-6 py-4 text-right">
                          <div className="relative inline-block text-left" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => setOpenMenuUserId(openMenuUserId === String(user.id) ? null : String(user.id))}
                              className="inline-flex items-center justify-center rounded-lg p-2 text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-600"
                            >
                              <MoreVertical size={18} />
                            </button>
                            
                            {openMenuUserId === String(user.id) && (
                              <>
                                <div 
                                  className="fixed inset-0 z-10" 
                                  onClick={() => setOpenMenuUserId(null)}
                                />
                                <div className="absolute right-0 z-20 mt-2 w-48 origin-top-right rounded-lg border border-slate-200 bg-white shadow-xl">
                                  <div className="py-1">
                                    <button
                                      onClick={() => {
                                        setViewingUserId(String(user.id))
                                        setOpenMenuUserId(null)
                                      }}
                                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                                    >
                                      <Eye size={16} className="text-blue-500" />
                                      <span>Xem chi tiết</span>
                                    </button>
                                    <button
                                      onClick={() => {
                                        setEditingUser(user)
                                        setOpenMenuUserId(null)
                                      }}
                                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                                    >
                                      <Edit size={16} className="text-indigo-500" />
                                      <span>Sửa thông tin</span>
                                    </button>
                                    {!isSelf && (
                                      <>
                                        <div className="my-1 border-t border-slate-100" />
                                        <button
                                          onClick={() => {
                                            setOpenMenuUserId(null)
                                            // Toggle active logic will be in dialog
                                            setViewingUserId(String(user.id))
                                          }}
                                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                                        >
                                          {user.is_active ? (
                                            <>
                                              <PowerOff size={16} className="text-orange-500" />
                                              <span>Vô hiệu hóa</span>
                                            </>
                                          ) : (
                                            <>
                                              <Power size={16} className="text-green-500" />
                                              <span>Kích hoạt</span>
                                            </>
                                          )}
                                        </button>
                                        <button
                                          onClick={() => {
                                            setOpenMenuUserId(null)
                                            // Delete logic will be in dialog
                                            setViewingUserId(String(user.id))
                                          }}
                                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
                                        >
                                          <Trash2 size={16} />
                                          <span>Xóa tài khoản</span>
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Bar */}
          <div className="app-list-footer">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <span>Hiển thị</span>
              <select data-filter-control
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value))
                  setPage(1)
                }}
                className="rounded-lg border-0 bg-white py-1.5 pl-3 pr-7 text-xs font-bold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-blue-600"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                  backgroundPosition: 'right 0.5rem center',
                  backgroundRepeat: 'no-repeat',
                  backgroundSize: '1em 1em',
                }}
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
              <span>trên tổng số <strong className="text-slate-900">{pagination.total}</strong> tài khoản</span>
            </div>

            <ListPagination page={page} totalPages={pagination.totalPages} loading={loading} onPageChange={setPage} />
          </div>

        </div>
      </PageLayout>

      {/* Dialogs */}
      <CreateUserDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} onSuccess={() => void loadUsers(page, limit)} />
      <EditUserDialog
        open={!!editingUser}
        onOpenChange={(open) => !open && setEditingUser(null)}
        user={editingUser}
        currentUserId={currentUser.id}
        onSuccess={() => void loadUsers(page, limit)}
      />
      <UserDetailsDialog
        userId={viewingUserId || ''}
        isOpen={!!viewingUserId}
        onClose={() => setViewingUserId(null)}
        onEdit={(userId) => {
          setViewingUserId(null)
          const user = users.find(u => String(u.id) === userId)
          if (user) setEditingUser(user)
        }}
        onDataChanged={() => void loadUsers(page, limit)}
        currentUserId={String(currentUser.id)}
      />
    </>
  )
}
