import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, RefreshCw, Save, Settings } from 'lucide-react'
import {
  fetchAdminSchedulerSettingsApi,
  updateAdminSchedulerSettingsApi,
  type SchedulerSettings,
  type SchedulerSettingsStatus,
} from '@/commons/apis/api'

const DEFAULT_SETTINGS: SchedulerSettings = {
  vnexpress_interval_minutes: 30,
  bilibili_interval_minutes: 30,
  publish_queue_interval_minutes: 5,
}

type SettingsPageProps = {
  currentUser: {
    roles: string[]
  }
}

export default function SettingsPage({ currentUser }: SettingsPageProps) {
  const isSystemUser = currentUser.roles.includes('system')
  const [status, setStatus] = useState<SchedulerSettingsStatus | null>(null)
  const [form, setForm] = useState<SchedulerSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const loadSettings = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchAdminSchedulerSettingsApi()
      setStatus(data)
      setForm(data.settings)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Không tải được cấu hình scheduler')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isSystemUser) void loadSettings()
  }, [isSystemUser])

  const updateField = (key: keyof SchedulerSettings, value: string) => {
    const numericValue = Number(value)
    setForm((current) => ({
      ...current,
      [key]: Number.isFinite(numericValue) ? Math.max(1, Math.min(1440, numericValue)) : 1,
    }))
  }

  const saveSettings = async () => {
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const data = await updateAdminSchedulerSettingsApi(form)
      setStatus(data)
      setForm(data.settings)
      setMessage('Đã lưu cấu hình scheduler')
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Không lưu được cấu hình scheduler')
    } finally {
      setSaving(false)
    }
  }

  if (!isSystemUser) {
    return (
      <div className="bento-card rounded-2xl p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-red-600">
          <AlertCircle size={18} />
          Chỉ admin hệ thống mới được mở phần này.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <Settings size={26} style={{ color: 'var(--primary)' }} />
          <h1 className="text-2xl font-bold" style={{ color: 'var(--on-surface)' }}>
            Admin Settings
          </h1>
        </div>
        <p className="mt-1 text-sm" style={{ color: 'var(--on-surface-variant)' }}>
          Cấu hình chu kỳ chạy scheduler cho từng nguồn crawl.
        </p>
      </div>

      <div className="bento-card rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--on-surface)' }}>
              Scheduler
            </h2>
            <p className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>
              Trạng thái hiện tại: <span className="font-semibold">{status?.status || '...'}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadSettings()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-60"
            style={{ borderColor: 'var(--outline)', color: 'var(--on-surface)' }}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Tải lại
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <IntervalField
            label="VNExpress crawl"
            value={form.vnexpress_interval_minutes}
            onChange={(value) => updateField('vnexpress_interval_minutes', value)}
          />
          <IntervalField
            label="Bilibili crawl"
            value={form.bilibili_interval_minutes}
            onChange={(value) => updateField('bilibili_interval_minutes', value)}
          />
          <IntervalField
            label="Publish queue"
            value={form.publish_queue_interval_minutes}
            onChange={(value) => updateField('publish_queue_interval_minutes', value)}
          />
        </div>

        {status?.jobs && (
          <div className="grid gap-3 md:grid-cols-3">
            <JobCard label="VNExpress" value={status.jobs.vnexpress.interval_minutes} />
            <JobCard label="Bilibili" value={status.jobs.bilibili.interval_minutes} />
            <JobCard label="Publish queue" value={status.jobs.publish_queue.interval_minutes} />
          </div>
        )}

        {(message || error) && (
          <div
            className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm"
            style={{
              backgroundColor: error ? '#FEE2E2' : '#DCFCE7',
              color: error ? '#991B1B' : '#166534',
            }}
          >
            {error ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}
            {error || message}
          </div>
        )}

        <button
          type="button"
          onClick={() => void saveSettings()}
          disabled={saving || loading}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60"
          style={{ backgroundColor: 'var(--primary)', color: 'var(--on-primary)' }}
        >
          <Save size={16} />
          {saving ? 'Đang lưu...' : 'Lưu cấu hình'}
        </button>
      </div>
    </div>
  )
}

function IntervalField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: string) => void
}) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium" style={{ color: 'var(--on-surface)' }}>
        {label}
      </span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={1440}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{
            borderColor: 'var(--outline)',
            backgroundColor: 'var(--surface)',
            color: 'var(--on-surface)',
          }}
        />
        <span className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>
          phút
        </span>
      </div>
    </label>
  )
}

function JobCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--outline)' }}>
      <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--on-surface-variant)' }}>
        Đang áp dụng
      </div>
      <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--on-surface)' }}>
        {label}: {value} phút
      </div>
    </div>
  )
}
