import { configureStore } from '@reduxjs/toolkit'
import {
  AxiosHeaders,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
  type RawAxiosHeaders,
} from 'axios'
import { registerApiCacheHandlers } from '@/commons/apis/client'
import statsReducer from './slices/statsSlice'
import eventsReducer from './slices/eventsSlice'
import { apiCache, type ApiGetQuery } from './apiCache'
import { getInvalidationForMutation, isVolatileGetPath } from './apiCachePolicy'

export const store = configureStore({
  reducer: {
    stats: statsReducer,
    events: eventsReducer,
    [apiCache.reducerPath]: apiCache.reducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(apiCache.middleware),
})

const queryConfig = (config?: AxiosRequestConfig): ApiGetQuery['config'] => ({
  params: config?.params,
  timeout: config?.timeout,
  responseType: config?.responseType,
  withCredentials: config?.withCredentials,
  headers: config?.headers,
})

const cloneCachedData = (data: unknown) => {
  if (typeof structuredClone !== 'function') return data
  try {
    return structuredClone(data)
  } catch {
    return data
  }
}

registerApiCacheHandlers({
  async get(url, config) {
    const query = apiCache.endpoints.get.initiate(
      { url, config: queryConfig(config) },
      {
        subscribe: false,
        forceRefetch: config?.cache === false || config?.forceRefresh === true || isVolatileGetPath(url),
      },
    )
    const cached = await store.dispatch(query).unwrap()
    return {
      // RTK Query freezes its Redux state in development. Return a detached
      // value so existing feature code keeps normal Axios mutation semantics.
      data: cloneCachedData(cached.data),
      status: cached.status,
      statusText: cached.statusText,
      headers: AxiosHeaders.from(cached.headers),
      config: {
        ...config,
        url,
        method: 'get',
        headers: AxiosHeaders.from(config?.headers as RawAxiosHeaders | AxiosHeaders | undefined),
      } as InternalAxiosRequestConfig,
    } as AxiosResponse
  },
  invalidateMutation(url) {
    const invalidation = getInvalidationForMutation(url)
    if (invalidation === 'all') {
      store.dispatch(apiCache.util.resetApiState())
      return
    }
    store.dispatch(apiCache.util.invalidateTags(invalidation))
  },
  reset() {
    store.dispatch(apiCache.util.resetApiState())
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
