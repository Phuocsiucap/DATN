import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ExternalLink, FileText, Languages, Loader2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { createDirectScriptApi } from '@/commons/apis/generateVideo'
import {
  createBilibiliTranslationWorkflowApi,
  fetchBilibiliOcrProgressApi,
  type BilibiliOcrEpisodeProgress,
  type BilibiliOcrProgress,
  type ContentDetail,
  type FinalContentItem,
  type ProfileContentMatch,
} from '@/commons/apis/module1'
import { AppButton, EmptyBlock, PlatformIcon, SocialProfileAvatar, StatusPill, Thumbnail } from '@/commons/component/social-ui'
import { SocialPostPreview } from '@/commons/component/social-previews'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/commons/component/ui/sheet'
import { MediaAssetPreview } from '@/commons/media'

const formatDate = (value?: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const formatScore = (value?: number | null) => {
  if (value == null) return '-'
  const score = Number(value)
  return Number.isFinite(score) ? score.toFixed(1) : '-'
}

const formatSimilarity = (value?: number | null) => {
  if (value == null) return '-'
  const score = Number(value)
  return Number.isFinite(score) ? `${(score * 100).toFixed(1)}%` : '-'
}

type ContentViewItem = FinalContentItem & Partial<ContentDetail>
type EpisodeRecord = Record<string, unknown>
const getContentMedia = (item: ContentViewItem) => item.media_jsonb || item.media || []
const countByMediaType = (item: ContentViewItem, pattern: RegExp) => {
  const counts = item.media_counts
  if (pattern.test('IMAGE') && typeof counts?.images === 'number') return counts.images
  if (pattern.test('VIDEO') && typeof counts?.videos === 'number') return counts.videos
  return getContentMedia(item).filter((media) => pattern.test(String(media.media_type || media.mime_type || ''))).length
}
const getSourceUrl = (item: ContentViewItem) => item.source_url || item.canonical_url || item.url || item.normalized?.url || ''
const getContentText = (item: ContentViewItem) => item.content || item.full_text || item.normalized?.content || item.summary || ''
const wordCount = (value?: string | null) => String(value || '').trim().split(/\s+/).filter(Boolean).length
const formatMediaCounts = (item: ContentViewItem) => {
  const images = countByMediaType(item, /image/i)
  const videos = countByMediaType(item, /video/i)
  const parts = [images ? `${images} ảnh` : '', videos ? `${videos} video` : ''].filter(Boolean)
  return parts.length ? parts.join(' · ') : '-'
}
const getContentTags = (item: ContentViewItem) => [...(item.tags || []), item.category, item.language].filter((value): value is string => Boolean(value))
const getMediaSrc = (item: ContentViewItem) => {
  const media = (item.media_jsonb || item.media || [])[0]
  return item.thumbnail_url || media?.thumbnail_url || media?.source_url || media?.storage_url || null
}
const getEpisodeItems = (item: ContentViewItem) => {
  const metadata = item.source_metadata || {}
  const episodes = metadata.episodes
  return Array.isArray(episodes) ? episodes.filter((episode): episode is EpisodeRecord => Boolean(episode && typeof episode === 'object')) : []
}
const formatDuration = (value: unknown) => {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${String(secs).padStart(2, '0')}`
}
const formatTimecode = (value?: number | null) => {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}
const isBilibiliItem = (item: ContentViewItem | null) => String(item?.source_type || '').toUpperCase() === 'BILIBILI'

function SkeletonLine({ className }: { className: string }) {
  return <div className={`animate-pulse bg-[#eef1f7] ${className}`} />
}

function ContentDetailSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-5 grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
        <SkeletonLine className="h-[110px] rounded-lg" />
        <div className="space-y-3"><SkeletonLine className="h-5 w-4/5" /><SkeletonLine className="h-4 w-full" /><SkeletonLine className="h-4 w-2/3" /><SkeletonLine className="h-6 w-24 rounded-md" /></div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <SkeletonLine key={index} className="h-[58px] rounded-lg" />)}</div>
      <div className="grid gap-4 lg:grid-cols-2"><SkeletonLine className="h-[220px] rounded-lg" /><SkeletonLine className="h-[220px] rounded-lg" /></div>
      <SkeletonLine className="mt-4 h-[180px] rounded-lg" />
    </div>
  )
}

