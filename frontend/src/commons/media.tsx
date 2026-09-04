import { ExternalLink, Play } from 'lucide-react'
import ReactPlayer from 'react-player'
import { mediaProxyPlaybackUrl } from '@/commons/mediaUrls'

type MediaLike = {
  media_type?: string | null
  source_url?: string | null
  storage_url?: string | null
  thumbnail_url?: string | null
  mime_type?: string | null
  format?: string | null
  embed_url?: string | null
  provider?: string | null
  title?: string | null
  alt?: string | null
  caption?: string | null
}

export function cleanMediaUrl(value?: unknown) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const markdownMatch = raw.match(/\]\((https?:\/\/.+)\)$/)
  return markdownMatch?.[1] || raw
}

export function mediaPlaybackUrl(item?: MediaLike | null) {
  if (!item) return ''
  const url = cleanMediaUrl(item.embed_url) || cleanMediaUrl(item.storage_url) || cleanMediaUrl(item.source_url)
  return mediaProxyPlaybackUrl(url)
}

export function mediaPreviewUrl(item?: MediaLike | null) {
  if (!item) return ''
  const thumb = cleanMediaUrl(item.thumbnail_url)
  if (thumb) return thumb
  if (isImageMedia(item)) return cleanMediaUrl(item.storage_url) || cleanMediaUrl(item.source_url)
  return ''
}

export function isVideoMedia(item?: MediaLike | null) {
  if (!item) return false
  const type = String(item.media_type || '').toUpperCase()
  const mime = String(item.mime_type || '').toLowerCase()
  const format = String(item.format || '').toLowerCase()
  const url = [item.source_url, item.storage_url, item.embed_url].map(cleanMediaUrl).join(' ')
  return type.includes('VIDEO') || mime.startsWith('video/') || mime.includes('mpegurl') || format === 'hls' || /\.(mp4|webm|mov|m4v|m3u8)(\?|#|$)/i.test(url)
}

export function isImageMedia(item?: MediaLike | null) {
  if (!item) return false
  const type = String(item.media_type || '').toUpperCase()
  const mime = String(item.mime_type || '').toLowerCase()
  const url = [item.thumbnail_url, item.source_url, item.storage_url].map(cleanMediaUrl).join(' ')
  return type.includes('IMAGE') || mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(url)
}

export function MediaAssetPreview({
  item,
  index = 0,
  compact = false,
  controls = false,
  className = '',
}: {
  item?: MediaLike | null
  index?: number
  compact?: boolean
  controls?: boolean
  className?: string
}) {
  const playbackUrl = mediaPlaybackUrl(item)
  const previewUrl = mediaPreviewUrl(item)
  const isVideo = isVideoMedia(item)
  const isImage = isImageMedia(item)
  const label = item?.title || item?.caption || item?.alt || `media-${index + 1}`
  const shellClass = `${className || (compact ? 'h-12 w-[72px]' : 'aspect-video w-full')} overflow-hidden rounded-md bg-black`

  if (!item || (!playbackUrl && !previewUrl)) {
    return <div className={`${shellClass} flex items-center justify-center border border-dashed border-slate-300 bg-slate-50 text-xs font-semibold text-slate-400`}>No media</div>
  }

  if (isVideo) {
    if (!compact && controls && playbackUrl) {
      return (
        <div className={shellClass}>
          <ReactPlayer src={playbackUrl} controls light={previewUrl || undefined} width="100%" height="100%" />
        </div>
      )
    }

    return (
      <a href={playbackUrl || previewUrl} target="_blank" rel="noreferrer" className={`relative block ${shellClass}`}>
        {previewUrl ? (
          <img src={previewUrl} alt={label} className="h-full w-full object-cover opacity-90" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-slate-950 text-xs font-bold text-white/70">Video</div>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/15">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-sm">
            <Play size={16} fill="currentColor" />
          </span>
        </span>
      </a>
    )
  }

  if (previewUrl && isImage) {
    return (
      <a href={playbackUrl || previewUrl} target="_blank" rel="noreferrer" className={`block ${shellClass}`}>
        <img
          src={previewUrl}
          alt={label}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={(event) => { event.currentTarget.src = 'https://placehold.co/640x360?text=No+Preview' }}
        />
      </a>
    )
  }

  return (
    <a href={playbackUrl || previewUrl} target="_blank" rel="noreferrer" className={`flex items-center justify-center gap-1.5 bg-slate-100 px-3 text-center text-xs font-bold text-blue-700 ${shellClass}`}>
      <ExternalLink size={15} /> Mở media
    </a>
  )
}
