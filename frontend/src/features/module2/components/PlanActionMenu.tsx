import React, { useState, useRef, useEffect } from 'react'
import { MoreVertical, Layers3, ExternalLink, RefreshCcw } from 'lucide-react'
import type { ContentPlan } from '../../../commons/apis/planning'

interface PlanActionMenuProps {
  plan: ContentPlan
  onOpenReassignModal: (plan: ContentPlan) => void
  onRegenerate: (plan: ContentPlan) => void
  buttonClassName?: string
}

export function PlanActionMenu({
  plan,
  onOpenReassignModal,
  onRegenerate,
  buttonClassName,
}: PlanActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [menuCoords, setMenuCoords] = useState<{ top: number; right: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const updateCoords = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setMenuCoords({
        top: rect.bottom + 4,
        right: Math.max(8, window.innerWidth - rect.right),
      })
    }
  }

  const toggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isOpen) {
      updateCoords()
      setIsOpen(true)
    } else {
      setIsOpen(false)
    }
  }

  useEffect(() => {
    if (!isOpen) return
    const handleScrollOrResize = () => {
      updateCoords()
    }
    window.addEventListener('scroll', handleScrollOrResize, true)
    window.addEventListener('resize', handleScrollOrResize)
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true)
      window.removeEventListener('resize', handleScrollOrResize)
    }
  }, [isOpen])

  const handleOpenOriginalPost = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsOpen(false)
    const url = plan.source_content?.canonical_url || plan.source_content?.source_url
    if (url) {
      window.open(url, '_blank')
    } else {
      alert(`Không tìm thấy đường dẫn bài gốc của "${plan.title}". (Kịch bản này có thể được sinh tự động bởi AI System).`)
    }
  }

  const handleReassignSeries = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsOpen(false)
    onOpenReassignModal(plan)
  }

  const handleRegenerate = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsOpen(false)
    onRegenerate(plan)
  }

  return (
    <div className="inline-block text-left" onClick={(e) => e.stopPropagation()}>
      <button
        ref={buttonRef}
        onClick={toggleMenu}
        className={buttonClassName || "flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 shadow-sm transition-colors"}
        title="Tùy chọn khác (...)"
      >
        <MoreVertical size={15} />
      </button>

      {isOpen && menuCoords && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setIsOpen(false)} />
          <div
            style={{
              position: 'fixed',
              top: `${menuCoords.top}px`,
              right: `${menuCoords.right}px`,
            }}
            className="z-[9999] w-48 rounded-xl border border-slate-200 bg-white py-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100"
          >
            <button
              onClick={handleReassignSeries}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-colors"
            >
              <Layers3 size={15} className="text-blue-500" />
              Đổi Series...
            </button>

            <button
              onClick={handleOpenOriginalPost}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
            >
              <ExternalLink size={15} className="text-emerald-500" />
              Mở bài gốc
            </button>

            <button
              onClick={handleRegenerate}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-amber-50 hover:text-amber-600 transition-colors border-t border-slate-100"
            >
              <RefreshCcw size={15} className="text-amber-500" />
              Tạo lại kịch bản
            </button>
          </div>
        </>
      )}
    </div>
  )
}
