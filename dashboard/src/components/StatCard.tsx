interface StatCardProps {
  label: string
  value: number | string
  icon: React.ReactNode
  color?: string
}

export default function StatCard({ label, value, icon, color = 'text-blue-400' }: StatCardProps) {
  return (
    <div className="bg-gray-800 rounded-xl p-5 flex items-center gap-4 border border-gray-700">
      <div className={`text-3xl ${color}`}>{icon}</div>
      <div>
        <p className="text-gray-400 text-sm">{label}</p>
        <p className="text-white text-2xl font-bold">{value}</p>
      </div>
    </div>
  )
}
