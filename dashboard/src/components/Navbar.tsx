import { Activity } from 'lucide-react'

export default function Navbar() {
  return (
    <nav
      className="px-6 py-3.5 flex items-center gap-3"
      style={{ backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="p-1.5 rounded-lg"
          style={{ backgroundColor: 'rgba(59,130,246,0.15)' }}
        >
          <Activity className="text-blue-400" size={18} />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>
            AutoCrawl
          </span>
          <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
            Dashboard
          </span>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
        style={{ backgroundColor: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)' }}>
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        Live
      </div>
    </nav>
  )
}
