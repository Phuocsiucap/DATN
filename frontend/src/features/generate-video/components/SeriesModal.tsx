import { useState } from 'react'
import { X } from 'lucide-react'
import type { ContentSeries, PlanningProfile } from '@/commons/apis/planning'

type SeriesFormData = {
  title: string
  description?: string
  series_type?: string
  profile_id?: string
  status?: string
}

type SeriesModalProps = {
  seriesToEdit: ContentSeries | null
  profiles: PlanningProfile[]
  onClose: () => void
  onSubmit: (data: SeriesFormData) => void
}

export function SeriesModal({ seriesToEdit, profiles, onClose, onSubmit }: SeriesModalProps) {
  const [title, setTitle] = useState(seriesToEdit?.title || '')
  const [description, setDescription] = useState(seriesToEdit?.description || '')
  const [profileId, setProfileId] = useState(seriesToEdit?.profile_id || profiles[0]?.id || '')
  const [status, setStatus] = useState(seriesToEdit?.status || 'ACTIVE')
  const isEditing = Boolean(seriesToEdit)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-md border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <h3 className="text-base font-black text-slate-900">
            {isEditing ? 'Chỉnh sửa series' : 'Tạo series mới'}
          </h3>
          <button
            type="button"
            title="Đóng"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
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
              series_type: seriesToEdit?.series_type || 'SERIES',
              profile_id: profileId || undefined,
              status,
            })
          }}
          className="mt-4 space-y-4 text-xs"
        >
          <label className="block">
            <span className="mb-1.5 block font-bold text-slate-700">Tên series</span>
            <input
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ví dụ: Bí ẩn Vạn Lý Trường Thành"
              className="h-9 w-full rounded-md border border-slate-300 px-3 font-semibold text-slate-800 outline-none focus:border-blue-500"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block font-bold text-slate-700">Mô tả</span>
            <textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Chủ đề, góc khai thác hoặc phong cách của series"
              className="w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-slate-800 outline-none focus:border-blue-500"
            />
          </label>

          {profiles.length > 0 && (
            <label className="block">
              <span className="mb-1.5 block font-bold text-slate-700">Social profile</span>
              <select
                value={profileId}
                onChange={(event) => setProfileId(event.target.value)}
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 font-semibold text-slate-800 outline-none focus:border-blue-500"
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.profile_name} ({profile.platform})
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
              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 font-semibold text-slate-800 outline-none focus:border-blue-500"
            >
              <option value="ACTIVE">Đang hoạt động</option>
              <option value="COMPLETED">Đã hoàn thành</option>
              <option value="ARCHIVED">Đã lưu trữ</option>
            </select>
          </label>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" onClick={onClose} className="h-8 rounded-md border border-slate-300 px-3 font-bold text-slate-700 hover:bg-slate-50">
              Hủy
            </button>
            <button type="submit" className="h-8 rounded-md bg-blue-700 px-4 font-bold text-white hover:bg-blue-800">
              {isEditing ? 'Lưu thay đổi' : 'Tạo series'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
