import { PaginatedList } from '@/commons/component/ui/paginated-list'
import { Table, TableHeader as ShadcnTableHeader, TableBody, TableRow, TableHead, TableCell } from '@/commons/component/ui/table'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Edit2, Loader2, Play, Plus, Square, Trash2 } from 'lucide-react'
import {
  createCrawlSourceConfigApi,
  deleteCrawlSourceConfigApi,
  fetchCrawlSourceConfigsApi,
  toggleCrawlSourceConfigStatusApi,
  updateCrawlSourceConfigApi,
  type CrawlSourceConfig,
} from '@/commons/apis/module1'
import { AppButton, AppCard, TableRowActions } from '@/commons/component/social-ui'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/commons/component/ui/dialog'

export function CrawlSourceConfigsTab({ isSystemUser = false, sourceTypes, vnexpressRssFeeds }: { isSystemUser?: boolean; sourceTypes: import('@/commons/apis/module1').SourceTypeConfig[]; vnexpressRssFeeds: import('@/commons/apis/module1').VnExpressRssFeed[] }) {
  const [configs, setConfigs] = useState<CrawlSourceConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [showDialog, setShowDialog] = useState(false)
  const [editingConfig, setEditingConfig] = useState<CrawlSourceConfig | null>(null)

  const loadConfigs = async () => {
    setLoading(true)
    try {
      const data = await fetchCrawlSourceConfigsApi()
      setConfigs(data)
    } catch (error) {
      toast.error('Không thể tải cấu hình nguồn.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadConfigs()
  }, [])

  const handleToggleStatus = async (config: CrawlSourceConfig) => {
    const nextStatus = config.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
    try {
      await toggleCrawlSourceConfigStatusApi(config.id, nextStatus)
      toast.success(`Đã ${nextStatus === 'ACTIVE' ? 'bật' : 'tạm dừng'} nguồn.`)
      await loadConfigs()
    } catch (error) {
      toast.error('Lỗi khi đổi trạng thái.')
    }
  }

  const handleDelete = async (config: CrawlSourceConfig) => {
    if (!window.confirm('Bạn có chắc muốn xoá nguồn này?')) return
    try {
      await deleteCrawlSourceConfigApi(config.id)
      toast.success('Đã xoá nguồn.')
      await loadConfigs()
    } catch (error) {
      toast.error('Lỗi khi xoá nguồn.')
    }
  }

  return (
    <div className="app-list-layout gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-extrabold text-[var(--on-surface)]">Nguồn Crawl Dùng Chung</h2>
          <p className="text-xs text-[var(--on-surface-variant)]">Quản lý các nguồn dữ liệu có thể sử dụng lại cho nhiều Job.</p>
        </div>
        {isSystemUser && <AppButton icon={<Plus size={15} />} onClick={() => { setEditingConfig(null); setShowDialog(true); }}>Tạo nguồn</AppButton>}
      </div>

      <AppCard className="app-list-layout app-table-card overflow-hidden">
        <PaginatedList items={configs} loading={loading} resetKey={configs.map(item => item.id).join()}>{(visibleItems) => (
<Table className="min-w-[960px] table-fixed">
          <colgroup>
            <col style={{ width: '30%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '10%' }} />
          </colgroup>
          <ShadcnTableHeader>
            <TableRow className="bg-slate-50/80">
              <TableHead className="px-4 py-3 min-w-[160px]"><div>Tên & Mô tả</div></TableHead>
              <TableHead className="px-4 py-3"><div>Loại Nguồn</div></TableHead>
              <TableHead className="px-4 py-3"><div>Trạng thái</div></TableHead>
              <TableHead className="px-4 py-3"><div>Ngày tạo</div></TableHead>
              <TableHead className="px-4 py-3"><div>Hành động</div></TableHead>
            </TableRow>
          </ShadcnTableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5}><div className="flex justify-center p-8 text-slate-500"><Loader2 className="animate-spin" /></div></TableCell></TableRow>
            ) : configs.length === 0 ? (
              <TableRow><TableCell colSpan={5}><div className="empty-state m-3">Chưa có nguồn dùng chung nào</div></TableCell></TableRow>
            ) : (
              visibleItems.map((config) => (
                <TableRow key={config.id} className=" border-t border-[var(--outline-variant)] text-xs">
                  <TableCell className="px-4 py-3 min-w-[160px]"><div>
                    <div className="font-extrabold">{config.name}</div>
                    <div className="mt-1 text-slate-500">{config.description || '-'}</div>
                  </div></TableCell>
                  <TableCell className="px-4 py-3"><div>
                    <div className="font-bold text-blue-600">{config.source_type}</div>
                    <div className="mt-1 text-slate-500 truncate max-w-[150px]" title={config.source_url || ''}>{config.source_url || 'N/A'}</div>
                  </div></TableCell>
                  <TableCell className="px-4 py-3"><div>
                    <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${config.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                      {config.status}
                    </span>
                  </div></TableCell>
                  <TableCell className="px-4 py-3"><div>
                    <div className="text-slate-500">{new Date(config.created_at).toLocaleString('vi-VN')}</div>
                    <div className="mt-0.5 text-slate-400">Bởi: {config.creator_name}</div>
                  </div></TableCell>
                  <TableCell className="px-4 py-3"><div>
                    {isSystemUser && <TableRowActions
                      actions={[
                        { label: 'Chỉnh sửa', icon: <Edit2 size={14} />, onClick: () => { setEditingConfig(config); setShowDialog(true); } },
                        { label: config.status === 'ACTIVE' ? 'Tạm dừng' : 'Kích hoạt', icon: config.status === 'ACTIVE' ? <Square size={14} /> : <Play size={14} />, onClick: () => handleToggleStatus(config) },
                        { label: 'Xoá nguồn', icon: <Trash2 size={14} />, onClick: () => handleDelete(config), danger: true },
                      ]}
                    />}
                  </div></TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
)}</PaginatedList>
      </AppCard>
      
      {showDialog && (
        <SourceConfigDialog
          config={editingConfig}
          sourceTypes={sourceTypes}
          vnexpressRssFeeds={vnexpressRssFeeds}
          onClose={() => setShowDialog(false)}
          onSuccess={() => { setShowDialog(false); void loadConfigs(); }}
        />
      )}
    </div>
  )
}

function SourceConfigDialog({ config, sourceTypes, vnexpressRssFeeds, onClose, onSuccess }: { config: CrawlSourceConfig | null; sourceTypes: import('@/commons/apis/module1').SourceTypeConfig[]; vnexpressRssFeeds: import('@/commons/apis/module1').VnExpressRssFeed[]; onClose: () => void; onSuccess: () => void }) {
  const [name, setName] = useState(config?.name || '')
  const [description, setDescription] = useState(config?.description || '')
  const [sourceType, setSourceType] = useState(config?.source_type || 'VNEXPRESS')
  const [sourceUrl, setSourceUrl] = useState(config?.source_url || '')
  const [selectedRssKeys, setSelectedRssKeys] = useState<string[]>(
    (config?.configuration?.rss_feed_keys as string[]) || (vnexpressRssFeeds.length > 0 ? ['tin-moi-nhat'] : [])
  )
  const [keywords, setKeywords] = useState(config?.keywords.join(', ') || '')
  const [jobOptions, setJobOptions] = useState<string[]>((config?.configuration.job_options as string[]) ?? [])
  const [saving, setSaving] = useState(false)

  const handleSubmit = async () => {
    if (!name.trim()) return toast.error('Vui lòng nhập tên nguồn')
    if (sourceType === 'VNEXPRESS' && !sourceUrl.trim() && !selectedRssKeys.length) return toast.error('Chọn RSS hoặc nhập URL')
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        source_type: sourceType,
        source_url: sourceUrl.trim() || null,
        keywords: keywords.split(',').map(k => k.trim()).filter(Boolean),
        configuration: {
          ...Object.fromEntries(Object.entries(config?.configuration || {}).filter(([key]) => !['max_items', 'limit', 'rss_feed_keys', 'rss_feed_urls', 'rss_feeds', 'job_options'].includes(key))),
          ...(sourceType === 'VNEXPRESS' ? { rss_feed_keys: selectedRssKeys } : {}),
          job_options: jobOptions.filter(key => key !== 'rss_feed_keys' || sourceType === 'VNEXPRESS'),
        },
      }
      if (config) {
        await updateCrawlSourceConfigApi(config.id, payload)
        toast.success('Đã cập nhật nguồn')
      } else {
        await createCrawlSourceConfigApi(payload)
        toast.success('Đã tạo nguồn mới')
      }
      onSuccess()
    } catch (error) {
      toast.error('Có lỗi xảy ra, vui lòng thử lại')
    } finally {
      setSaving(false)
    }
  }

  const toggleRssFeed = (key: string) => {
    setSelectedRssKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{config ? 'Chỉnh sửa Nguồn' : 'Tạo Nguồn Dùng Chung'}</DialogTitle>
          <DialogDescription>Cấu hình này có thể được sử dụng lại ở nhiều Crawl Jobs khác nhau.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <label className="block text-sm font-semibold">Tên Nguồn
            <input type="text" className="mt-1 w-full rounded-md border px-3 py-2 text-sm" value={name} onChange={e => setName(e.target.value)} />
          </label>
          <label className="block text-sm font-semibold">Mô tả
            <input type="text" className="mt-1 w-full rounded-md border px-3 py-2 text-sm" value={description} onChange={e => setDescription(e.target.value)} />
          </label>
          <label className="block text-sm font-semibold">Loại Nguồn
            <select className="mt-1 w-full rounded-md border px-3 py-2 text-sm" value={sourceType} onChange={e => setSourceType(e.target.value)} disabled={!!config}>
              {sourceTypes.filter(st => ['VNEXPRESS', 'BILIBILI'].includes(st.type)).map(st => (
                <option key={st.type} value={st.type}>{st.type}</option>
              ))}
            </select>
          </label>
          {sourceType === 'VNEXPRESS' && (
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">Chuyên mục RSS VNExpress</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setSelectedRssKeys(vnexpressRssFeeds.map(f => f.key))} className="h-8 rounded-md border px-3 text-xs font-bold">Chọn tất cả</button>
                  <button type="button" onClick={() => setSelectedRssKeys([])} className="h-8 rounded-md border px-3 text-xs font-bold">Bỏ chọn</button>
                </div>
              </div>
              <div className="grid max-h-[260px] gap-2 overflow-y-auto rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-3 sm:grid-cols-2 lg:grid-cols-3">
                {vnexpressRssFeeds.length === 0 ? (
                  <div className="col-span-full text-xs font-semibold text-[var(--on-surface-variant)]">Đang tải danh sách RSS...</div>
                ) : vnexpressRssFeeds.map((feed) => {
                  const checked = selectedRssKeys.includes(feed.key)
                  return (
                    <label key={feed.key} className={`flex min-h-[54px] cursor-pointer items-start gap-2 rounded-lg border p-2 text-xs transition ${checked ? 'border-[var(--accent)] bg-blue-50' : 'border-[var(--outline-variant)] bg-white hover:bg-slate-50'}`}>
                      <input type="checkbox" className="mt-0.5" checked={checked} onChange={() => toggleRssFeed(feed.key)} />
                      <span className="min-w-0">
                        <span className="block font-extrabold text-[var(--on-surface)]">{feed.label}</span>
                        <span className="mt-0.5 block truncate font-mono text-xs text-[var(--on-surface-variant)]">{feed.url.replace('https://vnexpress.net/rss/', '')}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
          {(
            <label className="block text-sm font-semibold">URL nguồn (tùy chọn)
              <input type="text" className="mt-1 w-full rounded-md border px-3 py-2 text-sm" placeholder="VD: https://space.bilibili.com/..." value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} />
            </label>
          )}
          <label className="block text-sm font-semibold">Từ khóa mặc định (tùy chọn)
            <input className="mt-1 w-full rounded-md border px-3 py-2 text-sm" value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="Phân cách bằng dấu phẩy" />
          </label>
          <div className="space-y-2"><p className="text-sm font-semibold">Cho phép tùy chỉnh khi tạo job</p>
            {[['source_url', 'URL'], ['keywords', 'Từ khóa'], ...(sourceType === 'VNEXPRESS' ? [['rss_feed_keys', 'Chọn trong các chuyên mục RSS của nguồn']] : [])].map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={jobOptions.includes(key)} onChange={e => setJobOptions(e.target.checked ? [...jobOptions, key] : jobOptions.filter(k => k !== key))} />{label}</label>)}
          </div>
        </DialogBody>
        <DialogFooter>
          <button onClick={onClose} disabled={saving} className="h-9 px-4 rounded-md border text-sm font-semibold">Hủy</button>
          <button onClick={handleSubmit} disabled={saving} className="h-9 px-4 rounded-md bg-[var(--accent)] text-white text-sm font-semibold">Lưu lại</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
