import { api, type ApiResponse } from './client'

export type ElevenLabsVoiceItem = {
  id: string
  name: string
  gender: 'male' | 'female'
  category: string
  preview_url: string
  description: string
}

export type TikTokProductImage = {
  url: string
  type?: string
  width?: number
  height?: number
}

export type TikTokProduct = {
  external_id: string
  title: string
  price: string
  original_price?: string
  sales_count?: string
  description?: string
  bullets?: string[]
  tags?: string[]
  url?: string
  video_url?: string
  image_Gallery: TikTokProductImage[]
}

export type TikTokScriptScene = {
  scene_id: number
  scene_type: string
  text: string
  visual_prompt: string
  suggested_tag?: string
  image_url?: string
  timing?: { duration?: number }
}

export type TikTokScriptPack = {
  product_id: string
  product_title: string
  selected_variant: number
  variant_name: string
  hook_technique: string
  full_script: string
  caption: string
  scenes: TikTokScriptScene[]
}

export type TikTokStudioJob = {
  id: string
  product_id: string
  product_title: string
  variant_index: number
  variant_name?: string
  voice_id?: string
  visual_mode?: string
  video_url?: string
  audio_url?: string
  script_url?: string
  caption_url?: string
  status: string
  created_at: string
}

export type TikTokStudioBootstrapData = {
  ok: boolean
  products: TikTokProduct[]
  jobs: TikTokStudioJob[]
  voices: ElevenLabsVoiceItem[]
  default_voice_id: string
  keys_status: {
    has_gemini: boolean
    has_elevenlabs: boolean
    has_openai: boolean
    gemini_masked?: string
    elevenlabs_masked?: string
  }
}

export const getTikTokStudioBootstrapApi = async (): Promise<TikTokStudioBootstrapData> => {
  const res = await api.get<ApiResponse<TikTokStudioBootstrapData>>('/tiktok-studio/bootstrap')
  return (res.data?.data || res.data) as TikTokStudioBootstrapData
}

export const prepareTikTokProductApi = async (productId: string, variantIndex = 1) => {
  const res = await api.post<ApiResponse<{ product: TikTokProduct; script_pack: TikTokScriptPack }>>(
    '/tiktok-studio/prepare-product',
    { product_id: productId, variant_index: variantIndex },
  )
  return res.data?.data || (res.data as unknown as { product: TikTokProduct; script_pack: TikTokScriptPack })
}

export const crawlAndCreateTikTokProductApi = async (query: string, voiceId?: string) => {
  const res = await api.post<
    ApiResponse<{
      ok: boolean
      product: TikTokProduct
      script_pack: TikTokScriptPack
      voices: ElevenLabsVoiceItem[]
      default_voice_id: string
    }>
  >('/tiktok-studio/crawl-and-create', { query, voice_id: voiceId }, { timeout: 120000 })
  return (
    res.data?.data ||
    (res.data as unknown as {
      ok: boolean
      product: TikTokProduct
      script_pack: TikTokScriptPack
      voices: ElevenLabsVoiceItem[]
      default_voice_id: string
    })
  )
}

export const renderTikTokVariantApi = async (payload: {
  product_id: string
  variant_index: number
  visual_mode: string
  voice_id?: string
  scenes?: TikTokScriptScene[]
  caption?: string
}) => {
  const res = await api.post<ApiResponse<any>>(
    '/tiktok-studio/render-mp4',
    payload,
    { timeout: 180000 },
  )
  const d = res.data?.data || (res.data as any)
  return (d?.job || d) as TikTokStudioJob
}

export const renderTikTokBatch5Api = async (payload: {
  product_id: string
  visual_mode?: string
  voice_id?: string
}) => {
  const res = await api.post<ApiResponse<{ ok: boolean; count: number; jobs: TikTokStudioJob[] }>>(
    '/tiktok-studio/render-batch-5',
    payload,
    { timeout: 300000 },
  )
  return res.data?.data || (res.data as unknown as { ok: boolean; count: number; jobs: TikTokStudioJob[] })
}

export const saveTikTokStudioKeysApi = async (keys: {
  gemini_api_key?: string
  elevenlabs_api_key?: string
  openai_api_key?: string
}) => {
  const res = await api.post<ApiResponse<{ ok: boolean; message: string }>>('/tiktok-studio/save-keys', keys)
  return res.data?.data || (res.data as unknown as { ok: boolean; message: string })
}
