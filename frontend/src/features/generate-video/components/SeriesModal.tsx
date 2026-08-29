import { useState } from 'react'
import { ArrowRightLeft, FolderKanban, Plus, X } from 'lucide-react'
import type { ContentSeries, PlanningProfile } from '@/commons/apis/planning'

export type SeriesFormData = {
  title: string
  description?: string
  series_type?: string
  profile_id?: string
  status?: string
  total_parts?: number
  current_part?: number
}

type SeriesModalProps = {
  seriesToEdit: ContentSeries | null
  profiles: PlanningProfile[]
  onClose: () => void
  onSubmit: (data: SeriesFormData) => void
  isSubmitting?: boolean
}

export function SeriesModal({ seriesToEdit, profiles, onClose, onSubmit, isSubmitting = false }: SeriesModalProps) {
  const [title, setTitle] = useState(seriesToEdit?.title || '')
  const [description, setDescription] = useState(seriesToEdit?.description || '')
  const [profileId, setProfileId] = useState(seriesToEdit?.profile_id || seriesToEdit?.profileId || profiles[0]?.id || '')
  const [seriesType, setSeriesType] = useState(seriesToEdit?.series_type || 'NARRATIVE')
  const [status, setStatus] = useState(seriesToEdit?.status || 'ACTIVE')
  const [totalParts, setTotalParts] = useState<number>(seriesToEdit?.total_parts ?? 0)
  const isEditing = Boolean(seriesToEdit)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <FolderKanban size={18} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">
                {isEditing ? 'Chỉnh sửa series' : 'Tạo series mới'}
              </h3>
              <p className="text-[11px] text-slate-500">
                {isEditing ? 'Cập nhật thông tin chuỗi kịch bản' : 'Tạo chủ đề series để nhóm bài viết'}
              </p>
            </div>
          </div>
          <button
            type="button"
            title="Đóng"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={17} />
          </button>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!title.trim()) return
            onSubmit({
              title: title.trim(),
              description: description.trim() || undefined,
              series_type: seriesType,
              profile_id: profileId || undefined,
              status,
              total_parts: Number(totalParts) || 0,
            })
          }}
          className="mt-4 space-y-4 text-xs"
        >
          <label className="block">
            <span className="mb-1.5 block font-bold text-slate-700">Tên series <span className="text-rose-500">*</span></span>
            <input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ví dụ: Bí ẩn Vạn Lý Trường Thành"
              className="h-9 w-full rounded-xl border border-slate-300 px-3 font-semibold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block font-bold text-slate-700">Mô tả series</span>
            <textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Chủ đề, góc khai thác hoặc phong cách triển khai của series..."
              className="w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block font-bold text-slate-700">Loại series</span>
              <select
                value={seriesType}
                onChange={(event) => setSeriesType(event.target.value)}
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 font-semibold text-slate-800 outline-none focus:border-blue-500"
              >
                <option value="NARRATIVE">Tự sự / Truyện (Narrative)</option>
                <option value="SERIES">Chuỗi nội dung (Series)</option>
                <option value="DOCUSERIES">Tài liệu (Docuseries)</option>
                <option value="LISTICLE">Danh sách (Listicle)</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block font-bold text-slate-700">Tổng số part</span>
              <input
                type="number"
                min={0}
                value={totalParts}
                onChange={(event) => setTotalParts(Number(event.target.value))}
                placeholder="0 = Không giới hạn"
                className="h-9 w-full rounded-xl border border-slate-300 px-3 font-semibold text-slate-800 outline-none focus:border-blue-500"
              />
            </label>
          </div>

          {profiles.length > 0 && (
            <label className="block">
              <span className="mb-1.5 block font-bold text-slate-700">Social profile liên kết</span>
              <select
                value={profileId}
                onChange={(event) => setProfileId(event.target.value)}
                className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 font-semibold text-slate-800 outline-none focus:border-blue-500"
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.profile_name} ({profile.platform.toUpperCase()})
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block">
            <span className="mb-1.5 block font-bold text-slate-700">Trạng thái</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="h-9 w-full rounded-xl border border-slate-300 bg-white px-3 font-semibold text-slate-800 outline-none focus:border-blue-500"
            >
              <option value="ACTIVE">Đang hoạt động (Active)</option>
              <option value="COMPLETED">Đã hoàn thành (Completed)</option>
              <option value="ARCHIVED">Đã lưu trữ (Archived)</option>
            </select>
          </label>

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-xl border border-slate-300 px-4 font-bold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="h-9 rounded-xl bg-blue-600 px-5 font-bold text-white shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Đang lưu...' : isEditing ? 'Lưu thay đổi' : 'Tạo series'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

type TransferSeriesModalProps = {
  itemTitle: string
  currentSeriesId?: string | null
  seriesList: ContentSeries[]
  onClose: () => void
  onSubmit: (targetSeriesId: string | null) => void
  onCreateNewSeries?: () => void
  isSubmitting?: boolean
}

export function TransferSeriesModal({
  itemTitle,
  currentSeriesId,
  seriesList,
  onClose,
  onSubmit,
  onCreateNewSeries,
  isSubmitting = false,
}: TransferSeriesModalProps) {
  const [targetId, setTargetId] = useState<string>(currentSeriesId || '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <ArrowRightLeft size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-base font-black text-slate-900">Chuyển bài qua Series khác</h3>
              <p className="mt-0.5 max-w-xs truncate text-xs font-semibold text-slate-500">{itemTitle}</p>
            </div>
          </div>
          <button
            type="button"
            title="Đóng"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-4 p-4 text-xs">
          <label className="block">
            <span className="mb-1.5 block font-bold text-slate-700">Chọn Series đích</span>
            <select
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 font-semibold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="">-- Không thuộc series nào --</option>
              {seriesList.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} {item.status === 'COMPLETED' ? '(Đã xong)' : ''}
                </option>
              ))}
            </select>
          </label>

          {onCreateNewSeries && (
            <button
              type="button"
              onClick={onCreateNewSeries}
              className="inline-flex items-center gap-1.5 justify-self-start font-bold text-blue-600 hover:text-blue-800 hover:underline"
            >
              <Plus size={14} /> Tạo series mới cho bài này
            </button>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-xl border border-slate-200 px-4 font-bold text-slate-600 hover:bg-slate-50"
            >
              Hủy
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => onSubmit(targetId || null)}
              className="h-9 rounded-xl bg-blue-600 px-5 font-bold text-white hover:bg-blue-700 disabled:opacity-50 shadow-sm"
            >
              {isSubmitting ? 'Đang lưu...' : 'Xác nhận chuyển'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

