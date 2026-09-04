import type { AxiosRequestConfig, AxiosResponse, RawAxiosHeaders } from 'axios'
import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query'
import { api } from '../apis/client.ts'
import { API_CACHE_TAG_TYPES, getTagsForGet } from './apiCachePolicy.ts'

export type ApiGetQuery = {
  url: string
  config?: Pick<AxiosRequestConfig, 'params' | 'timeout' | 'responseType' | 'withCredentials' | 'headers'>
}

export type CachedAxiosResponse = Pick<AxiosResponse, 'data' | 'status' | 'statusText'> & {
  headers: RawAxiosHeaders
}

export type CachedAxiosError = {
  message: string
  code?: string
  response?: {
    data?: unknown
    status?: number
    statusText?: string
  }
}

const serializeError = (error: unknown): CachedAxiosError => {
  const candidate = error as {
    message?: string
    code?: string
    response?: { data?: unknown; status?: number; statusText?: string }
  }
  return {
    message: candidate?.message || 'Không thể tải dữ liệu',
    code: candidate?.code,
    response: candidate?.response ? {
      data: candidate.response.data,
      status: candidate.response.status,
      statusText: candidate.response.statusText,
    } : undefined,
  }
}

export const apiCache = createApi({
  reducerPath: 'apiCache',
  baseQuery: fakeBaseQuery<CachedAxiosError>(),
  tagTypes: API_CACHE_TAG_TYPES,
  keepUnusedDataFor: 15,
  invalidationBehavior: 'immediately',
  endpoints: (builder) => ({
    get: builder.query<CachedAxiosResponse, ApiGetQuery>({
      async queryFn({ url, config }, { signal }) {
        try {
          const response = await api.request({
            ...config,
            method: 'get',
            url,
            signal,
          })
          const headers = typeof response.headers?.toJSON === 'function'
            ? response.headers.toJSON()
            : { ...response.headers } as RawAxiosHeaders
          return {
            data: {
              data: response.data,
              status: response.status,
              statusText: response.statusText,
              headers,
            },
          }
        } catch (error) {
          return { error: serializeError(error) }
        }
      },
      providesTags: (_result, _error, query) => getTagsForGet(query.url),
    }),
  }),
})
