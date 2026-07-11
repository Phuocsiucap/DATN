import { useEffect, useRef } from 'react'
import { useAppDispatch } from './useAppDispatch'
import { addEvent } from '../store/slices/eventsSlice'
import { prependArticle, updateArticleStatus } from '../store/slices/articlesSlice'
import { fetchStats } from '../store/slices/statsSlice'

export function useWebSocket() {
  const dispatch = useAppDispatch()
  const wsRef = useRef<WebSocket | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(`ws://${window.location.host}/ws`)
      wsRef.current = ws

      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data)
          if (event.type === 'ping') return

          dispatch(addEvent(event))

          if (event.type === 'article_crawled') {
            dispatch(prependArticle({
              title: event.title,
              link: event.link,
              status: 'crawled',
              crawled_at: event.timestamp,
            }))
            dispatch(fetchStats())
          }

          if (event.type === 'article_published') {
            dispatch(updateArticleStatus({ link: event.link, status: 'published' }))
            dispatch(fetchStats())
          }
        } catch { /* ignore parse errors */ }
      }

      ws.onclose = () => {
        retryRef.current = setTimeout(connect, 3000)
      }
    }

    connect()

    return () => {
      wsRef.current?.close()
      if (retryRef.current) clearTimeout(retryRef.current)
    }
  }, [dispatch])
}
