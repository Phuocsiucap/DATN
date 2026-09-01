interface StatCardProps {
  label: string
  value: number | string
  icon: React.ReactNode
  trend?: string
  trendUp?: boolean
  iconBg?: string
  iconColor?: string
  accentBorder?: boolean
  badge?: React.ReactNode
}

export default function StatCard({
  label, value, icon, trend, trendUp = true,
  iconBg = '#e5eeff', iconColor = 'var(--secondary)',
  accentBorder = false, badge
}: StatCardProps) {
  return (
    <div
      className="bento-card p-5 rounded-xl flex min-h-[116px] flex-col justify-between"
      style={accentBorder ? { borderLeft: '3px solid var(--success)' } : {}}
    >
      <div className="flex items-start justify-between">
        <div className="flex h-8 w-8 items-center justify-center rounded-md" style={{ backgroundColor: iconBg, color: iconColor }}>
          {icon}
        </div>
        {trend && (
          <span className="text-xs font-semibold flex items-center gap-0.5"
            style={{ color: trendUp ? 'var(--success)' : 'var(--error)' }}>
            {trendUp ? '↑' : '↓'}{trend}
          </span>
        )}
        {badge && badge}
      </div>
      <div className="mt-5">
        <p className="text-xs font-semibold uppercase" style={{ color: 'var(--on-surface-variant)' }}>
          {label}
        </p>
        <p className="text-xl font-bold mt-1 tabular-nums" style={{ color: 'var(--on-surface)' }}>
          {value}
        </p>
      </div>
    </div>
  )
}