export function ContentDetailSheet({
  item,
  loading,
  fallbackTitle,
  onClose,
  onOpenModule2,
}: {
  item: ContentDetail | null
  loading: boolean
  fallbackTitle?: string
  onClose: () => void
  onOpenModule2?: (jobId?: string) => void
}) {
  const [creatingProfileId, setCreatingProfileId] = useState<string | null>(null)
  const [ocrProgress, setOcrProgress] = useState<BilibiliOcrProgress | null>(null)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [translatingKey, setTranslatingKey] = useState<string | null>(null)
  const itemId = item?.id || ''
  const isBilibili = isBilibiliItem(item)
  const ocrHasActiveTasks = Boolean(ocrProgress?.episodes.some((episode) => ['PENDING', 'RUNNING', 'PROCESSING'].includes(episode.status)))
  const ocrTranslatedSegments = useMemo(
    () => ocrProgress?.episodes.flatMap((episode) => episode.segments.filter((segment) => segment.translated_text)) || [],
    [ocrProgress],
  )

  useEffect(() => {
    if (!itemId || !isBilibili) {
      setOcrProgress(null)
      return
    }
    let disposed = false
    const loadProgress = async (quiet = false) => {
      if (!quiet) setOcrLoading(true)
      try {
        const data = await fetchBilibiliOcrProgressApi(itemId)
        if (!disposed) setOcrProgress(data)
      } catch {
        if (!disposed) setOcrProgress(null)
      } finally {
        if (!quiet && !disposed) setOcrLoading(false)
      }
    }
    void loadProgress()
    const timer = window.setInterval(() => void loadProgress(true), 2500)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [itemId, isBilibili])

  if (!item && !loading) return null

  if (loading) {
    return (
      <Sheet open onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="right" className="max-w-[720px]">
          <div className="detail-shell">
            <SheetHeader>
              <SheetTitle>Chi tiết bài viết</SheetTitle>
              <SheetDescription className="truncate">{fallbackTitle || 'Đang tải dữ liệu...'}</SheetDescription>
            </SheetHeader>
          <ContentDetailSkeleton />
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  if (!item) return null

  const score = Number(item.quality_score)
  const tags = getContentTags(item)
  const contentText = getContentText(item)
  const contentLines = contentText.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 8)
  const mediaItems = getContentMedia(item)
  const imageItems = mediaItems.filter((media) => /image/i.test(String(media.media_type || media.mime_type || '')))
  const videoItems = mediaItems.filter((media) => /video/i.test(String(media.media_type || media.mime_type || '')) || ['hls', 'mp4'].includes(String(media.format || '').toLowerCase()))
  const episodeItems = getEpisodeItems(item)
  const sourceUrl = getSourceUrl(item)
  const profileMatches = item.profile_matches || []
  const tiktokMatch = profileMatches.find((match) => String(match.platform || '').toLowerCase() === 'tiktok' && match.can_create_script)
    || profileMatches.find((match) => String(match.platform || '').toLowerCase() === 'tiktok')

  const createScriptForProfile = async (match: ProfileContentMatch) => {
    if (creatingProfileId) return
    if (match.existing_workflow_id) {
      onOpenModule2?.(match.existing_workflow_id)
      return
    }
    setCreatingProfileId(match.profile_id)
    try {
      const result = await createDirectScriptApi({
        profile_id: match.profile_id,
        content_id: item.id,
        title: item.canonical_title || item.normalized_title || undefined,
        target_duration_seconds: 60,
      })
      const workflowId = typeof result.workflow?.id === 'string' ? result.workflow.id : undefined
      toast.success(result.reused
        ? `Bài này đã có quy trình cho ${match.profile_name}; đang mở lại.`
        : `Đã đưa kịch bản cho ${match.profile_name} vào hàng đợi.`)
      onOpenModule2?.(workflowId)
    } catch (error: unknown) {
      const candidate = error as { response?: { data?: { detail?: string } }; message?: string }
      toast.error(candidate.response?.data?.detail || candidate.message || 'Không thể tạo kịch bản ngay lúc này.')
    } finally {
      setCreatingProfileId(null)
    }
  }

  const queueTranslation = async (episodeIndex?: number) => {
    if (!item?.id || !isBilibili || translatingKey) return
    const targetProfile = tiktokMatch || profileMatches.find((match) => match.can_create_script) || profileMatches[0]
    if (!targetProfile?.profile_id) {
      toast.error('Chưa có kênh social phù hợp để tạo workflow dịch.')
      return
    }
    const key = episodeIndex ? `episode-${episodeIndex}` : 'all'
    setTranslatingKey(key)
    try {
      const result = await createBilibiliTranslationWorkflowApi(item.id, {
        profile_id: targetProfile.profile_id,
        episode_indices: episodeIndex ? [episodeIndex] : undefined,
        title: episodeIndex ? `${item.canonical_title || item.normalized_title || 'Bilibili'} · tập ${episodeIndex}` : undefined,
      })
      toast.success(`Đã tạo workflow dịch cho ${targetProfile.profile_name}.`)
      const progress = await fetchBilibiliOcrProgressApi(item.id)
      setOcrProgress(progress)
      onOpenModule2?.(result.workflow.id)
    } catch (error: unknown) {
      const candidate = error as { response?: { data?: { detail?: string } }; message?: string }
      toast.error(candidate.response?.data?.detail || candidate.message || 'Không thể tạo workflow dịch.')
    } finally {
      setTranslatingKey(null)
    }
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className={isBilibili ? 'max-w-[920px]' : 'max-w-[720px]'}>
      <div className="detail-shell">
      <SheetHeader>
        <div className="flex items-center justify-between gap-3 pr-10">
          <SheetTitle>Chi tiết bài viết</SheetTitle>
          <StatusPill value={item.status || '-'} />
        </div>
          <SheetDescription className="flex items-center gap-2 font-bold">
            <PlatformIcon platform={item.source_type || 'source'} size="sm" />
            {item.source_type || '-'}
            {Number.isFinite(score) && <span className="text-[#16a34a]">• {score.toFixed(1)}/100</span>}
          </SheetDescription>
      </SheetHeader>

      <SheetBody>
        <div className="mb-5 grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
          <Thumbnail src={getMediaSrc(item)} title={item.canonical_title} className="h-[110px]" fallback={false} />
          <div>
            <h3 className="line-clamp-2 text-lg font-extrabold leading-6 text-[#111827]">{item.canonical_title}</h3>
            {item.summary && <p className="mt-2 line-clamp-2 text-sm font-medium leading-5 text-[#526179]">{item.summary}</p>}
            {item.category && <span className="mt-3 inline-flex rounded-[6px] bg-[#f2f0ff] px-2.5 py-1 text-xs font-bold text-[#6d5dfc]">{item.category}</span>}
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 text-xs lg:grid-cols-3">
          <MetaCard label="Ngày đăng" value={formatDate(item.published_at || item.created_at)} />
          <MetaCard label="Độ dài" value={contentText ? `${wordCount(contentText).toLocaleString('vi-VN')} từ` : '-'} />
          <MetaCard label="Ngày thu thập" value={formatDate(item.created_at)} />
          <MetaCard label="Nguồn" value={item.source_type || '-'} />
          <MetaCard label="ID" value={item.article_id || item.id.slice(0, 10)} />
          <MetaCard label="Định dạng" value={formatMediaCounts(item)} />
        </div>

        {tags.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 border-y border-[var(--outline-variant)] py-3">
            <span className="text-sm font-bold text-[#526179]">Tags:</span>
            {tags.map((tag) => <span key={tag} className="rounded-[6px] bg-[#f2f0ff] px-2 py-0.5 text-xs font-bold text-[#6d5dfc]">{tag}</span>)}
          </div>
        )}

        {isBilibili ? (
          <div className="grid gap-4">
            <section className="rounded-[8px] border border-[var(--outline-variant)] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-extrabold text-[#111827]">
                <FileText size={16} /> Nội dung bài viết
              </div>
              {contentLines.length > 0 ? (
                <ol className="list-decimal space-y-2 pl-4 text-sm leading-6 text-[#34415a]">
                  {contentLines.map((line, index) => <li key={`${index}-${line.slice(0, 12)}`}>{line}</li>)}
                </ol>
              ) : (
                <EmptyBlock label="Chưa có nội dung bài viết." />
              )}
            </section>
            <BilibiliContentDetail
              item={item}
              episodes={episodeItems}
              translatingKey={translatingKey}
              onQueueTranslation={queueTranslation}
            />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-[8px] border border-[var(--outline-variant)] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-extrabold text-[#111827]">
                <FileText size={16} /> Nội dung bài viết
              </div>
              {contentLines.length > 0 ? (
                <ol className="list-decimal space-y-2 pl-4 text-sm leading-6 text-[#34415a]">
                  {contentLines.map((line, index) => <li key={`${index}-${line.slice(0, 12)}`}>{line}</li>)}
                </ol>
              ) : (
                <EmptyBlock label="Chưa có nội dung bài viết." />
              )}
            </section>

            <div className="flex flex-col gap-4">
            <section className="rounded-[8px] border border-[var(--outline-variant)] p-4">
              <div className="mb-3 text-sm font-extrabold text-[#111827]">Hình ảnh đính kèm ({imageItems.length})</div>
              {imageItems.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {imageItems.slice(0, 4).map((media, index) => (
                    <Thumbnail
                      key={`${media.source_url || media.storage_url || index}`}
                      src={media.thumbnail_url || media.source_url || media.storage_url}
                      title={media.title || item.canonical_title}
                      className="h-[110px]"
                      fallback={false}
                    />
                  ))}
                </div>
              ) : (
                <EmptyBlock label="Chưa có hình ảnh đính kèm." />
              )}
            </section>

            {videoItems.length > 0 && (
              <section className="rounded-[8px] border border-[var(--outline-variant)] p-4">
                <div className="mb-3 text-sm font-extrabold text-[#111827]">Video đính kèm ({videoItems.length})</div>
                <div className="grid gap-3">
                  {videoItems.slice(0, 4).map((media, index) => (
                    <div
                      key={`${media.source_url || index}`}
                      className="overflow-hidden rounded-lg border border-[var(--outline-variant)] bg-black shadow-sm"
                    >
                      <MediaAssetPreview
                        item={media}
                        index={index}
                        controls
                        className="aspect-video w-full"
                      />
                      {(media.title || media.description) && (
                        <div className="border-t border-white/10 bg-slate-950 px-3 py-2">
                          {media.title && <div className="line-clamp-1 text-xs font-bold text-white">{media.title}</div>}
                          {media.description && <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-white/65">{media.description}</div>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {episodeItems.length > 0 && (
              <section className="rounded-[8px] border border-[var(--outline-variant)] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-extrabold text-[#111827]">Danh sách tập ({episodeItems.length})</div>
                  {isBilibili && (
                    <AppButton
                      className="h-8 px-3 text-xs"
                      variant="secondary"
                      icon={translatingKey === 'all' ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
                      disabled={Boolean(translatingKey)}
                      onClick={() => void queueTranslation()}
                    >
                      Dịch toàn bộ
                    </AppButton>
                  )}
                </div>
                <div className="max-h-[360px] overflow-y-auto rounded-[8px] border border-[#edf1f7]">
                  {episodeItems.map((episode, index) => {
                    const title = String(episode.title || `Tập ${index + 1}`)
                    const url = String(episode.url || episode.embed_url || '')
                    const duration = formatDuration(episode.duration_seconds)
                    const episodeIndex = Number(episode.episode_index || index + 1)
                    const thumbnail = String(episode.thumbnail_url || '')
                    const isCurrent = Boolean(episode.current)
                    return (
                      <div
                        key={`${url || title}-${index}`}
                        className={`grid grid-cols-[44px_56px_minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-[#edf1f7] px-3 py-2 text-left text-xs last:border-b-0 hover:bg-[#f8fafc] ${isCurrent ? 'bg-blue-50/60' : ''}`}
                      >
                        <span className="font-mono font-bold text-[#64748b]">{String(episode.episode_index || index + 1).padStart(2, '0')}</span>
                        <button
                          type="button"
                          disabled={!url}
                          onClick={() => url && window.open(url, '_blank', 'noopener,noreferrer')}
                          className="h-10 overflow-hidden rounded-[6px] border border-[#edf1f7] bg-[#f8fafc] disabled:cursor-default"
                          title={url ? 'Mở tập gốc' : title}
                        >
                          {thumbnail ? <img src={thumbnail} alt="" className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center font-bold text-[#94a3b8]">EP</span>}
                        </button>
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="line-clamp-1 font-bold text-[#34415a]">{title}</span>
                            {isCurrent && <span className="shrink-0 rounded-[5px] bg-[#dbeafe] px-1.5 py-0.5 text-[10px] font-black uppercase text-[#1d4ed8]">Hiện tại</span>}
                          </span>
                          {Boolean(duration || episode.bvid) && <span className="mt-0.5 block text-[#64748b]">{[duration, episode.bvid ? String(episode.bvid) : ''].filter(Boolean).join(' · ')}</span>}
                        </span>
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="grid h-8 w-8 place-items-center rounded-[8px] text-[#94a3b8] hover:bg-white hover:text-[#2556ea]"
                            title="Mở tập gốc"
                          >
                            <ExternalLink size={14} />
                          </a>
                        ) : <span />}
                        {isBilibili && (
                          <button
                            type="button"
                            onClick={() => void queueTranslation(episodeIndex)}
                            disabled={Boolean(translatingKey)}
                            className="grid h-8 w-8 place-items-center rounded-[8px] border border-[var(--outline-variant)] text-[#64748b] hover:bg-white hover:text-[#2556ea] disabled:opacity-50"
                            title="Dịch tập này"
                          >
                            {translatingKey === `episode-${episodeIndex}` ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )}
          </div>
        </div>
        )}

        {isBilibili && (
          <BilibiliOcrProgressPanel
            progress={ocrProgress}
            loading={ocrLoading}
            polling={ocrHasActiveTasks}
            translatedSegmentCount={ocrTranslatedSegments.length}
          />
        )}

        <section className="mt-4 rounded-[8px] border border-[var(--outline-variant)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-base font-extrabold text-[#111827]">Phân tích phù hợp theo kênh social</div>
              {profileMatches.length > 0 && <p className="mt-1 text-xs leading-5 text-[#64748b]">{profileMatches.length} kênh đã phân tích. Mở chi tiết từng kênh để xem lý do và thông số đối chiếu.</p>}
            </div>
          </div>
          {profileMatches.length > 0 ? (
            <div className="divide-y divide-[#edf1f7]">
              {profileMatches.map((match) => (
                <ProfileMatchRow
                  key={`${item.id}-${match.profile_id}`}
                  match={match}
                  creating={creatingProfileId === match.profile_id}
                  createDisabled={Boolean(creatingProfileId)}
                  onCreateScript={createScriptForProfile}
                />
              ))}
            </div>
          ) : (
            <EmptyBlock label="Chưa có dữ liệu phân tích theo kênh social." />
          )}
        </section>

        <details key={item.id} className="group/preview mt-4 rounded-[8px] border border-[var(--outline-variant)] p-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-bold text-[#34415a] [&::-webkit-details-marker]:hidden">
            Xem trước bài đăng TikTok
            <ChevronDown size={16} className="shrink-0 transition-transform group-open/preview:rotate-180" />
          </summary>
          <p className="mb-4 mt-2 text-xs leading-5 text-[#64748b]">Bản mô phỏng giao diện, không phải kết quả đề xuất hay bài đã xuất bản.</p>
          {tiktokMatch ? (
            <SocialPostPreview
              post={{
                platform: 'tiktok',
                profileName: tiktokMatch.profile_name,
                username: tiktokMatch.username || tiktokMatch.profile_name,
                title: item.canonical_title,
                caption: item.summary || item.canonical_title,
                mediaUrl: getMediaSrc(item),
                status: item.status || '-',
              }}
            />
          ) : (
            <EmptyBlock label="Chưa có kênh TikTok để xem trước." />
          )}
        </details>
      </SheetBody>

      <SheetFooter>
        <AppButton variant="secondary" icon={<ExternalLink size={15} />} disabled={!sourceUrl} onClick={() => sourceUrl && window.open(sourceUrl, '_blank', 'noopener,noreferrer')}>Mở bài gốc</AppButton>
      </SheetFooter>
      </div>
      </SheetContent>
    </Sheet>
  )
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-[#edf1f7] bg-[#fbfcff] p-3">
      <div className="text-xs font-bold text-[#64748b]">{label}</div>
      <div className="mt-1 truncate text-xs font-extrabold text-[#34415a]">{value}</div>
    </div>
  )
}

function BilibiliContentDetail({
  item,
  episodes,
  translatingKey,
  onQueueTranslation,
}: {
  item: ContentViewItem
  episodes: EpisodeRecord[]
  translatingKey: string | null
  onQueueTranslation: (episodeIndex?: number) => void
}) {
  const mediaItems = getContentMedia(item)
  const listMetadata = (item as ContentViewItem & { list_metadata?: Record<string, unknown> }).list_metadata || {}
  const currentEpisodeIndex = Math.max(0, episodes.findIndex((episode) => Boolean(episode.current)))
  const [selectedIndex, setSelectedIndex] = useState(currentEpisodeIndex)
  const selectedEpisode = episodes[selectedIndex] || episodes[0] || null
  const selectedTitle = String(selectedEpisode?.title || item.canonical_title || 'Bilibili video')
  const selectedSourceUrl = String(selectedEpisode?.url || '')
  const selectedEmbedUrl = String(selectedEpisode?.embed_url || '')
  const selectedUrl = selectedSourceUrl || selectedEmbedUrl
  const selectedThumb = String(selectedEpisode?.thumbnail_url || item.thumbnail_url || getMediaSrc(item) || '')
  const selectedEpisodeNumber = Number(selectedEpisode?.episode_index || selectedIndex + 1)
  const selectedMedia = selectedUrl && !selectedEmbedUrl
    ? {
        media_type: 'VIDEO_REFERENCE',
        source_url: selectedUrl,
        embed_url: selectedEmbedUrl,
        thumbnail_url: selectedThumb,
        title: selectedTitle,
        provider: 'bilibili',
      }
    : null
  const fallbackVideo = mediaItems.find((media) => /video/i.test(String(media.media_type || media.mime_type || '')) || String(media.media_type || '').toUpperCase().includes('VIDEO'))
  const playerMedia = selectedMedia || (selectedEpisode?.current && fallbackVideo ? fallbackVideo : null)

  useEffect(() => {
    const nextIndex = Math.max(0, episodes.findIndex((episode) => Boolean(episode.current)))
    setSelectedIndex(nextIndex)
  }, [item.id, episodes.length])

  return (
          <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="overflow-hidden rounded-[8px] border border-[var(--outline-variant)] bg-slate-950">
              {selectedEmbedUrl ? (
                <div className="aspect-video w-full overflow-hidden bg-black">
                  <iframe
                    key={selectedEmbedUrl}
                    src={selectedEmbedUrl}
                    title={selectedTitle}
                    width="100%"
                    height="100%"
                    frameBorder="0"
                    scrolling="no"
                    allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : playerMedia ? (
                <MediaAssetPreview item={playerMedia} controls className="aspect-video w-full rounded-none" />
              ) : (
                <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-slate-950 px-6 text-center text-sm font-semibold text-white/75">
                  <span>Chưa có URL video cho tập này.</span>
                  <span className="text-xs font-medium text-white/45">Danh sách tập được lấy từ metadata/text crawl, không tạo thêm content item.</span>
                </div>
              )}
              <div className="border-t border-white/10 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="break-words text-base font-black leading-6 text-white">{selectedTitle}</h3>
                    <p className="mt-1 text-xs font-semibold text-white/55">
                      Tập {Number.isFinite(selectedEpisodeNumber) ? selectedEpisodeNumber : selectedIndex + 1}
                      {selectedEpisode?.bvid ? ` · ${String(selectedEpisode.bvid)}` : ''}
                    </p>
                  </div>
                  {selectedSourceUrl && (
                    <AppButton
                      className="h-8 shrink-0 px-3 text-xs"
                      variant="secondary"
                      icon={<ExternalLink size={14} />}
                      onClick={() => window.open(selectedSourceUrl, '_blank', 'noopener,noreferrer')}
                    >
                      Mở gốc
                    </AppButton>
                  )}
                </div>
              </div>
            </div>

            <section className="rounded-[8px] border border-[#222831] bg-[#202124] p-3 text-white shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <div className="line-clamp-1 text-base font-extrabold text-white">{String(listMetadata.series_title || listMetadata.season_title || item.canonical_title || 'Chuỗi video')}</div>
                  <div className="mt-1 text-xs font-semibold text-white/55">{episodes.length || 1} tập</div>
                </div>
                <AppButton
                  className="h-8 px-3 text-xs"
                  variant="secondary"
                  icon={translatingKey === 'all' ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
                  disabled={Boolean(translatingKey)}
                  onClick={() => onQueueTranslation()}
                >
                  Tạo workflow dịch
                </AppButton>
              </div>
              <div className="max-h-[560px] overflow-y-auto rounded-[8px] border border-white/10">
                {(episodes.length ? episodes : [{ title: item.canonical_title, current: true }]).map((episode, index) => {
                  const title = String(episode.title || `Tập ${index + 1}`)
                  const episodeIndex = Number(episode.episode_index || index + 1)
                  const duration = formatDuration(episode.duration_seconds)
                  const thumbnail = String(episode.thumbnail_url || '')
                  const active = index === selectedIndex
                  const hasUrl = Boolean(episode.url || episode.embed_url)
                  return (
                    <button
                      key={`${String(episode.url || '')}-${title}-${index}`}
                      type="button"
                      onClick={() => setSelectedIndex(index)}
                      className={`grid w-full grid-cols-[24px_minmax(0,1fr)_44px_28px] items-center gap-2 border-b border-white/10 px-3 py-3 text-left text-xs last:border-b-0 ${active ? 'bg-[#111827]' : 'hover:bg-white/5'}`}
                    >
                      <span className={`font-mono font-black ${active ? 'text-[#00a1d6]' : 'text-white/45'}`}>{active ? '||' : String(episodeIndex).padStart(2, '0')}</span>
                      <span className="min-w-0">
                        <span className={`line-clamp-2 font-extrabold leading-5 ${active ? 'text-[#00a1d6]' : 'text-white/90'}`}>{title}</span>
                        <span className="mt-0.5 block truncate text-white/40">
                          {[thumbnail ? 'có thumbnail' : '', hasUrl ? 'có video' : 'metadata'].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="text-right font-mono text-sm font-semibold text-white/55">{duration || '--:--'}</span>
                      <span className="grid h-7 w-7 place-items-center rounded-[7px] text-white/55 hover:bg-white/10 hover:text-white">
                        {translatingKey === `episode-${episodeIndex}` ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Languages
                            size={14}
                            onClick={(event) => {
                              event.stopPropagation()
                              onQueueTranslation(episodeIndex)
                            }}
                          />
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          </section>
  )
}

function BilibiliOcrProgressPanel({
  progress,
  loading,
  polling,
  translatedSegmentCount,
}: {
  progress: BilibiliOcrProgress | null
  loading: boolean
  polling: boolean
  translatedSegmentCount: number
}) {
  const overall = progress?.overall
  const percent = Math.round(Number(overall?.progress_percent || 0))
  return (
    <section className="mt-4 rounded-[8px] border border-[var(--outline-variant)] p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-extrabold text-[#111827]">
            OCR & text dịch Bilibili
            {polling && <span className="h-2 w-2 rounded-full bg-blue-500 shadow-xs shadow-blue-300" />}
          </div>
          <p className="mt-1 text-xs leading-5 text-[#64748b]">
            Hệ thống đọc task OCR theo thời gian thực; worker cập nhật segment dịch tới đâu sẽ hiện tới đó.
          </p>
        </div>
        {loading ? <Loader2 size={16} className="animate-spin text-[#64748b]" /> : <StatusPill value={ocrStatusLabel(overall?.status)} tone={ocrStatusTone(overall?.status)} />}
      </div>

      {!progress ? (
        <EmptyBlock label="Chưa có task OCR cho video này." />
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 text-xs sm:grid-cols-4">
            <MetaCard label="Tổng tiến trình" value={`${percent}%`} />
            <MetaCard label="Tập đã queue" value={`${overall?.queued || 0}/${overall?.total || 0}`} />
            <MetaCard label="Hoàn tất" value={`${overall?.completed || 0}`} />
            <MetaCard label="Segment đã dịch" value={`${translatedSegmentCount}`} />
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-[#edf1f7]">
            <div className="h-full rounded-full bg-[#2556ea] transition-all" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
          </div>

          <div className="max-h-[420px] overflow-y-auto rounded-[8px] border border-[#edf1f7]">
            {progress.episodes.length === 0 ? (
              <div className="p-3"><EmptyBlock label="Chưa có tập nào trong hàng đợi OCR." /></div>
            ) : (
              progress.episodes.map((episode) => (
                <OcrEpisodeRow key={episode.id} episode={episode} />
              ))
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function OcrEpisodeRow({ episode }: { episode: BilibiliOcrEpisodeProgress }) {
  const segmentPreview = episode.segments.filter((segment) => segment.raw_text || segment.translated_text).slice(-4)
  return (
    <details className="group/ocr border-b border-[#edf1f7] last:border-b-0" open={episode.status !== 'COMPLETED'}>
      <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_96px_auto] items-center gap-3 px-3 py-2.5 text-xs [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <div className="line-clamp-1 font-extrabold text-[#34415a]">
            {episode.episode_index ? `Tập ${episode.episode_index} · ` : ''}{episode.title || episode.bvid || episode.id.slice(0, 8)}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[#64748b]">
            <span>{ocrStageLabel(episode.current_stage) || episode.current_stage || 'Đang chờ'}</span>
            {episode.bvid && <span>{episode.bvid}</span>}
          </div>
        </div>
        <div className="text-right font-black tabular-nums text-[#111827]">{Math.round(Number(episode.progress_percent || 0))}%</div>
        <StatusPill value={ocrTaskStatusLabel(episode.status)} tone={ocrStatusTone(episode.status)} />
      </summary>
      <div className="space-y-3 px-3 pb-3">
        <div className="h-1.5 overflow-hidden rounded-full bg-[#edf1f7]">
          <div className="h-full rounded-full bg-[#16a34a]" style={{ width: `${Math.max(0, Math.min(100, Number(episode.progress_percent || 0)))}%` }} />
        </div>
        {episode.error_message && <div className="rounded-[8px] bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{episode.error_message}</div>}
        {(episode.translated_text || episode.raw_text) && (
          <div className="rounded-[8px] bg-[#f8fafc] p-3 text-xs leading-5 text-[#34415a]">
            {episode.translated_text || episode.raw_text}
          </div>
        )}
        {segmentPreview.length > 0 && (
          <div className="divide-y divide-[#edf1f7] rounded-[8px] border border-[#edf1f7]">
            {segmentPreview.map((segment) => (
              <div key={`${episode.id}-${segment.index}`} className="grid gap-2 px-3 py-2 text-xs sm:grid-cols-[74px_minmax(0,1fr)]">
                <div className="font-mono font-bold text-[#64748b]">{formatTimecode(segment.start)}-{formatTimecode(segment.end)}</div>
                <div className="min-w-0">
                  {segment.raw_text && <div className="break-words text-[#64748b]">{segment.raw_text}</div>}
                  {segment.translated_text && <div className="mt-1 break-words font-semibold text-[#111827]">{segment.translated_text}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  )
}

function ocrStatusLabel(value?: string | null) {
  const labels: Record<string, string> = {
    NOT_QUEUED: 'Chưa queue',
    QUEUED: 'Đang chờ OCR',
    PROCESSING: 'Đang OCR',
    COMPLETED: 'OCR xong',
    FAILED: 'OCR lỗi',
  }
  return labels[String(value || '').toUpperCase()] || String(value || 'Chưa queue')
}

function ocrTaskStatusLabel(value?: string | null) {
  const labels: Record<string, string> = {
    PENDING: 'Chờ',
    RUNNING: 'Đang chạy',
    PROCESSING: 'Đang chạy',
    COMPLETED: 'Xong',
    FAILED: 'Lỗi',
    CANCELLED: 'Đã hủy',
  }
  return labels[String(value || '').toUpperCase()] || String(value || '-')
}

function ocrStatusTone(value?: string | null): 'green' | 'blue' | 'amber' | 'red' | 'gray' {
  const status = String(value || '').toUpperCase()
  if (status === 'COMPLETED') return 'green'
  if (status === 'FAILED') return 'red'
  if (['RUNNING', 'PROCESSING'].includes(status)) return 'blue'
  if (status === 'PENDING' || status === 'QUEUED') return 'amber'
  return 'gray'
}

function ocrStageLabel(value?: string | null) {
  const labels: Record<string, string> = {
    QUEUED_OCR: 'Đang chờ OCR',
    DOWNLOADING_VIDEO: 'Đang tải video',
    EXTRACTING_FRAMES: 'Đang tách khung hình',
    RUNNING_OCR: 'Đang nhận diện chữ',
    TRANSLATING_TEXT: 'Đang dịch text',
    SAVING_TRANSCRIPT: 'Đang lưu transcript',
    COMPLETED: 'Hoàn tất',
  }
  return labels[String(value || '').toUpperCase()]
}

function ProfileMatchRow({
  match,
  creating,
  createDisabled,
  onCreateScript,
}: {
  match: ProfileContentMatch
  creating: boolean
  createDisabled: boolean
  onCreateScript: (match: ProfileContentMatch) => void
}) {
  const score = Number(match.score ?? 0)
  const threshold = Number(match.threshold ?? 70)
  const passedSimilarityGate = typeof match.passed_similarity_gate === 'boolean' ? match.passed_similarity_gate : score >= threshold
  const tone = match.blocked_by_avoid_topics || ['AI_REJECTED', 'HUMAN_REJECTED', 'AVOID_TOPIC_MATCH'].includes(match.recommendation_status)
    ? 'red'
    : ['REVIEW_REQUIRED', 'LOW_MATCH', 'DRAFT_FAILED', 'DRAFT_QUEUED'].includes(match.recommendation_status)
      ? 'amber'
      : ['RECOMMENDED', 'WORKFLOW_CREATED'].includes(match.recommendation_status) ? 'green' : 'gray'
  const statusLabels: Record<string, string> = {
    RECOMMENDED: 'Được đề xuất',
    LOW_MATCH: 'Độ phù hợp thấp',
    AVOID_TOPIC_MATCH: 'Khớp chủ đề cần tránh',
    AI_REJECTED: 'Hệ thống không đề xuất',
    HUMAN_REJECTED: 'Người dùng không sản xuất',
    DRAFT_QUEUED: 'Đã duyệt, đang sinh draft',
    DRAFT_FAILED: 'Sinh draft sau duyệt thất bại',
    REVIEW_REQUIRED: 'Cần kiểm duyệt',
    WORKFLOW_CREATED: 'Đã tạo quy trình',
  }
  const topicMatches = match.topic_matches || []
  const avoidTopicMatches = match.avoid_topic_matches || []
  const topTopicMatch = match.top_topic_match || topicMatches[0]
  const reason = match.selection_reason || match.ai_decision_reason
  const riskNotes = [...new Set(match.risk_notes || [])]
  const showAngle = match.can_create_script && !match.blocked_by_avoid_topics
    && ['RECOMMENDED', 'WORKFLOW_CREATED'].includes(match.recommendation_status)
  return (
    <div className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <SocialProfileAvatar
            avatarUrl={match.avatar_url}
            name={match.profile_name}
            platform={match.platform}
            size="lg"
          />
          <div className="min-w-0">
            <div className="break-words text-sm font-extrabold text-[#111827]">{match.profile_name}</div>
            <div className="mt-1 break-all text-xs text-[#64748b]">{match.username ? `@${match.username.replace(/^@/, '')} · ` : ''}{match.platform}</div>
          </div>
        </div>
        <StatusPill value={statusLabels[match.recommendation_status] || 'Chưa có kết luận'} tone={tone} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[8px] bg-[#f8fafc] px-3 py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <div className="text-xs text-[#526179]">Điểm phù hợp <strong className="ml-1 text-lg text-[#111827]">{formatScore(match.score)}</strong><span className="text-[#64748b]">/100</span></div>
          <div className="text-xs text-[#64748b]">Ngưỡng kênh: <span className="font-semibold text-[#34415a]">{formatScore(threshold)}/100</span></div>
        </div>
        <AppButton
          className="h-8 px-3"
          icon={creating ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
          disabled={createDisabled}
          onClick={() => onCreateScript(match)}
        >
          {creating ? 'Đang tạo...' : match.existing_workflow_id ? 'Mở quy trình đã có' : 'Tạo kịch bản ngay'}
        </AppButton>
      </div>
      {topTopicMatch && <p className="mt-2 text-xs leading-5 text-[#64748b]">Chủ đề gần nhất: <span className="font-semibold text-[#34415a]">{topTopicMatch.topic}</span>{!passedSimilarityGate && ' · Chưa đạt ngưỡng tương đồng'}</p>}
      {match.blocked_by_avoid_topics && <p className="mt-2 text-xs leading-5 text-[#c4253c]">Nội dung chạm chủ đề cần tránh{match.avoided_topics?.length ? `: ${match.avoided_topics.join(', ')}` : '.'}</p>}
      <details className="group/match mt-3">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-[#526179] hover:text-[#2556ea] [&::-webkit-details-marker]:hidden">
          <ChevronDown size={15} className="transition-transform group-open/match:rotate-180" />
          Chi tiết đánh giá
        </summary>
        <div className="mt-3 space-y-4 border-l-2 border-[#edf1f7] pl-3 text-xs leading-5 text-[#526179]">
          <div>
            <h4 className="font-bold text-[#34415a]">Lý do đánh giá</h4>
            <p className="mt-1">{reason || 'Chưa có giải thích chi tiết từ hệ thống.'}</p>
          </div>
          {(topicMatches.length > 0 || match.similarity_threshold != null || match.embedding_similarity != null) && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-bold text-[#34415a]">Độ tương đồng chủ đề</h4>
                <span className={passedSimilarityGate ? 'text-[#16813b]' : 'text-[#b76b00]'}>{passedSimilarityGate ? 'Đạt ngưỡng' : 'Chưa đạt ngưỡng'}</span>
              </div>
              <p className="mt-1 text-[#64748b]">So sánh ngữ nghĩa (cosine){match.similarity_threshold != null ? ` · Ngưỡng tối thiểu ${formatSimilarity(match.similarity_threshold)}` : ''}</p>
              {topicMatches.length > 0 ? (
                <dl className="mt-2 divide-y divide-[#edf1f7]">
                  {topicMatches.map((topic) => (
                    <div key={topic.topic_key || topic.topic} className="flex items-baseline justify-between gap-3 py-1.5">
                      <dt className="min-w-0 break-words" title={topic.description || undefined}>{topic.topic}</dt>
                      <dd className="shrink-0 font-semibold tabular-nums">{formatSimilarity(topic.similarity)}</dd>
                    </div>
                  ))}
                </dl>
              ) : match.embedding_similarity != null && <p className="mt-2">Cao nhất: {formatSimilarity(match.embedding_similarity)}</p>}
            </div>
          )}
          {(avoidTopicMatches.length > 0 || match.blocked_by_avoid_topics) && (
            <div>
              <h4 className="font-bold text-[#34415a]">Đối chiếu chủ đề cần tránh</h4>
              {match.avoid_similarity_threshold != null && <p className="mt-1 text-[#64748b]">Ngưỡng chặn: {formatSimilarity(match.avoid_similarity_threshold)}</p>}
              <dl className="mt-2 divide-y divide-[#edf1f7]">
                {avoidTopicMatches.map((topic) => (
                  <div key={topic.topic_key || topic.topic} className="flex items-baseline justify-between gap-3 py-1.5">
                    <dt className="min-w-0 break-words" title={topic.description || undefined}>{topic.topic}</dt>
                    <dd className={`shrink-0 font-semibold tabular-nums ${topic.matched ? 'text-[#c4253c]' : ''}`}>{formatSimilarity(topic.similarity)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {(match.tone || match.target_audience || Boolean(match.matched_topics?.length)) && (
            <div className="space-y-2 border-t border-[#edf1f7] pt-3">
              <dl className="space-y-2">
              {Boolean(match.matched_topics?.length) && <div><dt className="font-bold text-[#34415a]">Chủ đề khớp với kênh</dt><dd className="mt-1">{match.matched_topics?.join(', ')}</dd></div>}
              {match.target_audience && <div><dt className="font-bold text-[#34415a]">Khán giả mục tiêu của kênh</dt><dd className="mt-1">{match.target_audience}</dd></div>}
              {match.tone && <div><dt className="font-bold text-[#34415a]">Giọng điệu cấu hình</dt><dd className="mt-1">{match.tone}</dd></div>}
              </dl>
              {(match.target_audience || match.tone) && <p className="text-xs text-[#64748b]">Cấu hình kênh không phải kết luận bài viết phù hợp với khán giả hoặc giọng điệu.</p>}
            </div>
          )}
          {showAngle && match.suggested_angle && <div><h4 className="font-bold text-[#34415a]">Góc triển khai tham khảo</h4><p className="mt-1">{match.suggested_angle}</p></div>}
          {riskNotes.length > 0 && (
            <div className="rounded-[8px] bg-[#fffbeb] p-3 text-[#92400e]">
              <h4 className="font-bold">Lưu ý</h4>
              <ul className="mt-1 list-disc space-y-1 pl-4">{riskNotes.map((note) => <li key={note}>{note}</li>)}</ul>
            </div>
          )}
        </div>
      </details>
    </div>
  )
}
