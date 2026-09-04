import { useEffect, useState } from 'react'
import { ChevronDown, Coins, Cpu, LogOut, X } from 'lucide-react'
import { getMyAiUsageApi } from '@/commons/apis/auth'
import { SearchField, TopBarIconGroup, UserAvatar, type ApiUser, userDisplayName, userRoleLabel } from './social-ui'

type TopNavBarProps = {
  currentUser?: ApiUser | null
  onLogout?: () => void
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
  onLogout,
  currentUser,
}: TopNavBarProps) {
  const [aiUsage, setAiUsage] = useState<AiUsageData | null>(null)
  const [showUsageModal, setShowUsageModal] = useState(false)
  const displayName = userDisplayName(currentUser)
  const roleLabel = userRoleLabel(currentUser)

  useEffect(() => {
    const loadUsage = async () => {
      try {
        const data = await getMyAiUsageApi()
        setAiUsage(data)
      } catch {
        setAiUsage(null)
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
    <header className="sticky top-0 z-40 flex h-[var(--app-topbar-height)] w-full items-center justify-between border-b border-[var(--outline-variant)] bg-white/90 px-5 backdrop-blur-xl">
      <div className="hidden min-w-0 flex-1 md:block">
        <SearchField className="mx-auto max-w-[580px]" placeholder="Tìm kiếm bài viết, nội dung, kênh social..." />
      </div>

      <div className="ml-auto flex items-center gap-3">
        {aiUsage && (
          <div className="relative hidden xl:block">
            <button
              onClick={() => setShowUsageModal(!showUsageModal)}
              className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--outline-variant)] bg-white px-3 text-xs font-extrabold text-[#2556ea] transition hover:bg-[#f4f6ff]"
              title="Xem hạch toán Token hệ thống & Chi phí"
            >
              <Cpu size={15} />
              {formatTokens(aiUsage.total_tokens)}
              <span className="rounded-[5px] bg-[#eef4ff] px-1.5 py-0.5 text-xs text-[#2556ea]">${aiUsage.total_cost_usd}</span>
            </button>

            {showUsageModal && (
              <div className="app-card absolute right-0 mt-2 w-80 p-4">
                <div className="flex items-center justify-between border-b border-[var(--outline-variant)] pb-2">
                  <div className="flex items-center gap-2 text-sm font-extrabold text-[#111827]">
                    <Coins size={15} className="text-[#f59e0b]" />
                    Hạch toán Token hệ thống
                  </div>
                  <button onClick={() => setShowUsageModal(false)} className="grid h-7 w-7 place-items-center rounded-[8px] text-[#64748b] hover:bg-[#f4f6ff]">
                    <X size={15} />
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <UsageBox label="Input" value={aiUsage.total_input_tokens.toLocaleString()} />
                  <UsageBox label="Output" value={aiUsage.total_output_tokens.toLocaleString()} />
                  <UsageBox label="Runs" value={`${aiUsage.prompt_runs_count}`} />
                  <UsageBox label="Cost" value={`$${aiUsage.total_cost_usd}`} />
                </div>
              </div>
            )}
          </div>
        )}

        <TopBarIconGroup />

        <button className="flex items-center gap-3" title={currentUser?.email || displayName}>
          <UserAvatar src={null} name={displayName} />
          <div className="hidden text-left sm:block">
            <div className="text-sm font-extrabold leading-tight text-[#111827]">
              {displayName}
            </div>
            <div className="text-xs font-medium text-[#64748b]">{roleLabel}</div>
          </div>
          <ChevronDown size={16} className="text-[#526179]" />
        </button>

        {currentUser?.email && onLogout && (
          <button
            onClick={onLogout}
            className="grid h-9 w-9 place-items-center rounded-[8px] border border-[var(--outline-variant)] text-[#526179] transition hover:bg-[#f4f6ff]"
            title="Đăng xuất"
          >
            <LogOut size={16} />
          </button>
        )}
      </div>
    </header>
  )
}

function UsageBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-[var(--outline-variant)] bg-[#fbfcff] p-2.5">
      <div className="text-xs font-bold uppercase text-[#718096]">{label}</div>
      <div className="mt-0.5 truncate text-sm font-extrabold text-[#111827]">{value}</div>
    </div>
  )
}
