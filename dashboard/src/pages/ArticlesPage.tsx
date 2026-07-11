import { useEffect, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../hooks/useAppDispatch'
import { fetchArticles, setStatusFilter } from '../store/slices/articlesSlice'
import ArticleRow from '../components/ArticleRow'
import { Loader2 } from 'lucide-react'
import ArticleDetailModal from '../components/ArticleDetailModal'
import type { Article } from '../store/slices/articlesSlice'

const FILTERS = [
  { label: 'Tất cả', value: '' },
  { label: 'Mới crawl', value: 'crawled' },
  { label: 'Đã đăng', value: 'published' },
  { label: 'Thất bại', value: 'failed' },
]

export default function ArticlesPage() {
  const dispatch = useAppDispatch()
  const { items, total, page, loading, statusFilter } = useAppSelector(s => s.articles)
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null)
  
  // Local state for search and date filters
  const [searchInput, setSearchInput] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  useEffect(() => {
    dispatch(fetchArticles({ 
      page, 
      status: statusFilter || undefined,
      search: searchInput || undefined,
      startDate: startDate ? new Date(startDate).toISOString() : undefined,
      endDate: endDate ? new Date(endDate).toISOString() : undefined
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, page, statusFilter])

  const handleApplyFilters = () => {
    dispatch(fetchArticles({ 
      page: 1, 
      status: statusFilter || undefined,
      search: searchInput || undefined,
      startDate: startDate ? new Date(startDate).toISOString() : undefined,
      endDate: endDate ? new Date(endDate).toISOString() : undefined
    }))
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <h1 className="text-white text-xl font-bold">Bài viết ({total})</h1>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(f => (
            <button key={f.value}
              onClick={() => dispatch(setStatusFilter(f.value))}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                statusFilter === f.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Advanced Filters Bar */}
      <div className="flex flex-col md:flex-row gap-3 bg-gray-800 p-4 rounded-xl border border-gray-700">
        <div className="flex-1">
          <input 
            type="text" 
            placeholder="Tìm kiếm tiêu đề, nội dung..." 
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <input 
            type="date" 
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500"
            title="Từ ngày"
          />
          <span className="text-gray-500">-</span>
          <input 
            type="date" 
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500"
            title="Đến ngày"
          />
        </div>
        <button 
          onClick={handleApplyFilters}
          className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          Lọc kết quả
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-blue-400" size={32} />
        </div>
      ) : items.length === 0 ? (
        <p className="text-gray-500 text-center py-20">Không có bài viết nào</p>
      ) : (
        <div className="space-y-3">
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
      {total > 20 && (
        <div className="flex justify-center gap-2 pt-4">
          {Array.from({ length: Math.ceil(total / 20) }, (_, i) => i + 1).slice(0, 10).map(p => (
            <button key={p}
              onClick={() => dispatch(fetchArticles({ page: p, status: statusFilter || undefined }))}
              className={`w-8 h-8 rounded text-sm ${page === p ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Modal */}
      {selectedArticle && (
        <ArticleDetailModal 
          article={selectedArticle} 
          onClose={() => setSelectedArticle(null)} 
        />
      )}
    </div>
  )
}
