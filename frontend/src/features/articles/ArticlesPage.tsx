import { useEffect, useState } from 'react'
import { useAppDispatch, useAppSelector } from '@/commons/hooks/useAppDispatch'
import { fetchArticles, setStatusFilter } from '@/commons/store/slices/articlesSlice'
import ArticleRow from '@/features/articles/components/ArticleRow'
import { ChevronLeft, ChevronRight, Filter, Loader2, Radar, Save, Search, Sparkles } from 'lucide-react'
import ArticleDetailModal from '@/features/articles/components/ArticleDetailModal'
import type { Article } from '@/commons/store/slices/articlesSlice'
import {
  customTopicCrawlApi,
  fetchCrawlSettingsApi,
  fetchMyArticleFeedApi,
  fetchSocialProfilesApi,
  matchArticlesForMeApi,
  updateCrawlSettingsApi,
} from '@/commons/apis/api'

const FILTERS = [
  { label: 'Tất cả', value: '' },
  { label: 'Mới crawl', value: 'crawled' },
  { label: 'Đã đăng', value: 'published' },
  { label: 'Thất bại', value: 'failed' },
]

const PAGE_SIZE = 20

type SocialProfileOption = {
  id: number
  platform: string
  profile_name: string
  username?: string | null
  status: string
}

