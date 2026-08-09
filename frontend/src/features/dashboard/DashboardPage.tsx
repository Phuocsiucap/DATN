import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Newspaper, TrendingUp, AlertCircle, Download, Sparkles, Play, Pause, CheckCircle, Clock, UsersRound, CircleUserRound } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '@/commons/hooks/useAppDispatch'
import { fetchStats } from '@/commons/store/slices/statsSlice'
import { triggerCrawlApi, fetchSchedulerStatusApi, startSchedulerApi, stopSchedulerApi } from '@/commons/apis/api'
import StatCard from '@/features/dashboard/components/StatCard'
import EventFeed from '@/features/dashboard/components/EventFeed'

type CurrentUser = {
  id: string | number
  email: string
  roles: string[]
  is_system_admin?: boolean
}

export default function DashboardPage({ currentUser }: { currentUser: CurrentUser }) {
  const dispatch = useAppDispatch()
  const { data: stats, loading } = useAppSelector(s => s.stats)
  const [schedulerStatus, setSchedulerStatus] = useState<string>('stopped')
  const [crawling, setCrawling] = useState(false)
  const isSystemUser = currentUser.roles.includes('system')

  const loadSchedulerStatus = async () => {
    try {
      const data = await fetchSchedulerStatusApi()
      setSchedulerStatus(data.status)
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    dispatch(fetchStats())
    loadSchedulerStatus()
  }, [dispatch])

  const handleStartScheduler = async () => {
    await startSchedulerApi()
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

  const chartSource = isSystemUser ? stats?.by_platform : stats?.queue_status
  const chartData = chartSource
    ? Object.entries(chartSource).map(([name, value]) => ({ name, value }))
    : []

  const isRunning = schedulerStatus === 'running'

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--on-surface)' }}>
            {isSystemUser ? 'System Dashboard' : 'My Dashboard'}
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--on-surface-variant)' }}>
            {isSystemUser
              ? 'Theo dõi toàn bộ hoạt động crawl, queue, account và publish của hệ thống.'
              : 'Theo dõi bài phù hợp, queue sắp đăng và hiệu quả các social account của bạn.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all"
            style={{
              color: 'var(--on-surface)',
              borderColor: 'var(--outline-variant)',
              backgroundColor: 'transparent',
            }}
          >
            <Download size={16} />
            Export Report
          </button>
          <button
            onClick={handleCrawl}
            disabled={crawling || loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50 shadow-lg"
            style={{
              backgroundColor: 'var(--primary)',
              color: 'var(--on-primary)',
              boxShadow: '0 0 15px -3px rgba(33,112,228,0.2)',
            }}
          >
            <Sparkles size={16} className={crawling ? 'animate-spin' : ''} />
            {crawling ? 'Scanning...' : 'AI Content Scan'}
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          label={isSystemUser ? 'Total Collected' : 'Matched Articles'}
          value={stats?.total_articles.toLocaleString() ?? '—'}
          icon={<Newspaper size={20} />}
          trend={isSystemUser ? '+system' : `${stats?.feed_low_suggestions ?? 0} low`}
          trendUp={true}
          iconBg="var(--surface-container)"
          iconColor="var(--secondary)"
        />
        <StatCard
          label={isSystemUser ? 'Active Users' : 'Active Accounts'}
          value={isSystemUser ? (stats?.users_active ?? '—') : (stats?.profiles_active ?? '—')}
          icon={isSystemUser ? <UsersRound size={20} /> : <CircleUserRound size={20} />}
          trend={isSystemUser ? `${stats?.users_total ?? 0} total` : `${stats?.profiles_total ?? 0} total`}
          trendUp={true}
          iconBg="#dcfce7"
          iconColor="#16a34a"
        />
        <StatCard
          label={isSystemUser ? 'Upcoming Queue' : 'Sắp đăng'}
          value={stats?.queue_status?.upcoming ?? '—'}
          icon={<Clock size={20} />}
          badge={<span className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>{stats?.queue_status?.needs_approval ?? 0} cần duyệt</span>}
          iconBg="#dbeafe"
          iconColor="#2563eb"
        />
        <StatCard
          label={isSystemUser ? 'System Health' : 'Published'}
          value={isSystemUser ? (isRunning ? 'Active' : 'Stopped') : (stats?.published_total ?? '—')}
          icon={isSystemUser ? <TrendingUp size={20} /> : <CheckCircle size={20} />}
          accentBorder
          iconBg="rgba(0,164,114,0.1)"
          iconColor="#00a472"
          badge={
            <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold">
              {isSystemUser ? (isRunning ? 'LIVE' : 'OFF') : `${stats?.published_failed ?? 0} failed`}
            </span>
          }
        />
      </div>

      {/* Chart + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart */}
        <div className="lg:col-span-2 bento-card rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold" style={{ color: 'var(--on-surface)' }}>
                Content Distribution
              </h3>
              <p className="text-sm mt-1" style={{ color: 'var(--on-surface-variant)' }}>
                {isSystemUser ? 'Breakdown of posts across primary channels' : 'Queue trạng thái của các account của bạn'}
              </p>
            </div>
            <select
              className="px-4 py-2 rounded-lg text-sm border-none outline-none"
              style={{ backgroundColor: 'var(--surface-container-low)' }}
            >
              <option>Last 7 Days</option>
              <option>Last 30 Days</option>
            </select>
          </div>

          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <XAxis
                  dataKey="name"
                  tick={{ fill: 'var(--on-surface-variant)', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: 'var(--on-surface-variant)', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                  contentStyle={{
                    backgroundColor: 'var(--surface-container-lowest)',
                    border: '1px solid var(--outline-variant)',
                    borderRadius: '8px',
                    fontSize: '13px',
                  }}
                />
                <Bar dataKey="value" fill="var(--secondary)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px]" style={{ color: 'var(--on-surface-variant)' }}>
              <p className="text-sm">Chưa có dữ liệu</p>
            </div>
          )}
        </div>

        {/* Activity Feed */}
        <EventFeed />
      </div>

      {/* Scheduler Control */}
      <div className="bento-card rounded-xl p-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <span className="text-xs font-semibold uppercase tracking-wider mb-1"
                style={{ color: 'var(--on-surface-variant)' }}>
                {isSystemUser ? 'Scheduler Status' : 'Automation Status'}
              </span>
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${
                  isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'
                }`} />
                <span className="text-base font-semibold capitalize" style={{ color: 'var(--on-surface)' }}>
                  {schedulerStatus}
                </span>
              </div>
            </div>
            
            <div className="h-10 w-px" style={{ backgroundColor: 'var(--outline-variant)' }} />
            
            {isSystemUser && (!isRunning ? (
              <button
                onClick={handleStartScheduler}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all"
                style={{ backgroundColor: '#dcfce7', color: '#16a34a' }}
              >
                <Play size={14} fill="currentColor" /> Start Scheduler
              </button>
            ) : (
              <button
                onClick={handleStopScheduler}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all"
                style={{ backgroundColor: '#fef3c7', color: '#d97706' }}
              >
                <Pause size={14} fill="currentColor" /> Pause Scheduler
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--on-surface-variant)' }}>
            <AlertCircle size={14} />
            <span>
              {stats?.published_failed ?? 0} failed ·{' '}
              {stats?.published_total ?? 0} successful posts
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
