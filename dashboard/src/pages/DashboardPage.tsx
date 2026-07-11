import { useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Newspaper, TrendingUp, Send, AlertCircle, RefreshCw } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '../hooks/useAppDispatch'
import { fetchStats } from '../store/slices/statsSlice'
import { triggerCrawlApi } from '../services/api'
import StatCard from '../components/StatCard'
import EventFeed from '../components/EventFeed'

export default function DashboardPage() {
  const dispatch = useAppDispatch()
  const { data: stats, loading } = useAppSelector(s => s.stats)

  useEffect(() => {
    dispatch(fetchStats())
    const id = setInterval(() => dispatch(fetchStats()), 30000)
    return () => clearInterval(id)
  }, [dispatch])

  const chartData = stats
    ? Object.entries(stats.by_platform).map(([name, value]) => ({ name, value }))
    : []

  return (
    <div className="p-6 space-y-6">
      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Tổng bài viết" value={stats?.total_articles ?? '—'} icon={<Newspaper size={28} />} color="text-blue-400" />
        <StatCard label="Crawled (24h)" value={stats?.crawled_last_24h ?? '—'} icon={<TrendingUp size={28} />} color="text-yellow-400" />
        <StatCard label="Đã đăng" value={stats?.published_total ?? '—'} icon={<Send size={28} />} color="text-green-400" />
        <StatCard label="Thất bại" value={stats?.published_failed ?? '—'} icon={<AlertCircle size={28} />} color="text-red-400" />
      </div>

      {/* Chart + Events */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <h2 className="text-white font-semibold mb-4">Bài đăng theo platform</h2>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <XAxis dataKey="name" stroke="#9ca3af" />
                <YAxis stroke="#9ca3af" />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', color: '#fff' }} />
                <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-500 text-sm text-center py-16">Chưa có dữ liệu</p>
          )}
        </div>
        <EventFeed />
      </div>

      {/* Trigger crawl */}
      <div className="flex justify-end">
        <button
          onClick={() => triggerCrawlApi()}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50">
          <RefreshCw size={16} />
          Crawl ngay
        </button>
      </div>
    </div>
  )
}
