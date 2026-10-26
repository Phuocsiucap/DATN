import { api } from './client'

// ────────────────────────────────────────────────────────────────────────────
// TypeScript types mirroring backend schemas
// ────────────────────────────────────────────────────────────────────────────

export type TikTokShopOAuthStartResponse = {
  session_id: string
  auth_url: string
  state: string
  expires_in: number
}

export type TikTokShopOAuthPollResponse = {
  session_active: boolean
  authenticated: boolean
  status?: string | null
  auth_url?: string | null
  shop_info?: Record<string, unknown> | null
  token_data?: Record<string, unknown> | null
  credential?: TikTokShopCredential
}

export type TikTokShopCredential = {
  id: string
  user_id?: string
  shop_id: string
  shop_name?: string | null
  shop_cipher?: string | null
  access_token?: string
  refresh_token?: string | null
  token_expires_at?: string | null
  refresh_expires_at?: string | null
  authorized_scopes?: string[] | null
  region?: string | null
  metadata?: Record<string, unknown> | null
  status: string
  created_at: string
  updated_at?: string
}

export type TikTokShopProduct = {
  product_id: string
  product_name: string
  image_url?: string | null
  price?: number | null
  currency?: string | null
  commission_rate?: number | null // int in hundredths of % (e.g. 3000 = 30.00%)
  shop_name?: string | null
  detail_link?: string | null
}

export type TikTokShopProductSearchRequest = {
  query: string
  page_number?: number
  page_size?: number
}

export type TikTokShopProductSearchResponse = {
  products: TikTokShopProduct[]
  total: number
  has_more: boolean
  page_number?: number
}

export type TikTokShopCreatorProfile = {
  creator_user_id?: string
  username?: string
  register_region?: string
  selection_region?: string
  user_type?: string
  permissions?: string[]
  avatar?: Record<string, unknown> | null
}

export type TikTokShopCollaborationStatus = {
  product_id: string
  status: string
  commission_rate?: number | null
  approved_at?: string | null
}

export type TikTokShopTargetCollaboration = {
  id: string
  name: string
  status: string
  products: Record<string, unknown>[]
}

export type TikTokShopGenerateLinkRequest = {
  product_id: string
  promotion_link_type?: 'ShortLink' | 'NormalLink' | string
}

export type TikTokShopGenerateLinkResponse = {
  product_id: string
  affiliate_link: string
  short_link?: string | null
  qr_code_url?: string | null
}

export type TikTokShopOrder = {
  order_id: string
  product_name?: string | null
  product_id?: string | null
  order_amount?: number | null
  commission_amount?: number | null
  order_status?: string | null
  create_time?: string | null
}

export type TikTokShopOrdersResponse = {
  orders: TikTokShopOrder[]
  total: number
  has_more: boolean
  page_number: number
  page_size?: number
}

// ────────────────────────────────────────────────────────────────────────────
// API functions
// ────────────────────────────────────────────────────────────────────────────

export const startTikTokShopOAuthApi = async (): Promise<TikTokShopOAuthStartResponse> => {
  const { data } = await api.post('/tiktok-shop/oauth/start')
  return data
}

export const pollTikTokShopOAuthStatusApi = async (sessionId: string): Promise<TikTokShopOAuthPollResponse> => {
  const { data } = await api.get('/tiktok-shop/oauth/status', {
    params: { session_id: sessionId },
  })
  return data
}

export const cancelTikTokShopOAuthApi = async (sessionId: string): Promise<void> => {
  await api.post(`/tiktok-shop/oauth/${encodeURIComponent(sessionId)}/cancel`)
}

export const fetchTikTokShopCredentialsApi = async (): Promise<TikTokShopCredential[]> => {
  const { data } = await api.get('/tiktok-shop/credentials')
  return data
}

export const disconnectTikTokShopCredentialApi = async (credentialId: string): Promise<void> => {
  await api.delete(`/tiktok-shop/credentials/${encodeURIComponent(credentialId)}`)
}

export const getCreatorProfileApi = async (
  credentialId: string
): Promise<TikTokShopCreatorProfile> => {
  const { data } = await api.get('/tiktok-shop/profile', {
    params: { credential_id: credentialId },
  })
  return data
}

export const getShowcaseProductsApi = async (
  credentialId: string,
  pageSize = 20,
  origin = 'SHOWCASE'
): Promise<TikTokShopProductSearchResponse> => {
  const { data } = await api.get('/tiktok-shop/showcase/products', {
    params: { credential_id: credentialId, page_size: pageSize, origin },
  })
  return data
}

export const searchTikTokShopProductsApi = async (
  credentialId: string,
  request: TikTokShopProductSearchRequest
): Promise<TikTokShopProductSearchResponse> => {
  const { data } = await api.post('/tiktok-shop/products/search', request, {
    params: { credential_id: credentialId },
  })
  return data
}

export const applyCollaborationApi = async (
  credentialId: string,
  productId: string
): Promise<{ success: boolean; errors?: Record<string, unknown>[]; message: string }> => {
  const { data } = await api.post(
    '/tiktok-shop/collaborations/apply',
    { product_id: productId },
    { params: { credential_id: credentialId } }
  )
  return data
}

export const searchTargetCollaborationsApi = async (
  credentialId: string,
  productIds: string[]
): Promise<{ target_collaborations: TikTokShopTargetCollaboration[] }> => {
  const { data } = await api.post(
    '/tiktok-shop/collaborations/target',
    { product_ids: productIds },
    { params: { credential_id: credentialId } }
  )
  return data
}

export const generateAffiliateLinkApi = async (
  credentialId: string,
  request: TikTokShopGenerateLinkRequest
): Promise<TikTokShopGenerateLinkResponse> => {
  const { data } = await api.post('/tiktok-shop/links', request, {
    params: { credential_id: credentialId },
  })
  return data
}

export const fetchOrdersApi = async (
  credentialId: string,
  startTime: string,
  endTime: string,
  pageNumber: number = 1,
  pageSize: number = 20
): Promise<TikTokShopOrdersResponse> => {
  const { data } = await api.get('/tiktok-shop/orders', {
    params: {
      credential_id: credentialId,
      start_time: startTime,
      end_time: endTime,
      page_number: pageNumber,
      page_size: pageSize,
    },
  })
  return data
}
