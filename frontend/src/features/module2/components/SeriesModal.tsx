import React, { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import type { ContentSeries, PlanningProfile } from '../../../commons/apis/planning'

interface SeriesModalProps {
  isOpen: boolean
  seriesToEdit: ContentSeries | null
  profiles: PlanningProfile[]
  onClose: () => void
  onSubmit: (data: {
    title: string
    description?: string
    series_type?: string
    profile_id?: string
    status?: string
  }) => void
}

export function SeriesModal({
  isOpen,
  seriesToEdit,
  profiles,
  onClose,
  onSubmit,
}: SeriesModalProps) {
  const [title, setTitle] = useState(seriesToEdit?.title || '')
  const [description, setDescription] = useState(seriesToEdit?.description || '')
  const [profileId, setProfileId] = useState(seriesToEdit?.profile_id || profiles[0]?.id || '')
  const [status, setStatus] = useState(seriesToEdit?.status || 'ACTIVE')

  useEffect(() => {
    if (seriesToEdit) {
      setTitle(seriesToEdit.title)
      setDescription(seriesToEdit.description || '')
      setProfileId(seriesToEdit.profile_id || profiles[0]?.id || '')
      setStatus(seriesToEdit.status || 'ACTIVE')
    } else {
      setTitle('')
      setDescription('')
      setProfileId(profiles[0]?.id || '')
      setStatus('ACTIVE')
    }
  }, [seriesToEdit, profiles])

  if (!isOpen) return null

  const isEditing = Boolean(seriesToEdit)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <h3 className="text-base font-black text-[#0f172a]">
            {isEditing ? 'Chỉnh Sửa Series' : 'Thêm Series Mới'}
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
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
          <div>
            <label className="mb-1.5 block font-bold text-slate-700">
              Tên Series <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="VD: Bí Ẩn Vạn Lý Trường Thành"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 focus:border-[#2563eb] focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label className="mb-1.5 block font-bold text-slate-700">Mô tả Series</label>
            <textarea
              rows={3}
              placeholder="Nhập mô tả ngắn gọn về chủ đề hoặc phong cách của Series này..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-[#2563eb] focus:outline-none transition-colors"
            />
          </div>

          {profiles.length > 0 && (
            <div>
              <label className="mb-1.5 block font-bold text-slate-700">Kênh / Social Profile</label>
              <select
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 focus:border-[#2563eb] focus:outline-none bg-white"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.profile_name} ({p.platform})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-1.5 block font-bold text-slate-700">Trạng Thái</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 focus:border-[#2563eb] focus:outline-none bg-white"
            >
              <option value="ACTIVE">ACTIVE (Hoạt động)</option>
              <option value="COMPLETED">COMPLETED (Hoàn thành)</option>
              <option value="ARCHIVED">ARCHIVED (Lưu trữ)</option>
            </select>
          </div>

          <div className="mt-6 flex justify-end gap-2.5 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[#2563eb] px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-[#1d4ed8] transition-colors"
            >
              {isEditing ? 'Lưu Thay Đổi' : 'Tạo Series'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
