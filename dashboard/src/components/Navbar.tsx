import { Activity } from 'lucide-react'

export default function Navbar() {
  return (
    <nav className="bg-gray-900 border-b border-gray-700 px-6 py-3 flex items-center gap-3">
      <Activity className="text-blue-400" size={22} />
      <span className="text-white font-bold text-lg">AutoCrawl Dashboard</span>
      <span className="ml-auto flex items-center gap-2 text-xs text-green-400">
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        Live
      </span>
    </nav>
  )
}
