import { Search, Bell, Radio, LogOut, CircleUserRound } from 'lucide-react'

type TopNavBarProps = {
  email?: string
  onLogout?: () => void
}

export default function TopNavBar({ email, onLogout }: TopNavBarProps) {
  return (
    <header
      className="w-full sticky top-0 z-40 flex justify-between items-center h-16 px-6 border-b"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--outline-variant)',
      }}
    >
      {/* Search */}
      <div className="flex items-center flex-1 max-w-xl">
        <div className="relative w-full">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--on-surface-variant)' }} />
          <input
            className="w-full pl-10 pr-4 py-2 rounded-lg text-sm outline-none transition-all"
            style={{
              backgroundColor: 'var(--surface-container-low)',
              color: 'var(--on-surface)',
              border: 'none',
            }}
            placeholder="Tìm kiếm nội dung, bài viết..."
            type="text"
          />
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-5">
        {/* System status */}
        <div className="hidden lg:flex items-center gap-2 text-sm" style={{ color: 'var(--on-surface-variant)' }}>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          System: Active
        </div>

        <div className="flex items-center gap-3">
          {/* Notifications */}
          <button className="relative p-1 transition-colors" style={{ color: 'var(--on-surface-variant)' }}>
            <Bell size={20} />
            <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full border-2"
              style={{ backgroundColor: 'var(--error)', borderColor: 'var(--surface)' }} />
          </button>

          {/* Live indicator */}
          <button className="p-1 transition-colors" style={{ color: 'var(--on-surface-variant)' }}>
            <Radio size={20} />
          </button>

          <div className="h-7 w-px" style={{ backgroundColor: 'var(--outline-variant)' }} />

          {email && onLogout && (
            <button
              onClick={onLogout}
              className="hidden sm:flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium border transition-all hover:opacity-90"
              style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface)' }}
            >
              <CircleUserRound size={16} />
              <span className="max-w-[180px] truncate">{email}</span>
              <LogOut size={16} />
            </button>
          )}

          {/* User avatar */}
          <div className="flex items-center gap-3 cursor-pointer group">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-semibold leading-none" style={{ color: 'var(--on-surface)' }}>
                {email ? 'Logged in' : 'Admin'}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--on-surface-variant)' }}>
                {email || 'Content Manager'}
              </p>
            </div>
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all"
              style={{
                backgroundColor: 'var(--secondary)',
                color: 'var(--on-secondary)',
                borderColor: 'var(--outline-variant)',
              }}
            >
              A
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
