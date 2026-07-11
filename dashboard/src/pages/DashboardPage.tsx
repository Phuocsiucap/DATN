import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Newspaper, TrendingUp, Send, AlertCircle, RefreshCw, Play, Pause } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '../hooks/useAppDispatch'
import { fetchStats } from '../store/slices/statsSlice'
import { triggerCrawlApi, fetchSchedulerStatusApi, startSchedulerApi, stopSchedulerApi } from '../services/api'
import StatCard from '../components/StatCard'
import EventFeed from '../components/EventFeed'

export default function DashboardPage() {
  const dispatch = useAppDispatch()
  const { data: stats, loading } = useAppSelector(s => s.stats)
  const [schedulerStatus, setSchedulerStatus] = useState<string>('stopped')
  const [schedulerInterval, setSchedulerInterval] = useState<number>(30)
  const [crawling, setCrawling] = useState(false)

  const loadSchedulerStatus = async () => {
    try {
      const data = await fetchSchedulerStatusApi()
      setSchedulerStatus(data.status)
      if (data.interval) {
        setSchedulerInterval(data.interval)
      }
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    dispatch(fetchStats())
    loadSchedulerStatus()
    const id = setInterval(() => {
      dispatch(fetchStats())
      loadSchedulerStatus()
    }, 10000)
    return () => clearInterval(id)
  }, [dispatch])

  const handleStartScheduler = async () => {
    await startSchedulerApi(schedulerInterval)
    loadSchedulerStatus()
  }

  const handleStopScheduler = async () => {
    await stopSchedulerApi()
    loadSchedulerStatus()
  }

  const handleCrawl = async () => {
    setCrawling(true)
    try {
      await triggerCrawlApi()
    } finally {
      setTimeout(() => setCrawling(false), 2000)
    }
  }

  const chartData = stats
    ? Object.entries(stats.by_platform).map(([name, value]) => ({ name, value }))
    : []

  const isRunning = schedulerStatus === 'running'
  const isPaused = schedulerStatus === 'paused'

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Tổng bài viết"
          value={stats?.total_articles ?? '—'}
          icon={<Newspaper size={20} />}
          color="text-blue-400"
          accent="rgba(59,130,246,0.1)"
        />
        <StatCard
          label="Crawled (24h)"
          value={stats?.crawled_last_24h ?? '—'}
          icon={<TrendingUp size={20} />}
          color="text-amber-400"
          accent="rgba(251,191,36,0.1)"
        />
        <StatCard
          label="Đã đăng"
          value={stats?.published_total ?? '—'}
          icon={<Send size={20} />}
          color="text-emerald-400"
          accent="rgba(52,211,153,0.1)"
        />
        <StatCard
          label="Thất bại"
          value={stats?.published_failed ?? '—'}
          icon={<AlertCircle size={20} />}
          color="text-red-400"
          accent="rgba(248,113,113,0.1)"
        />
      </div>

      {/* Chart + Events + Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Chart */}
        <div
          className="lg:col-span-2 rounded-xl p-5"
          style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Bài đăng theo platform
            </p>
            {stats && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Cập nhật tự động
              </span>
            )}
          </div>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} barSize={32}>
                <XAxis
                  dataKey="name"
                  tick={{ fill: '#475569', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#475569', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={30}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                  contentStyle={{
                    backgroundColor: '#1a2236',
                    border: '1px solid #1f2d47',
                    borderRadius: '8px',
                    color: '#f1f5f9',
                    fontSize: '13px',
                  }}
                />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {chartData.map((_, i) => (
                    <Cell
                      key={i}
                      fill={['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b'][i % 4]}
                      fillOpacity={0.85}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[220px]"
              style={{ color: 'var(--text-muted)' }}>
              <p className="text-sm">Chưa có dữ liệu</p>
            </div>
          )}
        </div>

        {/* Right col: Events + Controls */}
        <div className="flex flex-col gap-4">
          <EventFeed />

          {/* Scheduler + Crawl controls */}
          <div
            className="rounded-xl p-4 space-y-3"
            style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)' }}
          >
            {/* Scheduler status */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Scheduler</p>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    isRunning ? 'bg-green-400 animate-pulse' :
                    isPaused ? 'bg-amber-400' : 'bg-red-400'
                  }`} />
                  <span className="text-sm font-medium capitalize" style={{ color: 'var(--text-primary)' }}>
                    {schedulerStatus}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-end gap-2">
                  <input
                    type="number"
                    min="1"
                    max="1440"
                    value={schedulerInterval}
                    onChange={(e) => setSchedulerInterval(Number(e.target.value))}
                    className="w-16 h-7 bg-transparent text-xs text-center border rounded-md focus:outline-none focus:border-blue-500"
                    style={{ color: 'var(--text-primary)', borderColor: 'var(--border)' }}
                    title="Thời gian chờ giữa các lần crawl (phút)"
                  />
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>phút</span>
                </div>
                <div className="flex items-center justify-end">
                  {!isRunning ? (
                    <button
                      onClick={handleStartScheduler}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-90"
                      style={{ backgroundColor: 'rgba(52,211,153,0.15)', color: '#4ade80', border: '1px solid rgba(52,211,153,0.2)' }}
                    >
                      <Play size={12} /> Start
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={handleStartScheduler}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-90"
                        title="Cập nhật thời gian mới"
                        style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.2)' }}
                      >
                        <RefreshCw size={12} /> Cập nhật
                      </button>
                      <button
                        onClick={handleStopScheduler}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-90"
                        style={{ backgroundColor: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }}
                      >
                        <Pause size={12} /> Pause
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)' }} className="pt-3">
              <button
                onClick={handleCrawl}
                disabled={crawling || loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
              >
                <RefreshCw size={14} className={crawling ? 'animate-spin' : ''} />
                {crawling ? 'Đang crawl...' : 'Crawl ngay'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
