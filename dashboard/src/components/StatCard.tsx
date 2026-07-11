interface StatCardProps {
  label: string
  value: number | string
  icon: React.ReactNode
  color?: string
  accent?: string
}

export default function StatCard({ label, value, icon, color = 'text-blue-400', accent = 'rgba(59,130,246,0.08)' }: StatCardProps) {
  return (
    <div
      className="rounded-xl p-5 flex items-center gap-4 transition-all hover:translate-y-[-1px]"
      style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border)',
      }}
    >
      <div
        className="p-3 rounded-xl shrink-0"
        style={{ backgroundColor: accent }}
      >
        <div className={color}>{icon}</div>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium mb-1 truncate" style={{ color: 'var(--text-muted)' }}>
          {label}
        </p>
        <p className="text-2xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
          {value}
        </p>
      </div>
    </div>
  )
}
