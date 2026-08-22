import { useEffect, useState } from 'react'
import { Search, Bell, Radio, LogOut, Cpu, X, Coins } from 'lucide-react'
import { getMyAiUsageApi } from '@/commons/apis/auth'

type TopNavBarProps = {
  email?: string
  onLogout?: () => void
  isSystemUser?: boolean
}

type AiUsageData = {
  total_input_tokens: number
  total_output_tokens: number
  total_tokens: number
  total_cost_usd: number
  prompt_runs_count: number
  recent_runs: any[]
}

export default function TopNavBar({
  email,
  onLogout,
  isSystemUser = false,
}: TopNavBarProps) {
  const [aiUsage, setAiUsage] = useState<AiUsageData | null>(null)
  const [showUsageModal, setShowUsageModal] = useState(false)

  useEffect(() => {
    const loadUsage = async () => {
      try {
        const data = await getMyAiUsageApi()
        setAiUsage(data)
      } catch (err) {
        console.error('Failed to fetch AI usage', err)
      }
    }
    void loadUsage()
    const interval = setInterval(() => void loadUsage(), 30000)
    return () => clearInterval(interval)
  }, [])

  const formatTokens = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  return (
    <header
      className="w-full sticky top-0 z-40 flex justify-between items-center h-[var(--app-topbar-height)] px-4 md:px-5 border-b backdrop-blur"
      style={{
        backgroundColor: 'rgba(244,246,249,0.92)',
        borderColor: 'var(--outline-variant)',
      }}
    >
      {/* Search */}
      <div className="flex items-center gap-3 flex-1 max-w-xl">
        <div className="relative w-full max-w-md">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--on-surface-variant)' }} />
          <input
            className="h-8 w-full pl-8 pr-3 rounded-md text-xs outline-none transition-colors border"
            style={{
              backgroundColor: 'var(--surface-container-low)',
              color: 'var(--on-surface)',
              borderColor: 'var(--outline-variant)',
            }}
            placeholder="Tìm kiếm nội dung, kịch bản, dự án..."
            type="text"
          />
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* AI Usage Chip */}
        {aiUsage && (
          <div className="relative">
            <button
              onClick={() => setShowUsageModal(!showUsageModal)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all hover:bg-blue-50/80 hover:border-blue-300"
              style={{
                backgroundColor: 'var(--surface-container-lowest)',
                borderColor: 'var(--outline-variant)',
                color: 'var(--accent-strong)',
              }}
              title="Xem hạch toán Token AI & Chi phí"
            >
              <Cpu size={13} className="text-blue-600 animate-pulse" />
              <span>{formatTokens(aiUsage.total_tokens)} tokens</span>
              <span className="text-[10px] px-1.5 py-0.2 bg-blue-100 text-blue-800 rounded font-bold">
                ${aiUsage.total_cost_usd}
              </span>
            </button>

            {/* Popover detail */}
            {showUsageModal && (
              <div className="absolute right-0 mt-2 w-80 bento-card p-4 shadow-xl z-50 rounded-xl space-y-3 border">
                <div className="flex items-center justify-between border-b pb-2">
                  <div className="flex items-center gap-1.5 font-bold text-xs" style={{ color: 'var(--on-surface)' }}>
                    <Coins size={14} className="text-amber-500" />
                    <span>Hạch toán Tiêu thụ Token AI</span>
                  </div>
                  <button onClick={() => setShowUsageModal(false)} className="text-gray-400 hover:text-gray-600">
                    <X size={14} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded bg-slate-50 border">
                    <p className="text-[10px] text-gray-500 font-medium">Input Tokens</p>
                    <p className="font-bold text-slate-800">{aiUsage.total_input_tokens.toLocaleString()}</p>
                  </div>
                  <div className="p-2 rounded bg-slate-50 border">
                    <p className="text-[10px] text-gray-500 font-medium">Output Tokens</p>
                    <p className="font-bold text-slate-800">{aiUsage.total_output_tokens.toLocaleString()}</p>
                  </div>
                  <div className="p-2 rounded bg-blue-50/60 border border-blue-100">
                    <p className="text-[10px] text-blue-600 font-medium">Tổng số lần gọi AI</p>
                    <p className="font-bold text-blue-900">{aiUsage.prompt_runs_count} runs</p>
                  </div>
                  <div className="p-2 rounded bg-emerald-50/60 border border-emerald-100">
                    <p className="text-[10px] text-emerald-600 font-medium">Tổng Chi phí USD</p>
                    <p className="font-bold text-emerald-900">${aiUsage.total_cost_usd}</p>
                  </div>
                </div>

                {aiUsage.recent_runs && aiUsage.recent_runs.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-gray-500 mb-1.5 uppercase tracking-wider">Lịch sử gọi AI gần đây</p>
                    <div className="max-h-36 overflow-y-auto space-y-1 pr-1 custom-scrollbar text-[11px]">
                      {aiUsage.recent_runs.slice(0, 5).map((run: any) => (
                        <div key={run.id} className="flex justify-between items-center p-1.5 bg-gray-50 rounded border text-gray-700">
                          <div>
                            <span className="font-semibold block leading-tight">{run.step_name}</span>
                            <span className="text-[9px] text-gray-400">{run.model_name}</span>
                          </div>
                          <div className="text-right">
                            <span className="font-bold text-blue-600 block leading-tight">+{run.total_tokens || 0} tok</span>
                            <span className="text-[9px] text-emerald-600">${run.cost_usd || 0}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* System status */}
        <div className="hidden lg:flex items-center gap-1.5 text-xs" style={{ color: 'var(--on-surface-variant)' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live
        </div>

        <div className="flex items-center gap-2">
          {/* Notifications */}
          <button className="relative inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-container-low)]" style={{ color: 'var(--on-surface-variant)' }}>
            <Bell size={16} />
            <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full border-2"
              style={{ backgroundColor: 'var(--error)', borderColor: 'var(--surface)' }} />
          </button>

          {/* Live indicator */}
          <button className="inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-container-low)]" style={{ color: 'var(--on-surface-variant)' }}>
            <Radio size={16} />
          </button>

          <div className="h-7 w-px" style={{ backgroundColor: 'var(--outline-variant)' }} />

          <div className="flex items-center gap-2">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-semibold leading-none" style={{ color: 'var(--on-surface)' }}>
                {isSystemUser ? 'System Admin' : 'Creator User'}
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--on-surface-variant)' }}>
                {email || 'Content Manager'}
              </p>
            </div>
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border transition-all ${
                isSystemUser ? 'bg-amber-100 text-amber-800 border-amber-200' : 'bg-emerald-100 text-emerald-800 border-emerald-200'
              }`}
            >
              {isSystemUser ? 'SA' : 'U'}
            </div>
            {email && onLogout && (
              <button
                onClick={onLogout}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors hover:bg-[var(--surface-container-low)]"
                style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface-variant)' }}
                title="Đăng xuất"
              >
                <LogOut size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
