import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Square } from 'lucide-react'
import { fetchContentDetailApi } from '@/commons/apis/module1'

const formatDate = (value?: string) => value ? new Date(value).toLocaleString('vi-VN') : '-'

type ContentDetailDialogProps = {
  contentId: string | null
  onClose: () => void
}

export function ContentDetailDialog({ contentId, onClose }: ContentDetailDialogProps) {
  const [contentDetail, setContentDetail] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (contentId) {
      setLoading(true)
      fetchContentDetailApi(contentId)
        .then(setContentDetail)
        .catch(console.error)
        .finally(() => setLoading(false))
    } else {
      setContentDetail(null)
    }
  }, [contentId])

  if (!contentId) return null

  const dialogContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6" style={{ backgroundColor: 'rgba(9,20,38,0.5)' }}>
      <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl relative flex flex-col">
        <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100">
          <Square size={16} className="rotate-45" />
        </button>
        
        {loading || !contentDetail ? (
          <div className="flex items-center justify-center py-20 text-slate-500">
            <Loader2 className="animate-spin mr-2" size={24} /> Đang tải dữ liệu chi tiết...
          </div>
        ) : (
          <>
            <h3 className="text-xl font-bold text-[#0f172a] mb-4 pr-8 leading-snug">{contentDetail.canonical_title}</h3>
            
            <div className="grid lg:grid-cols-[1fr_300px] gap-6 flex-1 overflow-hidden">
              <div className="overflow-y-auto space-y-4 pr-2">
                <div>
                  <h4 className="font-bold text-sm text-slate-800 mb-2">Tóm tắt (Summary)</h4>
                  <div className="bg-slate-50 p-4 rounded-lg border text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
                    {contentDetail.summary || 'Không có tóm tắt.'}
                  </div>
                </div>
                
                <div>
                  <h4 className="font-bold text-sm text-slate-800 mb-2">Dữ liệu gốc (Full Text)</h4>
                  <div className="bg-[#f8f9ff] p-4 rounded-lg border border-[#e0e7ff] text-sm text-[#091426] leading-relaxed whitespace-pre-wrap break-all font-mono">
                    {contentDetail.full_text || 'Không lấy được text gốc.'}
                  </div>
                </div>
              </div>
              
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="border rounded-lg p-3">
                    <div className="text-[10px] uppercase text-slate-500 font-bold mb-1">Nguồn</div>
                    <div className="text-sm font-semibold">{contentDetail.sources?.[0]?.source_type || '-'}</div>
                  </div>
                  <div className="border rounded-lg p-3">
                    <div className="text-[10px] uppercase text-slate-500 font-bold mb-1">Trạng thái</div>
                    <div><Badge value={contentDetail.status} /></div>
                  </div>
                  <div className="border rounded-lg p-3 col-span-2">
                    <div className="text-[10px] uppercase text-slate-500 font-bold mb-1">Ngày crawl</div>
                    <div className="text-xs font-semibold">{formatDate(contentDetail.created_at)}</div>
                  </div>
                </div>

                {contentDetail.canonical_url && (
                  <a href={contentDetail.canonical_url} target="_blank" rel="noreferrer" className="block text-center w-full rounded-lg border border-[#091426] py-2 text-sm font-bold text-[#091426] hover:bg-slate-50">
                    Mở bài đăng gốc
                  </a>
                )}
                
                {contentDetail.media?.length > 0 && (
                  <div>
                    <div className="text-xs uppercase text-slate-500 font-bold mb-2">Media đính kèm ({contentDetail.media.length})</div>
                    <div className="grid grid-cols-2 gap-2">
                      {contentDetail.media.map((m: any) => (
                        <div key={m.id} className="aspect-video bg-black rounded overflow-hidden">
                          <img src={m.storage_url || m.thumbnail_url || m.source_url} alt="Media" className="w-full h-full object-cover" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            <div className="mt-6 pt-4 border-t flex justify-end">
              <button onClick={onClose} className="px-5 py-2 rounded-lg bg-[#091426] text-white text-sm font-bold shadow-sm hover:bg-[#1e293b]">Đóng lại</button>
            </div>
          </>
        )}
      </div>
    </div>
  )

  return createPortal(dialogContent, document.body)
}

function Badge({ value }: { value: string }) {
  let color = 'bg-slate-100 text-slate-700'
  if (['SUCCEEDED', 'COMPLETED', 'APPROVED', 'READY'].includes(value)) color = 'bg-emerald-100 text-emerald-800'
  if (['FAILED', 'REJECTED'].includes(value)) color = 'bg-red-100 text-red-800'
  if (['RUNNING', 'PENDING', 'PROCESSING'].includes(value)) color = 'bg-blue-100 text-blue-800'
  return <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${color}`}>{value}</span>
}
