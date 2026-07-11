import { useState } from 'react'
import { Send, Loader2, Eye } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '../hooks/useAppDispatch'
import { publishArticle } from '../store/slices/articlesSlice'
import type { Article } from '../store/slices/articlesSlice'

const STATUS_STYLES: Record<string, string> = {
  crawled: 'bg-yellow-500/20 text-yellow-300',
  published: 'bg-green-500/20 text-green-300',
  failed: 'bg-red-500/20 text-red-300',
}

export default function ArticleRow({ article, onView }: { article: Article; onView?: () => void }) {
  const dispatch = useAppDispatch()
  const isPublishing = useAppSelector(s => s.articles.publishing[article.link])
  const [platforms, setPlatforms] = useState<string[]>(['facebook', 'tiktok'])

  const togglePlatform = (p: string) =>
    setPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])

  const handlePublish = () => {
    if (platforms.length === 0) return
    dispatch(publishArticle({ link: article.link, platforms }))
  }

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <a href={article.link} target="_blank" rel="noreferrer"
          className="text-white font-medium hover:text-blue-400 transition-colors line-clamp-2">
          {article.title}
        </a>
        <span className={`shrink-0 text-xs px-2 py-1 rounded-full ${STATUS_STYLES[article.status] ?? 'bg-gray-600 text-gray-300'}`}>
          {article.status}
        </span>
      </div>

      {article.crawled_at && (
        <p className="text-gray-500 text-xs">{new Date(article.crawled_at).toLocaleString('vi-VN')}</p>
      )}

      <div className="flex items-center gap-3 mt-1">
        {['facebook', 'tiktok'].map(p => (
          <label key={p} className="flex items-center gap-1 text-sm text-gray-400 cursor-pointer select-none">
            <input type="checkbox" checked={platforms.includes(p)} onChange={() => togglePlatform(p)}
              className="accent-blue-500" />
            {p}
          </label>
        ))}
        <button onClick={handlePublish} disabled={isPublishing || platforms.length === 0}
          className="ml-auto flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors">
          {isPublishing
            ? <><Loader2 size={14} className="animate-spin" /> Đang đăng...</>
            : <><Send size={14} /> Đăng</>}
        </button>
        {onView && (
          <button 
            onClick={onView}
            className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors"
            title="Xem chi tiết"
          >
            <Eye size={14} /> Xem
          </button>
        )}
      </div>
    </div>
  )
}
