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
      className="bento-card p-6 rounded-xl flex flex-col justify-between"
      style={accentBorder ? { borderLeft: '4px solid #6ffbbe' } : {}}
    >
      <div className="flex items-start justify-between">
        <div className="p-2 rounded-lg" style={{ backgroundColor: iconBg, color: iconColor }}>
          {icon}
        </div>
        {trend && (
          <span className="text-xs font-semibold flex items-center gap-0.5"
            style={{ color: trendUp ? '#00a472' : 'var(--error)' }}>
            {trendUp ? '↑' : '↓'}{trend}
          </span>
        )}
        {badge && badge}
      </div>
      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--on-surface-variant)' }}>
          {label}
        </p>
        <p className="text-2xl font-bold mt-1 tabular-nums" style={{ color: 'var(--on-surface)' }}>
          {value}
        </p>
      </div>
    </div>
  )
}
