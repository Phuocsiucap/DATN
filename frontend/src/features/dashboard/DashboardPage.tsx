import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Newspaper, TrendingUp, AlertCircle, Download, Sparkles, Play, Pause, CheckCircle, Clock, UsersRound, CircleUserRound } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '@/commons/hooks/useAppDispatch'
import { fetchStats } from '@/commons/store/slices/statsSlice'
import { triggerCrawlApi, fetchSchedulerStatusApi, startSchedulerApi, stopSchedulerApi } from '@/commons/apis/api'
import { PageLayout } from '@/commons/component/social-ui'
import StatCard from '@/features/dashboard/components/StatCard'
import EventFeed from '@/features/dashboard/components/EventFeed'

type CurrentUser = {
  id: string | number
  email: string
  roles: string[]
  is_system_admin?: boolean
}

const hasSystemRole = (roles: string[]) => roles.some((role) => {
  const normalized = role.toUpperCase()
  return normalized === 'SYSTEM' || normalized === 'SYSTEM_ADMIN' || normalized === 'ADMIN'
})

export default function DashboardPage({ currentUser }: { currentUser: CurrentUser }) {
  const dispatch = useAppDispatch()
  const { data: stats, loading } = useAppSelector(s => s.stats)
  const [schedulerStatus, setSchedulerStatus] = useState<string>('stopped')
  const [crawling, setCrawling] = useState(false)
  const isSystemUser = Boolean(currentUser.is_system_admin || hasSystemRole(currentUser.roles))

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
    <PageLayout
      title={isSystemUser ? 'System Dashboard' : 'My Dashboard'}
      description={
        isSystemUser
          ? 'Theo dõi toàn bộ hoạt động crawl, queue, account và publish của hệ thống.'
          : 'Theo dõi bài phù hợp, queue sắp đăng và hiệu quả các social account của bạn.'
      }
      actions={
        <>
          <button
            className="inline-flex h-8 items-center gap-1.5 px-3 rounded-md text-xs font-semibold border transition-colors hover:bg-[var(--surface-container-low)]"
            style={{
              color: 'var(--on-surface)',
              borderColor: 'var(--outline-variant)',
              backgroundColor: 'var(--surface-container-lowest)',
            }}
          >
            <Download size={14} />
            Export Report
          </button>
          <button
            onClick={handleCrawl}
            disabled={crawling || loading}
            className="inline-flex h-8 items-center gap-1.5 px-3 rounded-md text-xs font-semibold transition-colors disabled:opacity-50"
            style={{
              backgroundColor: 'var(--accent)',
              color: 'var(--on-primary)',
            }}
          >
            <Sparkles size={14} className={crawling ? 'animate-spin' : ''} />
            {crawling ? 'Scanning...' : 'AI Content Scan'}
          </button>
        </>
      }
    >

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          <>
            <div className="bento-card p-4 h-24 flex flex-col justify-between">
              <div className="skeleton-loader h-4 w-24" />
              <div className="skeleton-loader h-7 w-16" />
            </div>
            <div className="bento-card p-4 h-24 flex flex-col justify-between">
              <div className="skeleton-loader h-4 w-24" />
              <div className="skeleton-loader h-7 w-16" />
            </div>
            <div className="bento-card p-4 h-24 flex flex-col justify-between">
              <div className="skeleton-loader h-4 w-24" />
              <div className="skeleton-loader h-7 w-16" />
            </div>
            <div className="bento-card p-4 h-24 flex flex-col justify-between">
              <div className="skeleton-loader h-4 w-24" />
              <div className="skeleton-loader h-7 w-16" />
            </div>
          </>
        ) : (
          <>
            <StatCard
              label={isSystemUser ? 'Total Collected' : 'Matched Articles'}
              value={stats?.total_articles.toLocaleString() ?? '—'}
              icon={<Newspaper size={18} />}
              trend={isSystemUser ? '+system' : `${stats?.feed_low_suggestions ?? 0} low`}
              trendUp={true}
              iconBg="var(--surface-container)"
              iconColor="var(--secondary)"
            />
            <StatCard
              label={isSystemUser ? 'Active Users' : 'Active Accounts'}
              value={isSystemUser ? (stats?.users_active ?? '—') : (stats?.profiles_active ?? '—')}
              icon={isSystemUser ? <UsersRound size={18} /> : <CircleUserRound size={18} />}
              trend={isSystemUser ? `${stats?.users_total ?? 0} total` : `${stats?.profiles_total ?? 0} total`}
              trendUp={true}
              iconBg="#dcfce7"
              iconColor="#16a34a"
            />
            <StatCard
              label={isSystemUser ? 'Upcoming Queue' : 'Sắp đăng'}
              value={stats?.queue_status?.upcoming ?? '—'}
              icon={<Clock size={18} />}
              badge={<span className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>{stats?.queue_status?.needs_approval ?? 0} cần duyệt</span>}
              iconBg="#dbeafe"
              iconColor="#2563eb"
            />
            <StatCard
              label={isSystemUser ? 'System Health' : 'Published'}
              value={isSystemUser ? (isRunning ? 'Active' : 'Stopped') : (stats?.published_total ?? '—')}
              icon={isSystemUser ? <TrendingUp size={18} /> : <CheckCircle size={18} />}
              accentBorder
              iconBg="rgba(0,164,114,0.1)"
              iconColor="#00a472"
              badge={
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-bold">
                  {isSystemUser ? (isRunning ? 'LIVE' : 'OFF') : `${stats?.published_failed ?? 0} failed`}
                </span>
              }
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bento-card rounded-xl p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-semibold" style={{ color: 'var(--on-surface)' }}>
                Content Distribution
              </h3>
              <p className="text-xs mt-1" style={{ color: 'var(--on-surface-variant)' }}>
                {isSystemUser ? 'Breakdown of posts across primary channels' : 'Queue trạng thái của các account của bạn'}
              </p>
            </div>
            <select
              className="h-8 rounded-md border px-3 text-xs outline-none"
              style={{ backgroundColor: 'var(--surface-container-low)', borderColor: 'var(--outline-variant)' }}
            >
              <option>Last 7 Days</option>
              <option>Last 30 Days</option>
            </select>
          </div>

          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData}>
                <XAxis
                  dataKey="name"
                  tick={{ fill: 'var(--on-surface-variant)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: 'var(--on-surface-variant)', fontSize: 11 }}
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
                <Bar dataKey="value" fill="var(--accent)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[280px]" style={{ color: 'var(--on-surface-variant)' }}>
              <p className="text-sm">Chưa có dữ liệu</p>
            </div>
          )}
        </div>

        {/* Activity Feed */}
        <EventFeed />
      </div>

      <div className="bento-card rounded-xl p-5">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <span className="text-xs font-semibold uppercase mb-1"
                style={{ color: 'var(--on-surface-variant)' }}>
                {isSystemUser ? 'Scheduler Status' : 'Automation Status'}
              </span>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${
                  isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'
                }`} />
                <span className="text-sm font-semibold capitalize" style={{ color: 'var(--on-surface)' }}>
                  {schedulerStatus}
                </span>
              </div>
            </div>
            
            <div className="h-10 w-px" style={{ backgroundColor: 'var(--outline-variant)' }} />
            
            {isSystemUser && (!isRunning ? (
              <button
                onClick={handleStartScheduler}
                className="inline-flex h-8 items-center gap-1.5 px-3 rounded-md text-xs font-semibold transition-colors"
                style={{ backgroundColor: '#dcfce7', color: '#16a34a' }}
              >
                <Play size={13} fill="currentColor" /> Start Scheduler
              </button>
            ) : (
              <button
                onClick={handleStopScheduler}
                className="inline-flex h-8 items-center gap-1.5 px-3 rounded-md text-xs font-semibold transition-colors"
                style={{ backgroundColor: '#fef3c7', color: '#d97706' }}
              >
                <Pause size={13} fill="currentColor" /> Pause Scheduler
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
    </PageLayout>
  )
}
