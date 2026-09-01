import type { ReactNode } from 'react'
import { ExternalLink, Eye, Heart, MessageCircle, Share2 } from 'lucide-react'
import type { SocialPost } from '@/commons/apis/api'
import TikTokEmbedPlayer from '@/features/analytics/TikTokEmbedPlayer'
import { EmptyBlock, StatusPill } from '@/commons/component/social-ui'

const numberFormatter = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 })
const formatMetric = (value: number) => numberFormatter.format(Math.max(value, 0))
const metricValue = (post: SocialPost, key: 'views' | 'likes' | 'comments' | 'shares') => {
  const value = post.latest_metric?.[key]
  return Number.isFinite(Number(value)) ? Number(value) : 0
}
const formatDateTime = (value?: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function PostDetailCard({ post }: { post: SocialPost | null }) {
  if (!post) return <EmptyBlock label="Chọn một bài để xem chi tiết nhanh." />

  const latestCapturedAt = post.latest_metric?.captured_at
  const growth24h = Number(post.growth?.views_24h || 0)

  return (
    <section className="rounded-lg border border-[var(--outline-variant)] bg-white p-4 shadow-sm" aria-label="Chi tiết bài đã đăng">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2"><StatusPill value={post.status || 'published'} />{post.platform_post_id && <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-[var(--on-surface-variant)]">ID {post.platform_post_id}</span>}</div>
          <h2 className="line-clamp-2 text-base font-extrabold text-[var(--on-surface)]">{post.title || 'Untitled post'}</h2>
        </div>
        {post.post_url && <a href={post.post_url} target="_blank" rel="noreferrer" className="icon-button shrink-0 border border-[var(--outline-variant)] bg-white text-[var(--accent-strong)]" title="Mở bài đăng"><ExternalLink size={15} /></a>}
      </div>
      <div className="mt-3 space-y-2 text-xs text-[var(--on-surface-variant)]">
        <InfoLine label="Ngày đăng" value={formatDateTime(post.published_at)} />
        <InfoLine label="Cập nhật chỉ số" value={formatDateTime(latestCapturedAt)} />
        <InfoLine label="Tăng view 24h" value={`${growth24h >= 0 ? '+' : ''}${formatMetric(growth24h)}`} />
      </div>
      <div className="mt-3"><TikTokEmbedPlayer postId={post.platform_post_id} postUrl={post.post_url} title={post.title} /></div>
      {post.caption && <div className="mt-3 rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-3"><div className="mb-1 text-xs font-bold uppercase text-[var(--on-surface-variant)]">Caption</div><p className="line-clamp-6 whitespace-pre-line text-sm leading-relaxed text-[var(--on-surface)]">{post.caption}</p></div>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <MiniMetric label="Views" value={metricValue(post, 'views')} icon={<Eye size={14} />} />
        <MiniMetric label="Likes" value={metricValue(post, 'likes')} icon={<Heart size={14} />} />
        <MiniMetric label="Comments" value={metricValue(post, 'comments')} icon={<MessageCircle size={14} />} />
        <MiniMetric label="Shares" value={metricValue(post, 'shares')} icon={<Share2 size={14} />} />
      </div>
    </section>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3"><span className="font-semibold">{label}</span><span className="truncate font-bold text-[var(--on-surface)]">{value}</span></div>
}

function MiniMetric({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return <div className="rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-2"><div className="flex items-center gap-1 text-xs font-bold uppercase text-[var(--on-surface-variant)]">{icon}{label}</div><div className="mt-1 text-base font-extrabold text-[var(--on-surface)]">{formatMetric(value)}</div></div>
}
