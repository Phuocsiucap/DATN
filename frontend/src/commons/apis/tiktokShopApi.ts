import { api } from './client'

// ────────────────────────────────────────────────────────────────────────────
// TypeScript types mirroring backend schemas
// ────────────────────────────────────────────────────────────────────────────

export type TikTokShopOAuthStartResponse = {
  session_id: string
  auth_url: string
}

export type TikTokShopOAuthPollResponse = {
  authenticated: boolean
  status?: string
  credential?: TikTokShopCredential
}

export type TikTokShopCredential = {
  id: string
  user_id: string
  shop_id: string
  shop_name?: string | null
  shop_cipher?: string | null
  access_token: string
  refresh_token?: string | null
  token_expires_at?: string | null
  refresh_expires_at?: string | null
  authorized_scopes?: string[] | null
  region?: string | null
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type TikTokShopProduct = {
  product_id: string
  product_name: string
  cover_image_url?: string | null
  sale_price?: number | null
  currency?: string | null
  commission_rate?: number | null
  open_status?: string | null
}

export type TikTokShopProductSearchRequest = {
  keyword?: string | null
  page?: number
  page_size?: number
}

export type TikTokShopProductSearchResponse = {
  products: TikTokShopProduct[]
  total: number
  has_more: boolean
}

export type TikTokShopCollaborationStatus = {
  product_id: string
  status: string
  apply_time?: string | null
}

export type TikTokShopGenerateLinkRequest = {
  product_id: string
  link_type: 'ShortLink' | 'NormalLink'
}

export type TikTokShopGenerateLinkResponse = {
  link: string
  product_id: string
  link_type: string
}

export type TikTokShopOrder = {
  order_id: string
  product_name?: string | null
  product_id?: string | null
  order_amount?: number | null
  commission_amount?: number | null
  order_status?: string | null
  create_time?: string | null
  update_time?: string | null
}

export type TikTokShopOrdersResponse = {
  orders: TikTokShopOrder[]
  total: number
  page_number: number
  page_size: number
}

// ────────────────────────────────────────────────────────────────────────────
// API functions
// ────────────────────────────────────────────────────────────────────────────

export const startTikTokShopOAuthApi = async (): Promise<TikTokShopOAuthStartResponse> => {
  const { data } = await api.post('/tiktok-shop/oauth/start')
  return data
}

export const pollTikTokShopOAuthStatusApi = async (sessionId: string): Promise<TikTokShopOAuthPollResponse> => {
  const { data } = await api.get(`/tiktok-shop/oauth/status?session_id=${encodeURIComponent(sessionId)}`)
  return data
}

export const fetchTikTokShopCredentialsApi = async (): Promise<TikTokShopCredential[]> => {
  const { data } = await api.get('/tiktok-shop/credentials')
  return data
}

export const disconnectTikTokShopCredentialApi = async (credentialId: string): Promise<void> => {
  await api.delete(`/tiktok-shop/credentials/${encodeURIComponent(credentialId)}`)
}

export const searchTikTokShopProductsApi = async (
  credentialId: string,
  request: TikTokShopProductSearchRequest
): Promise<TikTokShopProductSearchResponse> => {
  const { data } = await api.post(`/tiktok-shop/credentials/${encodeURIComponent(credentialId)}/products/search`, request)
  return data
}

export const applyCollaborationApi = async (credentialId: string, productId: string): Promise<void> => {
  await api.post(`/tiktok-shop/credentials/${encodeURIComponent(credentialId)}/collaborations/apply`, { product_id: productId })
}

export const queryCollaborationStatusApi = async (
  credentialId: string,
  productIds: string[]
): Promise<TikTokShopCollaborationStatus[]> => {
  const { data } = await api.post(`/tiktok-shop/credentials/${encodeURIComponent(credentialId)}/collaborations/status`, { product_ids: productIds })
  return data
}

export const generateAffiliateLinkApi = async (
  credentialId: string,
  request: TikTokShopGenerateLinkRequest
): Promise<TikTokShopGenerateLinkResponse> => {
  const { data } = await api.post(`/tiktok-shop/credentials/${encodeURIComponent(credentialId)}/links`, request)
  return data
}

export const fetchOrdersApi = async (
  credentialId: string,
  startTime: string,
  endTime: string,
  pageNumber: number = 1,
  pageSize: number = 20
): Promise<TikTokShopOrdersResponse> => {
  const { data } = await api.get(`/tiktok-shop/credentials/${encodeURIComponent(credentialId)}/orders`, {
    params: {
      start_time: startTime,
      end_time: endTime,
      page_number: pageNumber,
      page_size: pageSize,
    },
  })
  return data
}
