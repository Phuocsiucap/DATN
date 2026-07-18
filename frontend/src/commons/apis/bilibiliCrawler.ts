import { api } from './client'

export type BilibiliCrawlerJob = {
  id: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  stage: 'queued' | 'keyword' | 'downloading' | 'transcribing' | 'translating' | 'rendering' | 'completed' | 'failed'
  progress: number
  input_text: string
  niche: string
  max_duration_seconds?: number
  source_url?: string | null
  artifacts: Record<string, any>
  error_message?: string | null
  created_at: string
  updated_at: string
}

export type BilibiliSearchMode = 'keyword' | 'trending' | 'link'

export type BilibiliSearchCandidate = {
  title: string
  title_vi?: string | null
  url: string
  aid?: number | null
  bvid?: string | null
  platform: string
  duration_seconds?: number | null
  query: string
  thumbnail_url?: string | null
  description?: string | null
  review_count?: number | null
  danmaku_count?: number | null
  episode_count_text?: string | null
  embed_url?: string | null
  preview_mode?: string
  downloadable?: boolean
  availability_note?: string | null
  series_key?: string | null
  series_title?: string | null
  episode_index?: number | null
  playlist_size?: number | null
}

export type BilibiliVideoDetailEpisode = Pick<
  BilibiliSearchCandidate,
  | 'title'
  | 'url'
  | 'aid'
  | 'bvid'
  | 'platform'
  | 'duration_seconds'
  | 'thumbnail_url'
  | 'description'
  | 'embed_url'
  | 'preview_mode'
  | 'downloadable'
  | 'episode_index'
  | 'playlist_size'
> & {
  query?: 'view_detail_pages'
}

export type BilibiliVideoDetailRelated = Pick<
  BilibiliSearchCandidate,
  | 'title'
  | 'url'
  | 'aid'
  | 'bvid'
  | 'platform'
  | 'duration_seconds'
  | 'thumbnail_url'
  | 'description'
  | 'embed_url'
  | 'preview_mode'
  | 'downloadable'
> & {
  query?: 'related'
}

export type BilibiliSearchResponse = {
  keyword_plan: {
    source_text_vi: string
    keyword_zh: string
    queries: string[]
    platform_priority: string[]
    provider: string
    inferred_niche?: string
    confidence?: number
    reasoning?: string
  }
  candidates: BilibiliSearchCandidate[]
}

export type BilibiliKeywordPlan = BilibiliSearchResponse['keyword_plan']

export type BilibiliPreviewUrl = {
  url: string
  title: string | null
  duration_seconds: number | null
}

export type BilibiliSeriesInfo = {
  aid: number | null
  bvid: string | null
  title: string
  episode_count: number
  related_count: number
  source: string
  current?: BilibiliSearchCandidate | null
  episodes?: BilibiliVideoDetailEpisode[]
  related?: BilibiliVideoDetailRelated[]
}

export type BilibiliDeepSeekConfig = {
  api_key_masked: string
  has_api_key: boolean
  base_url: string
  keyword_model: string
  subtitle_model: string
  reasoning_effort: string
  config_path: string
}

export type BilibiliSubtitleStyle = {
  font_size: number
  position: 'bottom' | 'middle' | 'top'
}

export type BilibiliVideoFilter = {
  preset: 'studio_bright' | 'cinematic_dark' | 'warm_pop' | 'cool_clean' | 'natural'
  speed: number
}

const bilibiliCrawlerPath = (path: string) => `/bilibili-crawler${path}`

export const searchBilibiliCrawlerApi = async (payload: {
  input_text: string
  sources?: string[]
  max_duration_seconds?: number
  limit?: number
  mode?: BilibiliSearchMode
}) => {
  const { data } = await api.post<BilibiliSearchResponse>(bilibiliCrawlerPath('/search'), {
    sources: ['bilibili'],
    max_duration_seconds: 7200,
    limit: 30,
    ...payload,
  })
  return data
}

export const createBilibiliCrawlerKeywordPlanApi = async (payload: {
  input_text: string
  niche: string
}) => {
  const { data } = await api.post<BilibiliKeywordPlan>(bilibiliCrawlerPath('/keyword-plan'), payload)
  return data
}

export const getBilibiliCrawlerPreviewUrlApi = async (url: string) => {
  const { data } = await api.post<BilibiliPreviewUrl>(bilibiliCrawlerPath('/preview-url'), { url })
  return data
}

export const getBilibiliCrawlerSeriesInfoApi = async (payload: {
  url?: string | null
  aid?: number | null
  bvid?: string | null
}) => {
  const { data } = await api.post<BilibiliSeriesInfo>(bilibiliCrawlerPath('/series-info'), payload)
  return data
}

