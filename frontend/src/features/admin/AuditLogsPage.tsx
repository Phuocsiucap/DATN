import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import {
  Activity,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FilterX,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  UserRound,
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
  SelectControl,
} from '@/commons/component/social-ui'
import { cn } from '@/commons/lib/utils'

const EMPTY_RESULT: AuditLogList = {
  items: [],
  page: 1,
  page_size: 25,
  total: 0,
  total_pages: 0,
  summary: { unique_actors: 0, unique_actions: 0 },
  filters: { actors: [], actions: [], target_types: [] },
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
  const [actorId, setActorId] = useState('')
  const [action, setAction] = useState('')
  const [targetType, setTargetType] = useState('')
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
        actor_id: actorId || undefined,
        action: action || undefined,
        target_type: targetType || undefined,
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
  }, [action, actorId, debouncedSearch, endDate, page, pageSize, refreshKey, startDate, targetType])

  const hasFilters = Boolean(search || actorId || action || targetType || startDate || endDate)
  const range = useMemo(() => {
    if (!result.total) return '0 bản ghi'
    const first = (result.page - 1) * result.page_size + 1
    const last = Math.min(result.page * result.page_size, result.total)
    return `${first}–${last} / ${result.total} bản ghi`
  }, [result.page, result.page_size, result.total])

  const resetFilters = () => {
    setLoading(true)
    setError('')
    setSearch('')
    setDebouncedSearch('')
    setActorId('')
    setAction('')
    setTargetType('')
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
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          icon={<ScrollText size={21} />}
          label={hasFilters ? 'Kết quả phù hợp' : 'Tổng nhật ký'}
          value={result.total.toLocaleString('vi-VN')}
          caption="bản ghi bất biến"
          tone="indigo"
        />
        <SummaryCard
          icon={<UserRound size={21} />}
          label="Người thao tác"
          value={result.summary.unique_actors.toLocaleString('vi-VN')}
          caption="trong kết quả hiện tại"
          tone="blue"
        />
        <SummaryCard
          icon={<Activity size={21} />}
          label="Loại hành động"
          value={result.summary.unique_actions.toLocaleString('vi-VN')}
          caption="trong kết quả hiện tại"
          tone="emerald"
        />
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <SearchField
              value={search}
              onChange={(value) => updateFilter(setSearch, value)}
              placeholder="Tìm email, hành động, ID hoặc metadata..."
              className="min-w-0 flex-1"
            />
            <SelectControl
              value={actorId}
              onChange={(value) => updateFilter(setActorId, value)}
              icon={<UserRound size={15} />}
              className="w-full xl:w-[220px]"
            >
              <option value="">Tất cả người thao tác</option>
              {result.filters.actors.map((actor) => (
                <option key={actor.id} value={actor.id}>{actorName(actor)}</option>
              ))}
            </SelectControl>
            <SelectControl
              value={action}
              onChange={(value) => updateFilter(setAction, value)}
              icon={<Activity size={15} />}
              className="w-full xl:w-[220px]"
            >
              <option value="">Tất cả hành động</option>
              {result.filters.actions.map((value) => (
                <option key={value} value={value}>{actionLabel(value)}</option>
              ))}
            </SelectControl>
            <SelectControl
              value={targetType}
              onChange={(value) => updateFilter(setTargetType, value)}
              icon={<ShieldCheck size={15} />}
              className="w-full xl:w-[205px]"
            >
              <option value="">Tất cả đối tượng</option>
              {result.filters.target_types.map((value) => (
                <option key={value} value={value}>{targetLabel(value)}</option>
              ))}
            </SelectControl>
          </div>

          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row">
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
            </div>
            {hasFilters && (
              <AppButton variant="ghost" icon={<FilterX size={15} />} onClick={resetFilters}>
                Xóa bộ lọc
              </AppButton>
            )}
          </div>
        </div>

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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-slate-50/80">
                <tr>
                  <th className="px-5 py-4 text-xs font-black uppercase tracking-wider text-slate-500">Thời gian</th>
                  <th className="px-5 py-4 text-xs font-black uppercase tracking-wider text-slate-500">Người thao tác</th>
                  <th className="px-5 py-4 text-xs font-black uppercase tracking-wider text-slate-500">Hành động</th>
                  <th className="px-5 py-4 text-xs font-black uppercase tracking-wider text-slate-500">Đối tượng</th>
                  <th className="w-16 px-5 py-4 text-right text-xs font-black uppercase tracking-wider text-slate-500">Chi tiết</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
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
              </tbody>
            </table>
          </div>
        )}

        {!error && result.total > 0 && (
          <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 text-sm font-semibold text-slate-600">
              <span>{range}</span>
              <label className="relative">
                <select
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
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Trang trước"
                disabled={page <= 1 || loading}
                onClick={() => {
                  setLoading(true)
                  setError('')
                  setPage((value) => Math.max(1, value - 1))
                }}
                className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40"
              >
                <ChevronLeft size={17} />
              </button>
              <span className="min-w-24 text-center text-sm font-bold text-slate-700">
                Trang {result.page} / {Math.max(result.total_pages, 1)}
              </span>
              <button
                type="button"
                aria-label="Trang sau"
                disabled={page >= result.total_pages || loading}
                onClick={() => {
                  setLoading(true)
                  setError('')
                  setPage((value) => value + 1)
                }}
                className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40"
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
        )}
      </section>
    </PageLayout>
  )
}

