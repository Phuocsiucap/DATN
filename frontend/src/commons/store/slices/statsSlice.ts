import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { fetchStatsApi } from '@/commons/apis/api'

export interface Stats {
  scope: 'system' | 'user'
  total_articles: number
  crawled_last_24h: number
  crawled_last_1h: number
  published_total: number
  published_failed: number
  by_platform: Record<string, number>
  profiles_total: number
  profiles_active: number
  queue_status: Record<string, number>
  ai_matches_total: number
  social_posts_total: number
  users_total?: number
  users_active?: number
  feed_matched?: number
  feed_low_suggestions?: number
}

interface StatsState {
  data: Stats | null
  loading: boolean
}

const initialState: StatsState = { data: null, loading: false }

export const fetchStats = createAsyncThunk('stats/fetch', async () => {
  return await fetchStatsApi()
})

const statsSlice = createSlice({
  name: 'stats',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchStats.pending, (state) => { state.loading = true })
      .addCase(fetchStats.fulfilled, (state, action) => {
        state.loading = false
        state.data = action.payload
      })
      .addCase(fetchStats.rejected, (state) => { state.loading = false })
  },
})

export default statsSlice.reducer
