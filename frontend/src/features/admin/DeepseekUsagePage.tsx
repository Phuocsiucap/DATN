import { useEffect, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { api } from '@/commons/apis/api'
import { PageLayout } from '@/commons/component/social-ui'

interface DeepseekUsageMetrics {
  balance: {
    is_available: boolean
    total_balance: number
  }
  total_cost: number
  total_api_requests: number
  total_tokens: number
  cost_series: Array<{
    date: string
    full_date: string
    timestamp: number
    cost: number
    requests: number
    tokens: number
  }>
  models: Record<string, {
    total_requests: number
    total_tokens: number
    series: Array<{
      date: string
      full_date: string
      timestamp: number
      requests: number
      tokens: number
    }>
  }>
}

export default function DeepseekUsagePage() {
  const [data, setData] = useState<DeepseekUsageMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [timeRange, setTimeRange] = useState<number>(30)

  useEffect(() => {
    async function loadUsage() {
      try {
        setLoading(true)
        const now = Math.floor(Date.now() / 1000)
        const start = now - timeRange * 24 * 3600
        
        const res = await api.get(`/admin/system/deepseek-usage/metrics?start_time=${start}`)
        setData(res.data)
      } catch (err: any) {
        setError(err?.response?.data?.detail || 'Không thể tải dữ liệu DeepSeek')
      } finally {
        setLoading(false)
      }
    }
    void loadUsage()
  }, [timeRange])

  if (loading) {
    return <div className="p-6 text-sm text-[#64748b]">Đang tải dữ liệu...</div>
  }

  if (error) {
    return <div className="p-6 text-sm text-red-500">{error}</div>
  }

  const CustomTooltip = ({ active, payload, label, unit }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-3 shadow-xl">
          <p className="mb-2 text-sm text-slate-300">{payload[0].payload.full_date}</p>
          <p className="text-sm font-bold text-white">
            {unit === '$' ? '$' : ''}{payload[0].value.toLocaleString(undefined, { maximumFractionDigits: 4 })}
          </p>
        </div>
      )
    }
    return null
  }

  return (
    <PageLayout
      title="Sử dụng DeepSeek"
      description="Theo dõi lưu lượng token, chi phí và số dư của DeepSeek API."
    >
      <div className="mb-6 space-y-6">
        
        {/* Top Cards: Balance & Total Cost */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-900 p-6 text-white shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-400">Topped-up balance</span>
              <a href="https://platform.deepseek.com/top_up" target="_blank" rel="noreferrer" className="rounded-full bg-white px-4 py-1 text-sm font-semibold text-slate-900 hover:bg-slate-100 transition-colors">
                Top up
              </a>
            </div>
            <div className="mt-2 text-4xl font-bold">
              ${data?.balance?.total_balance?.toFixed(2) || '0.00'} <span className="text-xl text-slate-500">USD</span>
            </div>
          </div>
          
          <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-900 p-6 text-white shadow-sm">
            <div className="mb-2 text-sm font-medium text-slate-400">Total cost</div>
            <div className="mt-2 text-4xl font-bold">
              ${data?.total_cost?.toFixed(2) || '0.00'} <span className="text-xl text-slate-500">USD</span>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center space-x-4 text-sm text-slate-400">
            <div className="flex items-center space-x-2 rounded-full border border-slate-800 bg-slate-900 px-4 py-1.5">
              <span>Time</span>
              <select 
                value={timeRange} 
                onChange={e => setTimeRange(Number(e.target.value))}
                className="bg-transparent text-white outline-none cursor-pointer"
              >
                <option value={7} className="text-slate-900">Last 7 days</option>
                <option value={14} className="text-slate-900">Last 14 days</option>
                <option value={30} className="text-slate-900">Last 30 days</option>
              </select>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-white shadow-sm">
            <div className="text-sm font-medium text-slate-400">Cost</div>
            <div className="mt-4 text-3xl font-bold">${data?.total_cost?.toFixed(2) || '0.00'} <span className="text-lg text-slate-500">USD</span></div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-white shadow-sm">
            <div className="text-sm font-medium text-slate-400">API requests</div>
            <div className="mt-4 text-3xl font-bold">{data?.total_api_requests?.toLocaleString() || 0}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-white shadow-sm">
            <div className="text-sm font-medium text-slate-400">Tokens</div>
            <div className="mt-4 text-3xl font-bold">{data?.total_tokens?.toLocaleString() || 0}</div>
          </div>
        </div>

        {/* Cost Bar Chart */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <div className="mb-6 text-sm font-medium text-white">Cost(USD) <span className="text-slate-400">${data?.total_cost?.toFixed(2) || '0.00'}</span></div>
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.cost_series || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} minTickGap={20} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                <Tooltip content={<CustomTooltip unit="$" />} cursor={{ fill: '#1e293b' }} />
                <Bar dataKey="cost" fill="#f97316" radius={[2, 2, 0, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Models Detail */}
        {data?.models && Object.entries(data.models).map(([modelName, modelData]) => (
          <div key={modelName} className="mt-8 space-y-4">
            <h2 className="text-lg font-bold text-slate-900">{modelName}</h2>
            
            <div className="grid gap-6 md:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
                <div className="mb-6 text-sm font-medium text-white">API requests <span className="text-slate-400">{modelData.total_requests.toLocaleString()}</span></div>
                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={modelData.series} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} minTickGap={20} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                      <Tooltip content={<CustomTooltip />} cursor={{ fill: '#1e293b' }} />
                      <Bar dataKey="requests" fill="#3b82f6" radius={[2, 2, 0, 0]} maxBarSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
                <div className="mb-6 text-sm font-medium text-white">Tokens <span className="text-slate-400">{modelData.total_tokens.toLocaleString()}</span></div>
                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={modelData.series} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} minTickGap={20} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} />
                      <Tooltip content={<CustomTooltip />} cursor={{ fill: '#1e293b' }} />
                      <Bar dataKey="tokens" fill="#0ea5e9" radius={[2, 2, 0, 0]} maxBarSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        ))}

      </div>
    </PageLayout>
  )
}
