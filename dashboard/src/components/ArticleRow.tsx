import { useState } from 'react'
import { Send, Loader2, Eye, Video } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '../hooks/useAppDispatch'
import { publishArticle } from '../store/slices/articlesSlice'
import type { Article } from '../store/slices/articlesSlice'

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  crawled:   { label: 'Mới crawl', bg: 'rgba(251,191,36,0.1)',  color: '#fbbf24' },
  published: { label: 'Đã đăng',   bg: 'rgba(52,211,153,0.1)', color: '#34d399' },
  failed:    { label: 'Thất bại',  bg: 'rgba(248,113,113,0.1)', color: '#f87171' },
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

  const status = STATUS_CONFIG[article.status]

  return (
    <div
      className="rounded-xl p-4 transition-all hover:translate-y-[-1px]"
      style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start gap-3">
        {/* Title area */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={article.link}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium hover:text-blue-400 transition-colors line-clamp-1"
              style={{ color: 'var(--text-primary)' }}
            >
              {article.title}
            </a>
            {article.videos && article.videos.length > 0 && (
              <span
                className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded shrink-0"
                style={{ backgroundColor: 'rgba(139,92,246,0.12)', color: '#a78bfa' }}
              >
                <Video size={11} /> video
              </span>
            )}
          </div>
          {article.crawled_at && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {new Date(article.crawled_at).toLocaleString('vi-VN')}
            </p>
          )}
        </div>

        {/* Status badge */}
        {status && (
          <span
            className="shrink-0 text-xs px-2 py-1 rounded-full font-medium"
            style={{ backgroundColor: status.bg, color: status.color }}
          >
            {status.label}
          </span>
        )}
      </div>

      {/* Actions row */}
      <div className="flex items-center gap-3 mt-3 pt-3"
        style={{ borderTop: '1px solid var(--border-subtle)' }}>
        {['facebook', 'tiktok'].map(p => (
          <label key={p} className="flex items-center gap-1.5 text-xs cursor-pointer select-none"
            style={{ color: 'var(--text-muted)' }}>
            <input
              type="checkbox"
              checked={platforms.includes(p)}
              onChange={() => togglePlatform(p)}
              className="accent-blue-500 w-3.5 h-3.5"
            />
            {p}
          </label>
        ))}

        <div className="ml-auto flex items-center gap-2">
          {onView && (
            <button
              onClick={onView}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
              style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            >
              <Eye size={13} /> Xem
            </button>
          )}
          <button
            onClick={handlePublish}
            disabled={isPublishing || platforms.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
          >
            {isPublishing
              ? <><Loader2 size={13} className="animate-spin" /> Đăng...</>
              : <><Send size={13} /> Đăng</>}
          </button>
        </div>
      </div>
    </div>
  )
}
