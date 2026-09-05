import { useEffect, useState } from 'react'
import { FileText, AlignLeft, Activity, Star, Link, Globe, Lock } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from '@/commons/component/ui/dialog'
import { updateAdminContentItemApi, type AdminContentItem } from '@/commons/apis/adminContents'
import { cn } from '@/commons/lib/utils'

const CONTENT_STATUSES = [
  { value: 'NEEDS_REVIEW', label: 'Chờ duyệt', color: 'text-amber-700 bg-amber-50 ring-amber-200' },
  { value: 'APPROVED', label: 'Đã duyệt', color: 'text-emerald-700 bg-emerald-50 ring-emerald-200' },
  { value: 'REJECTED', label: 'Từ chối', color: 'text-rose-700 bg-rose-50 ring-rose-200' },
  { value: 'ARCHIVED', label: 'Lưu trữ', color: 'text-slate-600 bg-slate-100 ring-slate-200' },
  { value: 'PROCESSING', label: 'Đang xử lý', color: 'text-blue-700 bg-blue-50 ring-blue-200' },
]

type EditContentItemDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: AdminContentItem | null
  onSuccess: () => void
}

type EditForm = {
  canonical_title: string
  summary: string
  status: string
  quality_score: string
}

const statusMeta = (status: string) =>
  CONTENT_STATUSES.find((s) => s.value === status) ?? {
    value: status,
    label: status,
    color: 'text-slate-600 bg-slate-100 ring-slate-200',
  }

const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('vi-VN') : '—'

