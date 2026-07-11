import { useEffect, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../hooks/useAppDispatch'
import { fetchArticles, setStatusFilter } from '../store/slices/articlesSlice'
import ArticleRow from '../components/ArticleRow'
import { Loader2, Search, SlidersHorizontal, ChevronLeft, ChevronRight } from 'lucide-react'
import ArticleDetailModal from '../components/ArticleDetailModal'
import type { Article } from '../store/slices/articlesSlice'

const FILTERS = [
  { label: 'Tất cả', value: '' },
  { label: 'Mới crawl', value: 'crawled' },
  { label: 'Đã đăng', value: 'published' },
  { label: 'Thất bại', value: 'failed' },
]

const PAGE_SIZE = 20

export default function ArticlesPage() {
  const dispatch = useAppDispatch()
  const { items, total, page, loading, statusFilter } = useAppSelector(s => s.articles)
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null)

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

  useEffect(() => {
    dispatch(fetchArticles(buildParams()))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, page, statusFilter])

  const handleApplyFilters = () => {
    dispatch(fetchArticles(buildParams(1)))
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            Bài viết
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {total.toLocaleString('vi-VN')} kết quả
          </p>
        </div>

        {/* Status filters */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => dispatch(setStatusFilter(f.value))}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={
                statusFilter === f.value
                  ? { backgroundColor: 'var(--accent)', color: '#fff' }
                  : { backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search + filter bar */}
      <div
        className="rounded-xl p-4 space-y-3"
        style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)' }}
      >
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Tìm kiếm tiêu đề, nội dung..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleApplyFilters()}
              className="w-full pl-9 pr-4 py-2 rounded-lg text-sm outline-none transition-all"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
          <button
            onClick={() => setShowFilters(v => !v)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all"
            style={
              showFilters
                ? { backgroundColor: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)' }
                : { backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }
            }
          >
            <SlidersHorizontal size={13} /> Bộ lọc
          </button>
          <button
            onClick={handleApplyFilters}
            className="px-4 py-2 rounded-lg text-xs font-medium transition-all hover:opacity-90"
            style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
          >
            Tìm
          </button>
        </div>

        {showFilters && (
          <div className="flex flex-wrap gap-3 pt-1">
            <select
              value={hasVideoInput}
              onChange={e => setHasVideoInput(e.target.value)}
              className="px-3 py-2 rounded-lg text-xs outline-none"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
              }}
            >
              <option value="">Tất cả media</option>
              <option value="true">Có video</option>
              <option value="false">Không video</option>
            </select>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="px-3 py-2 rounded-lg text-xs outline-none"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
              }}
              title="Từ ngày"
            />
            <span className="self-center text-xs" style={{ color: 'var(--text-muted)' }}>đến</span>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="px-3 py-2 rounded-lg text-xs outline-none"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                color: 'var(--text-secondary)',
              }}
              title="Đến ngày"
            />
          </div>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-blue-400" size={28} />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-2"
          style={{ color: 'var(--text-muted)' }}>
          <Search size={28} className="opacity-30" />
          <p className="text-sm">Không tìm thấy bài viết nào</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map(article => (
            <ArticleRow
              key={article.link}
              article={article}
              onView={() => setSelectedArticle(article)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            disabled={page <= 1}
            onClick={() => dispatch(fetchArticles(buildParams(page - 1)))}
            className="p-2 rounded-lg transition-all disabled:opacity-30"
            style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            <ChevronLeft size={14} />
          </button>

          {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map(p => (
            <button
              key={p}
              onClick={() => dispatch(fetchArticles(buildParams(p)))}
              className="w-8 h-8 rounded-lg text-xs font-medium transition-all"
              style={
                page === p
                  ? { backgroundColor: 'var(--accent)', color: '#fff' }
                  : { backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }
              }
            >
              {p}
            </button>
          ))}

          <button
            disabled={page >= totalPages}
            onClick={() => dispatch(fetchArticles(buildParams(page + 1)))}
            className="p-2 rounded-lg transition-all disabled:opacity-30"
            style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      {selectedArticle && (
        <ArticleDetailModal
          article={selectedArticle}
          onClose={() => setSelectedArticle(null)}
        />
      )}
    </div>
  )
}
