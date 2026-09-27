import { Table, TableHeader as ShadcnTableHeader, TableBody, TableRow, TableHead, TableCell } from '@/commons/component/ui/table'
import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, CheckCircle2, ExternalLink, Languages, Loader2, RefreshCw, Video } from 'lucide-react'
import { toast } from 'sonner'
import {
  fetchStoryPublishStatusApi,
  queueBilibiliOcrApi,
  queueBilibiliStoryOcrApi,
  type StoryEpisodePublishStatus,
  type StoryPublishStatus,
} from '@/commons/apis/module1'
import {
  AppButton,
  AppCard,
  EmptyBlock,
  PageLayout,
  SearchField,
  SelectControl,
  StatusPill,
} from '@/commons/component/social-ui'
import { cn } from '@/commons/lib/utils'

type StatusFilter = 'all' | 'unpublished' | 'in_progress' | 'published'

const formatDateTime = (value?: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const statusLabel = (status?: string | null) => {
  switch (status) {
    case 'PUBLISHED':
      return 'Đã đăng'
    case 'QUEUED':
      return 'Đang chờ đăng'
    case 'WORKFLOW_READY':
      return 'Đã có workflow'
    default:
      return 'Chưa đăng'
  }
}

const statusTone = (status?: string | null): 'green' | 'blue' | 'amber' | 'gray' => {
  if (status === 'PUBLISHED') return 'green'
  if (status === 'QUEUED') return 'blue'
  if (status === 'WORKFLOW_READY') return 'amber'
  return 'gray'
}

const normalizeText = (value?: string | null) => String(value || '').trim().toLowerCase()
const isBilibiliSource = (value?: string | null) => String(value || '').toUpperCase() === 'BILIBILI'

export default function StoryPublishStatusPage({ onOpenGenerateVideo }: { onOpenGenerateVideo?: (workflowId?: string) => void }) {
  const [stories, setStories] = useState<StoryPublishStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null)
  const [translatingKey, setTranslatingKey] = useState<string | null>(null)

  const loadData = async () => {
    setLoading(true)
    try {
      const data = await fetchStoryPublishStatusApi()
      const items = data.items || []
      setStories(items)
      setSelectedStoryId((current) => {
        if (current && items.some((item) => item.id === current)) return current
        return items[0]?.id || null
      })
    } catch (error: any) {
      setStories([])
      toast.error(error?.response?.data?.detail || 'Không thể tải trạng thái series')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const filteredStories = useMemo(() => {
    const term = normalizeText(search)
    return stories.filter((story) => {
      const matchesSearch = !term
        || normalizeText(story.canonical_name).includes(term)
        || story.episodes.some((episode) => normalizeText(episode.title).includes(term))
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'published' && story.unpublished_count === 0 && story.published_count > 0)
        || (statusFilter === 'unpublished' && story.unpublished_count > 0)
        || (statusFilter === 'in_progress' && story.in_progress_count > 0)
      return matchesSearch && matchesStatus
    })
  }, [search, statusFilter, stories])

  const selectedStory = useMemo(() => {
    if (selectedStoryId) {
      const selected = filteredStories.find((story) => story.id === selectedStoryId)
      if (selected) return selected
    }
    return filteredStories[0] || null
  }, [filteredStories, selectedStoryId])

  const totals = useMemo(() => {
    return stories.reduce((acc, story) => ({
      series: acc.series + 1,
      episodes: acc.episodes + story.episodes.length,
      published: acc.published + story.published_count,
      unpublished: acc.unpublished + story.unpublished_count,
    }), { series: 0, episodes: 0, published: 0, unpublished: 0 })
  }, [stories])

  const translateStory = async (story: StoryPublishStatus) => {
    if (translatingKey) return
    setTranslatingKey(`story-${story.id}`)
    try {
      const result = story.id.startsWith('content:')
        ? await queueBilibiliOcrApi(story.id.slice('content:'.length))
        : await queueBilibiliStoryOcrApi(story.id)
      toast.success(`Đã đưa ${result.queued} tập của series vào hàng đợi dịch${result.reused ? `, ${result.reused} tập đã có task trước đó` : ''}.`)
      await loadData()
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || 'Không thể dịch toàn bộ story.')
    } finally {
      setTranslatingKey(null)
    }
  }

  const translateEpisode = async (episode: StoryEpisodePublishStatus) => {
    if (translatingKey) return
    const episodeKey = `${episode.content_id}-${episode.episode_order || 'item'}`
    setTranslatingKey(`episode-${episodeKey}`)
    try {
      const result = await queueBilibiliOcrApi(
        episode.content_id,
        isBilibiliSource(episode.source_type) && episode.episode_order ? [episode.episode_order] : undefined,
      )
      toast.success(`Đã đưa item vào hàng đợi dịch${result.reused ? ' (đã có task trước đó)' : ''}.`)
      await loadData()
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || 'Không thể dịch item này.')
    } finally {
      setTranslatingKey(null)
    }
  }

  return (
    <PageLayout
      title="Trạng thái series"
      description="Theo dõi từng story/series đã đăng tập nào và tập nào còn chưa đăng."
      actions={(
        <AppButton variant="secondary" onClick={() => void loadData()} disabled={loading}>
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          Làm mới
        </AppButton>
      )}
      contentClassName="min-h-0"
    >
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <AppCard className="flex min-h-0 flex-col overflow-hidden">
          <div className="border-b border-[var(--outline-variant)] p-4">
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Series" value={totals.series} />
              <Metric label="Tập" value={totals.episodes} />
              <Metric label="Đã đăng" value={totals.published} tone="text-emerald-700" />
              <Metric label="Chưa đăng" value={totals.unpublished} tone="text-slate-700" />
            </div>
            <div className="mt-3 grid gap-2">
              <SearchField value={search} onChange={setSearch} placeholder="Tìm series hoặc tập..." />
              <SelectControl value={statusFilter} onChange={(value) => setStatusFilter(value as StatusFilter)}>
                <option value="all">Tất cả series</option>
                <option value="unpublished">Còn tập chưa đăng</option>
                <option value="in_progress">Đang xử lý</option>
                <option value="published">Đã đăng hết</option>
              </SelectControl>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="grid h-48 place-items-center text-sm font-semibold text-[#64748b]">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : filteredStories.length === 0 ? (
              <EmptyBlock label="Chưa có series phù hợp" />
            ) : (
              <div className="space-y-1">
                {filteredStories.map((story) => (
                  <button
                    key={story.id}
                    type="button"
                    onClick={() => setSelectedStoryId(story.id)}
                    className={cn(
                      'w-full rounded-[8px] border p-3 text-left transition',
                      selectedStory?.id === story.id
                        ? 'border-[#2556ea] bg-[#eff4ff]'
                        : 'border-transparent hover:border-[var(--outline-variant)] hover:bg-[#f8fafc]',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-extrabold text-[#111827]">{story.canonical_name}</div>
                        <div className="mt-1 flex items-center gap-2 text-xs font-semibold text-[#64748b]">
                          <Video size={13} />
                          <span>{story.episodes.length || story.total_episodes} tập</span>
                          {story.source_type && <span>{story.source_type}</span>}
                        </div>
                      </div>
                      <StatusPill value={`${story.published_count}/${story.episodes.length || story.total_episodes}`} tone={story.unpublished_count > 0 ? 'amber' : 'green'} />
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e9edf5]">
                      <div
                        className="h-full rounded-full bg-[#16a34a]"
                        style={{ width: `${story.episodes.length ? Math.round((story.published_count / story.episodes.length) * 100) : 0}%` }}
                      />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </AppCard>

        <AppCard className="app-table-card flex min-h-0 flex-col overflow-hidden">
          {selectedStory ? (
            <>
              <div className="flex flex-col gap-3 border-b border-[var(--outline-variant)] p-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-base font-extrabold text-[#111827]">{selectedStory.canonical_name}</h2>
                    <StatusPill value={selectedStory.unpublished_count > 0 ? 'Còn tập chưa đăng' : 'Đã đăng hết'} tone={selectedStory.unpublished_count > 0 ? 'amber' : 'green'} />
                  </div>
                  <p className="mt-1 text-sm font-medium text-[#64748b]">
                    {selectedStory.published_count} đã đăng · {selectedStory.in_progress_count} đang xử lý · {selectedStory.unpublished_count} chưa đăng
                  </p>
                </div>
                {selectedStory.episodes.some((episode) => isBilibiliSource(episode.source_type)) && (
                  <AppButton
                    variant="secondary"
                    icon={translatingKey === `story-${selectedStory.id}` ? <Loader2 size={16} className="animate-spin" /> : <Languages size={16} />}
                    disabled={Boolean(translatingKey)}
                    onClick={() => void translateStory(selectedStory)}
                  >
                    Dịch toàn bộ story
                  </AppButton>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                <Table>
                  <ShadcnTableHeader className="sticky top-0 z-10 bg-white">
                    <TableRow>
                      <TableHead className="w-[90px] px-4 py-3">Tập</TableHead>
                      <TableHead className="min-w-[300px] px-4 py-3">Nội dung</TableHead>
                      <TableHead className="w-[160px] px-4 py-3">Trạng thái</TableHead>
                      <TableHead className="w-[180px] px-4 py-3">Kênh</TableHead>
                      <TableHead className="w-[170px] px-4 py-3">Ngày đăng</TableHead>
                      <TableHead className="w-[120px] px-4 py-3 text-right">Thao tác</TableHead>
                    </TableRow>
                  </ShadcnTableHeader>
                  <TableBody>
                    {selectedStory.episodes.map((episode, index) => (
                      <EpisodeRow
                        key={`${episode.content_id}-${episode.episode_order ?? index}`}
                        episode={episode}
                        fallbackOrder={index + 1}
                        onOpenGenerateVideo={onOpenGenerateVideo}
                        onTranslate={translateEpisode}
                        translating={translatingKey === `episode-${episode.content_id}-${episode.episode_order || 'item'}`}
                        translateDisabled={Boolean(translatingKey)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <EmptyBlock label="Chọn một series để xem danh sách tập" />
          )}
        </AppCard>
      </div>
    </PageLayout>
  )
}

function Metric({ label, value, tone = 'text-[#111827]' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-[8px] border border-[var(--outline-variant)] bg-[#fbfcff] p-3">
      <div className="text-xs font-bold uppercase text-[#718096]">{label}</div>
      <div className={cn('mt-1 text-lg font-extrabold', tone)}>{value.toLocaleString('vi-VN')}</div>
    </div>
  )
}

function EpisodeRow({
  episode,
  fallbackOrder,
  onOpenGenerateVideo,
  onTranslate,
  translating,
  translateDisabled,
}: {
  episode: StoryEpisodePublishStatus
  fallbackOrder: number
  onOpenGenerateVideo?: (workflowId?: string) => void
  onTranslate?: (episode: StoryEpisodePublishStatus) => void
  translating?: boolean
  translateDisabled?: boolean
}) {
  return (
    <TableRow className="hover:bg-[#f8fafc]">
      <TableCell className="px-4 py-3">
        <div className="inline-flex h-7 min-w-7 items-center justify-center rounded-[7px] bg-[#eef4ff] px-2 text-xs font-extrabold text-[#2556ea]">
          {episode.episode_order ?? fallbackOrder}
        </div>
      </TableCell>
      <TableCell className="px-4 py-3">
        <div className="min-w-0">
          <div className="line-clamp-2 text-sm font-extrabold text-[#111827]">{episode.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-[#64748b]">
            {episode.source_url && (
              <a className="inline-flex items-center gap-1 hover:text-[#2556ea]" href={episode.source_url} target="_blank" rel="noreferrer">
                Nguồn <ExternalLink size={12} />
              </a>
            )}
            {episode.workflow_status && <span>Workflow: {episode.workflow_status}</span>}
            {episode.queue_status && <span>Queue: {episode.queue_status}</span>}
          </div>
        </div>
      </TableCell>
      <TableCell className="px-4 py-3">
        <StatusPill value={statusLabel(episode.publish_status)} tone={statusTone(episode.publish_status)} />
      </TableCell>
      <TableCell className="px-4 py-3">
        <div className="text-xs font-semibold text-[#526179]">
          <div className="truncate">{episode.profile_name || '-'}</div>
          {episode.platform && <div className="mt-0.5 uppercase text-[#94a3b8]">{episode.platform}</div>}
        </div>
      </TableCell>
      <TableCell className="px-4 py-3">
        <div className="text-xs font-semibold text-[#526179]">{formatDateTime(episode.published_at || episode.scheduled_at)}</div>
      </TableCell>
      <TableCell className="px-4 py-3">
        <div className="flex justify-end gap-1">
          {episode.post_url && (
            <a
              href={episode.post_url}
              target="_blank"
              rel="noreferrer"
              className="grid h-8 w-8 place-items-center rounded-[8px] border border-[var(--outline-variant)] text-[#64748b] hover:bg-[#f8fafc] hover:text-[#2556ea]"
              title="Mở bài đã đăng"
            >
              <ArrowUpRight size={15} />
            </a>
          )}
          {episode.workflow_id && onOpenGenerateVideo && (
            <button
              type="button"
              onClick={() => onOpenGenerateVideo(episode.workflow_id || undefined)}
              className="grid h-8 w-8 place-items-center rounded-[8px] border border-[var(--outline-variant)] text-[#64748b] hover:bg-[#f8fafc] hover:text-[#2556ea]"
              title="Mở workflow"
            >
              <CheckCircle2 size={15} />
            </button>
          )}
          {isBilibiliSource(episode.source_type) && onTranslate && (
            <button
              type="button"
              onClick={() => onTranslate(episode)}
              disabled={translateDisabled}
              className="grid h-8 w-8 place-items-center rounded-[8px] border border-[var(--outline-variant)] text-[#64748b] hover:bg-[#f8fafc] hover:text-[#2556ea] disabled:opacity-50"
              title="Dịch item này"
            >
              {translating ? <Loader2 size={15} className="animate-spin" /> : <Languages size={15} />}
            </button>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}