export const fetchBilibiliCrawlerJobsApi = async () => {
  const { data } = await api.get<BilibiliCrawlerJob[]>(bilibiliCrawlerPath('/jobs'))
  return data
}

export const createBilibiliCrawlerJobApi = async (payload: {
  input_text: string
  source_url?: string | null
  source_platform?: string | null
  source_title?: string | null
  max_duration_seconds?: number
}) => {
  const { data } = await api.post<BilibiliCrawlerJob>(bilibiliCrawlerPath('/jobs'), {
    niche: 'smart_home',
    max_duration_seconds: 7200,
    ...payload,
  })
  return data
}

export const deleteBilibiliCrawlerJobApi = async (jobId: number) => {
  const { data } = await api.delete<BilibiliCrawlerJob>(bilibiliCrawlerPath(`/jobs/${jobId}`))
  return data
}

export const retryBilibiliCrawlerJobApi = async (jobId: number) => {
  const { data } = await api.post<BilibiliCrawlerJob>(bilibiliCrawlerPath(`/jobs/${jobId}/retry`))
  return data
}

export const cancelBilibiliCrawlerJobApi = async (jobId: number) => {
  const { data } = await api.post<BilibiliCrawlerJob>(bilibiliCrawlerPath(`/jobs/${jobId}/cancel`))
  return data
}

export const retranslateBilibiliCrawlerJobApi = async (jobId: number) => {
  const { data } = await api.post<BilibiliCrawlerJob>(bilibiliCrawlerPath(`/jobs/${jobId}/retranslate`))
  return data
}

export const applyBilibiliCrawlerSubtitlesApi = async (jobId: number, style: BilibiliSubtitleStyle) => {
  const { data } = await api.post<BilibiliCrawlerJob>(bilibiliCrawlerPath(`/jobs/${jobId}/apply-subtitles`), style)
  return data
}

export const applyBilibiliCrawlerFilterApi = async (jobId: number, style: BilibiliVideoFilter) => {
  const { data } = await api.post<BilibiliCrawlerJob>(bilibiliCrawlerPath(`/jobs/${jobId}/apply-filter`), style)
  return data
}

export const mergeBilibiliCrawlerPartsApi = async (jobId: number, segment_indexes: number[]) => {
  const { data } = await api.post<BilibiliCrawlerJob>(bilibiliCrawlerPath(`/jobs/${jobId}/merge-parts`), { segment_indexes })
  return data
}

export const mergeBilibiliCrawlerJobsApi = async (job_ids: number[]) => {
  const { data } = await api.post<BilibiliCrawlerJob>(bilibiliCrawlerPath(`/jobs/merge-jobs`), { job_ids })
  return data
}

export const generateBilibiliCrawlerTikTokMetadataApi = async (jobId: number) => {
  const { data } = await api.post(bilibiliCrawlerPath(`/jobs/${jobId}/tiktok-metadata`))
  return data
}

export const openBilibiliCrawlerOutputFolderApi = async (jobId: number) => {
  const { data } = await api.post(bilibiliCrawlerPath(`/jobs/${jobId}/open-folder`))
  return data
}

export const translateBilibiliCrawlerTitleApi = async (title: string) => {
  const { data } = await api.post(bilibiliCrawlerPath('/translate-title'), { title })
  return data
}

export const fetchBilibiliCrawlerDeepSeekConfigApi = async () => {
  const { data } = await api.get<BilibiliDeepSeekConfig>(bilibiliCrawlerPath('/config/deepseek'))
  return data
}

export const updateBilibiliCrawlerDeepSeekConfigApi = async (payload: {
  api_key?: string
  base_url: string
  keyword_model: string
  subtitle_model: string
  reasoning_effort?: string
}) => {
  const { data } = await api.put<BilibiliDeepSeekConfig>(bilibiliCrawlerPath('/config/deepseek'), payload)
  return data
}

export const getBilibiliCrawlerMediaUrl = (jobId: number, key: 'raw_video_path' | 'output_video_path', version?: string) => {
  const suffix = version ? `?v=${encodeURIComponent(version)}` : ''
  return `${api.defaults.baseURL}${bilibiliCrawlerPath(`/jobs/${jobId}/media/${key}`)}${suffix}`
}

export const getBilibiliCrawlerSegmentUrl = (jobId: number, segmentIndex: number, version?: string) => {
  const suffix = version ? `?v=${encodeURIComponent(version)}` : ''
  return `${api.defaults.baseURL}${bilibiliCrawlerPath(`/jobs/${jobId}/segments/${segmentIndex}`)}${suffix}`
}

export const getBilibiliCrawlerImageProxyUrl = (url?: string | null) => {
  return url ? `${api.defaults.baseURL}${bilibiliCrawlerPath(`/image-proxy?url=${encodeURIComponent(url)}`)}` : ''
}
