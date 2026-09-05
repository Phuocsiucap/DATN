import { useEffect, useState } from 'react'
import {
  RefreshCw,
  Search,
  FilterX,
  Edit,
  LibraryBig,
  Globe,
  Lock,
  ExternalLink,
  Star,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageLayout } from '@/commons/component/social-ui'
import { ListPagination } from '@/commons/component/ui/list-pagination'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/commons/component/ui/table'
import { cn } from '@/commons/lib/utils'
import { fetchAdminContentsApi, type AdminContentItem } from '@/commons/apis/adminContents'
import EditContentItemDialog from './EditContentItemDialog'

// ── Status helpers ─────────────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; color: string }> = {
  NEEDS_REVIEW: { label: 'Chờ duyệt', color: 'bg-amber-50 text-amber-700 ring-amber-200' },
  APPROVED: { label: 'Đã duyệt', color: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  REJECTED: { label: 'Từ chối', color: 'bg-rose-50 text-rose-700 ring-rose-200' },
  ARCHIVED: { label: 'Lưu trữ', color: 'bg-slate-100 text-slate-600 ring-slate-200' },
  PROCESSING: { label: 'Đang xử lý', color: 'bg-blue-50 text-blue-700 ring-blue-200' },
}

const statusMeta = (s: string) =>
  STATUS_META[s] ?? { label: s, color: 'bg-slate-100 text-slate-600 ring-slate-200' }

const CONTENT_TYPES = ['ARTICLE', 'VIDEO', 'IMAGE', 'AUDIO', 'POST']
const CONTENT_SCOPES = ['GLOBAL', 'PRIVATE']
const STATUSES = Object.keys(STATUS_META)

