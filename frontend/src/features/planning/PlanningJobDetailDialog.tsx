import { useEffect, useState } from 'react'
import { Loader2, X, Terminal, FileCheck } from 'lucide-react'
import { fetchPlanningJobCandidatesApi, fetchPlanningJobLogsApi, type PlanningJob, type PlanningCandidate, type PromptRun } from '@/commons/apis/planning'
import { Sheet, SheetContent } from '@/commons/component/ui/sheet'

export function PlanningJobDetailDialog({
  job,
  open,
  onOpenChange,
}: {
  job: PlanningJob | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [activeTab, setActiveTab] = useState<'candidates' | 'logs'>('candidates')
  const [candidates, setCandidates] = useState<PlanningCandidate[]>([])
  const [logs, setLogs] = useState<PromptRun[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (job && open) {
      setLoading(true)
      Promise.all([
        fetchPlanningJobCandidatesApi(job.id),
        fetchPlanningJobLogsApi(job.id)
      ])
        .then(([c, l]) => {
          setCandidates(c)
          setLogs(l)
        })
        .finally(() => setLoading(false))
    }
  }, [job, open])

  if (!open || !job) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="max-w-[900px]">
        <div className="flex h-full flex-col overflow-hidden bg-white">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#eef2f7] bg-[#f8fafc] px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-[#0f172a]">Chi Tiết Tiến Trình AI</h2>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                job.status === 'COMPLETED' || job.status === 'WAITING_REVIEW' ? 'bg-emerald-100 text-emerald-800' : 
                job.status === 'FAILED' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
              }`}>{job.status}</span>
            </div>
            <p className="mt-1 text-sm text-[#64748b] font-mono">Job ID: {job.id.slice(0, 8)} • Mode: {job.planning_mode}</p>
          </div>
          <button onClick={() => onOpenChange(false)} className="rounded-full p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 border-b border-slate-200 px-6 pt-4 bg-white">
          <button
            onClick={() => setActiveTab('candidates')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition-colors ${
              activeTab === 'candidates' ? 'border-[#3525cd] text-[#3525cd]' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileCheck size={16} /> Ứng Viên ({candidates.length})
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition-colors ${
              activeTab === 'logs' ? 'border-[#3525cd] text-[#3525cd]' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Terminal size={16} /> Lịch Sử Chạy AI ({logs.length})
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500">
              <Loader2 className="h-8 w-8 animate-spin mb-4" />
              <p>Đang tải dữ liệu tiến trình...</p>
            </div>
          ) : activeTab === 'candidates' ? (
            <div className="space-y-4">
              {candidates.length === 0 ? (
                <div className="text-center p-10 text-slate-500">Không có ứng viên nào được chọn.</div>
              ) : candidates.map(c => (
                <div key={c.id} className={`rounded-xl border bg-white p-5 shadow-sm ${c.eligible ? 'border-emerald-200' : 'border-slate-200 opacity-60'}`}>
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        {c.eligible ? (
                          <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded uppercase">Đủ điều kiện</span>
                        ) : (
                          <span className="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded uppercase">Bị loại</span>
                        )}
                        <span className="font-mono text-[10px] text-slate-400">ID: {c.content_id?.slice(0, 8)}</span>
                      </div>
                      <h4 className="font-bold text-[#091426] leading-snug">
                        {c.content_title || 'Nội dung không xác định'}
                      </h4>
                      {c.content_url && (
                        <a href={c.content_url} target="_blank" rel="noreferrer" className="text-xs text-[#3525cd] hover:underline break-all">
                          {c.content_url}
                        </a>
                      )}
                    </div>
                    <div className="font-bold text-lg text-[#091426] whitespace-nowrap ml-4">{c.candidate_score.toFixed(1)} đ</div>
                  </div>
                  
                  <div className="grid gap-3">
                    {c.selection_reasons.length > 0 && (
                      <div className="bg-blue-50/50 p-3 rounded-lg border border-blue-100">
                        <div className="text-[10px] font-bold uppercase text-blue-800 mb-1">Lý do chọn</div>
                        <ul className="list-disc pl-4 text-sm text-blue-900 space-y-1">
                          {c.selection_reasons.map((r, i) => <li key={i}>{String(r)}</li>)}
                        </ul>
                      </div>
                    )}
                    {c.rejection_reasons.length > 0 && (
                      <div className="bg-red-50/50 p-3 rounded-lg border border-red-100">
                        <div className="text-[10px] font-bold uppercase text-red-800 mb-1">Lý do loại</div>
                        <ul className="list-disc pl-4 text-sm text-red-900 space-y-1">
                          {c.rejection_reasons.map((r, i) => <li key={i}>{String(r)}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {logs.length === 0 ? (
                <div className="text-center p-10 text-slate-500">Chưa có log chạy AI.</div>
              ) : logs.map((log, i) => (
                <div key={log.id} className="rounded-lg bg-slate-900 overflow-hidden shadow-sm text-slate-300 font-mono text-xs border border-slate-700">
                  <div className="bg-slate-950 px-4 py-2 border-b border-slate-700 flex justify-between items-center text-slate-400">
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-400 font-bold">[{i+1}]</span>
                      <span className="text-white font-semibold">{log.step_name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {log.latency_ms && <span>⏱ {log.latency_ms}ms</span>}
                      {log.status === 'COMPLETED' ? <span className="text-emerald-400">SUCCESS</span> : log.status === 'FAILED' ? <span className="text-red-400">ERROR</span> : <span className="text-blue-400">{log.status}</span>}
                    </div>
                  </div>
                  <div className="p-4 grid gap-2">
                    <div className="flex gap-2">
                      <span className="text-blue-400">Model:</span>
                      <span className="text-slate-100">{log.model_provider}/{log.model_name || 'N/A'}</span>
                    </div>
                    {(log.input_tokens || log.output_tokens) && (
                      <div className="flex gap-2">
                        <span className="text-purple-400">Tokens:</span>
                        <span className="text-slate-100">IN: {log.input_tokens || 0} | OUT: {log.output_tokens || 0}</span>
                      </div>
                    )}
                    {log.error_message && (
                      <div className="mt-2 text-red-400 bg-red-950/30 p-2 rounded border border-red-900/50">
                        {log.error_message}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
      </SheetContent>
    </Sheet>
  )
}
