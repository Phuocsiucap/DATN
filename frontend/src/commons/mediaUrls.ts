import { api } from '@/commons/apis/client'

export function isHlsMediaUrl(value?: unknown) {
  const url = String(value || '').trim()
  return /\.m3u8(?:[?#]|$)/i.test(url)
}

export function mediaProxyPlaybackUrl(value?: unknown) {
  const url = String(value || '').trim()
  if (!url || !/^https?:\/\//i.test(url)) return url
  
  // Wrap proxy if it's an HLS stream or a Bilibili link
  const needsProxy = isHlsMediaUrl(url) || /bilibili\.com\/video\//i.test(url)
  if (!needsProxy) return url
  
  if (/\/media-proxy\?url=/i.test(url)) return url
  const base = String(api.defaults.baseURL || '/api/v1').replace(/\/$/, '')
  return `${base}/media-proxy?url=${encodeURIComponent(url)}`
}
