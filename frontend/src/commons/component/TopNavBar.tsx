import { Search, Bell, Radio, LogOut } from 'lucide-react'

type TopNavBarProps = {
  email?: string
  onLogout?: () => void
  isSystemUser?: boolean
}

export default function TopNavBar({
  email,
  onLogout,
  isSystemUser = false,
}: TopNavBarProps) {
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
            placeholder="Tìm kiếm nội dung, bài viết..."
            type="text"
          />
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
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
