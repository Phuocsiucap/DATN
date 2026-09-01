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

interface OpenAiBucketData {
  object: 'page'
  data: Array<{
    object: 'bucket'
    start_time: number
    end_time: number
    results: Array<{
      model?: string
      num_requests?: number
      num_model_requests?: number
      input_tokens?: number
      output_tokens?: number
      seconds?: number
      input_cached_tokens?: number
      input_cache_write_tokens?: number
      input_uncached_tokens?: number
    }>
  }>
}

export default function OpenAiUsagePage() {
  const [costByDayData, setCostByDayData] = useState<OpenAiBucketData | null>(null)
  const [completionsData, setCompletionsData] = useState<OpenAiBucketData | null>(null)
  const [embeddingsData, setEmbeddingsData] = useState<OpenAiBucketData | null>(null)
  const [audioData, setAudioData] = useState<OpenAiBucketData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [timeRange, setTimeRange] = useState<number>(7)

  useEffect(() => {
    async function loadUsage() {
      try {
        setLoading(true)
        const now = Math.floor(Date.now() / 1000)
        const start = now - timeRange * 24 * 3600
        
        const [resCostByDay, resCompletions, resEmbeddings, resAudio] = await Promise.all([
          api.get(`/admin/system/openai-usage/costs-by-day?start_time=${start}`).catch(() => ({ data: null })),
          api.get(`/admin/system/openai-usage/completions?start_time=${start}&group_by=model`),
          api.get(`/admin/system/openai-usage/embeddings?start_time=${start}&group_by=model`),
          api.get(`/admin/system/openai-usage/audio-transcriptions?start_time=${start}&group_by=model`).catch(() => ({ data: null }))
        ])
        
        setCostByDayData(resCostByDay.data)
        setCompletionsData(resCompletions.data)
        setEmbeddingsData(resEmbeddings.data)
        setAudioData(resAudio.data)
      } catch (err: any) {
        setError(err?.response?.data?.detail || 'Không thể tải dữ liệu OpenAI')
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
  
  const spendSeriesData = []
  const costBuckets = costByDayData?.data || []
  let totalCost = 0
  
  for (const bucket of costBuckets) {
    const st = bucket.start_time
    const dateObj = new Date(st * 1000)
    const date = `${dateObj.getDate().toString().padStart(2, '0')}/${(dateObj.getMonth()+1).toString().padStart(2, '0')}`
    
    let dailyCost = 0
    if (bucket.results) {
       for(const res of bucket.results as any[]) {
          if (res.amount && res.amount.value) {
             dailyCost += res.amount.value
          } else if (res.amount) {
             dailyCost += typeof res.amount === 'number' ? res.amount : 0
          }
       }
    }
    
    totalCost += dailyCost
    
    spendSeriesData.push({
       timestamp: st,
       date,
       cost: dailyCost
    })
  }
  spendSeriesData.sort((a, b) => a.timestamp - b.timestamp)
  
  const modelStats: Record<string, { model: string, num_requests: number, input_tokens: number, output_tokens: number, seconds: number }> = {}
  let totalRequests = 0
  let totalTokens = 0
  let totalSeconds = 0
  
  let totalInputCached = 0
  let totalInputCacheWrite = 0
  let totalInputUncached = 0

  const timeSeriesMap: Record<number, any> = {}
  const allModels = new Set<string>()
  const modelMetricType: Record<string, string> = {}

  const processBuckets = (bucketData: OpenAiBucketData | null) => {
    const buckets = bucketData?.data || []
    for (const bucket of buckets) {
      const st = bucket.start_time
      if (!timeSeriesMap[st]) {
        const dateObj = new Date(st * 1000)
        timeSeriesMap[st] = { 
          timestamp: st, 
          date: `${dateObj.getDate().toString().padStart(2, '0')}/${(dateObj.getMonth()+1).toString().padStart(2, '0')}`,
          cache_read: 0,
          cache_write: 0,
          uncached: 0,
          input_tokens: 0,
          output_tokens: 0
        }
      }

      if (!bucket.results) continue
      for (const res of bucket.results) {
        if (!res.model) continue
        allModels.add(res.model)
        
        if (!modelStats[res.model]) {
          modelStats[res.model] = { model: res.model, num_requests: 0, input_tokens: 0, output_tokens: 0, seconds: 0 }
        }
        
        const reqs = (res.num_requests || res.num_model_requests || 0)
        const seconds = res.seconds || 0
        const isAudio = seconds > 0 || res.model.includes('whisper')
        
        modelStats[res.model].num_requests += reqs
        modelStats[res.model].input_tokens += res.input_tokens || 0
        modelStats[res.model].output_tokens += res.output_tokens || 0
        modelStats[res.model].seconds += seconds
        
        totalRequests += reqs
        totalSeconds += seconds
        
        const tokens = (res.input_tokens || 0) + (res.output_tokens || 0)
        totalTokens += tokens
        
        const cached = res.input_cached_tokens || 0
        const cachedWrite = res.input_cache_write_tokens || 0
        let uncached = res.input_uncached_tokens || 0
        
        // If model doesn't support caching (like embeddings), all input tokens are technically uncached
        if (cached === 0 && cachedWrite === 0 && uncached === 0 && (res.input_tokens || 0) > 0) {
          uncached = res.input_tokens || 0
        }
        
        totalInputCached += cached
        totalInputCacheWrite += cachedWrite
        totalInputUncached += uncached
        
        timeSeriesMap[st]['cache_read'] += cached
        timeSeriesMap[st]['cache_write'] += cachedWrite
        timeSeriesMap[st]['uncached'] += uncached
        timeSeriesMap[st]['input_tokens'] += (res.input_tokens || 0)
        timeSeriesMap[st]['output_tokens'] += (res.output_tokens || 0)
        
        modelMetricType[res.model] = isAudio ? 'Seconds' : 'Tokens'
        
        if (!timeSeriesMap[st][res.model]) {
          timeSeriesMap[st][res.model] = 0
        }
        timeSeriesMap[st][res.model] += (isAudio ? seconds : tokens)
      }
    }
  }

  processBuckets(completionsData)
  processBuckets(embeddingsData)
  processBuckets(audioData)

  const timeSeriesData = Object.values(timeSeriesMap).sort((a: any, b: any) => a.timestamp - b.timestamp)
  const modelsList = Array.from(allModels)
  const COLORS = ['#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#4f46e5', '#ec4899', '#06b6d4']
  
  const cacheHitRate = (totalInputCached + totalInputUncached) > 0 
      ? ((totalInputCached / (totalInputCached + totalInputUncached)) * 100).toFixed(1)
      : '0.0'

  return (
    <PageLayout
      title="Sử dụng OpenAI API"
      description="Theo dõi lưu lượng token, chi phí và tỷ lệ cache hit của OpenAI API."
      actions={
        <select
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

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-[12px] border border-[#333] bg-[#1a1a1a] p-6 shadow-sm text-white flex flex-col">
          <h2 className="mb-2 text-sm text-gray-400">Total Spend</h2>
          <div className="mb-6 text-3xl font-extrabold text-white">
            ${totalCost.toFixed(4)}
          </div>
          <div className="h-[250px] w-full mt-auto">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={spendSeriesData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9ca3af' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9ca3af' }} tickFormatter={(val) => `$${val.toFixed(2)}`} />
                <Tooltip
                  cursor={{ fill: '#333' }}
                  contentStyle={{ backgroundColor: '#000', borderRadius: '8px', border: '1px solid #333', color: '#fff' }}
                  formatter={(value: any) => [`$${Number(value || 0).toFixed(4)}`, 'Chi phí']}
                />
                <Bar dataKey="cost" fill="#8b5cf6" radius={[4, 4, 0, 0]} maxBarSize={60} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-[12px] border border-[#333] bg-[#1a1a1a] p-6 shadow-sm text-white flex flex-col">
          <h2 className="mb-2 text-sm text-gray-400">Total tokens</h2>
          <div className="mb-6 text-3xl font-extrabold text-white">
            {totalTokens.toLocaleString()}
          </div>
          <div className="h-[250px] w-full mt-auto">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timeSeriesData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9ca3af' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9ca3af' }} tickFormatter={(val) => val >= 1000 ? `${(val/1000).toFixed(0)}k` : val} />
                <Tooltip
                  cursor={{ stroke: '#333', strokeWidth: 1 }}
                  contentStyle={{ backgroundColor: '#000', borderRadius: '8px', border: '1px solid #333', color: '#fff' }}
                />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} iconType="plainline" />
                <Line type="monotone" dataKey="input_tokens" name="Input Tokens" stroke="#f97316" strokeWidth={2} dot={{ r: 3, fill: '#1a1a1a', strokeWidth: 2 }} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="output_tokens" name="Output Tokens" stroke="#ec4899" strokeWidth={2} dot={{ r: 3, fill: '#1a1a1a', strokeWidth: 2 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-[12px] border border-[#333] bg-[#1a1a1a] p-6 shadow-sm text-white">
          <h2 className="mb-6 text-sm font-bold text-gray-200">Cache performance</h2>
          <div className="grid grid-cols-2">
            <div>
              <div className="text-sm text-gray-400">Hit rate (cache-read ratio)</div>
              <div className="mt-2 text-2xl font-semibold">
                {cacheHitRate}%
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-400">Cache reads per write</div>
              <div className="mt-2 text-2xl font-semibold">
                {totalInputCacheWrite > 0 ? (totalInputCached / totalInputCacheWrite).toFixed(1) : '—'}
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-[12px] border border-[#333] bg-[#1a1a1a] p-6 shadow-sm text-white">
          <h2 className="mb-6 text-sm font-bold text-gray-200">Token volume</h2>
          <div className="grid grid-cols-3">
            <div>
              <div className="text-sm text-gray-400">Cache-read tokens</div>
              <div className="mt-2 text-2xl font-semibold">
                {totalInputCached >= 1000 ? (totalInputCached/1000).toFixed(0) + 'K' : totalInputCached}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-400">Cache-write tokens</div>
              <div className="mt-2 text-2xl font-semibold">
                {totalInputCacheWrite >= 1000 ? (totalInputCacheWrite/1000).toFixed(0) + 'K' : totalInputCacheWrite}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-400">Uncached tokens</div>
              <div className="mt-2 text-2xl font-semibold">
                {totalInputUncached >= 1000 ? (totalInputUncached/1000).toFixed(0) + 'K' : totalInputUncached}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="rounded-[12px] border border-[#333] bg-[#1a1a1a] p-6 shadow-sm text-white">
        <h2 className="mb-6 text-sm font-bold text-gray-200">Input token composition</h2>
        <div className="h-[250px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={timeSeriesData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" />
              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9ca3af' }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9ca3af' }} tickFormatter={(val) => val >= 1000 ? `${(val/1000).toFixed(0)}k` : val} />
              <Tooltip
                cursor={{ fill: '#333' }}
                contentStyle={{ backgroundColor: '#000', borderRadius: '8px', border: '1px solid #333', color: '#fff' }}
              />
              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} iconType="square" />
              <Bar dataKey="cache_read" name="Cache reads" stackId="a" fill="#10b981" maxBarSize={40} />
              <Bar dataKey="cache_write" name="Cache writes" stackId="a" fill="#8b5cf6" maxBarSize={40} />
              <Bar dataKey="uncached" name="Uncached" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {modelsList.length > 0 && (
        <div className="space-y-6">
          <h2 className="text-lg font-bold text-[#111827]">Chi tiết sử dụng từng Model (7 ngày qua)</h2>
          <div className="grid gap-6 lg:grid-cols-2">
            {modelsList.map((model, idx) => {
              const metric = modelMetricType[model]
              const color = COLORS[idx % COLORS.length]
              const stat = modelStats[model]
              
              return (
                <div key={model} className="rounded-[12px] border border-[var(--outline-variant)] bg-white p-6 shadow-sm flex flex-col">
                  <h3 className="mb-4 flex items-center text-base font-bold text-[#111827]">
                    <div className="mr-2 h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
                    {model} <span className="ml-2 text-sm font-normal text-[#64748b]">({metric})</span>
                  </h3>
                  
                  <div className="mb-6 flex gap-6 text-sm">
                    <div>
                      <div className="text-[#64748b]">Requests</div>
                      <div className="font-semibold text-[#111827]">{stat?.num_requests?.toLocaleString() || 0}</div>
                    </div>
                    {metric === 'Tokens' ? (
                      <>
                        <div>
                          <div className="text-[#64748b]">Input Tokens</div>
                          <div className="font-semibold text-[#111827]">{stat?.input_tokens?.toLocaleString() || 0}</div>
                        </div>
                        <div>
                          <div className="text-[#64748b]">Output Tokens</div>
                          <div className="font-semibold text-[#111827]">{stat?.output_tokens?.toLocaleString() || 0}</div>
                        </div>
                      </>
                    ) : (
                      <div>
                        <div className="text-[#64748b]">Audio (Seconds)</div>
                        <div className="font-semibold text-[#111827]">{stat?.seconds ? `${stat.seconds.toLocaleString()}s` : '0s'}</div>
                      </div>
                    )}
                  </div>

                  <div className="h-[220px] w-full mt-auto">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={timeSeriesData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(val) => {
                          if (val >= 1000) return `${(val/1000).toFixed(1)}k`
                          return val
                        }} />
                        <Tooltip
                          cursor={{ fill: '#f8faff' }}
                          contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                          formatter={(value: any) => [Number(value || 0).toLocaleString(), metric]}
                        />
                        <Bar dataKey={model} fill={color} radius={[4, 4, 0, 0]} maxBarSize={40} />
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
