import { useEffect, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
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
  total_input_tokens: number
  total_output_tokens: number
  cost_series: Array<{
    date: string
    full_date: string
    timestamp: number
    cost: number
    requests: number
    tokens: number
    input_tokens: number
    output_tokens: number
  }>
  models: Record<string, {
    total_requests: number
    total_tokens: number
    total_input_tokens: number
    total_output_tokens: number
    series: Array<{
      date: string
      full_date: string
      timestamp: number
      requests: number
      tokens: number
      input_tokens: number
      output_tokens: number
    }>
  }>
}

export default function DeepseekUsagePage() {
  const [data, setData] = useState<DeepseekUsageMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [timeRange, setTimeRange] = useState<number>(7)

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

  const COLORS = ['#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#4f46e5', '#ec4899', '#06b6d4']

  return (
    <PageLayout
      title="Sử dụng DeepSeek API"
      description="Theo dõi lưu lượng token, chi phí và số dư của DeepSeek API."
      actions={
        <select data-filter-control
          value={timeRange}
          onChange={(e) => setTimeRange(Number(e.target.value))}
          className="rounded-md border border-[var(--outline-variant)] bg-white px-3 py-1.5 text-sm text-[#111827] shadow-sm outline-none focus:border-[#8b5cf6]"
        >
          <option value={7}>7 ngày qua</option>
          <option value={14}>14 ngày qua</option>
          <option value={30}>30 ngày qua</option>
        </select>
      }
    >
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm flex items-center justify-between">
         <div>
            <div className="text-sm font-bold text-slate-500 uppercase tracking-wider">Topped-up balance</div>
            <div className="mt-2 text-3xl font-black text-slate-900">
               ${data?.balance?.total_balance?.toFixed(2) || '0.00'}
            </div>
         </div>
         <a href="https://platform.deepseek.com/top_up" target="_blank" rel="noreferrer" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition-colors">
            Top up DeepSeek
         </a>
      </div>

      <div className="grid gap-6 md:grid-cols-2 mb-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm flex flex-col">
          <h2 className="mb-2 text-sm font-bold text-slate-500 uppercase tracking-wider">Total Spend</h2>
          <div className="mb-6 text-3xl font-black text-slate-900">
            ${data?.total_cost?.toFixed(4) || '0.0000'}
          </div>
          <div className="h-[250px] w-full mt-auto">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.cost_series || []} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b', fontWeight: 600 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b', fontWeight: 600 }} tickFormatter={(val) => `$${val.toFixed(2)}`} />
                <Tooltip
                  cursor={{ fill: '#f8faff' }}
                  contentStyle={{ backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', color: '#0f172a', fontWeight: 'bold', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  formatter={(value: any) => [`$${Number(value || 0).toFixed(4)}`, 'Chi phí']}
                />
                <Bar dataKey="cost" fill="#8b5cf6" radius={[4, 4, 0, 0]} maxBarSize={60} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm flex flex-col">
          <h2 className="mb-2 text-sm font-bold text-slate-500 uppercase tracking-wider">Total tokens</h2>
          <div className="mb-6 text-3xl font-black text-slate-900">
            {data?.total_tokens?.toLocaleString() || 0}
          </div>
          <div className="h-[250px] w-full mt-auto">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.cost_series || []} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b', fontWeight: 600 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b', fontWeight: 600 }} tickFormatter={(val) => val >= 1000 ? `${(val/1000).toFixed(0)}k` : val} />
                <Tooltip
                  cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 4' }}
                  contentStyle={{ backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', color: '#0f172a', fontWeight: 'bold', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px', fontWeight: 'bold' }} iconType="plainline" />
                <Line type="monotone" dataKey="input_tokens" name="Input Tokens" stroke="#f97316" strokeWidth={3} dot={{ r: 4, fill: '#ffffff', strokeWidth: 2 }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="output_tokens" name="Output Tokens" stroke="#ec4899" strokeWidth={3} dot={{ r: 4, fill: '#ffffff', strokeWidth: 2 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {data?.models && Object.keys(data.models).length > 0 && (
        <div className="space-y-6">
          <h2 className="text-lg font-bold text-[#111827]">Chi tiết sử dụng từng Model ({timeRange} ngày qua)</h2>
          <div className="grid gap-6 lg:grid-cols-2">
            {Object.entries(data.models).map(([modelName, modelData], idx) => {
              const color = COLORS[idx % COLORS.length]
              
              return (
                <div key={modelName} className="rounded-[12px] border border-[var(--outline-variant)] bg-white p-6 shadow-sm flex flex-col">
                  <h3 className="mb-4 flex items-center text-base font-bold text-[#111827]">
                    <div className="mr-2 h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
                    {modelName} <span className="ml-2 text-sm font-normal text-[#64748b]">(Tokens)</span>
                  </h3>
                  
                  <div className="mb-6 flex gap-6 text-sm">
                    <div>
                      <div className="text-[#64748b]">Requests</div>
                      <div className="font-semibold text-[#111827]">{modelData.total_requests.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-[#64748b]">Input Tokens</div>
                      <div className="font-semibold text-[#111827]">{modelData.total_input_tokens?.toLocaleString() || 0}</div>
                    </div>
                    <div>
                      <div className="text-[#64748b]">Output Tokens</div>
                      <div className="font-semibold text-[#111827]">{modelData.total_output_tokens?.toLocaleString() || 0}</div>
                    </div>
                  </div>

                  <div className="h-[220px] w-full mt-auto">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={modelData.series} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(val) => {
                          if (val >= 1000) return `${(val/1000).toFixed(1)}k`
                          return val
                        }} />
                        <Tooltip
                          cursor={{ fill: '#f8faff' }}
                          contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                          formatter={(value: any) => [Number(value || 0).toLocaleString(), 'Tokens']}
                        />
                        <Bar dataKey="tokens" fill={color} radius={[4, 4, 0, 0]} maxBarSize={40} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </PageLayout>
  )
}
