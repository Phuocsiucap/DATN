import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { fetchStatsApi } from '../../services/api'

export interface Stats {
  total_articles: number
  crawled_last_24h: number
  crawled_last_1h: number
  published_total: number
  published_failed: number
  by_platform: Record<string, number>
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
