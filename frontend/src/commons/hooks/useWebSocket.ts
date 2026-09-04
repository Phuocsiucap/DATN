import { useEffect, useRef } from 'react'
import { useAppDispatch } from './useAppDispatch'
import { addEvent } from '@/commons/store/slices/eventsSlice'
import { subscribeWebSocket } from './webSocketClient'

type DashboardEvent = {
  type: string
  timestamp: string
  title?: string
  link?: string
  platform?: string
  success?: boolean
  new_articles?: number
}

function isDashboardEvent(event: Record<string, unknown>): event is DashboardEvent {
  return typeof event.type === 'string' && typeof event.timestamp === 'string'
}

export function useWebSocket(enabled: boolean) {
  const dispatch = useAppDispatch()
  const unsubscribeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!enabled) {
      unsubscribeRef.current?.()
      unsubscribeRef.current = null
      return
    }

    unsubscribeRef.current = subscribeWebSocket((event) => {
      if (event.type === 'ping') return
      if (event.channel) return
      if (!isDashboardEvent(event)) return

      dispatch(addEvent(event))
    })

    return () => {
      unsubscribeRef.current?.()
      unsubscribeRef.current = null
    }
  }, [dispatch, enabled])
}
