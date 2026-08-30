import { ExternalLink, PlayCircle } from 'lucide-react'

export default function TikTokEmbedPlayer({
  postId,
  title,
  postUrl,
}: {
  postId?: string | null
  title?: string | null
  postUrl?: string | null
}) {
  const cleanPostId = String(postId || '').trim().replace(/^\[+|\]+$/g, '').replace(/^['"]|['"]$/g, '')
  const embedUrl = cleanPostId
    ? `https://www.tiktok.com/player/v1/${encodeURIComponent(cleanPostId)}?controls=1&description=1&music_info=1`
    : ''

  if (!embedUrl) {
    return (
      <div className="flex aspect-[9/16] max-h-[520px] min-h-[360px] w-full flex-col items-center justify-center gap-2 rounded-[8px] bg-slate-950 p-6 text-center text-white/70">
        <PlayCircle size={34} />
        <span className="text-sm font-semibold">Chưa có TikTok post_id để nhúng player.</span>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-[8px] border border-[var(--outline-variant)] bg-slate-950">
      <iframe
        title={title || 'TikTok video player'}
        src={embedUrl}
        className="aspect-[9/16] max-h-[620px] min-h-[420px] w-full"
        allow="fullscreen; clipboard-write; encrypted-media; picture-in-picture"
        loading="lazy"
      />
      {postUrl && (
        <a
          href={postUrl}
          target="_blank"
          rel="noreferrer"
          className="flex h-9 items-center justify-center gap-2 border-t border-white/10 bg-slate-900 text-xs font-bold text-white"
        >
          <ExternalLink size={14} />
          Mở trên TikTok
        </a>
      )}
    </div>
  )
}
