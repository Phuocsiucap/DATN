import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import { fetchArticlesApi, publishArticleApi } from '@/commons/apis/api'

export interface Article {
  id?: string
  title: string
  link: string
  content?: string | string[]
  summary?: string
  image?: string
  images?: string[]
  videos?: string[]
  status: 'crawled' | 'published' | 'failed'
  crawled_at?: string
  quality_score?: number
  content_scope?: string
  published?: Record<string, boolean>
  match_score?: number
  match_status?: 'matched' | 'low_suggestion'
  match_reason?: string
  matched_keywords?: string[]
  matched_at?: string
}

interface ArticlesState {
  items: Article[]
  total: number
  page: number
  loading: boolean
  publishing: Record<string, boolean>
  statusFilter: string
  hasVideoFilter: string
}

const initialState: ArticlesState = {
  items: [],
  total: 0,
  page: 1,
  loading: false,
  publishing: {},
  statusFilter: '',
  hasVideoFilter: '',
}

export const fetchArticles = createAsyncThunk(
  'articles/fetch',
  async ({
    page,
    status,
    search,
    startDate,
    endDate,
    hasVideo,
    sourceType,
    crawlJobId,
  }: {
    page: number
    status?: string
    search?: string
    startDate?: string
    endDate?: string
    hasVideo?: string | boolean
    sourceType?: string
    crawlJobId?: string
  }) => {
    return await fetchArticlesApi(page, status, search, startDate, endDate, hasVideo, sourceType, crawlJobId)
  }
)

export const publishArticle = createAsyncThunk(
  'articles/publish',
  async ({ link, platforms, profileIds = [] }: { link: string; platforms: string[]; profileIds?: (number | string)[] }) => {
    return await publishArticleApi(link, platforms, profileIds)
  }
)

const articlesSlice = createSlice({
  name: 'articles',
  initialState,
  reducers: {
    setStatusFilter(state, action: PayloadAction<string>) {
      state.statusFilter = action.payload
      state.page = 1
    },
    setHasVideoFilter(state, action: PayloadAction<string>) {
      state.hasVideoFilter = action.payload
      state.page = 1
    },
    prependArticle(state, action: PayloadAction<Article>) {
      state.items.unshift(action.payload)
      state.total += 1
    },
    updateArticleStatus(state, action: PayloadAction<{ link: string; status: Article['status'] }>) {
      const item = state.items.find(a => a.link === action.payload.link)
      if (item) item.status = action.payload.status
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchArticles.pending, (state) => { state.loading = true })
      .addCase(fetchArticles.fulfilled, (state, action) => {
        state.loading = false
        state.items = action.payload.items
        state.total = action.payload.total
        state.page = action.payload.page
      })
      .addCase(fetchArticles.rejected, (state) => { state.loading = false })
      .addCase(publishArticle.pending, (state, action) => {
        state.publishing[action.meta.arg.link] = true
      })
      .addCase(publishArticle.fulfilled, (state, action) => {
        state.publishing[action.meta.arg.link] = false
      })
      .addCase(publishArticle.rejected, (state, action) => {
        state.publishing[action.meta.arg.link] = false
      })
  },
})

export const { setStatusFilter, setHasVideoFilter, prependArticle, updateArticleStatus } = articlesSlice.actions
export default articlesSlice.reducer
