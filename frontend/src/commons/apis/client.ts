import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api',
  withCredentials: true,
})

type RetryableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean
}

let refreshPromise: Promise<void> | null = null

const refreshAccessToken = async () => {
  await api.post('/auth/refresh')
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined
    const status = error.response?.status
    const requestUrl = originalRequest?.url ?? ''
    const isAuthRefreshRequest = requestUrl.includes('/auth/refresh')
    const isLoginRequest = requestUrl.includes('/auth/login')

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
      window.dispatchEvent(new Event('auth:expired'))
      return Promise.reject(refreshError)
    }
  },
)
