import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, ArrowRight, CheckCircle, Loader2, Square } from 'lucide-react'
import { fetchContentDetailApi } from '@/commons/apis/module1'
import { createContentProjectFromSourcesApi, createProjectRunApi, type PlanningProfile } from '@/commons/apis/planning'
import { fetchSocialProfilesApi } from '@/commons/apis/socialProfiles'

const formatDate = (value?: string) => value ? new Date(value).toLocaleString('vi-VN') : '-'

type ContentDetailDialogProps = {
  contentId: string | null
  onClose: () => void
  onOpenModule2?: (jobId?: string) => void
}

export function ContentDetailDialog({ contentId, onClose, onOpenModule2 }: ContentDetailDialogProps) {
  const [contentDetail, setContentDetail] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [profiles, setProfiles] = useState<PlanningProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [creatingScript, setCreatingScript] = useState(false)
  const [scriptResult, setScriptResult] = useState<{ success: boolean; message: string } | null>(null)

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

  useEffect(() => {
    fetchSocialProfilesApi()
      .then((res: any) => {
        const items = res?.items || res || []
        setProfiles(items)
        setSelectedProfileId((current) => current || items[0]?.id || '')
      })
      .catch(() => setProfiles([]))
  }, [])

  const createDirectScript = async () => {
    if (!contentDetail?.id || !selectedProfileId) return
    setCreatingScript(true)
    setScriptResult(null)
    try {
      const project = await createContentProjectFromSourcesApi({
        profile_id: selectedProfileId,
        content_ids: [contentDetail.id],
        story_ids: [],
        episode_ids: [],
        selection_mode: 'MANUAL',
        candidate_limit: 1,
        title: contentDetail.canonical_title || contentDetail.normalized_title || 'Content project',
        note: `Tạo kịch bản trực tiếp từ kho: "${contentDetail.canonical_title || contentDetail.normalized_title || contentDetail.id}"`,
        filters: {
          manual_direct_script: true,
          bypass_scoring: true,
          source: 'content_store',
          content_ids: [contentDetail.id],
        },
      })
      const job = await createProjectRunApi({
        profile_id: selectedProfileId,
        project_id: project.id,
        planning_mode: 'SINGLE',
        target_duration_seconds: 60,
        preferred_part_count: 1,
        language: 'vi',
        skip_ai_evaluation: true,
        instructions: 'manual_direct_script: true. Bỏ qua chấm điểm và lọc phù hợp; tạo luôn kịch bản video đơn lẻ từ đúng bài người dùng đã chọn.',
      })
      setScriptResult({ success: true, message: 'Đã tạo job kịch bản trực tiếp trong Module 2.' })
      onOpenModule2?.(job.id)
    } catch (error: any) {
      setScriptResult({ success: false, message: error?.response?.data?.detail || error?.message || 'Không tạo được kịch bản trực tiếp' })
    } finally {
      setCreatingScript(false)
    }
  }

  if (!contentId) return null

  const dialogContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6" style={{ backgroundColor: 'rgba(9,20,38,0.5)' }}>
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-y-auto rounded-lg border border-[var(--outline-variant)] bg-white p-5 shadow-xl">
        <button onClick={onClose} className="icon-button absolute right-4 top-4 hover:bg-slate-100">
          <Square size={16} className="rotate-45" />
        </button>
        
        {loading || !contentDetail ? (
          <div className="flex items-center justify-center py-20 text-slate-500">
            <Loader2 className="animate-spin mr-2" size={24} /> Đang tải dữ liệu chi tiết...
          </div>
        ) : (
          <>
            <h3 className="mb-4 pr-8 text-lg font-bold leading-snug text-[#0f172a]">{contentDetail.canonical_title}</h3>
            
            <div className="grid lg:grid-cols-[1fr_300px] gap-6 flex-1 overflow-hidden">
              <div className="overflow-y-auto space-y-4 pr-2">
                <div>
                  <h4 className="font-bold text-sm text-slate-800 mb-2">Tóm tắt (Summary)</h4>
                  <div className="rounded-md border bg-slate-50 p-3 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap break-words">
                    {contentDetail.summary || 'Không có tóm tắt.'}
                  </div>
                </div>
                
                <div>
                  <h4 className="font-bold text-sm text-slate-800 mb-2">Dữ liệu gốc (Full Text)</h4>
                  <div className="rounded-md border border-[#e0e7ff] bg-[#f8f9ff] p-3 font-mono text-sm leading-relaxed text-[#091426] whitespace-pre-wrap break-all">
                    {contentDetail.full_text || 'Không lấy được text gốc.'}
                  </div>
                </div>
              </div>
              
              <div className="space-y-4">
                <div className="rounded-md border border-blue-200 bg-blue-50/60 p-3">
                  <div className="mb-2 text-[10px] font-black uppercase text-blue-800">Module 2 manual</div>
                  <div className="grid gap-2">
                    <select
                      value={selectedProfileId}
                      onChange={(event) => setSelectedProfileId(event.target.value)}
                      className="h-8 rounded-md border border-blue-200 bg-white px-2 text-xs font-semibold text-[#0f172a]"
                    >
                      {profiles.length === 0 && <option value="">Chưa có profile</option>}
                      {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.profile_name}{profile.username ? ` (@${profile.username})` : ''} - {profile.platform}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => void createDirectScript()}
                      disabled={creatingScript || loading || !contentDetail?.id || !selectedProfileId}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {creatingScript ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                      Tạo luôn kịch bản
                    </button>
                    {scriptResult && (
                      <div className={`flex items-start gap-2 rounded border px-2 py-1.5 text-xs font-semibold ${scriptResult.success ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
                        {scriptResult.success ? <CheckCircle size={13} className="mt-0.5 shrink-0" /> : <AlertCircle size={13} className="mt-0.5 shrink-0" />}
                        <span>{scriptResult.message}</span>
                      </div>
                    )}
                  </div>
                </div>

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
                  <a href={contentDetail.canonical_url} target="_blank" rel="noreferrer" className="block w-full rounded-md border border-[var(--outline-variant)] py-2 text-center text-xs font-bold text-[var(--on-surface)] hover:bg-slate-50">
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
              <button onClick={onClose} className="h-8 rounded-md bg-[var(--primary)] px-3 text-xs font-semibold text-white hover:bg-[#1e293b]">Đóng lại</button>
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
