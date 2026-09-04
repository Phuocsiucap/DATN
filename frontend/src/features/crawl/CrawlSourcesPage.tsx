import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { RefreshCcw, Loader2, Eye, Play, Pause, Trash2, AlertTriangle } from 'lucide-react'
import {
  fetchCrawlSourcesApi,
  updateCrawlSourceStatusApi,
  deleteCrawlSourceApi,
  type CrawlSource,
} from '@/commons/apis/module1'
import { AppButton, AppCard, PageLayout, TableRowActions, type TableRowActionItem } from '@/commons/component/social-ui'
import { cn } from '@/commons/lib/utils'

const formatDate = (value?: string) => (value ? new Date(value).toLocaleString('vi-VN') : '-')
const shortId = (value: string) => value.slice(0, 8)

export default function CrawlSourcesPage() {
  const [sources, setSources] = useState<CrawlSource[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSource, setSelectedSource] = useState<CrawlSource | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)

  const loadSources = async () => {
    setLoading(true)
    try {
      const data = await fetchCrawlSourcesApi()
      setSources(data)
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể tải danh sách nguồn crawl')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSources()
  }, [])

  const handleToggleStatus = async (source: CrawlSource) => {
    const newStatus = source.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    try {
      await updateCrawlSourceStatusApi(source.id, newStatus)
      toast.success(newStatus === 'ACTIVE' ? 'Đã kích hoạt nguồn crawl' : 'Đã dừng nguồn crawl')
      await loadSources()
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể cập nhật trạng thái')
    }
  }

  const handleDelete = async (sourceId: string) => {
    try {
      const result = await deleteCrawlSourceApi(sourceId)
      toast.success(result.message || 'Đã xóa nguồn crawl')
      setShowDeleteConfirm(null)
      await loadSources()
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || 'Không thể xóa nguồn crawl')
    }
  }

  const activeSources = sources.filter((s) => s.status === 'ACTIVE').length
  const inactiveSources = sources.filter((s) => s.status === 'INACTIVE').length

  return (
    <PageLayout
      title="Quản lý nguồn Crawl"
      description="Dừng hoặc xóa các nguồn crawl để quản lý vòng đời dữ liệu."
      actions={
        <AppButton
          variant="secondary"
          icon={<RefreshCcw size={15} />}
          disabled={loading}
          onClick={() => void loadSources()}
        >
          Tải lại
        </AppButton>
      }
    >
      <section className="min-w-0 space-y-4">
        {loading && sources.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="animate-spin" size={16} /> Đang tải...
          </div>
        )}

        {/* Stats */}
        <div className="grid gap-3 sm:grid-cols-3">
          <AppCard className="flex flex-col justify-between p-4">
            <div className="text-xs font-semibold text-slate-500">Tổng nguồn</div>
            <div className="text-2xl font-extrabold text-slate-900">{sources.length}</div>
          </AppCard>
          <AppCard className="flex flex-col justify-between p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Đang hoạt động
            </div>
            <div className="text-2xl font-extrabold text-slate-900">{activeSources}</div>
          </AppCard>
          <AppCard className="flex flex-col justify-between p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <span className="h-2 w-2 rounded-full bg-slate-400" />
              Đã dừng
            </div>
            <div className="text-2xl font-extrabold text-slate-900">{inactiveSources}</div>
          </AppCard>
        </div>

        {/* Sources Table */}
        <div className="app-card overflow-hidden">
          <div className="data-grid-lg">
            <div className="app-table-header grid grid-cols-[1.2fr_0.8fr_1fr_0.8fr_1fr_0.8fr] gap-3 px-4 py-3">
              <div>Nguồn</div>
              <div>Loại</div>
              <div>Cấu hình</div>
              <div>Trạng thái</div>
              <div>Ngày tạo</div>
              <div>Thao tác</div>
            </div>

            {sources.length === 0 && !loading ? (
              <div className="empty-state m-3">Chưa có nguồn crawl nào</div>
            ) : (
              sources.map((source) => (
                <div
                  key={source.id}
                  className={cn(
                    'grid grid-cols-[1.2fr_0.8fr_1fr_0.8fr_1fr_0.8fr] items-center gap-3 border-t border-slate-200 px-4 py-4 text-xs transition-colors',
                    selectedSource?.id === source.id
                      ? 'bg-blue-50'
                      : 'hover:bg-slate-50',
                  )}
                >
                  {/* Source Info */}
                  <div>
                    <div className="font-extrabold text-slate-900">
                      {source.source_type}
                    </div>
                    <div className="mt-1 font-mono text-xs text-slate-500">
                      ID: {shortId(source.id)}...
                    </div>
                    {source.source_url && (
                      <div className="mt-1 truncate text-xs text-blue-600">
                        {source.source_url}
                      </div>
                    )}
                  </div>

                  {/* Type Badge */}
                  <div>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-lg px-2 py-1 text-xs font-bold uppercase',
                        source.source_type === 'BILIBILI'
                          ? 'bg-pink-100 text-pink-700'
                          : 'bg-red-100 text-red-700',
                      )}
                    >
                      {source.source_type}
                    </span>
                  </div>

                  {/* Configuration */}
                  <div className="space-y-1">
                    {source.keywords.length > 0 && (
                      <div className="text-xs text-slate-600">
                        <span className="font-semibold">Keywords:</span>{' '}
                        {source.keywords.slice(0, 2).join(', ')}
                        {source.keywords.length > 2 && ` +${source.keywords.length - 2}`}
                      </div>
                    )}
                    {typeof source.configuration?.max_items === 'number' ? (
                      <div className="text-xs text-slate-600">
                        <span className="font-semibold">Max:</span>{' '}
                        {source.configuration.max_items} items
                      </div>
                    ) : null}
                    {Object.keys(source.configuration || {}).length === 0 && (
                      <div className="text-xs text-slate-400">Không có cấu hình</div>
                    )}
                  </div>

                  {/* Status */}
                  <div>
                    <button
                      onClick={() => handleToggleStatus(source)}
                      disabled={loading}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50',
                        source.status === 'ACTIVE'
                          ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/50 hover:bg-emerald-200'
                          : 'bg-slate-100 text-slate-700 ring-1 ring-slate-200/50 hover:bg-slate-200',
                      )}
                    >
                      {source.status === 'ACTIVE' ? (
                        <>
                          <Play size={12} /> Active
                        </>
                      ) : (
                        <>
                          <Pause size={12} /> Inactive
                        </>
                      )}
                    </button>
                  </div>

                  {/* Created At */}
                  <div className="text-slate-600">{formatDate(source.created_at)}</div>

                  {/* Actions */}
                  <div>
                    {showDeleteConfirm === source.id ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setShowDeleteConfirm(null)}
                          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                          Hủy
                        </button>
                        <button
                          onClick={() => handleDelete(source.id)}
                          className="rounded bg-red-600 px-2 py-1 text-xs font-bold text-white hover:bg-red-700"
                        >
                          Xác nhận xóa
                        </button>
                      </div>
                    ) : (
                      <TableRowActions
                        actions={[
                          {
                            label: 'Xem chi tiết',
                            icon: <Eye size={14} />,
                            onClick: () => setSelectedSource(source),
                          },
                          {
                            label:
                              source.status === 'ACTIVE'
                                ? 'Dừng nguồn'
                                : 'Kích hoạt nguồn',
                            icon:
                              source.status === 'ACTIVE' ? (
                                <Pause size={14} />
                              ) : (
                                <Play size={14} />
                              ),
                            onClick: () => handleToggleStatus(source),
                          },
                          {
                            label: 'Xóa nguồn',
                            icon: <Trash2 size={14} />,
                            onClick: () => setShowDeleteConfirm(source.id),
                            danger: true,
                          },
                        ]}
                      />
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Info notice */}
        <AppCard className="flex items-start gap-3 border-blue-200 bg-blue-50 p-4">
          <AlertTriangle size={20} className="shrink-0 text-blue-600" />
          <div className="text-sm">
            <p className="font-bold text-blue-900">Lưu ý quan trọng</p>
            <p className="mt-1 text-blue-800">
              Khi <strong>dừng</strong> hoặc <strong>xóa</strong> một nguồn crawl, các
              content item đã được thu thập trước đó sẽ{' '}
              <strong>không bị ảnh hưởng</strong>. Hành động này chỉ ngăn các lần crawl
              tiếp theo sử dụng nguồn này.
            </p>
          </div>
        </AppCard>

        {/* Detail Sheet */}
        {selectedSource && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
            onClick={() => setSelectedSource(null)}
          >
            <div
              className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 border-b border-slate-200 bg-slate-50 px-6 py-4">
                <h3 className="text-lg font-extrabold text-slate-900">
                  Chi tiết nguồn crawl
                </h3>
              </div>
              <div className="space-y-4 p-6">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    ID
                  </div>
                  <div className="mt-1 font-mono text-sm text-slate-900">
                    {selectedSource.id}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Job ID
                  </div>
                  <div className="mt-1 font-mono text-sm text-slate-900">
                    {selectedSource.job_id}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Loại nguồn
                  </div>
                  <div className="mt-1 text-sm font-bold text-slate-900">
                    {selectedSource.source_type}
                  </div>
                </div>
                {selectedSource.source_url && (
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      URL nguồn
                    </div>
                    <div className="mt-1 break-all text-sm text-blue-600">
                      {selectedSource.source_url}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Keywords
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {selectedSource.keywords.length > 0 ? (
                      selectedSource.keywords.map((kw) => (
                        <span
                          key={kw}
                          className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700"
                        >
                          {kw}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-slate-400">Không có</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Cấu hình
                  </div>
                  <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                    {JSON.stringify(selectedSource.configuration, null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Trạng thái
                  </div>
                  <div className="mt-1">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold uppercase',
                        selectedSource.status === 'ACTIVE'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-100 text-slate-700',
                      )}
                    >
                      {selectedSource.status}
                    </span>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Ngày tạo
                    </div>
                    <div className="mt-1 text-sm text-slate-900">
                      {formatDate(selectedSource.created_at)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Cập nhật
                    </div>
                    <div className="mt-1 text-sm text-slate-900">
                      {formatDate(selectedSource.updated_at)}
                    </div>
                  </div>
                </div>
              </div>
              <div className="sticky bottom-0 flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
                <button
                  onClick={() => setSelectedSource(null)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </PageLayout>
  )
}
