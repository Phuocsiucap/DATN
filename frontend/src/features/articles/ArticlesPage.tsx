import { useEffect, useState } from 'react'
import { useAppDispatch, useAppSelector } from '@/commons/hooks/useAppDispatch'
import { fetchArticles } from '@/commons/store/slices/articlesSlice'
import ArticleRow from '@/features/articles/components/ArticleRow'
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  Loader2,
  Newspaper,
  RefreshCcw,
  Search,
  Sparkles,
  Building2,
  User,
} from 'lucide-react'
import ArticleDetailModal from '@/features/articles/components/ArticleDetailModal'
import type { Article } from '@/commons/store/slices/articlesSlice'
import {
  fetchMyArticleFeedApi,
  fetchSocialProfilesApi,
  matchArticlesForMeApi,
} from '@/commons/apis/api'
import { fetchCrawlJobsApi, type CrawlJob } from '@/commons/apis/module1'

const PAGE_SIZE = 20

type SocialProfileOption = {
  id: number | string
  platform: string
  profile_name: string
  username?: string | null
  status: string
}

type TabType = 'recommendations' | 'global' | 'private'

const normalizeArticle = (item: any): Article => ({
  ...item,
  match_status: item.match_status === 'matched' || item.match_status === 'low_suggestion'
    ? item.match_status
    : undefined,
})

