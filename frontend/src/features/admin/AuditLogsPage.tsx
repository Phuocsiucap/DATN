import { ListPagination } from '@/commons/component/ui/list-pagination'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/commons/component/ui/table'
import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import {
  CalendarDays,
  ChevronDown,
  FilterX,
  RefreshCw,
  ScrollText,
} from 'lucide-react'

import {
  fetchAdminAuditLogsApi,
  type AuditActor,
  type AuditLogItem,
  type AuditLogList,
} from '@/commons/apis/auditLogs'
import {
  AppButton,
  DateInput,
  PageLayout,
  SearchField,
} from '@/commons/component/social-ui'
import { cn } from '@/commons/lib/utils'

const EMPTY_RESULT: AuditLogList = {
  items: [],
  pagination: { page: 1, limit: 25, total: 0, totalPages: 1 },
}

const ACTION_LABELS: Record<string, string> = {
  'content_series.created': 'Tạo series nội dung',
  'content_series.updated': 'Cập nhật series nội dung',
  'content_series.deleted': 'Xóa series nội dung',
  'content_series.context_rebuilt': 'Tạo lại ngữ cảnh series',
  'crawl_job.created': 'Tạo crawl job',
  'crawl_job.schedule_updated': 'Cập nhật lịch crawl',
  'crawl_job.cancelled': 'Hủy crawl job',
  'crawl_job.retry': 'Chạy lại crawl job',
  'crawl_job.publish_failed': 'Phát sự kiện crawl thất bại',
  'scheduler.settings_updated': 'Cập nhật scheduler',
  'scheduler.started': 'Khởi động scheduler',
  'scheduler.stopped': 'Dừng scheduler',
  'scheduler.run_once': 'Chạy publish queue ngay',
  'user.created': 'Tạo người dùng',
  'user.updated': 'Cập nhật người dùng',
  'user.deleted': 'Xóa người dùng',
}

const TARGET_LABELS: Record<string, string> = {
  content_series: 'Series nội dung',
  crawl_job: 'Crawl job',
  scheduler: 'Scheduler',
  system_setting: 'Cấu hình hệ thống',
  user: 'Người dùng',
}

const actionLabel = (action: string) => ACTION_LABELS[action] || action.replace(/[._]/g, ' ')
const targetLabel = (target?: string | null) => target ? TARGET_LABELS[target] || target.replace(/_/g, ' ') : 'Hệ thống'

const actionTone = (action: string) => {
  if (/(deleted|cancelled|stopped|failed)$/.test(action)) return 'border-rose-200 bg-rose-50 text-rose-700'
  if (/(updated|retry|rebuilt)$/.test(action)) return 'border-amber-200 bg-amber-50 text-amber-700'
  if (/(created|started)$/.test(action)) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return 'border-indigo-200 bg-indigo-50 text-indigo-700'
}

const actorName = (actor?: AuditActor | null) => actor?.full_name?.trim() || actor?.email || 'Hệ thống'

const actorInitials = (actor?: AuditActor | null) => actorName(actor)
  .split(/\s+/)
  .map((part) => part[0])
  .join('')
  .slice(0, 2)
  .toUpperCase()

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Không rõ thời gian'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

const dateBoundary = (value: string, endOfDay = false) => {
  if (!value) return undefined
  const time = endOfDay ? '23:59:59.999' : '00:00:00.000'
  return new Date(`${value}T${time}`).toISOString()
}

const errorMessage = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { detail?: string; message?: string } | undefined
    return data?.detail || data?.message || 'Không thể tải nhật ký hệ thống'
  }
  return 'Không thể tải nhật ký hệ thống'
}

