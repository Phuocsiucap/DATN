import { useAppSelector, useAppDispatch } from '../hooks/useAppDispatch'
import { clearEvents } from '../store/slices/eventsSlice'
import { Trash2, Radio } from 'lucide-react'

const EVENT_ICONS: Record<string, string> = {
  crawl_start: '🔄',
  crawl_done: '✅',
  article_crawled: '📰',
  article_published: '🚀',
}

export default function EventFeed() {
  const events = useAppSelector(s => s.events.items)
  const dispatch = useAppDispatch()

  return (
    <div
      className="rounded-xl flex flex-col"
      style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', height: '320px' }}
    >
      <div className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-2">
          <Radio size={14} style={{ color: 'var(--text-muted)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Realtime Events
          </span>
          {events.length > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-md font-medium tabular-nums"
              style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: '#60a5fa' }}>
              {events.length}
            </span>
          )}
        </div>
        <button
          onClick={() => dispatch(clearEvents())}
          className="p-1.5 rounded-lg transition-colors hover:opacity-80"
          style={{ color: 'var(--text-muted)' }}
          title="Xóa events"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2"
            style={{ color: 'var(--text-muted)' }}>
            <Radio size={24} className="opacity-30" />
            <p className="text-xs">Chờ sự kiện...</p>
          </div>
        ) : (
          <div className="space-y-0">
            {events.map((ev, i) => (
              <div
                key={ev.id}
                className="flex items-start gap-3 py-2.5 text-sm"
                style={{ borderBottom: i < events.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}
              >
                <span className="text-base leading-none mt-0.5 shrink-0">
                  {EVENT_ICONS[ev.type] ?? '📡'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                    {ev.title ?? ev.type.replace(/_/g, ' ')}
                    {ev.platform && (
                      <span className="ml-1.5 text-blue-400 font-normal">[{ev.platform}]</span>
                    )}
                    {ev.new_articles !== undefined && (
                      <span className="ml-1.5 text-green-400 font-normal">+{ev.new_articles}</span>
                    )}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {new Date(ev.timestamp).toLocaleTimeString('vi-VN')}
                  </p>
                </div>
                {ev.success !== undefined && (
                  <span className={`text-xs shrink-0 mt-0.5 ${ev.success ? 'text-green-400' : 'text-red-400'}`}>
                    {ev.success ? '✓' : '✗'}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