export default function ArticlesPage() {
  const dispatch = useAppDispatch()
  const { items, total, page, loading, statusFilter } = useAppSelector(s => s.articles)
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null)
  const [viewMode, setViewMode] = useState<'global' | 'feed'>('global')
  const [feedItems, setFeedItems] = useState<Article[]>([])
  const [feedTotal, setFeedTotal] = useState(0)
  const [feedPage, setFeedPage] = useState(1)
  const [feedLoading, setFeedLoading] = useState(false)
  const [feedMessage, setFeedMessage] = useState('')
  const [socialProfiles, setSocialProfiles] = useState<SocialProfileOption[]>([])
  const [keywordsInput, setKeywordsInput] = useState('')
  const [excludeKeywordsInput, setExcludeKeywordsInput] = useState('')
  const [minScore, setMinScore] = useState(70)
  const [includeLow, setIncludeLow] = useState(false)
  const [useAiScoring, setUseAiScoring] = useState(true)
  const [customCrawlLimit, setCustomCrawlLimit] = useState(10)
  const [searchInput, setSearchInput] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [hasVideoInput, setHasVideoInput] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const buildParams = (p = page) => ({
    page: p,
    status: statusFilter || undefined,
    search: searchInput || undefined,
    startDate: startDate ? new Date(startDate).toISOString() : undefined,
    endDate: endDate ? new Date(endDate).toISOString() : undefined,
    hasVideo: hasVideoInput || undefined,
  })

  const parseKeywords = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean)

  const loadFeed = async (p = feedPage) => {
    setFeedLoading(true)
    setFeedMessage('')
    try {
      const data = await fetchMyArticleFeedApi(p, includeLow)
      setFeedItems(data.items || [])
      setFeedTotal(data.total || 0)
      setFeedPage(data.page || p)
    } catch (error: any) {
      setFeedMessage(error?.response?.data?.detail || 'Không thể tải feed cá nhân')
    } finally {
      setFeedLoading(false)
    }
  }

  const loadCrawlSettings = async () => {
    try {
      const data = await fetchCrawlSettingsApi()
      setKeywordsInput((data.keywords || []).join(', '))
      setExcludeKeywordsInput((data.exclude_keywords || []).join(', '))
      setMinScore(data.min_score ?? 70)
      setIncludeLow(Boolean(data.include_low_suggestions))
      setUseAiScoring(data.use_ai_scoring ?? true)
    } catch {
      setFeedMessage('Chưa tải được cấu hình crawl cá nhân')
    }
  }

  const loadSocialProfiles = async () => {
    try {
      const data = await fetchSocialProfilesApi()
      setSocialProfiles(data.items || [])
    } catch {
      setSocialProfiles([])
    }
  }

  useEffect(() => {
    dispatch(fetchArticles(buildParams()))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, page, statusFilter])

  useEffect(() => {
    void loadCrawlSettings()
    void loadSocialProfiles()
  }, [])

  useEffect(() => {
    if (viewMode === 'feed') {
      void loadFeed(1)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, includeLow])

  const handleApplyFilters = () => {
    dispatch(fetchArticles(buildParams(1)))
  }

  const handleSaveCrawlSettings = async () => {
    setFeedLoading(true)
    setFeedMessage('')
    try {
      await updateCrawlSettingsApi({
        keywords: parseKeywords(keywordsInput),
        exclude_keywords: parseKeywords(excludeKeywordsInput),
        min_score: minScore,
        include_low_suggestions: includeLow,
        use_ai_scoring: useAiScoring,
        recent_limit: 50,
      })
      setFeedMessage('Đã lưu cấu hình crawl cá nhân.')
    } catch (error: any) {
      setFeedMessage(error?.response?.data?.detail || 'Không thể lưu cấu hình')
      throw error
    } finally {
      setFeedLoading(false)
    }
  }

  const handleMatchForMe = async () => {
    setFeedLoading(true)
    setFeedMessage('')
    try {
      await updateCrawlSettingsApi({
        keywords: parseKeywords(keywordsInput),
        exclude_keywords: parseKeywords(excludeKeywordsInput),
        min_score: minScore,
        include_low_suggestions: includeLow,
        use_ai_scoring: useAiScoring,
        recent_limit: 50,
      })
      const data = await matchArticlesForMeApi({ force_ai: useAiScoring })
      setViewMode('feed')
      await loadFeed(1)
      setFeedMessage(`Đã chấm ${data.processed} bài: ${data.matched} bài phù hợp, ${data.low_suggestions} gợi ý thấp.`)
    } catch (error: any) {
      setFeedMessage(error?.response?.data?.detail || 'Không thể chấm điểm bài viết')
    } finally {
      setFeedLoading(false)
    }
  }

  const handleCustomTopicCrawl = async () => {
    const topics = parseKeywords(keywordsInput)
    if (topics.length === 0) {
      setFeedMessage('Hãy nhập ít nhất một chủ đề để crawl riêng.')
      return
    }

    setFeedLoading(true)
    setFeedMessage('')
    try {
      const data = await customTopicCrawlApi({
        topics,
        exclude_keywords: parseKeywords(excludeKeywordsInput),
        limit: customCrawlLimit,
        use_ai_scoring: useAiScoring,
      })
      setViewMode('feed')
      await loadFeed(1)
      setFeedMessage(
        `Custom crawl xong: lưu mới ${data.stored}, có sẵn ${data.skipped_existing}, phù hợp ${data.matched}, gợi ý thấp ${data.low_suggestions}.`,
      )
    } catch (error: any) {
      setFeedMessage(error?.response?.data?.detail || 'Không thể crawl theo chủ đề')
    } finally {
      setFeedLoading(false)
    }
  }

  const visibleItems = viewMode === 'feed' ? feedItems : items
  const visibleTotal = viewMode === 'feed' ? feedTotal : total
  const visiblePage = viewMode === 'feed' ? feedPage : page
  const visibleLoading = viewMode === 'feed' ? feedLoading : loading
  const totalPages = Math.ceil(visibleTotal / PAGE_SIZE)

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--on-surface)' }}>
            Content Collection
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--on-surface-variant)' }}>
            {visibleTotal.toLocaleString('vi-VN')} bài viết {viewMode === 'feed' ? 'phù hợp với bạn' : 'được thu thập'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setViewMode('global')}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={viewMode === 'global'
              ? { backgroundColor: 'var(--primary)', color: 'var(--on-primary)' }
              : { backgroundColor: 'var(--surface-container-lowest)', color: 'var(--on-surface)', border: '1px solid var(--outline-variant)' }}
          >
            Tất cả
          </button>
          <button
            onClick={() => setViewMode('feed')}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={viewMode === 'feed'
              ? { backgroundColor: 'var(--primary)', color: 'var(--on-primary)' }
              : { backgroundColor: 'var(--surface-container-lowest)', color: 'var(--on-surface)', border: '1px solid var(--outline-variant)' }}
          >
            Feed của tôi
          </button>
          {viewMode === 'global' && FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => dispatch(setStatusFilter(f.value))}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={
                statusFilter === f.value
                  ? { backgroundColor: 'var(--secondary)', color: 'var(--on-secondary)' }
                  : {
                      backgroundColor: 'var(--surface-container-lowest)',
                      color: 'var(--on-surface)',
                      border: '1px solid var(--outline-variant)',
                    }
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bento-card rounded-xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
          <label className="flex-1 space-y-2 text-sm">
            <span>Keyword quan tâm</span>
            <input
              value={keywordsInput}
              onChange={(event) => setKeywordsInput(event.target.value)}
              className="w-full px-4 py-2 rounded-lg border outline-none"
              style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
              placeholder="ai, công nghệ, marketing"
            />
          </label>
          <label className="flex-1 space-y-2 text-sm">
            <span>Keyword loại trừ</span>
            <input
              value={excludeKeywordsInput}
              onChange={(event) => setExcludeKeywordsInput(event.target.value)}
              className="w-full px-4 py-2 rounded-lg border outline-none"
              style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
              placeholder="tai nạn, giật gân"
            />
          </label>
          <label className="w-full lg:w-32 space-y-2 text-sm">
            <span>Min score</span>
            <input
              type="number"
              min="0"
              max="100"
              value={minScore}
              onChange={(event) => setMinScore(Number(event.target.value))}
              className="w-full px-4 py-2 rounded-lg border outline-none"
              style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
            />
          </label>
          <label className="w-full lg:w-32 space-y-2 text-sm">
            <span>Số bài crawl</span>
            <input
              type="number"
              min="1"
              max="30"
              value={customCrawlLimit}
              onChange={(event) => setCustomCrawlLimit(Number(event.target.value || 10))}
              className="w-full px-4 py-2 rounded-lg border outline-none"
              style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4 text-sm" style={{ color: 'var(--on-surface-variant)' }}>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={useAiScoring} onChange={(event) => setUseAiScoring(event.target.checked)} />
              Gọi API AI scoring
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={includeLow} onChange={(event) => setIncludeLow(event.target.checked)} />
              Hiện gợi ý thấp
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleSaveCrawlSettings()}
              disabled={feedLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
              style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface)' }}
            >
              <Save size={16} />
              Lưu cấu hình
            </button>
            <button
              onClick={() => void handleMatchForMe()}
              disabled={feedLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: 'var(--secondary)', color: 'var(--on-secondary)' }}
            >
              <Sparkles size={16} />
              AI match
            </button>
            <button
              onClick={() => void handleCustomTopicCrawl()}
              disabled={feedLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: 'var(--primary)', color: 'var(--on-primary)' }}
            >
              <Radar size={16} />
              Crawl theo chủ đề
            </button>
          </div>
        </div>
        {feedMessage && <div className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>{feedMessage}</div>}
      </div>

      <div className="bento-card rounded-xl overflow-hidden">
        <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b"
          style={{ borderColor: 'var(--outline-variant)' }}>
          <h3 className="text-lg font-semibold" style={{ color: 'var(--on-surface)' }}>
            {viewMode === 'feed' ? 'My Matched Feed' : 'Recent Content Collection'}
          </h3>
          {viewMode === 'global' && (
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--on-surface-variant)' }} />
                <input
                  type="text"
                  placeholder="Tìm kiếm..."
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleApplyFilters()}
                  className="pl-9 pr-4 py-2 rounded-lg text-sm outline-none"
                  style={{
                    backgroundColor: 'var(--surface-container-low)',
                    color: 'var(--on-surface)',
                    border: 'none',
                    width: '200px',
                  }}
                />
              </div>

              <button
                onClick={() => setShowFilters(v => !v)}
                className="p-2 rounded-lg transition-colors"
                style={{
                  color: showFilters ? 'var(--secondary)' : 'var(--on-surface-variant)',
                  backgroundColor: showFilters ? 'var(--surface-container)' : 'transparent',
                }}
                title="Bộ lọc"
              >
                <Filter size={18} />
              </button>
            </div>
          )}
        </div>

        {showFilters && viewMode === 'global' && (
          <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b"
            style={{ backgroundColor: 'var(--surface-container-low)', borderColor: 'var(--outline-variant)' }}>
            <select
              value={hasVideoInput}
              onChange={e => setHasVideoInput(e.target.value)}
              className="px-3 py-2 rounded-lg text-sm outline-none border"
              style={{
                backgroundColor: 'var(--surface-container-lowest)',
                borderColor: 'var(--outline-variant)',
                color: 'var(--on-surface)',
              }}
            >
              <option value="">Tất cả media</option>
              <option value="true">Có video</option>
              <option value="false">Không video</option>
            </select>

            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="px-3 py-2 rounded-lg text-sm outline-none border"
              style={{
                backgroundColor: 'var(--surface-container-lowest)',
                borderColor: 'var(--outline-variant)',
                color: 'var(--on-surface)',
              }} title="Từ ngày"
            />
            <span className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>đến</span>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              className="px-3 py-2 rounded-lg text-sm outline-none border"
              style={{
                backgroundColor: 'var(--surface-container-lowest)',
                borderColor: 'var(--outline-variant)',
                color: 'var(--on-surface)',
              }} title="Đến ngày"
            />
            <button
              onClick={handleApplyFilters}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ backgroundColor: 'var(--secondary)', color: 'var(--on-secondary)' }}
            >
              Áp dụng
            </button>
          </div>
        )}

        {visibleLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin" size={28} style={{ color: 'var(--secondary)' }} />
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2"
            style={{ color: 'var(--on-surface-variant)' }}>
            <Search size={32} className="opacity-30" />
            <p className="text-sm">Không tìm thấy bài viết nào</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead style={{ backgroundColor: 'var(--surface-container-low)' }}>
                <tr>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--on-surface-variant)' }}>Tiêu đề</th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--on-surface-variant)' }}>Platform</th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--on-surface-variant)' }}>Trạng thái</th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-right"
                    style={{ color: 'var(--on-surface-variant)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map(article => (
                  <ArticleRow
                    key={article.link}
                    article={article}
                    socialProfiles={socialProfiles}
                    onView={() => setSelectedArticle(article)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-6 py-4 flex items-center justify-between border-t"
          style={{ backgroundColor: 'var(--surface-container-low)', borderColor: 'var(--outline-variant)' }}>
          <span className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>
            Showing {visibleItems.length} of {visibleTotal.toLocaleString('vi-VN')} items
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                disabled={visiblePage <= 1}
                onClick={() => viewMode === 'feed' ? void loadFeed(feedPage - 1) : dispatch(fetchArticles(buildParams(page - 1)))}
                className="p-1.5 rounded border transition-all disabled:opacity-30"
                style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
              >
                <ChevronLeft size={14} />
              </button>
              {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => viewMode === 'feed' ? void loadFeed(p) : dispatch(fetchArticles(buildParams(p)))}
                  className="w-8 h-8 rounded border text-xs font-medium transition-all"
                  style={
                    visiblePage === p
                      ? { backgroundColor: 'var(--secondary)', color: 'var(--on-secondary)', borderColor: 'var(--secondary)' }
                      : { backgroundColor: 'var(--surface-container-lowest)', color: 'var(--on-surface)', borderColor: 'var(--outline-variant)' }
                  }
                >
                  {p}
                </button>
              ))}
              <button
                disabled={visiblePage >= totalPages}
                onClick={() => viewMode === 'feed' ? void loadFeed(feedPage + 1) : dispatch(fetchArticles(buildParams(page + 1)))}
                className="p-1.5 rounded border transition-all disabled:opacity-30"
                style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-lowest)' }}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      {selectedArticle && (
        <ArticleDetailModal
          article={selectedArticle}
          socialProfiles={socialProfiles}
          onClose={() => setSelectedArticle(null)}
        />
      )}
    </div>
  )
}
