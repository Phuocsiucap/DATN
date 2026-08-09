import { useEffect, useState } from 'react'
import { Send, Loader2, Eye, Video, Pencil } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '@/commons/hooks/useAppDispatch'
import { publishArticle } from '@/commons/store/slices/articlesSlice'
import type { Article } from '@/commons/store/slices/articlesSlice'

const STATUS_CONFIG: Record<string, { label: string; style: React.CSSProperties }> = {
  crawled:   { label: 'NEW',       style: { backgroundColor: 'var(--surface-container)', color: 'var(--on-surface-variant)' } },
  published: { label: 'PUBLISHED', style: { backgroundColor: '#dcfce7', color: '#15803d' } },
  failed:    { label: 'FAILED',    style: { backgroundColor: '#fee2e2', color: '#dc2626' } },
}

const PLATFORM_COLOR: Record<string, string> = {
  facebook: '#1877f2',
  tiktok:   '#010101',
}

type SocialProfileOption = {
  id: number | string
  platform: string
  profile_name: string
  username?: string | null
  status: string
}

export default function ArticleRow({
  article,
  onView,
  socialProfiles = [],
  workspaceMode = 'admin',
}: {
  article: Article
  onView?: () => void
  socialProfiles?: SocialProfileOption[]
  workspaceMode?: 'admin' | 'user'
}) {
  const dispatch = useAppDispatch()
  const isPublishing = useAppSelector(s => s.articles.publishing[article.link])
  const [platforms, setPlatforms] = useState<string[]>(['tiktok'])
  const [profileIds, setProfileIds] = useState<(number | string)[]>([])

  const activeTikTokProfiles = socialProfiles.filter(profile => profile.platform === 'tiktok' && profile.status === 'active')

  useEffect(() => {
    if (profileIds.length === 0 && activeTikTokProfiles.length > 0) {
      setProfileIds([activeTikTokProfiles[0].id])
    }
  }, [activeTikTokProfiles, profileIds.length])

  const togglePlatform = (p: string) =>
    setPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])

  const handlePublish = () => {
    if (platforms.length === 0) return
    const selectedProfileIds = platforms.includes('tiktok') ? profileIds : []
    dispatch(publishArticle({ link: article.link, platforms, profileIds: selectedProfileIds }))
  }

  const status = STATUS_CONFIG[article.status] || { label: 'READY', style: { backgroundColor: '#e2e8f0', color: '#334155' } }
  const isAdmin = workspaceMode === 'admin'

  return (
    <tr className="hover:bg-[#f8f9ff] transition-colors" style={{ borderBottom: '1px solid var(--outline-variant)', opacity: 1 }}>
      {/* Title */}
      <td className="px-6 py-4 max-w-xs">
        <div className="flex items-center gap-2">
          <a
            href={article.link}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold hover:underline truncate block max-w-[280px]"
            style={{ color: 'var(--on-surface)' }}
          >
            {article.title}
          </a>
          {article.videos && article.videos.length > 0 && (
            <span className="shrink-0 flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded"
              style={{ backgroundColor: '#ede9fe', color: '#7c3aed' }}>
              <Video size={10} /> video
            </span>
          )}
        </div>
        {article.crawled_at && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--on-surface-variant)' }}>
            {new Date(article.crawled_at).toLocaleString('vi-VN')}
          </p>
        )}
        {!isAdmin && article.match_score !== undefined && (
          <p className="text-xs mt-1" style={{ color: 'var(--secondary)' }}>
            Match {article.match_score}/100
            {article.matched_keywords?.length ? ` | ${article.matched_keywords.join(', ')}` : ''}
          </p>
        )}
      </td>

      {/* Scope / Source / Quality (Admin) vs Platform Checkboxes (User) */}
      <td className="px-6 py-4">
        {isAdmin ? (
          <div className="space-y-1">
            <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">
              SCOPE: {article.content_scope || 'GLOBAL'}
            </span>
            {article.quality_score !== undefined && (
              <p className="text-xs font-semibold text-emerald-700">
                Quality Score: {Number(article.quality_score).toFixed(1)}/10
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              {['facebook', 'tiktok'].map(p => (
                <label key={p} className="flex items-center gap-1.5 text-xs cursor-pointer select-none"
                  style={{ color: 'var(--on-surface-variant)' }}>
                  <input
                    type="checkbox"
                    checked={platforms.includes(p)}
                    onChange={() => togglePlatform(p)}
                    className="w-3.5 h-3.5 rounded"
                    style={{ accentColor: PLATFORM_COLOR[p] }}
                  />
                  {p}
                </label>
              ))}
            </div>
            {platforms.includes('tiktok') && (
              <div className="mt-2 flex flex-col gap-1">
                {activeTikTokProfiles.length === 0 ? (
                  <span className="text-[11px]" style={{ color: 'rgb(185,28,28)' }}>
                    Chưa có TikTok account active
                  </span>
                ) : activeTikTokProfiles.map(profile => (
                  <label key={profile.id} className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none"
                    style={{ color: 'var(--on-surface-variant)' }}>
                    <input
                      type="checkbox"
                      checked={profileIds.includes(profile.id)}
                      onChange={() => setProfileIds(prev => prev.includes(profile.id) ? prev.filter(id => id !== profile.id) : [...prev, profile.id])}
                      className="w-3 h-3 rounded"
                      style={{ accentColor: PLATFORM_COLOR.tiktok }}
                    />
                    {profile.profile_name}{profile.username ? ` (${profile.username})` : ''}
                  </label>
                ))}
              </div>
            )}
          </>
        )}
      </td>

      {/* Status */}
      <td className="px-6 py-4">
        <span className="px-2 py-1 rounded text-[10px] font-bold" style={status.style}>
          {status.label}
        </span>
      </td>

      {/* Actions */}
      <td className="px-6 py-4 text-right">
        <div className="flex items-center justify-end gap-1">
          {onView && (
            <button
              onClick={onView}
              className="p-2 rounded transition-colors hover:opacity-70 flex items-center gap-1 text-xs font-semibold text-blue-600 bg-blue-50 px-2.5 py-1"
              title="Xem chi tiết"
            >
              <Eye size={15} /> {isAdmin ? 'Xem Bản Crawl' : 'Xem Chi Tiết'}
            </button>
          )}
          {isAdmin ? (
            <button
              className="p-2 rounded transition-colors hover:opacity-70 text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-1"
              title="Quản lý Canonical"
            >
              <Pencil size={14} /> Sửa
            </button>
          ) : (
            <button
              onClick={handlePublish}
              disabled={isPublishing || platforms.length === 0 || (platforms.includes('tiktok') && profileIds.length === 0)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ml-1 transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--secondary)', color: 'var(--on-secondary)' }}
            >
              {isPublishing
                ? <><Loader2 size={13} className="animate-spin" /> Đăng...</>
                : <><Send size={13} /> Đăng bài</>}
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
