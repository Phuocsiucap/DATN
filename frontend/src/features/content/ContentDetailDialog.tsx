import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  Calendar,
  CheckCircle,
  Clock,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  Newspaper,
  ShieldCheck,
  Sparkles,
  Tag,
  Video,
  Wand2,
  X,
} from 'lucide-react'
import { fetchContentDetailApi } from '@/commons/apis/module1'
import { createDirectScriptApi } from '@/commons/apis/generateVideo'
import { fetchSocialProfilesApi } from '@/commons/apis/socialProfiles'
import { MediaAssetPreview } from '@/commons/media'

const formatDate = (value?: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN')
}

type ContentDetailDialogProps = {
  contentId: string | null
  onClose: () => void
  onOpenModule2?: (jobId?: string) => void
}

export function ContentDetailDialog({ contentId, onClose, onOpenModule2 }: ContentDetailDialogProps) {
  const [contentDetail, setContentDetail] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [profiles, setProfiles] = useState<Array<{ id: string; profile_name: string; username?: string | null; platform: string }>>([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [creatingScript, setCreatingScript] = useState(false)
  const [scriptResult, setScriptResult] = useState<{ success: boolean; message: string } | null>(null)

  useEffect(() => {
    if (contentId) {
      setLoading(true)
      fetchContentDetailApi(contentId)
        .then(setContentDetail)
        .catch(console.error)
        .finally(() => setLoading(false))
    } else {
      setContentDetail(null)
    }
  }, [contentId])

  useEffect(() => {
    if (!contentId) return
    fetchSocialProfilesApi()
      .then((res: any) => {
        const items = res?.items || res || []
        setProfiles(items)
        setSelectedProfileId((current) => current || items[0]?.id || '')
      })
      .catch(() => setProfiles([]))
  }, [contentId])

  const createDirectScript = async () => {
    if (!contentDetail?.id || !selectedProfileId) return
    setCreatingScript(true)
    setScriptResult(null)
    try {
      const result = await createDirectScriptApi({
        profile_id: selectedProfileId,
        content_id: contentDetail.id,
        title: contentDetail.canonical_title || contentDetail.normalized_title || undefined,
        target_duration_seconds: 60,
      })
      setScriptResult({ success: true, message: 'Đã tạo job kịch bản! Chuyển tới Xưởng sản xuất...' })
      onOpenModule2?.((result.workflow as any)?.id || (result.job as any)?.id)
    } catch (error: any) {
      setScriptResult({ success: false, message: error?.response?.data?.detail || error?.message || 'Không tạo được kịch bản trực tiếp' })
    } finally {
      setCreatingScript(false)
    }
  }

  if (!contentId) return null

  const article = contentDetail?.normalized || {
    articleId: contentDetail?.articleId || contentDetail?.article_id,
    categoryId: contentDetail?.categoryId || contentDetail?.category_id,
    siteId: contentDetail?.siteId || contentDetail?.site_id,
    title: contentDetail?.title || contentDetail?.canonical_title || '',
    lead: contentDetail?.lead || contentDetail?.summary || '',
    publishedAt: contentDetail?.publishedAt || contentDetail?.published_at || contentDetail?.source_published_at,
    content: contentDetail?.content || contentDetail?.full_text || '',
    images: contentDetail?.images || [],
    videos: contentDetail?.videos || [],
    url: contentDetail?.url || contentDetail?.canonical_url,
  }

  const rawContentText = (article.content || contentDetail?.full_text || contentDetail?.content || '').trim()

  // Format content paragraphs cleanly and deduplicate lead paragraph
  const paragraphs = useMemo(() => {
    if (!rawContentText) return []
    let list: string[] = []
    if (rawContentText.includes('\n')) {
      list = rawContentText.split(/\n+/).map((p: string) => p.trim()).filter(Boolean)
    } else {
      const splitPattern = /(\.|\"|\”)\s+([A-Z\u00C0-\u024F])/g
      const replaced = rawContentText.replace(splitPattern, '$1\n\n$2')
      list = replaced.split(/\n+/).map((p: string) => p.trim()).filter(Boolean)
    }
    // Deduplicate lead paragraph if it repeats the lead text
    const leadText = (article.lead || '').trim()
    if (leadText && list.length > 0 && (list[0] === leadText || list[0].startsWith(leadText))) {
      return list.slice(1)
    }
    return list
  }, [rawContentText, article.lead])

  const sourceMetadata = contentDetail?.source_metadata || {}
  const tags = Array.isArray(sourceMetadata.tags) ? sourceMetadata.tags.map(String) : []

  // Frontend image deduplication using asset fingerprint
  const imageItems = useMemo(() => {
    const rawImages = article.images || contentDetail?.images || []
    const seen = new Set<string>()
    const items: any[] = []
    for (const image of rawImages) {
      const src = image.src || image.url || ''
      if (!src) continue
      const clean = src.split('?')[0].split('#')[0].toLowerCase()
      const match = clean.match(/-(\d{7,})\.(png|jpg|jpeg|webp|gif)/i)
      const fp = match ? `vne_asset_${match[1]}` : clean.replace(/https?:\/\/i\d+-/, 'https://i-')
      if (!seen.has(fp)) {
        seen.add(fp)
        items.push({
          media_type: 'IMAGE',
          source_url: src,
          alt: image.alt,
          caption: image.caption,
        })
      }
    }
    return items
  }, [article.images, contentDetail?.images])

  const videoItems = (article.videos || []).map((video: any) => ({
    media_type: 'VIDEO',
    source_url: video.url,
    embed_url: video.embedUrl,
    thumbnail_url: video.thumbnail,
    mime_type: video.mimeType,
    format: video.kind,
    provider: video.provider,
    title: video.title,
    description: video.description,
    duration: video.duration,
    qualities: video.qualities,
    max_quality: video.maxQuality,
    extraction_source: video.extractionSource,
  }))

  const dialogContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-950/60 backdrop-blur-xs">
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-6 py-4 bg-slate-50/80">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-xs">
              <Newspaper size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-700">Chi tiết bài viết</span>
                {contentDetail?.source_type && (
                  <span className="rounded-full bg-blue-100/80 px-2.5 py-0.5 text-[10px] font-black text-blue-700">
                    {contentDetail.source_type}
                  </span>
                )}
                {contentDetail?.status && <Badge value={contentDetail.status} />}
                {contentDetail?.quality_score !== undefined && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-black text-emerald-700">
                    <ShieldCheck size={11} /> Quality: {Number(contentDetail.quality_score).toFixed(1)}/100
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
          >
            <X size={18} />
          </button>
        </div>

        {loading || !contentDetail ? (
          <div className="flex h-80 items-center justify-center text-slate-500">
            <Loader2 className="animate-spin mr-2" size={24} /> Đang tải dữ liệu bài viết...
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-y-auto p-6 space-y-5">
            {/* TOP BAR: Metadata & Actions Container */}
            <div className="rounded-xl border border-slate-200/90 bg-slate-50/80 p-4 space-y-3.5 shadow-2xs">
              {/* Row 1: Quick Action (Module 2 Manual) + External Link */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 pb-3">
                <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
                  <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-blue-900 shrink-0">
                    <Wand2 size={15} className="text-blue-600" />
                    <span>Module 2 Manual</span>
                  </div>

                  <select
                    value={selectedProfileId}
                    onChange={(event) => setSelectedProfileId(event.target.value)}
                    className="h-8 max-w-[240px] rounded-lg border border-blue-200 bg-white px-2.5 text-xs font-bold text-slate-800 outline-none focus:border-blue-500"
                  >
                    {profiles.length === 0 && <option value="">Chưa có profile</option>}
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.profile_name}{profile.username ? ` (@${profile.username})` : ''} - {profile.platform}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => void createDirectScript()}
                    disabled={creatingScript || loading || !contentDetail?.id || !selectedProfileId}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-3.5 text-xs font-bold text-white shadow-2xs transition-all hover:opacity-95 disabled:opacity-50"
                  >
                    {creatingScript ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                    Tạo luôn kịch bản
                  </button>
                </div>

                {(article.url || contentDetail.source_url || contentDetail.canonical_url) && (
                  <a
                    href={article.url || contentDetail.source_url || contentDetail.canonical_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-2xs transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                  >
                    <ExternalLink size={13} /> Mở bài đăng gốc
                  </a>
                )}
              </div>

              {scriptResult && (
                <div
                  className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    scriptResult.success
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-rose-200 bg-rose-50 text-rose-800'
                  }`}
                >
                  {scriptResult.success ? (
                    <CheckCircle size={14} className="shrink-0 text-emerald-600" />
                  ) : (
                    <AlertCircle size={14} className="shrink-0 text-rose-600" />
                  )}
                  <span>{scriptResult.message}</span>
                </div>
              )}

              {/* Row 2: Metadata Pills & Key Information */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-2.5 text-xs">
                <div className="rounded-lg border border-slate-200/80 bg-white p-2.5">
                  <div className="flex items-center gap-1 text-[10px] font-bold uppercase text-slate-400">
                    <Calendar size={10} /> Ngày đăng
                  </div>
                  <div className="font-bold text-slate-800 truncate">{formatDate(article.publishedAt || contentDetail.source_published_at)}</div>
                </div>

                <div className="rounded-lg border border-slate-200/80 bg-white p-2.5">
                  <div className="flex items-center gap-1 text-[10px] font-bold uppercase text-slate-400">
                    <Clock size={10} /> Ngày thu thập
                  </div>
                  <div className="font-semibold text-slate-700 truncate">{formatDate(contentDetail.created_at)}</div>
                </div>

                <div className="rounded-lg border border-slate-200/80 bg-white p-2.5">
                  <div className="text-[10px] font-bold uppercase text-slate-400">Chuyên mục</div>
                  <div className="font-bold text-blue-700 truncate">{contentDetail.category || sourceMetadata.category || 'Chung'}</div>
                </div>

                <div className="rounded-lg border border-slate-200/80 bg-white p-2.5">
                  <div className="text-[10px] font-bold uppercase text-slate-400">Tổng quan media</div>
                  <div className="font-bold text-slate-800 truncate">
                    {imageItems.length} Ảnh • {videoItems.length} Video
                  </div>
                </div>
              </div>

              {/* Row 3: Identifiers & Tags */}
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-1">
                {(article.articleId || article.categoryId || article.siteId || contentDetail.article_id) && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-slate-600">
                    <span className="text-[10px] uppercase text-slate-400 mr-1 font-bold">IDs:</span>
                    {(article.articleId || contentDetail.article_id) && (
                      <span className="rounded-md bg-white border border-slate-200 px-2 py-0.5">Article {article.articleId || contentDetail.article_id}</span>
                    )}
                    {(article.categoryId || contentDetail.category_id) && (
                      <span className="rounded-md bg-white border border-slate-200 px-2 py-0.5">Category {article.categoryId || contentDetail.category_id}</span>
                    )}
                    {(article.siteId || contentDetail.site_id) && (
                      <span className="rounded-md bg-white border border-slate-200 px-2 py-0.5">Site {article.siteId || contentDetail.site_id}</span>
                    )}
                  </div>
                )}

                {tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="flex items-center gap-1 text-[10px] uppercase text-slate-400 font-bold mr-1">
                      <Tag size={11} /> Tags:
                    </div>
                    {tags.map((tag: string) => (
                      <span key={tag} className="rounded-md bg-blue-50/80 px-2 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-100">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* MAIN ARTICLE BODY */}
            <div className="space-y-4">
              <div>
                <h1 className="text-xl font-black leading-snug text-slate-900">
                  {article.title || contentDetail.canonical_title}
                </h1>
                {article.lead && (
                  <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/50 p-3.5 text-xs leading-relaxed font-semibold text-slate-700">
                    {article.lead}
                  </div>
                )}
              </div>

              {/* Main Content Paragraphs */}
              <div>
                <div className="mb-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500">
                    <FileText size={14} className="text-blue-600" />
                    <span>Nội dung bài viết ({paragraphs.length} đoạn)</span>
                  </div>
                </div>

                <div className="max-h-[420px] overflow-y-auto rounded-xl border border-slate-200/90 bg-slate-50/60 p-4 text-xs leading-7 text-slate-800 space-y-3 font-normal shadow-2xs">
                  {paragraphs.length > 0 ? (
                    paragraphs.map((paragraph: string, idx: number) => (
                      <p key={idx} className="text-slate-700 leading-relaxed">
                        {paragraph}
                      </p>
                    ))
                  ) : (
                    <div className="flex h-28 items-center justify-center text-slate-400 font-semibold">
                      Không lấy được nội dung văn bản cho bài viết.
                    </div>
                  )}
                </div>
              </div>

              {/* Media Attachments */}
              {(imageItems.length > 0 || videoItems.length > 0) && (
                <div className="space-y-4 pt-2">
                  {videoItems.length > 0 && (
                    <section>
                      <div className="mb-2.5 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500">
                        <Video size={14} className="text-indigo-600" /> Video đính kèm ({videoItems.length})
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {videoItems.map((item: any, index: number) => (
                          <div key={item.source_url || item.embed_url || index} className="overflow-hidden rounded-xl border border-slate-200 bg-black">
                            <MediaAssetPreview item={item} index={index} controls />
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {imageItems.length > 0 && (
                    <section>
                      <div className="mb-2.5 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500">
                        <ImageIcon size={14} className="text-emerald-600" /> Hình ảnh đính kèm ({imageItems.length})
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {imageItems.map((item: any, index: number) => (
                          <div key={item.source_url || index} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
                            <MediaAssetPreview item={item} index={index} controls />
                            {item.caption && (
                              <div className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
                                {item.caption}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(dialogContent, document.body)
}

function Badge({ value }: { value: string }) {
  let color = 'bg-slate-100 text-slate-700'
  if (['SUCCEEDED', 'COMPLETED', 'APPROVED', 'READY'].includes(value)) color = 'bg-emerald-100 text-emerald-800'
  if (['FAILED', 'REJECTED'].includes(value)) color = 'bg-rose-100 text-rose-800'
  if (['RUNNING', 'PENDING', 'PROCESSING'].includes(value)) color = 'bg-blue-100 text-blue-800'
  return <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${color}`}>{value}</span>
}
