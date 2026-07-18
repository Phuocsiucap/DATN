import { useAppSelector, useAppDispatch } from '@/commons/hooks/useAppDispatch'
import { clearEvents } from '@/commons/store/slices/eventsSlice'
import { Trash2 } from 'lucide-react'

const EVENT_BADGE: Record<string, { label: string; style: React.CSSProperties }> = {
  crawl_start:       { label: 'CRAWLING',   style: { backgroundColor: '#dbeafe', color: '#1d4ed8' } },
  crawl_done:        { label: 'DONE',       style: { backgroundColor: '#dcfce7', color: '#15803d' } },
  article_crawled:   { label: 'NEW',        style: { backgroundColor: 'var(--surface-container)', color: 'var(--on-surface-variant)' } },
  article_published: { label: 'PUBLISHED',  style: { backgroundColor: '#dcfce7', color: '#15803d' } },
}

export default function EventFeed() {
  const events = useAppSelector(s => s.events.items)
  const dispatch = useAppDispatch()

  return (
    <div className="bento-card rounded-xl flex flex-col overflow-hidden">
      <div className="p-6 border-b flex items-center justify-between"
        style={{ borderColor: 'var(--outline-variant)' }}>
        <div>
          <h3 className="text-lg font-semibold" style={{ color: 'var(--on-surface)' }}>
            Recent Activity
          </h3>
          <p className="text-sm mt-0.5" style={{ color: 'var(--on-surface-variant)' }}>
            Latest news and API ingestion
          </p>
        </div>
        <button
          onClick={() => dispatch(clearEvents())}
          className="p-1.5 rounded-lg transition-colors hover:opacity-70"
          style={{ color: 'var(--on-surface-variant)' }}
          title="Xóa tất cả"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5" style={{ maxHeight: '360px' }}>
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2"
            style={{ color: 'var(--on-surface-variant)' }}>
            <span className="text-3xl opacity-30">📡</span>
            <p className="text-sm">Chờ sự kiện...</p>
          </div>
        ) : (
          events.map(ev => {
            const badge = EVENT_BADGE[ev.type]
            return (
              <div key={ev.id} className="flex gap-4">
                <div className="mt-1.5 w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: 'var(--secondary)' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm" style={{ color: 'var(--on-surface)' }}>
                    <span className="font-bold">
                      {ev.platform ? `${ev.platform}:` : ev.type.replace(/_/g, ' ') + ':'}
                    </span>{' '}
                    {ev.title ?? ev.type.replace(/_/g, ' ')}
                    {ev.new_articles !== undefined && (
                      <span className="ml-1" style={{ color: '#16a34a' }}>
                        +{ev.new_articles} bài
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    {badge && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={badge.style}>
                        {badge.label}
                      </span>
                    )}
                    <span className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>
                      {new Date(ev.timestamp).toLocaleTimeString('vi-VN')}
                    </span>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      <button
        className="w-full py-4 text-center text-sm font-medium border-t transition-colors hover:opacity-70"
        style={{ color: 'var(--secondary)', borderColor: 'var(--outline-variant)' }}
      >
        View All Activity
      </button>
    </div>
  )
}
