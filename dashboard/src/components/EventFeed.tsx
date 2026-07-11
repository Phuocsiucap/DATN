import { useAppSelector, useAppDispatch } from '../hooks/useAppDispatch'
import { clearEvents } from '../store/slices/eventsSlice'
import { Trash2 } from 'lucide-react'

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
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 h-96 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-white font-semibold">Realtime Events</h2>
        <button onClick={() => dispatch(clearEvents())}
          className="text-gray-500 hover:text-red-400 transition-colors">
          <Trash2 size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {events.length === 0 && (
          <p className="text-gray-500 text-sm text-center mt-10">Chưa có sự kiện nào...</p>
        )}
        {events.map(ev => (
          <div key={ev.id} className="flex items-start gap-2 text-sm border-b border-gray-700 pb-2">
            <span className="text-lg leading-none">{EVENT_ICONS[ev.type] ?? '📡'}</span>
            <div className="flex-1 min-w-0">
              <p className="text-gray-300 truncate">
                {ev.title ?? ev.type.replace(/_/g, ' ')}
                {ev.platform && <span className="ml-1 text-blue-400">[{ev.platform}]</span>}
                {ev.new_articles !== undefined && <span className="ml-1 text-green-400">+{ev.new_articles} bài</span>}
              </p>
              <p className="text-gray-600 text-xs">{new Date(ev.timestamp).toLocaleTimeString('vi-VN')}</p>
            </div>
            {ev.success !== undefined && (
              <span className={ev.success ? 'text-green-400 text-xs' : 'text-red-400 text-xs'}>
                {ev.success ? '✓' : '✗'}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