export default function EditContentItemDialog({
  open,
  onOpenChange,
  item,
  onSuccess,
}: EditContentItemDialogProps) {
  const [form, setForm] = useState<EditForm>({
    canonical_title: '',
    summary: '',
    status: 'NEEDS_REVIEW',
    quality_score: '0',
  })
  const [loading, setLoading] = useState(false)
  const [scoreError, setScoreError] = useState('')

  useEffect(() => {
    if (item) {
      setForm({
        canonical_title: item.canonical_title,
        summary: item.summary ?? '',
        status: item.status,
        quality_score: String(item.quality_score ?? 0),
      })
      setScoreError('')
    }
  }, [item])

  const validateScore = (raw: string) => {
    const n = parseFloat(raw)
    if (raw.trim() === '' || isNaN(n)) return 'Điểm chất lượng phải là số'
    if (n < 0 || n > 100) return 'Điểm phải trong khoảng 0 – 100'
    return ''
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!item) return

    if (!form.canonical_title.trim()) {
      toast.error('Tiêu đề không được để trống')
      return
    }

    const scoreErr = validateScore(form.quality_score)
    if (scoreErr) {
      setScoreError(scoreErr)
      return
    }

    setLoading(true)
    try {
      await updateAdminContentItemApi(item.id, {
        canonical_title: form.canonical_title.trim(),
        summary: form.summary.trim() || null,
        status: form.status,
        quality_score: parseFloat(form.quality_score),
      })
      toast.success('Đã cập nhật nội dung.')
      onOpenChange(false)
      onSuccess()
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Không thể cập nhật nội dung')
    } finally {
      setLoading(false)
    }
  }

  if (!item) return null

  const currentStatus = statusMeta(item.status)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
              <FileText size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="text-lg font-bold leading-tight text-slate-900">
                  Chỉnh sửa nội dung
                </DialogTitle>
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ring-1',
                    currentStatus.color,
                  )}
                >
                  {currentStatus.label}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                  {item.content_scope === 'GLOBAL' ? (
                    <Globe size={11} />
                  ) : (
                    <Lock size={11} />
                  )}
                  {item.content_scope}
                </span>
              </div>
              <p className="mt-1 line-clamp-1 text-xs text-slate-500">ID: {item.id}</p>
            </div>
          </div>
          <DialogDescription className="mt-2 text-sm text-slate-500">
            Hiệu chỉnh tiêu đề canonical, tóm tắt, trạng thái và điểm chất lượng.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <DialogBody className="space-y-5">
            {/* Metadata strip */}
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs">
              <div>
                <span className="font-bold uppercase tracking-wider text-slate-400">Loại</span>
                <p className="mt-0.5 font-semibold text-slate-700">{item.content_type}</p>
              </div>
              <div>
                <span className="font-bold uppercase tracking-wider text-slate-400">Nguồn</span>
                <p className="mt-0.5 font-semibold text-slate-700">{item.source_type ?? '—'}</p>
              </div>
              <div>
                <span className="font-bold uppercase tracking-wider text-slate-400">Ngôn ngữ</span>
                <p className="mt-0.5 font-semibold text-slate-700">{item.language.toUpperCase()}</p>
              </div>
              <div>
                <span className="font-bold uppercase tracking-wider text-slate-400">Tạo lúc</span>
                <p className="mt-0.5 font-semibold text-slate-700">{formatDate(item.created_at)}</p>
              </div>
            </div>

            {/* Canonical URL (read-only) */}
            {item.canonical_url && (
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <Link size={12} /> URL nguồn
                </label>
                <a
                  href={item.canonical_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-blue-600 hover:underline"
                >
                  {item.canonical_url}
                </a>
              </div>
            )}

            {/* Canonical title */}
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                <FileText size={12} /> Tiêu đề Canonical{' '}
                <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                maxLength={500}
                disabled={loading}
                value={form.canonical_title}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, canonical_title: e.target.value }))
                }
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 hover:border-slate-300 disabled:opacity-50"
                placeholder="Nhập tiêu đề chính xác của nội dung…"
              />
            </div>

            {/* Summary */}
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                <AlignLeft size={12} /> Tóm tắt
              </label>
              <textarea
                rows={4}
                maxLength={2000}
                disabled={loading}
                value={form.summary}
                onChange={(e) => setForm((prev) => ({ ...prev, summary: e.target.value }))}
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition-all placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 hover:border-slate-300 disabled:opacity-50"
                placeholder="Tóm tắt ngắn gọn nội dung bài viết…"
              />
              <p className="mt-1 text-right text-xs text-slate-400">
                {form.summary.length}/2000
              </p>
            </div>

            {/* Status + Quality score side by side */}
            <div className="grid grid-cols-2 gap-4">
              {/* Status */}
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <Activity size={12} /> Trạng thái{' '}
                  <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  disabled={loading}
                  value={form.status}
                  onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                  className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition-all focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 hover:border-slate-300 disabled:opacity-50"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                    backgroundPosition: 'right 0.75rem center',
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: '1.2em 1.2em',
                  }}
                >
                  {CONTENT_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Quality score */}
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <Star size={12} /> Điểm chất lượng{' '}
                  <span className="text-slate-400">(0–100)</span>
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  disabled={loading}
                  value={form.quality_score}
                  onChange={(e) => {
                    setForm((prev) => ({ ...prev, quality_score: e.target.value }))
                    setScoreError(validateScore(e.target.value))
                  }}
                  className={cn(
                    'w-full rounded-xl border bg-slate-50/50 px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition-all placeholder:text-slate-400 hover:border-slate-300 disabled:opacity-50',
                    scoreError
                      ? 'border-rose-400 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10'
                      : 'border-slate-200 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10',
                  )}
                  placeholder="0 – 100"
                />
                {scoreError && (
                  <p className="mt-1 text-xs font-semibold text-rose-600">{scoreError}</p>
                )}
              </div>
            </div>
          </DialogBody>

          <DialogFooter className="flex items-center justify-end gap-3">
            <button
              type="button"
              disabled={loading}
              onClick={() => onOpenChange(false)}
              className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading || !!scoreError}
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95 disabled:opacity-50"
            >
              {loading ? 'Đang lưu…' : 'Lưu thay đổi'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