export default function ArticlesPage({ workspaceMode = 'admin' }: { workspaceMode?: 'admin' | 'user' }) {
  const dispatch = useAppDispatch()
  const { items, total, page, loading, statusFilter } = useAppSelector((s) => s.articles)
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null)
  const [activeTab, setActiveTab] = useState<TabType>(workspaceMode === 'user' ? 'recommendations' : 'global')

  const [feedItems, setFeedItems] = useState<Article[]>([])
  const [feedTotal, setFeedTotal] = useState(0)
  const [feedPage, setFeedPage] = useState(1)
  const [feedLoading, setFeedLoading] = useState(false)
  const [feedMessage, setFeedMessage] = useState('')
  const [socialProfiles, setSocialProfiles] = useState<SocialProfileOption[]>([])
  const [crawlJobs, setCrawlJobs] = useState<CrawlJob[]>([])

  const [searchInput, setSearchInput] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [hasVideoInput, setHasVideoInput] = useState('')
  const [selectedJobId, setSelectedJobId] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const isUserMode = workspaceMode === 'user'

  const buildParams = (p = page) => ({
    page: p,
    status: statusFilter || undefined,
    search: searchInput || undefined,
    startDate: startDate ? new Date(startDate).toISOString() : undefined,
    endDate: endDate ? new Date(endDate).toISOString() : undefined,
    hasVideo: hasVideoInput || undefined,
    sourceType: categoryFilter || undefined,
    crawlJobId: selectedJobId || undefined,
  })

  const loadFeed = async (p = feedPage) => {
    setFeedLoading(true)
    setFeedMessage('')
    try {
      const data = await fetchMyArticleFeedApi(p, true)
      setFeedItems((data.items || []).map(normalizeArticle))
      setFeedTotal(data.total || 0)
      setFeedPage(data.page || p)
    } catch (error: any) {
      setFeedMessage(error?.response?.data?.detail || 'Không thể tải danh sách gợi ý cho kênh')
    } finally {
      setFeedLoading(false)
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

  const loadJobs = async () => {
    try {
      const jobs = await fetchCrawlJobsApi()
      setCrawlJobs(jobs)
    } catch {
      setCrawlJobs([])
    }
  }

  useEffect(() => {
    dispatch(fetchArticles(buildParams()))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, page, statusFilter, selectedJobId, categoryFilter])

  useEffect(() => {
    void loadSocialProfiles()
    void loadJobs()
  }, [])

  useEffect(() => {
    if (activeTab === 'recommendations') {
      void loadFeed(1)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  const handleApplyFilters = () => {
    dispatch(fetchArticles(buildParams(1)))
  }

  const handleMatchForMe = async () => {
    setFeedLoading(true)
    setFeedMessage('')
    try {
      const data = await matchArticlesForMeApi({ force_ai: true })
      await loadFeed(1)
      setFeedMessage(`Đã chạy AI Matcher: ${data.matched || 0} bài viết phù hợp với chiến lược các kênh của bạn.`)
    } catch (error: any) {
      setFeedMessage(error?.response?.data?.detail || 'Không thể chạy AI matching')
    } finally {
      setFeedLoading(false)
    }
  }

  const visibleItems = activeTab === 'recommendations' ? feedItems : items
  const visibleTotal = activeTab === 'recommendations' ? feedTotal : total
  const visiblePage = activeTab === 'recommendations' ? feedPage : page
  const visibleLoading = activeTab === 'recommendations' ? feedLoading : loading
  const totalPages = Math.ceil(visibleTotal / PAGE_SIZE) || 1

  return (
    <div className="space-y-6">
      {/* Header Container */}
      <div className="rounded-xl border border-[#d9e0ea] bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-[#0f172a]">
                {isUserMode ? 'Content Discovery & Recommendations' : 'Global Content Store & Story Library'}
              </h2>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${isUserMode ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
                {isUserMode ? 'CREATOR HUB' : 'SYSTEM CONTENT STORE'}
              </span>
            </div>
            <p className="mt-1 text-sm text-[#64748b]">
              {isUserMode
                ? 'Khám phá các nội dung được AI chấm điểm phù hợp với từng kênh TikTok của bạn, sẵn sàng tạo Plan.'
                : 'Kho nội dung chuẩn hóa toàn hệ thống (Canonical Content Store), quản lý nhóm bài viết và truyện.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => (activeTab === 'recommendations' ? void loadFeed(1) : dispatch(fetchArticles(buildParams(1))))}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#d9e0ea] bg-white px-3 text-xs font-semibold text-[#475569] hover:bg-slate-50"
            >
              <RefreshCcw size={14} /> Tải lại
            </button>
            {isUserMode && (
              <button
                onClick={() => void handleMatchForMe()}
                disabled={feedLoading}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#2563eb] px-4 text-xs font-bold text-white shadow-sm hover:bg-[#1d4ed8] disabled:opacity-50"
              >
                <Sparkles size={14} /> Chạy AI Re-Match
              </button>
            )}
          </div>
        </div>

        {/* Dynamic Navigation Tabs */}
        <div className="mt-6 flex gap-2 border-t border-[#eef2f7] pt-4 overflow-x-auto">
          {isUserMode ? (
            <>
              <button
                onClick={() => setActiveTab('recommendations')}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
                  activeTab === 'recommendations'
                    ? 'bg-[#2563eb] text-white shadow-sm'
                    : 'bg-[#f8fafc] text-[#64748b] border border-[#e2e8f0] hover:bg-[#f1f5f9] hover:text-[#0f172a]'
                }`}
              >
                <Sparkles size={15} /> Gợi Ý Khớp Profile ({feedTotal})
              </button>
              <button
                onClick={() => setActiveTab('global')}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
                  activeTab === 'global'
                    ? 'bg-[#2563eb] text-white shadow-sm'
                    : 'bg-[#f8fafc] text-[#64748b] border border-[#e2e8f0] hover:bg-[#f1f5f9] hover:text-[#0f172a]'
                }`}
              >
                <Building2 size={15} /> Kho Nội Dung Global ({total})
              </button>
              <button
                onClick={() => setActiveTab('private')}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
                  activeTab === 'private'
                    ? 'bg-[#2563eb] text-white shadow-sm'
                    : 'bg-[#f8fafc] text-[#64748b] border border-[#e2e8f0] hover:bg-[#f1f5f9] hover:text-[#0f172a]'
                }`}
              >
                <User size={15} /> Dữ Liệu Crawl Riêng
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setActiveTab('global')}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
                  activeTab === 'global'
                    ? 'bg-[#2563eb] text-white shadow-sm'
                    : 'bg-[#f8fafc] text-[#64748b] border border-[#e2e8f0] hover:bg-[#f1f5f9] hover:text-[#0f172a]'
                }`}
              >
                <Building2 size={15} /> Kho Nội Dung Canonical (System Global) ({total})
              </button>
            </>
          )}
        </div>
      </div>

      {feedMessage && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-medium text-blue-800 flex items-center justify-between">
          <span>{feedMessage}</span>
          <button onClick={() => setFeedMessage('')} className="text-blue-600 hover:text-blue-900">✕</button>
        </div>
      )}

      {/* Main Content Card */}
      <div className="rounded-xl border border-[#d9e0ea] bg-white overflow-hidden shadow-sm">
        {/* Table Top Controls */}
        <div className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#eef2f7]">
          <div>
            <h3 className="text-base font-bold text-[#0f172a]">
              {isUserMode
                ? activeTab === 'recommendations'
                  ? 'Danh sách Bài Viết Phù Hợp Kênh'
                  : activeTab === 'global'
                  ? 'Kho Dữ Liệu Global Content Store'
                  : 'Dữ Liệu Riêng do Bạn Crawl'
                : 'Kho Nội Dung Chuẩn Hóa toàn Hệ Thống (Canonical Content Store)'}
            </h3>
            <p className="text-xs text-[#64748b] mt-0.5">
              Hiển thị {visibleItems.length} trên tổng số {visibleTotal.toLocaleString('vi-VN')} nội dung chuẩn hóa
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
              <input
                type="text"
                placeholder="Tìm tiêu đề, từ khóa..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleApplyFilters()}
                className="pl-9 pr-4 py-1.5 rounded-lg text-xs outline-none border border-[#d9e0ea] bg-[#f8fafc] focus:bg-white focus:border-[#2563eb] w-48 sm:w-64 transition-all"
              />
            </div>

            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`p-2 rounded-lg border text-xs transition-colors ${
                showFilters ? 'bg-blue-50 text-[#2563eb] border-blue-200' : 'bg-white text-[#64748b] border-[#d9e0ea] hover:bg-slate-50'
              }`}
              title="Bộ lọc chi tiết"
            >
              <Filter size={16} />
            </button>
          </div>
        </div>

        {/* Filter Drawer */}
        {showFilters && (
          <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-[#eef2f7] bg-[#f8fafc]">
            {/* Category / Source Type Filter */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs outline-none border border-[#d9e0ea] bg-white text-[#0f172a]"
            >
              <option value="">Tất cả Category / Loại Nguồn</option>
              <option value="BILIBILI">Bilibili Video</option>
              <option value="VNEXPRESS">VNExpress News</option>
              <option value="STORY_SERIES">Truyện / Series</option>
            </select>

            {/* Crawl Job Filter */}
            <select
              value={selectedJobId}
              onChange={(e) => setSelectedJobId(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs outline-none border border-[#d9e0ea] bg-white text-[#0f172a] max-w-[220px] truncate"
            >
              <option value="">Tất cả Crawl Jobs</option>
              {crawlJobs.map((job) => (
                <option key={job.id} value={job.id}>
                  Job: {job.name} ({job.status})
                </option>
              ))}
            </select>

            <select
              value={hasVideoInput}
              onChange={(e) => setHasVideoInput(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs outline-none border border-[#d9e0ea] bg-white text-[#0f172a]"
            >
              <option value="">Tất cả định dạng</option>
              <option value="true">Có Video (Bilibili/Vlog)</option>
              <option value="false">Văn bản / Bài báo</option>
            </select>

            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs outline-none border border-[#d9e0ea] bg-white text-[#0f172a]"
              title="Từ ngày"
            />
            <span className="text-xs text-[#64748b]">đến</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs outline-none border border-[#d9e0ea] bg-white text-[#0f172a]"
              title="Đến ngày"
            />
            <button
              onClick={handleApplyFilters}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
            >
              Áp dụng
            </button>
          </div>
        )}

        {/* Table Body */}
        {visibleLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-[#64748b]">
            <Loader2 className="animate-spin text-[#2563eb]" size={32} />
            <span className="text-xs font-medium">Đang tải danh sách bài viết...</span>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-[#64748b]">
            <Newspaper size={40} className="opacity-30 text-[#64748b]" />
            <p className="text-sm font-semibold">Chưa có bài viết nào trong mục này</p>
            {activeTab === 'recommendations' && (
              <button
                onClick={() => void handleMatchForMe()}
                className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-[#2563eb] text-white"
              >
                <Sparkles size={14} /> Chạy AI Match cho các Kênh
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-[#f8fafc] border-b border-[#eef2f7]">
                <tr>
                  <th className="px-6 py-3 font-semibold text-[#64748b] uppercase tracking-wider">
                    {isUserMode ? 'Tiêu đề bài viết' : 'Nội dung Canonical (Tiêu đề)'}
                  </th>
                  <th className="px-6 py-3 font-semibold text-[#64748b] uppercase tracking-wider">
                    {isUserMode ? 'Kênh & Phân phối' : 'Nguồn & Quality Score'}
                  </th>
                  <th className="px-6 py-3 font-semibold text-[#64748b] uppercase tracking-wider">Trạng thái</th>
                  <th className="px-6 py-3 font-semibold text-[#64748b] uppercase tracking-wider text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eef2f7]">
                {visibleItems.map((article, idx) => (
                  <ArticleRow
                    key={article.link || idx}
                    article={article}
                    socialProfiles={socialProfiles}
                    workspaceMode={workspaceMode}
                    onView={() => setSelectedArticle(article)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        <div className="px-6 py-4 flex items-center justify-between border-t border-[#eef2f7] bg-[#f8fafc]">
          <span className="text-xs text-[#64748b]">
            Hiển thị {visibleItems.length} trên tổng {visibleTotal.toLocaleString('vi-VN')}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                disabled={visiblePage <= 1}
                onClick={() => (activeTab === 'recommendations' ? void loadFeed(feedPage - 1) : dispatch(fetchArticles(buildParams(page - 1))))}
                className="p-1.5 rounded border border-[#d9e0ea] bg-white text-[#475569] hover:bg-slate-50 disabled:opacity-30"
              >
                <ChevronLeft size={14} />
              </button>
              {Array.from({ length: Math.min(totalPages, 8) }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => (activeTab === 'recommendations' ? void loadFeed(p) : dispatch(fetchArticles(buildParams(p))))}
                  className={`w-7 h-7 rounded border text-xs font-bold transition-all ${
                    visiblePage === p
                      ? 'bg-[#2563eb] text-white border-[#2563eb]'
                      : 'bg-white text-[#475569] border-[#d9e0ea] hover:bg-slate-50'
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                disabled={visiblePage >= totalPages}
                onClick={() => (activeTab === 'recommendations' ? void loadFeed(feedPage + 1) : dispatch(fetchArticles(buildParams(page + 1))))}
                className="p-1.5 rounded border border-[#d9e0ea] bg-white text-[#475569] hover:bg-slate-50 disabled:opacity-30"
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
          workspaceMode={workspaceMode}
          onClose={() => setSelectedArticle(null)}
        />
      )}
    </div>
  )
}
