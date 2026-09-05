import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { CrawlJob, VnExpressRssFeed, CrawlSourceConfig } from '@/commons/apis/module1'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/commons/component/ui/dialog'
import {
  type CrawlScheduleForm,
  normalizeClock,
  scheduleFormForJob,
  WEEKDAYS,
} from '../crawlSchedule'

export type JobSourceDraft = {
  id: string
  maxItems: number
  overrides: { source_url?: string | null; keywords?: string[]; configuration?: { rss_feed_keys: string[] } }
}
const inputClassName = 'mt-1 w-full rounded-md border border-[var(--outline-variant)] bg-white px-3 py-2 text-sm'

export function CreateCrawlJobDialog(props: {
  sourceConfigs: CrawlSourceConfig[]
  sourceTypes: import('@/commons/apis/module1').SourceTypeConfig[]
  sources: JobSourceDraft[]
  setSources: (sources: JobSourceDraft[]) => void
  jobName: string
  setJobName: (name: string) => void
  saving: boolean
  vnexpressRssFeeds: VnExpressRssFeed[]
  scheduleEnabled: boolean
  setScheduleEnabled: (enabled: boolean) => void
  schedule: CrawlScheduleForm
  setSchedule: (schedule: CrawlScheduleForm) => void
  onClose: () => void
  onSubmit: () => void
}) {
  const update = (id: string, patch: Partial<JobSourceDraft>) => props.setSources(props.sources.map(s => s.id === id ? { ...s, ...patch } : s))
  const available = props.sourceConfigs.filter(c => c.status === 'ACTIVE' && ['VNEXPRESS', 'BILIBILI'].includes(c.source_type))
  return <Dialog open onOpenChange={open => !open && !props.saving && props.onClose()}>
    <DialogContent className="max-w-3xl">
      <DialogHeader><DialogTitle>Tạo Crawl Job</DialogTitle><DialogDescription>Chọn một hoặc nhiều nguồn và số bài cần thu thập từ mỗi nguồn.</DialogDescription></DialogHeader>
      <DialogBody className="space-y-4">
        <label className="block text-sm font-semibold">Tên job<input className={inputClassName} value={props.jobName} onChange={e => props.setJobName(e.target.value)} /></label>
        {!available.length && <p>Chưa có nguồn đang hoạt động. System Admin cần cấu hình nguồn trước khi tạo job.</p>}
        {available.map(config => {
          const draft = props.sources.find(s => s.id === config.id)
          const options = Array.isArray(config.configuration.job_options) ? config.configuration.job_options as string[] : (config.source_type === 'VNEXPRESS' ? ['source_url', 'keywords', 'rss_feed_keys'] : ['source_url', 'keywords'])
          const patchOverride = (patch: JobSourceDraft['overrides']) => draft && update(config.id, { overrides: { ...draft.overrides, ...patch } })
          const rssKeys = (draft?.overrides.configuration?.rss_feed_keys ?? config.configuration.rss_feed_keys ?? []) as string[]
          return <div key={config.id} className="rounded-lg border p-4 space-y-3">
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={!!draft} onChange={e => props.setSources(e.target.checked ? [...props.sources, { id: config.id, maxItems: 20, overrides: {} }] : props.sources.filter(s => s.id !== config.id))} />{config.name} ({config.source_type})</label>
            {config.description && <p className="text-sm text-slate-500">{config.description}</p>}
            {draft && <>
              <label className="block text-sm">Số bài cần thu thập từ nguồn này<input type="number" min={1} max={200} className={inputClassName} value={draft.maxItems} onChange={e => update(config.id, { maxItems: Number(e.target.value) })} /></label>
              {options.includes('source_url') ? <label className="block text-sm">URL (tùy chọn)<input type="url" className={inputClassName} value={draft.overrides.source_url !== undefined ? draft.overrides.source_url || '' : config.source_url || ''} onChange={e => patchOverride({ source_url: e.target.value || null })} /></label> : config.source_url && <p className="text-sm break-all">URL: {config.source_url}</p>}
              {options.includes('keywords') ? <label className="block text-sm">Từ khóa (tùy chọn, phân cách bằng dấu phẩy)<input className={inputClassName} defaultValue={config.keywords.join(', ')} onChange={e => patchOverride({ keywords: e.target.value.split(',').map(k => k.trim()).filter(Boolean) })} /></label> : <p className="text-sm">Từ khóa: {config.keywords.join(', ') || 'Không có'}</p>}
              {options.includes('rss_feed_keys') && <div className="flex flex-wrap gap-3">{props.vnexpressRssFeeds.filter(f => ((config.configuration.rss_feed_keys ?? []) as string[]).includes(f.key)).map(feed => <label key={feed.key} className="text-sm flex items-center gap-1"><input type="checkbox" checked={rssKeys.includes(feed.key)} onChange={e => patchOverride({ configuration: { rss_feed_keys: e.target.checked ? [...rssKeys, feed.key] : rssKeys.filter(k => k !== feed.key) } })} />{feed.label}</label>)}</div>}
            </>}
          </div>
        })}
        <label className="flex items-center gap-2"><input type="checkbox" checked={props.scheduleEnabled} onChange={e => props.setScheduleEnabled(e.target.checked)} />Chạy định kỳ</label>
        {props.scheduleEnabled && <ScheduleFormFields value={props.schedule} onChange={props.setSchedule} />}
      </DialogBody>
      <DialogFooter><button disabled={props.saving} onClick={props.onClose}>Hủy</button><button className="rounded-md bg-blue-600 text-white px-4 py-2" disabled={props.saving || !props.sources.length} onClick={props.onSubmit}>{props.saving ? 'Đang tạo...' : 'Tạo job'}</button></DialogFooter>
    </DialogContent>
  </Dialog>
}