// ── Score badge ────────────────────────────────────────────────────────────────
function ScoreBadge({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score))
  const color =
    pct >= 75
      ? 'text-emerald-700'
      : pct >= 50
        ? 'text-amber-700'
        : 'text-rose-600'
  return (
    <div className="flex flex-col items-end gap-1">
      <span className={cn('text-sm font-black tabular-nums', color)}>
        {pct.toFixed(1)}
      </span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-rose-400',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function AdminContentItemsPage() {
  const [items, setItems] = useState<AdminContentItem[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)

  // Filters
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterScope, setFilterScope] = useState('')
  const [filterType, setFilterType] = useState('')

  // Pagination
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const totalPages = Math.max(1, Math.ceil(total / limit))

  // Edit dialog
  const [editingItem, setEditingItem] = useState<AdminContentItem | null>(null)

  const hasActiveFilters = search || filterStatus || filterScope || filterType

  const resetFilters = () => {
    setSearch('')
    setFilterStatus('')
    setFilterScope('')
    setFilterType('')
    setPage(1)
  }

  const loadItems = async (p = page, l = limit) => {
    setLoading(true)
    try {
      const data = await fetchAdminContentsApi({
        search: search || undefined,
        status: filterStatus || undefined,
        content_scope: filterScope || undefined,
        content_type: filterType || undefined,
        page: p,
        limit: l,
      })
      setItems(data.items)
      setTotal(data.total)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Không thể tải danh sách nội dung')
    } finally {
      setLoading(false)
    }
  }

  // Debounced reload when filters/pagination change
  useEffect(() => {
    const timer = setTimeout(() => void loadItems(page, limit), 250)
    return () => clearTimeout(timer)
  }, [page, limit, search, filterStatus, filterScope, filterType])

  // Reset to page 1 when filters change
  const applyFilter = (setter: (v: string) => void, value: string) => {
    setter(value)
    setPage(1)
  }

  const selectClass =
    'w-full appearance-none rounded-2xl border-0 bg-white py-3 pl-4 pr-8 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-200 transition-all focus:bg-white focus:ring-2 focus:ring-inset focus:ring-indigo-600'
  const selectBg = {
    backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
    backgroundPosition: 'right 0.75rem center',
    backgroundRepeat: 'no-repeat',
    backgroundSize: '1.1em 1.1em',
  }

  return (
    <>
      <PageLayout
        title="Kho nội dung"
        description="Xem và hiệu chỉnh toàn bộ content item trong hệ thống — tiêu đề, tóm tắt, trạng thái, điểm chất lượng."
        actions={
          <button
            onClick={() => void loadItems(page, limit)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 hover:shadow-md hover:ring-slate-300 disabled:opacity-50"
          >
            <RefreshCw size={16} className={cn('transition-transform duration-500', loading && 'animate-spin')} />
            Làm mới
          </button>
        }
      >
        <div className="app-list-panel app-table-card relative border border-slate-200/60 bg-white shadow-xl shadow-slate-200/40">

          {/* Filters */}
          <div className="flex flex-col gap-4 border-b border-slate-100 bg-slate-50/50 p-6 md:p-8">
            <div className="grid gap-3 md:grid-cols-6 items-center">

              {/* Search */}
              <div className="relative md:col-span-2">
                <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Tìm tiêu đề, tóm tắt, URL, ID…"
                  className="w-full rounded-2xl border-0 bg-white py-3 pl-11 pr-4 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-200 transition-all placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-indigo-600"
                  value={search}
                  onChange={(e) => applyFilter(setSearch, e.target.value)}
                />
              </div>

              {/* Status */}
              <div className="md:col-span-1">
                <select
                  className={selectClass}
                  style={selectBg}
                  value={filterStatus}
                  onChange={(e) => applyFilter(setFilterStatus, e.target.value)}
                >
                  <option value="">Tất cả trạng thái</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_META[s].label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Content type */}
              <div className="md:col-span-1">
                <select
                  className={selectClass}
                  style={selectBg}
                  value={filterType}
                  onChange={(e) => applyFilter(setFilterType, e.target.value)}
                >
                  <option value="">Tất cả loại</option>
                  {CONTENT_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {/* Scope */}
              <div className="md:col-span-1">
                <select
                  className={selectClass}
                  style={selectBg}
                  value={filterScope}
                  onChange={(e) => applyFilter(setFilterScope, e.target.value)}
                >
                  <option value="">Tất cả phạm vi</option>
                  {CONTENT_SCOPES.map((sc) => (
                    <option key={sc} value={sc}>{sc}</option>
                  ))}
                </select>
              </div>

              {/* Reset */}
              <div className="md:col-span-1">
                <button
                  onClick={resetFilters}
                  disabled={!hasActiveFilters}
                  className={cn(
                    'flex w-full items-center justify-center gap-2 rounded-2xl py-3 px-4 text-sm font-bold shadow-sm ring-1 transition-all',
                    hasActiveFilters
                      ? 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50 cursor-pointer'
                      : 'bg-slate-100/60 text-slate-400 opacity-50 ring-slate-200/50 cursor-not-allowed',
                  )}
                >
                  <FilterX size={16} className={cn('transition-transform', hasActiveFilters && 'group-hover:rotate-12')} />
                  Xóa bộ lọc
                </button>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="app-list-scroll">
            <Table className="w-full min-w-[900px] text-left text-sm">
              <TableHeader className="bg-white">
                <TableRow>
                  <TableHead className="border-b border-slate-100 px-6 py-5 text-xs font-black uppercase tracking-widest text-slate-400">
                    Nội dung
                  </TableHead>
                  <TableHead className="border-b border-slate-100 px-4 py-5 text-xs font-black uppercase tracking-widest text-slate-400">
                    Loại / Phạm vi
                  </TableHead>
                  <TableHead className="border-b border-slate-100 px-4 py-5 text-xs font-black uppercase tracking-widest text-slate-400">
                    Trạng thái
                  </TableHead>
                  <TableHead className="border-b border-slate-100 px-4 py-5 text-right text-xs font-black uppercase tracking-widest text-slate-400">
                    <span className="inline-flex items-center gap-1"><Star size={12} />Điểm</span>
                  </TableHead>
                  <TableHead className="border-b border-slate-100 px-4 py-5 text-right text-xs font-black uppercase tracking-widest text-slate-400">
                    Ngày tạo
                  </TableHead>
                  <TableHead className="border-b border-slate-100 px-4 py-5 text-right text-xs font-black uppercase tracking-widest text-slate-400">
                    Thao tác
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody className="divide-y divide-slate-50">
                {items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="px-6 py-24 text-center">
                      <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-slate-50 text-slate-300 ring-1 ring-slate-100">
                        <LibraryBig size={40} />
                      </div>
                      <h3 className="text-xl font-black text-slate-900">Không có dữ liệu</h3>
                      <p className="mt-2 text-sm font-medium text-slate-500">
                        Chưa có nội dung nào hoặc không khớp với bộ lọc.
                      </p>
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => {
                    const sm = statusMeta(item.status)
                    return (
                      <TableRow
                        key={item.id}
                        className="group transition-all hover:bg-slate-50/80"
                      >
                        {/* Title + summary */}
                        <TableCell className="px-6 py-4 max-w-xs">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500">
                              <LibraryBig size={15} />
                            </div>
                            <div className="min-w-0">
                              <p
                                className="line-clamp-2 text-sm font-bold text-slate-900"
                                title={item.canonical_title}
                              >
                                {item.canonical_title}
                              </p>
                              {item.summary && (
                                <p className="mt-0.5 line-clamp-1 text-xs font-medium text-slate-500">
                                  {item.summary}
                                </p>
                              )}
                              {item.canonical_url && (
                                <a
                                  href={item.canonical_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-500 hover:underline"
                                >
                                  <ExternalLink size={10} />
                                  {new URL(item.canonical_url).hostname}
                                </a>
                              )}
                            </div>
                          </div>
                        </TableCell>

                        {/* Type / Scope */}
                        <TableCell className="px-4 py-4">
                          <div className="flex flex-col gap-1.5">
                            <span className="inline-flex w-fit items-center rounded-md bg-slate-100 px-2.5 py-1 text-xs font-black uppercase tracking-wide text-slate-700 ring-1 ring-slate-200">
                              {item.content_type}
                            </span>
                            <span className="inline-flex w-fit items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ring-1">
                              {item.content_scope === 'GLOBAL' ? (
                                <><Globe size={10} className="text-indigo-500" /><span className="text-indigo-700">Global</span></>
                              ) : (
                                <><Lock size={10} className="text-slate-500" /><span className="text-slate-600">Private</span></>
                              )}
                            </span>
                          </div>
                        </TableCell>

                        {/* Status */}
                        <TableCell className="px-4 py-4">
                          <span
                            className={cn(
                              'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ring-1',
                              sm.color,
                            )}
                          >
                            {sm.label}
                          </span>
                        </TableCell>

                        {/* Quality score */}
                        <TableCell className="px-4 py-4 text-right">
                          <ScoreBadge score={item.quality_score} />
                        </TableCell>

                        {/* Created at */}
                        <TableCell className="px-4 py-4 text-right">
                          <div className="text-sm font-bold text-slate-700">
                            {new Date(item.created_at).toLocaleDateString('vi-VN')}
                          </div>
                          <div className="mt-0.5 text-xs font-semibold text-slate-400">
                            {new Date(item.created_at).toLocaleTimeString('vi-VN', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="px-4 py-4 text-right">
                          <button
                            onClick={() => setEditingItem(item)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                          >
                            <Edit size={13} />
                            Sửa
                          </button>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination footer */}
          <div className="app-list-footer">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <span>Hiển thị</span>
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value))
                  setPage(1)
                }}
                className="rounded-lg border-0 bg-white py-1.5 pl-3 pr-7 text-xs font-bold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-indigo-600"
                style={selectBg}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span>
                trên tổng số <strong className="text-slate-900">{total}</strong> nội dung
              </span>
            </div>
            <ListPagination page={page} totalPages={totalPages} loading={loading} onPageChange={setPage} />
          </div>

        </div>
      </PageLayout>

      <EditContentItemDialog
        open={!!editingItem}
        onOpenChange={(open) => !open && setEditingItem(null)}
        item={editingItem}
        onSuccess={() => void loadItems(page, limit)}
      />
    </>
  )
}
