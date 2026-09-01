import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { CrawlJob, VnExpressRssFeed } from '@/commons/apis/module1'
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

type CreateCrawlJobDialogProps = {
  sourceType: 'BILIBILI' | 'VNEXPRESS'
  setSourceType: (value: 'BILIBILI' | 'VNEXPRESS') => void
  jobName: string
  setJobName: (value: string) => void
  sourceUrl: string
  setSourceUrl: (value: string) => void
  keywords: string
  setKeywords: (value: string) => void
  maxItems: number
  setMaxItems: (value: number) => void
  vnexpressRssFeeds: VnExpressRssFeed[]
  selectedVnexpressRssKeys: string[]
  setSelectedVnexpressRssKeys: (value: string[]) => void
  scheduleEnabled: boolean
  setScheduleEnabled: (value: boolean) => void
  schedule: CrawlScheduleForm
  setSchedule: (value: CrawlScheduleForm) => void
  onClose: () => void
  onSubmit: () => void
}

const inputClassName = 'mt-1 w-full rounded-md border border-[var(--outline-variant)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-blue-100'

export function CreateCrawlJobDialog(props: CreateCrawlJobDialogProps) {
  const toggleRssFeed = (key: string) => {
    props.setSelectedVnexpressRssKeys(
      props.selectedVnexpressRssKeys.includes(key)
        ? props.selectedVnexpressRssKeys.filter((item) => item !== key)
        : [...props.selectedVnexpressRssKeys, key],
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Tạo Crawl Job</DialogTitle>
          <DialogDescription>Chọn nguồn, giới hạn dữ liệu và lịch crawl cho job mới.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <label className="block text-sm font-semibold">
            Tên Job
            <input type="text" className={inputClassName} value={props.jobName} onChange={(event) => props.setJobName(event.target.value)} />
          </label>
          <label className="block text-sm font-semibold">
            Nguồn
            <select className={inputClassName} value={props.sourceType} onChange={(event) => props.setSourceType(event.target.value as 'BILIBILI' | 'VNEXPRESS')}>
              <option value="BILIBILI">Bilibili</option>
              <option value="VNEXPRESS">VNExpress</option>
            </select>
          </label>
          {props.sourceType === 'VNEXPRESS' && (
            <>
              <label className="block text-sm font-semibold">
                URL VNExpress
                <input type="url" className={inputClassName} placeholder="https://vnexpress.net/rss/tin-moi-nhat.rss" value={props.sourceUrl} onChange={(event) => props.setSourceUrl(event.target.value)} />
              </label>
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">Chuyên mục RSS VNExpress</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => props.setSelectedVnexpressRssKeys(props.vnexpressRssFeeds.map((feed) => feed.key))} className="h-8 rounded-md border px-3 text-xs font-bold">Chọn tất cả</button>
                    <button type="button" onClick={() => props.setSelectedVnexpressRssKeys([])} className="h-8 rounded-md border px-3 text-xs font-bold">Bỏ chọn</button>
                  </div>
                </div>
                <div className="grid max-h-[260px] gap-2 overflow-y-auto rounded-lg border border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-3 sm:grid-cols-2 lg:grid-cols-3">
                  {props.vnexpressRssFeeds.length === 0 ? (
                    <div className="col-span-full text-xs font-semibold text-[var(--on-surface-variant)]">Đang tải danh sách RSS...</div>
                  ) : props.vnexpressRssFeeds.map((feed) => {
                    const checked = props.selectedVnexpressRssKeys.includes(feed.key)
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
            </>
          )}
          <label className="block text-sm font-semibold">
            Keywords
            <input type="text" className={inputClassName} value={props.keywords} onChange={(event) => props.setKeywords(event.target.value)} />
          </label>
          <label className="block text-sm font-semibold">
            Số lượng tối đa
            <input type="number" className={inputClassName} value={props.maxItems} onChange={(event) => props.setMaxItems(Number(event.target.value))} />
          </label>
          <div className="rounded-lg border border-[var(--outline-variant)] bg-blue-50/50 p-4">
            <label className="flex cursor-pointer items-center justify-between gap-4">
              <span>
                <span className="block text-sm font-extrabold text-[var(--on-surface)]">Lên lịch crawl tự động</span>
                <span className="mt-1 block text-xs text-[var(--on-surface-variant)]">Job sẽ được lưu làm mẫu và chạy theo lịch đã chọn.</span>
              </span>
              <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={props.scheduleEnabled} onChange={(event) => props.setScheduleEnabled(event.target.checked)} />
            </label>
            {props.scheduleEnabled && <div className="mt-4 border-t border-[var(--outline-variant)] pt-4"><ScheduleFormFields value={props.schedule} onChange={props.setSchedule} /></div>}
          </div>
        </DialogBody>
        <DialogFooter>
          <button onClick={props.onClose} className="h-9 rounded-md border border-[var(--outline-variant)] px-4 text-sm font-semibold">Hủy</button>
          <button onClick={props.onSubmit} className="h-9 rounded-md bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--accent-strong)]">Tạo mới</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
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
