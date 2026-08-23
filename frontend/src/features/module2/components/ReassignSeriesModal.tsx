import React, { useState, useEffect } from 'react'
import type { ContentPlan, ContentSeries } from '../../../commons/apis/planning'
import { Layers3, X, Check, Link2, Sparkles } from 'lucide-react'

interface ReassignSeriesModalProps {
  isOpen: boolean
  plan: ContentPlan | null
  seriesList: ContentSeries[]
  onClose: () => void
  onConfirm: (plan: ContentPlan, seriesId: string | null) => Promise<void>
}

export function ReassignSeriesModal({
  isOpen,
  plan,
  seriesList,
  onClose,
  onConfirm,
}: ReassignSeriesModalProps) {
  const [selectedSeriesId, setSelectedSeriesId] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (plan) {
      setSelectedSeriesId(plan.series_id || '')
    }
  }, [plan, plan?.series_id])

  if (!isOpen || !plan) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      await onConfirm(plan, selectedSeriesId || null)
      onClose()
    } catch (err) {
      console.error(err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const currentSeries = seriesList.find((s) => s.id === plan.series_id)
  const isChanged = (selectedSeriesId || '') !== (plan.series_id || '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl transition-all">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
              <Layers3 size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Đổi Series Liên Kết</h3>
              <p className="text-xs text-slate-500">Gán hoặc thay đổi chuỗi nội dung cho kịch bản</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Info Block */}
        <div className="my-5 rounded-xl bg-slate-50 p-4 border border-slate-200/80 space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Bài kịch bản</div>
          <div className="text-sm font-bold text-slate-800 line-clamp-2">{plan.title}</div>
          {plan.content_angle && (
            <div className="text-xs text-slate-600 italic">"{plan.content_angle}"</div>
          )}
          
          <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-xs">
            <span className="text-slate-500 font-medium">Trạng thái Series hiện tại:</span>
            <span className="font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
              {currentSeries ? currentSeries.title : 'Độc lập (Chưa thuộc series)'}
            </span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2 flex items-center gap-1.5">
              <Sparkles size={14} className="text-blue-500" /> Chọn Series Mới
            </label>
            <select
              value={selectedSeriesId}
              onChange={(e) => setSelectedSeriesId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none transition-all"
            >
              <option value="">-- Độc lập (Không gán vào Series nào) --</option>
              {seriesList.map((s) => (
                <option key={s.id} value={s.id}>
                  📌 {s.title} ({s.series_type} - {s.total_parts} tập)
                </option>
              ))}
            </select>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !isChanged}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-blue-500/20 transition-all"
            >
              {isSubmitting ? (
                <span>Đang lưu...</span>
              ) : (
                <>
                  <Check size={16} /> Xác nhận đổi Series
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
