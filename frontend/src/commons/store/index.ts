import { configureStore } from '@reduxjs/toolkit'
import articlesReducer from './slices/articlesSlice'
import statsReducer from './slices/statsSlice'
import eventsReducer from './slices/eventsSlice'

export const store = configureStore({
  reducer: {
    articles: articlesReducer,
    stats: statsReducer,
    events: eventsReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
