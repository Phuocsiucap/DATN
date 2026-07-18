import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'

export interface Event {
  id: string
  type: string
  timestamp: string
  title?: string
  link?: string
  platform?: string
  success?: boolean
  new_articles?: number
}

interface EventsState {
  items: Event[]
  maxItems: number
}

const initialState: EventsState = { items: [], maxItems: 50 }

const eventsSlice = createSlice({
  name: 'events',
  initialState,
  reducers: {
    addEvent(state, action: PayloadAction<Omit<Event, 'id'>>) {
      const event: Event = {
        id: `${Date.now()}-${Math.random()}`,
        ...action.payload,
      }
      state.items.unshift(event)
      if (state.items.length > state.maxItems) {
        state.items = state.items.slice(0, state.maxItems)
      }
    },
    clearEvents(state) {
      state.items = []
    },
  },
})

export const { addEvent, clearEvents } = eventsSlice.actions
export default eventsSlice.reducer
