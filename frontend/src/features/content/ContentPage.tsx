import { useEffect, useState } from 'react'
import { RefreshCcw } from 'lucide-react'
import {
  fetchFinalContentViewApi,
  type FinalContentItem,
  type FinalContentView,
} from '@/commons/apis/module1'

import { ContentDetailDialog } from './ContentDetailDialog'

const formatDate = (value?: string) => value ? new Date(value).toLocaleString('vi-VN') : '-'
const shortId = (value: string) => value.slice(0, 8)

export default function ContentPage({ isSystemUser = false, onOpenModule2 }: { isSystemUser?: boolean; onOpenModule2?: (jobId?: string) => void }) {
  const [activeTab, setActiveTab] = useState<'normal' | 'series'>('normal')
  const [view, setView] = useState<FinalContentView>({ normal_items: [], series_items: [] })
  const [selectedContent, setSelectedContent] = useState<FinalContentItem | null>(null)
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    setLoading(true)
    try {
      // Admin sees global, user sees what's assigned/crawled for them
      const data = await fetchFinalContentViewApi({ content_scope: isSystemUser ? 'GLOBAL' : 'PRIVATE' })
      setView(data)
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [isSystemUser])

  const contents = activeTab === 'normal' ? view.normal_items : view.series_items

  return (
    <div className="workspace-page">
      <div className="workspace-header">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="workspace-title">Kho Nội Dung</h2>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${!isSystemUser ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
                {!isSystemUser ? 'PRIVATE DATA' : 'GLOBAL DATA'}
              </span>
            </div>
            <p className="workspace-subtitle">
              {!isSystemUser
                ? 'Dữ liệu nội dung riêng của bạn và các nội dung từ hệ thống được đề xuất.'
                : 'Kho dữ liệu gốc (Canonical Data) đã được làm sạch và lưu trữ tập trung trên hệ thống.'}
            </p>
          </div>
          <button onClick={() => void loadData()} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--outline-variant)] bg-white px-3 text-xs font-semibold text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-low)]">
            <RefreshCcw size={15} /> Tải lại dữ liệu
          </button>
        </div>

        <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-[var(--outline-variant)] pt-3">
          <div className="flex gap-2 w-full sm:w-auto">
            <button onClick={() => setActiveTab('normal')} className={`h-8 rounded-md border px-3 text-xs font-semibold transition-colors ${activeTab === 'normal' ? 'border-[var(--accent)] bg-[var(--secondary-container)] text-[var(--accent-strong)]' : 'border-[var(--outline-variant)] bg-white text-[var(--on-surface-variant)]'}`}>
              Bài Đơn Lẻ ({view.normal_items.length})
            </button>
            <button onClick={() => setActiveTab('series')} className={`h-8 rounded-md border px-3 text-xs font-semibold transition-colors ${activeTab === 'series' ? 'border-[var(--accent)] bg-[var(--secondary-container)] text-[var(--accent-strong)]' : 'border-[var(--outline-variant)] bg-white text-[var(--on-surface-variant)]'}`}>
              Bài Tuyến Series ({view.series_items.length})
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="bento-card p-6 space-y-4 min-h-[500px]">
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="flex items-center gap-4 border-b border-[var(--outline-variant)] pb-3">
              <div className="skeleton-loader h-12 w-[72px] rounded-md" />
              <div className="flex-1 space-y-2">
                <div className="skeleton-loader h-4 w-3/4" />
                <div className="skeleton-loader h-3 w-1/2" />
              </div>
              <div className="skeleton-loader h-6 w-20" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="bento-card table-scroll flex min-h-[620px] flex-col overflow-hidden">
            <div className="data-grid flex min-h-[620px] flex-col">
              <TableHeader columns={activeTab === 'normal' ? ['Preview', 'Tiêu đề & Tóm tắt', 'Nguồn', 'Trạng thái', 'Ngày lưu'] : ['Preview', 'Tên Series', 'Tập số', 'Trạng thái', 'Độ tin cậy', 'Ngày lưu']} />
              <div className="flex-1 overflow-y-auto">
                {contents.length === 0 ? <div className="empty-state m-3">Chưa có dữ liệu.</div> : contents.map((item) => (
                  <div key={item.id} onClick={() => setSelectedContent(item)} className={`grid cursor-pointer grid-cols-[84px_2fr_0.8fr_0.9fr_1fr] items-center gap-3 border-b border-[var(--outline-variant)] px-4 py-3 text-xs transition-colors ${selectedContent?.id === item.id ? 'bg-[var(--secondary-container)]/40' : 'bg-white hover:bg-[var(--surface-container-low)]'}`}>
                    <MediaPreview media={item.media_jsonb || item.media} compact />
                    <div className="min-w-0">
                      <div className="truncate font-bold text-[var(--on-surface)]">{activeTab === 'series' ? item.series?.canonical_name || item.canonical_title : item.canonical_title}</div>
                      <div className="truncate text-xs text-[var(--on-surface-variant)] mt-0.5">{activeTab === 'series' ? (item.episode_title || item.canonical_title) : (item.summary || item.canonical_url || shortId(item.id))}</div>
                    </div>
                    <div className="text-[var(--on-surface-variant)] font-medium">{activeTab === 'series' ? item.source_type || 'SERIES' : item.source_type || item.content_type}</div>
                    <Badge value={item.status} />
                    <div className="text-xs text-[var(--on-surface-variant)]">{formatDate(item.created_at)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedContent && (
        <ContentDetailDialog
          contentId={selectedContent.id}
          onClose={() => setSelectedContent(null)}
          onOpenModule2={onOpenModule2}
        />
      )}
    </div>
  )
}

function TableHeader({ columns }: { columns: string[] }) {
  return (
    <div className={`grid grid-cols-[84px_2fr_0.8fr_0.9fr_1fr] gap-3 bg-[#f8fafc] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#64748b] border-b border-[#eef2f7]`}>
      {columns.map(c => <div key={c}>{c}</div>)}
    </div>
  )
}

function Badge({ value }: { value: string }) {
  let color = 'bg-slate-100 text-slate-700'
  if (['SUCCEEDED', 'COMPLETED', 'READY', 'APPROVED'].includes(value)) color = 'bg-emerald-100 text-emerald-800'
  if (['FAILED', 'REJECTED'].includes(value)) color = 'bg-red-100 text-red-800'
  if (['RUNNING', 'PENDING', 'PROCESSING'].includes(value)) color = 'bg-blue-100 text-blue-800'
  if (['NEEDS_REVIEW'].includes(value)) color = 'bg-amber-100 text-amber-800'
  return <span className={`px-2 py-1 inline-flex items-center justify-center rounded-md text-[10px] font-bold uppercase tracking-wider ${color}`}>{value}</span>
}

function MediaPreview({ media, compact = false }: { media?: any[]; compact?: boolean }) {
  const first = media?.[0]
  if (!first) return <div className={`${compact ? 'h-12 w-[72px]' : 'h-32 w-full'} rounded-md border border-dashed border-[#d9e0ea] bg-[#fbfcfd] text-[11px] text-[#94a3b8] flex items-center justify-center`}>No media</div>
  const url = first.storage_url || first.source_url || first.thumbnail_url
  return (
    <div className={`${compact ? 'h-12 w-[72px]' : 'h-48 w-full'} rounded-md overflow-hidden bg-black relative`}>
      <img src={url} alt="Media preview" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.src = 'https://placehold.co/400x300?text=No+Preview' }} />
    </div>
  )
}