function SummaryCard({
  icon,
  label,
  value,
  caption,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  caption: string
  tone: 'indigo' | 'blue' | 'emerald'
}) {
  const tones = {
    indigo: 'border-indigo-100 bg-indigo-50/60 text-indigo-700',
    blue: 'border-blue-100 bg-blue-50/60 text-blue-700',
    emerald: 'border-emerald-100 bg-emerald-50/60 text-emerald-700',
  }
  return (
    <div className={cn('rounded-2xl border p-5 shadow-sm', tones[tone])}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-wider opacity-75">{label}</div>
          <div className="mt-2 text-3xl font-black text-slate-900">{value}</div>
          <div className="mt-1 text-xs font-semibold opacity-70">{caption}</div>
        </div>
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-white/80 shadow-sm">{icon}</div>
      </div>
    </div>
  )
}

function AuditRow({ item, expanded, onToggle }: { item: AuditLogItem; expanded: boolean; onToggle: () => void }) {
  const hasMetadata = Object.keys(item.metadata || {}).length > 0
  return (
    <>
      <tr className={cn('transition-colors hover:bg-indigo-50/30', expanded && 'bg-indigo-50/40')}>
        <td className="whitespace-nowrap px-5 py-4 align-top font-semibold text-slate-600">
          <div className="flex items-center gap-2">
            <CalendarDays size={14} className="text-slate-400" />
            {formatDateTime(item.created_at)}
          </div>
        </td>
        <td className="px-5 py-4 align-top">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 text-xs font-black text-white">
              {actorInitials(item.actor)}
            </span>
            <span className="min-w-0">
              <span className="block max-w-[220px] truncate font-bold text-slate-900">{actorName(item.actor)}</span>
              {item.actor?.full_name && <span className="block max-w-[220px] truncate text-xs font-medium text-slate-500">{item.actor.email}</span>}
            </span>
          </div>
        </td>
        <td className="px-5 py-4 align-top">
          <span className={cn('inline-flex rounded-lg border px-2.5 py-1 text-xs font-black', actionTone(item.action))}>
            {actionLabel(item.action)}
          </span>
          <span className="mt-1.5 block font-mono text-[11px] text-slate-400">{item.action}</span>
        </td>
        <td className="px-5 py-4 align-top">
          <div className="font-bold text-slate-800">{targetLabel(item.target_type)}</div>
          <div className="mt-1 max-w-[260px] truncate font-mono text-xs text-slate-500" title={item.target_id || undefined}>
            {item.target_id || '—'}
          </div>
        </td>
        <td className="px-5 py-4 text-right align-top">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={expanded ? 'Ẩn chi tiết' : 'Xem chi tiết'}
            className="inline-grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600"
          >
            {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-slate-50/70">
          <td colSpan={5} className="px-5 py-4">
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
          </td>
        </tr>
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
        <tr key={row} className="animate-pulse">
          {[0, 1, 2, 3, 4].map((column) => (
            <td key={column} className="px-5 py-5">
              <div className="h-4 rounded bg-slate-100" />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