export default function AuditLogsPage() {
  const [result, setResult] = useState<AuditLogList>(EMPTY_RESULT)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [refreshKey, setRefreshKey] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const requestSequence = useRef(0)

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 350)
    return () => window.clearTimeout(timeout)
  }, [search])

  useEffect(() => {
    const sequence = ++requestSequence.current
    void fetchAdminAuditLogsApi({
        page,
        page_size: pageSize,
        search: debouncedSearch || undefined,
        created_from: dateBoundary(startDate),
        created_to: dateBoundary(endDate, true),
      })
      .then((data) => {
        if (sequence !== requestSequence.current) return
        setResult(data)
        setError('')
      })
      .catch((requestError: unknown) => {
        if (sequence === requestSequence.current) setError(errorMessage(requestError))
      })
      .finally(() => {
        if (sequence === requestSequence.current) setLoading(false)
      })
  }, [debouncedSearch, endDate, page, pageSize, refreshKey, startDate])

  const hasFilters = Boolean(search || startDate || endDate)
  const range = useMemo(() => {
    if (!result.pagination.total) return '0 bản ghi'
    const first = (result.pagination.page - 1) * result.pagination.limit + 1
    const last = Math.min(result.pagination.page * result.pagination.limit, result.pagination.total)
    return `${first}–${last} / ${result.pagination.total} bản ghi`
  }, [result.pagination.page, result.pagination.limit, result.pagination.total])

  const resetFilters = () => {
    setLoading(true)
    setError('')
    setSearch('')
    setDebouncedSearch('')
    setStartDate('')
    setEndDate('')
    setPage(1)
  }

  const updateFilter = (setter: (value: string) => void, value: string) => {
    setLoading(true)
    setError('')
    setter(value)
    setPage(1)
  }

  const refresh = () => {
    setLoading(true)
    setError('')
    setRefreshKey((value) => value + 1)
  }

  return (
    <PageLayout
      title="Nhật ký hệ thống"
      description="Theo dõi ai đã thực hiện thao tác gì, trên đối tượng nào và vào thời điểm nào."
      actions={
        <AppButton
          variant="secondary"
          icon={<RefreshCw size={16} className={cn(loading && 'animate-spin')} />}
          disabled={loading}
          onClick={refresh}
        >
          Làm mới
        </AppButton>
      }
    >
      <section className="app-list-panel app-table-card border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <SearchField
              value={search}
              onChange={(value) => updateFilter(setSearch, value)}
              placeholder="Tìm email, hành động, ID hoặc metadata..."
              className="min-w-0 flex-1"
            />
            <div className="flex flex-wrap items-center gap-2">
              <DateInput
                label="Từ"
                value={startDate}
                max={endDate || undefined}
                onChange={(value) => updateFilter(setStartDate, value)}
              />
              <DateInput
                label="Đến"
                value={endDate}
                min={startDate || undefined}
                onChange={(value) => updateFilter(setEndDate, value)}
              />
              {hasFilters && (
                <AppButton 
                  variant="ghost" 
                  icon={<FilterX size={15} />} 
                  onClick={resetFilters}
                  className="h-9"
                >
                  Xóa lọc
                </AppButton>
              )}
            </div>
          </div>
        </div>

        <div className="app-list-scroll">
        {error ? (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-rose-50 text-rose-600">
              <ScrollText size={26} />
            </div>
            <h2 className="mt-4 text-base font-black text-slate-900">Không tải được nhật ký</h2>
            <p className="mt-1 text-sm font-medium text-rose-600">{error}</p>
            <AppButton className="mt-5" variant="secondary" onClick={refresh}>
              Thử lại
            </AppButton>
          </div>
        ) : !loading && result.items.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-500">
              <ScrollText size={26} />
            </div>
            <h2 className="mt-4 text-base font-black text-slate-900">Chưa có nhật ký phù hợp</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {hasFilters ? 'Hãy thay đổi hoặc xóa bộ lọc để xem thêm kết quả.' : 'Các thao tác có hỗ trợ audit sẽ xuất hiện tại đây.'}
            </p>
          </div>
        ) : (
          <div>
            <Table className="w-full min-w-[980px] text-left text-sm">
              <TableHeader className="bg-slate-50/80">
                <TableRow>
                  <TableHead className="px-5 py-2.5 text-xs font-black uppercase tracking-wider text-slate-500">Thời gian</TableHead>
                  <TableHead className="px-5 py-2.5 text-xs font-black uppercase tracking-wider text-slate-500">Người thao tác</TableHead>
                  <TableHead className="px-5 py-2.5 text-xs font-black uppercase tracking-wider text-slate-500">Hành động</TableHead>
                  <TableHead className="px-5 py-2.5 text-xs font-black uppercase tracking-wider text-slate-500">Đối tượng</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-slate-100">
                {loading && result.items.length === 0 ? (
                  <LoadingRows />
                ) : result.items.map((item) => (
                  <AuditRow
                    key={item.id}
                    item={item}
                    expanded={expandedId === item.id}
                    onToggle={() => setExpandedId((value) => value === item.id ? null : item.id)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        </div>
          <div className="app-list-footer">
            <div className="flex items-center gap-3 text-sm font-semibold text-slate-600">
              <span>{range}</span>
              <label className="relative">
                <select data-filter-control
                  value={pageSize}
                  onChange={(event) => {
                    setLoading(true)
                    setError('')
                    setPageSize(Number(event.target.value))
                    setPage(1)
                  }}
                  className="h-9 appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 text-xs font-bold text-slate-700 outline-none focus:border-indigo-400"
                >
                  <option value={25}>25 / trang</option>
                  <option value={50}>50 / trang</option>
                  <option value={100}>100 / trang</option>
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              </label>
            </div>
            <ListPagination page={page} totalPages={error ? 1 : result.pagination.totalPages} loading={loading || !!error} onPageChange={(nextPage) => { setLoading(true); setError(''); setPage(nextPage) }} />
          </div>
      </section>
    </PageLayout>
  )
}

function AuditRow({ item, expanded, onToggle }: { item: AuditLogItem; expanded: boolean; onToggle: () => void }) {
  const hasMetadata = Object.keys(item.metadata || {}).length > 0
  return (
    <>
      <TableRow 
        onClick={onToggle}
        className={cn(
          'cursor-pointer transition-colors hover:bg-indigo-50/40',
          expanded && 'bg-indigo-50/50'
        )}
      >
        <TableCell className="whitespace-nowrap px-5 py-2.5 align-top font-semibold text-slate-600">
          <div className="flex items-center gap-2">
            <CalendarDays size={14} className="text-slate-400" />
            {formatDateTime(item.created_at)}
          </div>
        </TableCell>
        <TableCell className="px-5 py-2.5 align-top">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 text-xs font-black text-white">
              {actorInitials(item.actor)}
            </span>
            <span className="min-w-0">
              <span className="block max-w-[220px] truncate font-bold text-slate-900">{actorName(item.actor)}</span>
              {item.actor?.full_name && <span className="block max-w-[220px] truncate text-xs font-medium text-slate-500">{item.actor.email}</span>}
            </span>
          </div>
        </TableCell>
        <TableCell className="px-5 py-2.5 align-top">
          <span className={cn('inline-flex rounded-lg border px-2.5 py-1 text-xs font-black', actionTone(item.action))}>
            {actionLabel(item.action)}
          </span>
          <span className="mt-1 block font-mono text-[11px] text-slate-400">{item.action}</span>
        </TableCell>
        <TableCell className="px-5 py-2.5 align-top">
          <div className="font-bold text-slate-800">{targetLabel(item.target_type)}</div>
          <div className="mt-0.5 max-w-[260px] truncate font-mono text-xs text-slate-500" title={item.target_id || undefined}>
            {item.target_id || '—'}
          </div>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="bg-slate-50/70">
          <TableCell colSpan={4} className="px-5 py-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-black uppercase tracking-wider text-slate-500">Thông tin truy vết</div>
                <dl className="mt-3 space-y-2 text-xs">
                  <TraceField label="Log ID" value={item.id} />
                  <TraceField label="Actor ID" value={item.actor_id || 'Hệ thống'} />
                  <TraceField label="Target ID" value={item.target_id || 'Không có'} />
                </dl>
              </div>
              <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-950 p-4 text-slate-100">
                <div className="text-xs font-black uppercase tracking-wider text-slate-400">Metadata</div>
                {hasMetadata ? (
                  <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-5">{JSON.stringify(item.metadata, null, 2)}</pre>
                ) : (
                  <p className="mt-3 text-xs font-medium text-slate-400">Không có metadata bổ sung.</p>
                )}
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

function TraceField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[74px_minmax(0,1fr)] gap-2">
      <dt className="font-bold text-slate-500">{label}</dt>
      <dd className="break-all font-mono text-slate-700">{value}</dd>
    </div>
  )
}

function LoadingRows() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((row) => (
        <TableRow key={row} className="animate-pulse">
          {[0, 1, 2, 3].map((column) => (
            <TableCell key={column} className="px-5 py-3">
              <div className="h-4 rounded bg-slate-100" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}
