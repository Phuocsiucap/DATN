import { useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import {
  fetchContentDetailApi,
  fetchFinalContentViewApi,
  type ContentDetail,
  type CrawlJob,
  type FinalContentItem,
} from '@/commons/apis/module1'
import { AppButton, EmptyBlock, SelectControl, StatusPill, Thumbnail } from '@/commons/component/social-ui'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/commons/component/ui/sheet'
import { ContentDetailSheet } from '@/features/content/components/ContentDetailSheet'
import { normalizeClock, scheduleDaysLabel } from '../crawlSchedule'

const formatDate = (value?: string) => value ? new Date(value).toLocaleString('vi-VN') : '-'
const shortId = (value: string) => value.slice(0, 8)

export function CrawlJobDetailSheet({
  job,
  onClose,
  onOpenModule2,
}: {
  job: CrawlJob | null
  onClose: () => void
  onOpenModule2?: (jobId?: string) => void
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'contents'>('contents')
  const [contentsState, setContentsState] = useState<{ jobId: string; items: FinalContentItem[] } | null>(null)
  const [selectedContent, setSelectedContent] = useState<FinalContentItem | null>(null)
  const [contentDetail, setContentDetail] = useState<ContentDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    if (!job || activeTab !== 'contents') return
    let cancelled = false
    fetchFinalContentViewApi({ crawl_job_id: job.id, view: 'list' })
      .then((response) => {
        if (!cancelled) setContentsState({ jobId: job.id, items: response.normal_items || [] })
      })
      .catch(() => {
        if (!cancelled) setContentsState({ jobId: job.id, items: [] })
      })
    return () => { cancelled = true }
  }, [activeTab, job])

  if (!job) return null

  const contents = contentsState?.jobId === job.id ? contentsState.items : []
  const loadingContents = activeTab === 'contents' && contentsState?.jobId !== job.id
  const totalContents = contents.length || job.total_normalized || 0
  const openContentDetail = async (item: FinalContentItem) => {
    setSelectedContent(item)
    setContentDetail(null)
    setDetailLoading(true)
    try {
      setContentDetail(await fetchContentDetailApi(item.id))
    } catch (error) {
      console.error(error)
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <>
      <Sheet open onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="right" className="max-w-[720px]">
          <div className="detail-shell">
            <SheetHeader>
              <div className="flex items-start justify-between gap-3 pr-10">
                <div className="min-w-0">
                  <SheetTitle className="truncate">Chi tiết Job · {job.name}</SheetTitle>
                  <SheetDescription className="truncate font-mono">ID: {job.id}</SheetDescription>
                </div>
                <StatusPill value={job.status === 'SUCCEEDED' ? 'Hoàn thành' : job.status} />
              </div>
              <div className="mt-4 flex gap-6 border-b border-[var(--outline-variant)]">
                {[
                  { key: 'overview' as const, label: 'Tổng quan' },
                  { key: 'contents' as const, label: 'Nội dung crawl được', count: totalContents },
                ].map((tab) => (
                  <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`relative h-10 text-sm font-bold ${activeTab === tab.key ? 'text-[var(--accent-strong)]' : 'text-[var(--on-surface-variant)]'}`}>
                    {tab.label}
                    {typeof tab.count === 'number' && <span className="ml-1 rounded-full bg-[var(--accent-strong)] px-2 py-0.5 text-xs text-white">{tab.count}</span>}
                    {activeTab === tab.key && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--accent-strong)]" />}
                  </button>
                ))}
              </div>
            </SheetHeader>

            <SheetBody className="p-0">
              {activeTab === 'overview' && (
                <div className="space-y-4 p-5">
                  <div className="grid grid-cols-2 gap-3">
                    <JobMetric label="Đã phát hiện" value={job.total_discovered} />
                    <JobMetric label="Đã crawl" value={job.total_crawled} />
                    <JobMetric label="Đã chuẩn hóa" value={job.total_normalized} />
                    <JobMetric label="Lỗi" value={job.total_failed} tone="red" />
                  </div>
                  <div>
                    <div className="mb-2 text-sm font-extrabold text-[var(--on-surface)]">Tiến độ</div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-variant)]"><div className="h-full rounded-full bg-[var(--success)]" style={{ width: `${Math.max(0, Math.min(100, Number(job.progress_percent || 0)))}%` }} /></div>
                    <div className="mt-2 text-xs font-semibold text-[var(--on-surface-variant)]">{Number(job.progress_percent || 0).toFixed(0)}% hoàn thành</div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <MetaInfo label="Chế độ" value={job.crawl_mode} />
                    <MetaInfo label="Stage" value={job.current_stage} />
                    <MetaInfo label="Tạo lúc" value={formatDate(job.created_at)} />
                    <MetaInfo label="Cập nhật" value={formatDate(job.updated_at)} />
                    {job.schedule && <>
                      <MetaInfo label="Tần suất" value={`${job.schedule.runs_per_day} lần/ngày · ${normalizeClock(job.schedule.window_start)}–${normalizeClock(job.schedule.window_end)}`} />
                      <MetaInfo label="Ngày chạy" value={scheduleDaysLabel(job.schedule.weekdays)} />
                      <MetaInfo label="Lần kế tiếp" value={formatDate(job.schedule.next_run_at || undefined)} />
                      <MetaInfo label="Trạng thái lịch" value={job.schedule.enabled ? 'Đang hoạt động' : 'Tạm dừng'} />
                    </>}
                  </div>
                </div>
              )}

              {activeTab === 'contents' && <>
                <div className="flex items-center justify-between border-b border-[var(--outline-variant)] px-5 py-3">
                  <span className="text-sm text-[var(--on-surface-variant)]">Hiển thị {contents.length ? `1 đến ${Math.min(20, contents.length)} trong` : '0 trong'} {totalContents} bài</span>
                  <AppButton variant="secondary" className="h-9 px-3" icon={<Download size={15} />}>Xuất dữ liệu</AppButton>
                </div>
                <div className="p-4">
                  {loadingContents ? <div className="loading-state"><Loader2 className="animate-spin" size={16} /> Đang tải nội dung...</div>
                    : contents.length === 0 ? <EmptyBlock label="Chưa có bài nào được crawl thành công." />
                      : <div className="space-y-3">{contents.map((item, index) => (
                        <button key={item.id} onClick={() => void openContentDetail(item)} className="grid w-full grid-cols-[112px_minmax(0,1fr)_58px] gap-3 rounded-lg p-2 text-left transition hover:bg-[var(--surface-container-low)]">
                          <Thumbnail src={getContentMediaSrc(item)} index={index} className="h-[76px] w-[112px]" fallback={false} />
                          <div className="min-w-0"><div className="line-clamp-2 text-sm font-extrabold leading-5 text-[var(--on-surface)]">{item.canonical_title}</div><p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--on-surface-variant)]">{item.summary || item.canonical_url || shortId(item.id)}</p></div>
                          <StatusPill value={item.status || 'READY'} tone="green" />
                        </button>
                      ))}</div>}
                </div>
              </>}
            </SheetBody>

            {activeTab === 'contents' && contents.length > 0 && <div className="flex items-center justify-between border-t border-[var(--outline-variant)] p-4"><div className="flex items-center gap-2 text-sm font-semibold text-[var(--on-surface-variant)]"><button className="grid h-8 w-8 place-items-center rounded-lg">‹</button><button className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--accent-strong)] text-white">1</button><button className="grid h-8 w-8 place-items-center rounded-lg">›</button></div><SelectControl className="w-28"><option>20 / trang</option></SelectControl></div>}
          </div>
        </SheetContent>
      </Sheet>

      <ContentDetailSheet item={contentDetail} loading={detailLoading} fallbackTitle={selectedContent?.canonical_title} onClose={() => { setSelectedContent(null); setContentDetail(null); setDetailLoading(false) }} onOpenModule2={onOpenModule2} />
    </>
  )
}

function JobMetric({ label, value, tone = 'green' }: { label: string; value: number; tone?: 'green' | 'red' }) {
  return <div className="rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-3"><div className="text-xs font-bold text-[var(--on-surface-variant)]">{label}</div><div className={`mt-1 text-2xl font-extrabold ${tone === 'red' ? 'text-[var(--error)]' : 'text-[var(--success)]'}`}>{Number(value || 0).toLocaleString('vi-VN')}</div></div>
}

function MetaInfo({ label, value }: { label: string; value?: string | number | null }) {
  return <div className="rounded-lg border border-[var(--outline-variant)] bg-white p-3"><div className="text-xs font-bold text-[var(--on-surface-variant)]">{label}</div><div className="mt-1 truncate text-xs font-extrabold text-[#34415a]">{value || '-'}</div></div>
}

function getContentMediaSrc(item: FinalContentItem) {
  if (item.thumbnail_url) return item.thumbnail_url
  const media = (item.media_jsonb || item.media || [])[0]
  if (media?.thumbnail_url || media?.source_url || media?.storage_url) return media.thumbnail_url || media.source_url || media.storage_url
  return item.normalized?.images?.[0]?.src || null
}
