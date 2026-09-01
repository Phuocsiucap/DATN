import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'

export type ApiPagination = {
  page: number
  limit: number
  total: number
  totalPages: number
}

export type ApiErrorDetail = {
  field?: string | null
  message: string
}

export type ApiResponse<T> = {
  success: boolean
  message: string
  data: T | null
  code?: string
  pagination?: ApiPagination
  errors?: ApiErrorDetail[]
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  timeout: 12000,
  withCredentials: true,
})

export const isSocialContentApiBase = () => String(api.defaults.baseURL || '').includes('/api/v1')

type RetryableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean
}

let refreshPromise: Promise<void> | null = null

const isApiResponse = (value: unknown): value is ApiResponse<unknown> => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ApiResponse<unknown>>
  return typeof candidate.success === 'boolean' && typeof candidate.message === 'string' && 'data' in candidate
}

export const setAccessToken = (token: string | null) => {
  if (token) {
    localStorage.setItem('access_token', token)
  } else {
    localStorage.removeItem('access_token')
  }
}

const refreshAccessToken = async () => {
  const { data } = await api.post('/auth/refresh')
  setAccessToken(data.access_token)
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => {
    // Keep existing feature APIs focused on domain data while the wire format
    // remains the shared ApiResponse envelope.
    if (isApiResponse(response.data)) {
      response.data = response.data.data
    }
    return response
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined
    const status = error.response?.status
    const requestUrl = originalRequest?.url ?? ''
    const isAuthRefreshRequest = requestUrl.includes('/auth/refresh')
    const isLoginRequest = requestUrl.includes('/auth/login')

    if (error.response && isApiResponse(error.response.data)) {
      // Transitional alias for existing UI error presenters. New code should
      // consume message/code/errors from ApiResponse directly.
      error.response.data = { ...error.response.data, detail: error.response.data.message }
    }

    if (!originalRequest || status !== 401 || originalRequest._retry || isAuthRefreshRequest || isLoginRequest) {
      return Promise.reject(error)
    }

    originalRequest._retry = true

    try {
      refreshPromise ??= refreshAccessToken().finally(() => {
        refreshPromise = null
      })

      await refreshPromise
      return api(originalRequest)
    } catch (refreshError) {
      setAccessToken(null)
      window.dispatchEvent(new Event('auth:expired'))
      return Promise.reject(refreshError)
    }
  },
)