export function ScheduleFormFields({ value, onChange }: { value: CrawlScheduleForm; onChange: (value: CrawlScheduleForm) => void }) {
  const update = <K extends keyof CrawlScheduleForm>(key: K, next: CrawlScheduleForm[K]) => onChange({ ...value, [key]: next })
  const toggleWeekday = (day: number) => update('weekdays', value.weekdays.includes(day) ? value.weekdays.filter((item) => item !== day) : [...value.weekdays, day].sort((a, b) => a - b))

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-xs font-bold text-[#34415a]">Số lần mỗi ngày<input type="number" min={1} max={24} className={inputClassName} value={value.runs_per_day} onChange={(event) => update('runs_per_day', Math.max(1, Math.min(24, Number(event.target.value) || 1)))} /></label>
        <label className="block text-xs font-bold text-[#34415a]">Từ giờ<input type="time" className={inputClassName} value={normalizeClock(value.window_start)} onChange={(event) => update('window_start', event.target.value)} /></label>
        <label className="block text-xs font-bold text-[#34415a]">Đến giờ<input type="time" className={inputClassName} value={normalizeClock(value.window_end)} onChange={(event) => update('window_end', event.target.value)} /></label>
      </div>
      <div>
        <div className="mb-2 text-xs font-bold text-[#34415a]">Chạy vào các ngày</div>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((day) => {
            const selected = value.weekdays.includes(day.value)
            return <button key={day.value} type="button" title={day.label} onClick={() => toggleWeekday(day.value)} className={`h-8 min-w-9 rounded-md border px-2 text-xs font-extrabold transition ${selected ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[var(--outline-variant)] bg-white text-[var(--on-surface-variant)] hover:border-slate-400'}`}>{day.short}</button>
          })}
        </div>
      </div>
      <div className="rounded-md bg-blue-50 px-3 py-2 text-xs font-semibold text-[#38527b]">Các lần chạy được chia đều từ {normalizeClock(value.window_start)} đến {normalizeClock(value.window_end)} theo giờ Việt Nam.</div>
    </div>
  )
}

export function CrawlScheduleDialog({ job, saving, onClose, onSave }: { job: CrawlJob; saving: boolean; onClose: () => void; onSave: (schedule: CrawlScheduleForm) => void }) {
  const [form, setForm] = useState<CrawlScheduleForm>(() => scheduleFormForJob(job))
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Thiết lập lịch crawl</DialogTitle><DialogDescription>{job.name}</DialogDescription></DialogHeader>
        <DialogBody>
          <label className="mb-5 flex cursor-pointer items-center justify-between rounded-lg border border-[var(--outline-variant)] bg-blue-50/50 p-3">
            <span><span className="block text-sm font-extrabold text-[var(--on-surface)]">Kích hoạt lịch</span><span className="text-xs text-[var(--on-surface-variant)]">Tắt để tạm dừng mà không mất cấu hình.</span></span>
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
          </label>
          <ScheduleFormFields value={form} onChange={setForm} />
          {job.schedule?.last_run_at && <div className="mt-4 text-xs font-semibold text-[var(--on-surface-variant)]">Lần chạy gần nhất: {new Date(job.schedule.last_run_at).toLocaleString('vi-VN')}</div>}
        </DialogBody>
        <DialogFooter>
          <button type="button" onClick={onClose} disabled={saving} className="h-9 rounded-md border border-[var(--outline-variant)] px-4 text-sm font-bold disabled:opacity-50">Hủy</button>
          <button type="button" onClick={() => onSave(form)} disabled={saving} className="flex h-9 items-center gap-2 rounded-md bg-[var(--accent)] px-4 text-sm font-bold text-white disabled:opacity-60">{saving && <Loader2 size={14} className="animate-spin" />} Lưu lịch</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
