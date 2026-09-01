import { ChevronRight, ExternalLink, FileText } from 'lucide-react'
import type { ProfileSeriesReview, ReviewSourceContent } from '@/commons/apis/planning'
import { MediaAssetPreview, mediaPlaybackUrl, mediaPreviewUrl, isImageMedia, isVideoMedia } from '@/commons/media'
import { Sheet, SheetContent } from '@/commons/component/ui/sheet'
import { OpenDraftWorkspaceButton } from '../OpenDraftWorkspaceButton'
import { getArticleStoryData, sourceCategoryId } from '../planningReviewUtils'

const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString('vi-VN') : '-'

export function ArticleReviewSheet({
  selection,
  open,
  onOpenChange,
  onOpenSource,
  onOpenWorkflow,
}: {
  selection: { article: ProfileSeriesReview['articles'][number]; seriesTitle: string } | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenSource: (source: ReviewSourceContent) => void
  onOpenWorkflow?: (id: string) => void
}) {
  if (!selection) return null

  const { article, seriesTitle } = selection
  const source = article.source_content
  const sourceUrl = source?.source_url || source?.canonical_url
  const storyData = getArticleStoryData(article)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[calc(100vw-1rem)] max-w-[920px]">
        <div className="detail-shell">
          <div className="detail-header">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-[var(--primary)] px-2 py-0.5 text-xs font-black uppercase text-white">Bài review</span>
              {article.plan ? <PlanningStatusBadge value={article.plan.status} /> : <PlanningStatusBadge value="UNLINKED" />}
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold uppercase text-slate-600">{storyData.length} scene</span>
            </div>
            <h2 className="text-xl font-black leading-tight text-[#0f172a]">{article.plan?.title || source?.canonical_title || 'Bài chưa liên kết kế hoạch'}</h2>
            <p className="mt-2 text-xs font-semibold text-[#64748b]">{seriesTitle}</p>
            {article.plan && <div className="mt-3 space-y-2">
              <OpenDraftWorkspaceButton workflowId={article.plan.workflow_id || article.plan.id}
                reviewRequired={article.plan.current_stage ? article.plan.current_stage === 'DRAFT_REVIEW_REQUIRED' : undefined}
                rejected={article.plan.status === 'REJECTED'}
                onOpenWorkflow={onOpenWorkflow ? id => { onOpenChange(false); onOpenWorkflow(id) } : undefined} />
              <p className="text-xs text-slate-500">Đây là bản xem nhanh. Mở trình sửa để xem đầy đủ lời thoại, liên kết ảnh/video và duyệt đúng phiên bản draft.</p>
            </div>}
          </div>

          <div className="detail-body">
            <div className="grid gap-4">
              {source && (
                <section className="detail-section border-blue-200 bg-blue-50/40">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-black uppercase text-blue-800">Bài gốc</span>
                        {source.source_type && <span className="text-xs font-bold text-slate-500">{source.source_type}</span>}
                        <span className="text-xs font-bold text-slate-500">Quality {Number(source.quality_score || 0).toFixed(0)}</span>
                      </div>
                      <h3 className="text-base font-black text-[#0f172a]">{source.canonical_title}</h3>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {sourceUrl && (
                        <a
                          href={sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-blue-200 bg-white px-3 text-xs font-bold text-blue-700 hover:bg-blue-50"
                        >
                          <ExternalLink size={15} /> Link nguồn
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => onOpenSource(source)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-xs font-bold text-white hover:bg-[var(--accent-strong)]"
                      >
                        <FileText size={15} /> View full
                      </button>
                    </div>
                  </div>

                  {source.summary && <p className="mb-4 text-sm leading-6 text-slate-700">{source.summary}</p>}

                  {(source.media || []).length > 0 && (
                    <ReviewMediaPreview source={source} onOpen={() => onOpenSource(source)} />
                  )}

                  <div className="max-h-[260px] overflow-y-auto rounded-md border border-blue-100 bg-white p-3">
                    <div className="detail-label mb-2">Nội dung gốc</div>
                    <div className="whitespace-pre-wrap text-sm leading-7 text-slate-800">
                      {source.full_text || source.summary || 'Backend chưa có full text cho bài này.'}
                    </div>
                  </div>
                </section>
              )}

              {article.plan && (
                <section className="detail-section">
                  <div className="detail-label mb-2">Metadata kịch bản</div>
                  <h3 className="text-base font-black text-[#0f172a]">{article.plan.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{article.plan.content_angle || 'Chưa có góc khai thác.'}</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Tone</div>
                      <div className="mt-1 text-sm font-bold text-slate-800">{article.plan.tone || '-'}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Audience</div>
                      <div className="mt-1 text-sm font-bold text-slate-800">{article.plan.target_audience || '-'}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Duration</div>
                      <div className="mt-1 text-sm font-bold text-slate-800">{article.plan.target_duration_seconds ? `${article.plan.target_duration_seconds}s` : '-'}</div>
                    </div>
                  </div>
                </section>
              )}

              <section className="detail-section">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="detail-label">Story data</div>
                  <span className="text-xs font-bold text-slate-400">{storyData.length} scene</span>
                </div>
                {storyData.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Bài này chưa có story_data.</div>
                ) : (
                  <div className="grid gap-4">
                    {storyData.map((scene, index) => (
                      <div key={`${scene.image || 'scene'}-${index}`} className="rounded-md border border-slate-200 bg-[#fbfcfe] p-4">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-[var(--primary)] px-2 py-0.5 text-xs font-black uppercase text-white">Scene {index + 1}</span>
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold uppercase text-slate-600">{scene.duration}s</span>
                          <span className="rounded-md bg-white px-2 py-0.5 text-xs font-bold uppercase text-slate-500">{scene.effect || 'slow-zoom'}</span>
                        </div>
                        <div className="mt-4 grid gap-4">
                          <DetailBlock title="Subtitle" tone="slate">
                            {scene.subtitle || 'Chưa có subtitle.'}
                          </DetailBlock>
                          {scene.voice_text && (
                            <DetailBlock title="Voice text" tone="blue">
                              {scene.voice_text}
                            </DetailBlock>
                          )}
                          {scene.image && (
                            <DetailBlock title="Image" tone="emerald">
                              {scene.image}
                            </DetailBlock>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function ReviewMediaPreview({
  source,
  onOpen,
}: {
  source: ReviewSourceContent
  onOpen: () => void
}) {
  const mediaItems = (source.media || []).slice(0, 4)
  const remainingCount = Math.max(0, (source.media || []).length - mediaItems.length)

  return (
    <div className="mb-3 rounded-md border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="detail-label">Ảnh / video gốc</div>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:text-blue-900"
        >
          View full <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {mediaItems.map((item) => {
          return (
            <button
              key={item.id}
              type="button"
              onClick={onOpen}
              className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100 text-left hover:border-blue-300"
            >
              <MediaAssetPreview item={item} compact={false} />
            </button>
          )
        })}
        {remainingCount > 0 && (
          <button
            type="button"
            onClick={onOpen}
            className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm font-black text-slate-500 hover:border-blue-300 hover:bg-blue-50"
          >
            +{remainingCount}
          </button>
        )}
      </div>
    </div>
  )
}

export function ContentItemPreview({ media }: { media?: ReviewSourceContent['media'] }) {
  const first = media?.[0]
  if (!first) {
    return (
      <div className="flex h-14 w-20 items-center justify-center rounded-md border border-dashed border-[#d9e0ea] bg-[#fbfcfd] text-xs text-[#94a3b8]">
        No media
      </div>
    )
  }
  const mediaUrl = mediaPlaybackUrl(first)
  const previewUrl = mediaPreviewUrl(first)
  const isVideo = isVideoMedia(first)

  if (!previewUrl && !mediaUrl) {
    return (
      <div className="flex h-14 w-20 items-center justify-center rounded-md border border-dashed border-[#d9e0ea] bg-[#fbfcfd] text-xs text-[#94a3b8]">
        No media
      </div>
    )
  }

  return (
    <div className="relative h-14 w-20 overflow-hidden rounded-md bg-black">
      {isVideo && mediaUrl ? (
        <MediaAssetPreview item={first} compact className="h-14 w-20" />
      ) : (
        <img
          src={previewUrl || ''}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={(event) => { event.currentTarget.src = 'https://placehold.co/160x112?text=No+Preview' }}
        />
      )}
    </div>
  )
}

export function SourceContentSheet({
  source,
  open,
  onOpenChange,
}: {
  source: ReviewSourceContent | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!source) return null

  const sourceUrl = source.source_url || source.canonical_url
  const publishedAt = source.source_published_at || source.published_at
  const mediaItems = source.media || []
  const sources = source.sources || []
  const categoryId = sourceCategoryId(source)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[calc(100vw-1rem)] max-w-[860px]">
        <div className="detail-shell">
          <div className="detail-header">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-blue-100 px-2 py-0.5 text-xs font-black uppercase text-blue-800">Bài gốc</span>
              <PlanningStatusBadge value={source.status} />
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold uppercase text-slate-600">{source.content_type}</span>
            </div>
            <h2 className="text-xl font-black leading-tight text-[#0f172a]">{source.canonical_title}</h2>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-semibold text-[#64748b]">
              {source.source_type && <span>{source.source_type}</span>}
              {categoryId && <span>Category {categoryId}</span>}
              {source.source_author && <span>{source.source_author}</span>}
              <span>Quality {Number(source.quality_score || 0).toFixed(0)}</span>
              <span>{formatDate(publishedAt || source.created_at)}</span>
            </div>
          </div>

          <div className="detail-body">
            <div className="grid gap-4">
              {sourceUrl && (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 hover:bg-blue-100"
                >
                  <ExternalLink size={16} /> Mở link nguồn
                </a>
              )}

              {source.summary && (
                <DetailBlock title="Tóm tắt nguồn" tone="blue">
                  {source.summary}
                </DetailBlock>
              )}

              {mediaItems.length > 0 && (
                <section className="detail-section">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="detail-label">Ảnh / video gốc</div>
                    <span className="text-xs font-bold text-slate-400">{mediaItems.length} media</span>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {mediaItems.map((item) => {
                      const mediaUrl = mediaPlaybackUrl(item)
                      const thumbUrl = mediaPreviewUrl(item)
                      const isVideo = isVideoMedia(item)
                      const isImage = isImageMedia(item)

                      return (
                        <div key={item.id} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                          {mediaUrl && isVideo ? (
                            <MediaAssetPreview item={item} controls />
                          ) : thumbUrl && isImage ? (
                            <img src={thumbUrl} alt="" className="aspect-video w-full bg-slate-100 object-cover" loading="lazy" />
                          ) : thumbUrl ? (
                            <a href={thumbUrl} target="_blank" rel="noreferrer" className="flex aspect-video items-center justify-center gap-2 bg-slate-100 text-sm font-bold text-slate-600 hover:bg-slate-200">
                              <ExternalLink size={16} /> Mở media
                            </a>
                          ) : (
                            <div className="flex aspect-video items-center justify-center text-sm font-semibold text-slate-400">Không có URL media</div>
                          )}
                          <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-slate-500">
                            <span className="uppercase">{item.media_type}</span>
                            {item.duration_seconds ? <span>{item.duration_seconds}s</span> : <span>{item.width && item.height ? `${item.width}x${item.height}` : ''}</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              <section className="detail-section">
                <div className="detail-label mb-3">Nội dung đầy đủ</div>
                <div className="whitespace-pre-wrap text-sm leading-7 text-slate-800">
                  {source.full_text || source.summary || 'Backend chưa có full text cho bài này. Có thể nguồn crawl chưa lưu raw document hoặc chưa normalize xong.'}
                </div>
              </section>

              {sources.length > 0 && (
                <section className="detail-section">
                  <div className="detail-label mb-3">Nguồn crawl</div>
                  <div className="space-y-2">
                    {sources.map((item) => (
                      <a
                        key={item.id}
                        href={item.source_url || '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm hover:border-blue-200 hover:bg-blue-50"
                      >
                        <span className="min-w-0 truncate font-semibold text-slate-700">{item.source_title || item.source_external_id || item.source_type}</span>
                        <ExternalLink size={15} className="shrink-0 text-slate-400" />
                      </a>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DetailBlock({
  title,
  tone,
  children,
}: {
  title: string
  tone: 'slate' | 'violet' | 'blue' | 'amber' | 'emerald'
  children: string
}) {
  const styles = {
    slate: 'border-slate-300 bg-slate-50 text-slate-800',
    violet: 'border-[#c7d2fe] bg-[#f5f2ff] text-[#312e81]',
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }

  return (
    <section className={`rounded-md border p-3 ${styles[tone]}`}>
      <div className="mb-2 text-xs font-black uppercase opacity-75">{title}</div>
      <p className="text-sm leading-6">{children}</p>
    </section>
  )
}

export function PlanningStatusBadge({ value }: { value: string }) {
  let color = 'bg-slate-100 text-slate-700'
  if (['SUCCEEDED', 'COMPLETED', 'READY', 'APPROVED'].includes(value)) color = 'bg-emerald-100 text-emerald-800'
  if (['FAILED', 'REJECTED'].includes(value)) color = 'bg-red-100 text-red-800'
  if (['RUNNING', 'PENDING', 'PROCESSING', 'GENERATED'].includes(value)) color = 'bg-blue-100 text-blue-800'
  if (['NEEDS_REVIEW'].includes(value)) color = 'bg-amber-100 text-amber-800'
  return <span className={`px-2 py-1 inline-flex items-center justify-center rounded-md text-xs font-bold uppercase tracking-wider ${color}`}>{value}</span>
}
