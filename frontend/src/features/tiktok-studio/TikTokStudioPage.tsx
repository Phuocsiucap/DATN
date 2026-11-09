import React, { useEffect, useRef, useState } from 'react'
import {
  Sparkles,
  Play,
  Pause,
  Download,
  Film,
  Layers,
  Volume2,
  Key,
  ExternalLink,
  RefreshCw,
  Search,
  CheckCircle2,
  Copy,
  Clock,
  Sliders,
  AlertCircle,
  FileText,
  ShoppingBag,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  getTikTokStudioBootstrapApi,
  prepareTikTokProductApi,
  crawlAndCreateTikTokProductApi,
  renderTikTokVariantApi,
  renderTikTokBatch5Api,
  saveTikTokStudioKeysApi,
  type TikTokProduct,
  type TikTokScriptPack,
  type TikTokScriptScene,
  type TikTokStudioJob,
  type ElevenLabsVoiceItem,
} from '@/commons/apis/tiktokStudioApi'

const VARIANT_NAMES = [
  'Hook Cảnh Báo (Contrarian)',
  'Mở Hộp Chi Tiết (Unboxing)',
  'Thử Thách / Trải Nghiệm (Challenge)',
  'Chất Liệu & Độ Bền (Features)',
  'Chốt Deal / FOMO (Direct CTA)',
]

export default function TikTokStudioPage() {
  // State chính
  const [loading, setLoading] = useState(true)
  const [products, setProducts] = useState<TikTokProduct[]>([])
  const [jobs, setJobs] = useState<TikTokStudioJob[]>([])
  const [voices, setVoices] = useState<ElevenLabsVoiceItem[]>([])
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('21m00Tcm4TlvDq8ikWAM')
  const [voiceFilter, setVoiceFilter] = useState<'all' | 'male' | 'female'>('all')

  // Audio Demo State
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null)
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null)

  // Sản phẩm đang chọn & Kịch bản
  const [selectedProductId, setSelectedProductId] = useState<string>('')
  const [selectedVariant, setSelectedVariant] = useState<number>(1)
  const [currentScriptPack, setCurrentScriptPack] = useState<TikTokScriptPack | null>(null)
  const [visualMode, setVisualMode] = useState<string>('real_video')

  // Crawl input
  const [crawlQuery, setCrawlQuery] = useState('')
  const [crawling, setCrawling] = useState(false)

  // Render video state
  const [rendering, setRendering] = useState(false)
  const [renderingBatch, setRenderingBatch] = useState(false)
  const [activeJob, setActiveJob] = useState<TikTokStudioJob | null>(null)

  // API Keys modal
  const [showKeysModal, setShowKeysModal] = useState(false)
  const [keysStatus, setKeysStatus] = useState<any>({})
  const [geminiKeyInput, setGeminiKeyInput] = useState('')
  const [elevenlabsKeyInput, setElevenlabsKeyInput] = useState('')
  const [savingKeys, setSavingKeys] = useState(false)

  // Load bootstrap
  const loadBootstrap = async () => {
    try {
      setLoading(true)
      const data = await getTikTokStudioBootstrapApi()
      if (data) {
        setProducts(data.products || [])
        setJobs(data.jobs || [])
        setVoices(data.voices || [])
        setKeysStatus(data.keys_status || {})
        if (data.default_voice_id) {
          setSelectedVoiceId(data.default_voice_id)
        }

        // Tự chọn sản phẩm đầu tiên nếu có
        if (data.products && data.products.length > 0 && !selectedProductId) {
          const first = data.products[0]
          setSelectedProductId(first.external_id)
          loadProductVariant(first.external_id, 1)
        }

        // Chọn job mới nhất nếu có
        if (data.jobs && data.jobs.length > 0) {
          setActiveJob(data.jobs[0])
        }
      }
    } catch (err: any) {
      toast.error('Không thể nạp dữ liệu TikTok Studio: ' + (err?.message || 'Lỗi server'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBootstrap()
  }, [])

  // Nạp kịch bản sản phẩm theo variant
  const loadProductVariant = async (productId: string, variantIdx: number) => {
    try {
      const res = await prepareTikTokProductApi(productId, variantIdx)
      if (res && res.script_pack) {
        setCurrentScriptPack(res.script_pack)
      }
    } catch (err: any) {
      toast.error('Lỗi khi tải kịch bản biến thể: ' + (err?.message || ''))
    }
  }

  // Chuyển variant tab
  const handleVariantChange = (vIdx: number) => {
    setSelectedVariant(vIdx)
    if (selectedProductId) {
      loadProductVariant(selectedProductId, vIdx)
    }
  }

  // Chuyển sản phẩm
  const handleSelectProduct = (productId: string) => {
    setSelectedProductId(productId)
    loadProductVariant(productId, selectedVariant)
  }

  // Crawl sản phẩm mới từ URL hoặc Tên
  const handleCrawl = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!crawlQuery.trim()) {
      toast.error('Vui lòng nhập link sản phẩm Shopee/TikTok Shop hoặc từ khóa')
      return
    }

    try {
      setCrawling(true)
      toast.info('Đang phân tích & thu thập dữ liệu sản phẩm...')
      const res = await crawlAndCreateTikTokProductApi(crawlQuery, selectedVoiceId)
      if (res && res.product) {
        toast.success(`Đã chuẩn bị xong sản phẩm: "${res.product.title.slice(0, 35)}..."`)
        setProducts((prev) => [res.product, ...prev.filter((p) => p.external_id !== res.product.external_id)])
        setSelectedProductId(res.product.external_id)
        if (res.script_pack) {
          setCurrentScriptPack(res.script_pack)
        }
        setCrawlQuery('')
      }
    } catch (err: any) {
      toast.error('Lỗi thu thập sản phẩm: ' + (err?.response?.data?.detail || err?.message || 'Không thể crawl'))
    } finally {
      setCrawling(false)
    }
  }

  // Phát / Dừng Audio Demo của giọng
  const togglePlayVoiceDemo = (voice: ElevenLabsVoiceItem) => {
    if (playingVoiceId === voice.id) {
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause()
      }
      setPlayingVoiceId(null)
    } else {
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause()
      }
      const audio = new Audio(voice.preview_url)
      audioPreviewRef.current = audio
      setPlayingVoiceId(voice.id)
      audio.play().catch(() => {
        toast.error('Không thể phát file nghe thử của giọng này.')
        setPlayingVoiceId(null)
      })
      audio.onended = () => {
        setPlayingVoiceId(null)
      }
    }
  }

  // Sửa thoại scene
  const handleSceneTextChange = (sceneIndex: number, newText: string) => {
    if (!currentScriptPack) return
    const updatedScenes = [...currentScriptPack.scenes]
    updatedScenes[sceneIndex] = { ...updatedScenes[sceneIndex], text: newText }
    setCurrentScriptPack({ ...currentScriptPack, scenes: updatedScenes })
  }

  // Render 1 Video
  const handleRenderSingleVideo = async () => {
    if (!selectedProductId) {
      toast.error('Vui lòng chọn sản phẩm trước')
      return
    }
    try {
      setRendering(true)
      toast.info(`Đang render video biến thể #${selectedVariant} (kèm voice ElevenLabs)...`)
      const job = await renderTikTokVariantApi({
        product_id: selectedProductId,
        variant_index: selectedVariant,
        visual_mode: visualMode,
        voice_id: selectedVoiceId,
        scenes: currentScriptPack?.scenes || [],
        caption: currentScriptPack?.caption || '',
      })
      if (job) {
        toast.success('Đã tạo xong Video MP4 thành công!')
        setActiveJob(job)
        setJobs((prev) => [job, ...prev.filter((j) => j.id !== job.id)])
      }
    } catch (err: any) {
      toast.error('Lỗi khi render video: ' + (err?.response?.data?.detail || err?.message || 'Lỗi xử lý FFmpeg'))
    } finally {
      setRendering(false)
    }
  }

  // Render Batch 5 Video
  const handleRenderBatch5 = async () => {
    if (!selectedProductId) {
      toast.error('Vui lòng chọn sản phẩm trước')
      return
    }
    try {
      setRenderingBatch(true)
      toast.info('Đang render hàng loạt cả 5 biến thể A/B testing, vui lòng đợi giây lát...')
      const res = await renderTikTokBatch5Api({
        product_id: selectedProductId,
        visual_mode: visualMode,
        voice_id: selectedVoiceId,
      })
      if (res && res.jobs) {
        toast.success(`Đã render thành công ${res.jobs.length} video biến thể!`)
        setJobs((prev) => [...res.jobs, ...prev])
        if (res.jobs.length > 0) {
          setActiveJob(res.jobs[0])
        }
      }
    } catch (err: any) {
      toast.error('Lỗi render batch: ' + (err?.response?.data?.detail || err?.message || 'Lỗi server'))
    } finally {
      setRenderingBatch(false)
    }
  }

  // Lưu API Keys
  const handleSaveKeys = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setSavingKeys(true)
      await saveTikTokStudioKeysApi({
        gemini_api_key: geminiKeyInput.trim() || undefined,
        elevenlabs_api_key: elevenlabsKeyInput.trim() || undefined,
      })
      toast.success('Đã lưu cấu hình API Keys thành công!')
      setShowKeysModal(false)
      loadBootstrap()
    } catch (err: any) {
      toast.error('Không thể lưu keys: ' + (err?.message || ''))
    } finally {
      setSavingKeys(false)
    }
  }

  const selectedProduct = products.find((p) => p.external_id === selectedProductId)
  const filteredVoices = voices.filter((v) => (voiceFilter === 'all' ? true : v.gender === voiceFilter))

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center h-full text-slate-400 gap-3">
        <RefreshCw className="w-5 h-5 animate-spin text-indigo-500" />
        <span>Đang nạp TikTok Video AI Studio...</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 h-full min-h-0 overflow-y-auto bg-slate-950 text-slate-100 p-4 md:p-6">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-tr from-rose-500 via-pink-600 to-indigo-600 shadow-lg shadow-pink-500/20">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white">TikTok Video AI Studio</h1>
              <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-pink-500/20 text-pink-300 border border-pink-500/30">
                16 Giọng ElevenLabs
              </span>
              <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Auto 5 Biến thể
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Tạo video affiliate chuyển đổi cao từ link Shopee/TikTok Shop hoặc tên sản phẩm với kịch bản A/B testing
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowKeysModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            <Key className="w-3.5 h-3.5 text-amber-400" />
            <span>API Keys</span>
            {(keysStatus.has_gemini || keysStatus.has_elevenlabs) && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 ml-1" />
            )}
          </button>
          <button
            onClick={loadBootstrap}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
            title="Làm mới dữ liệu"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Grid Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mt-5 flex-1 min-h-0">
        {/* CỘT 1: Sản phẩm & Thu thập (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          {/* Box Crawl Link / Nhập sản phẩm */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2 mb-3">
              <Search className="w-4 h-4 text-pink-400" />
              <span>Dán Link hoặc Tên Sản Phẩm</span>
            </h3>
            <form onSubmit={handleCrawl} className="flex flex-col gap-2.5">
              <div className="relative">
                <input
                  type="text"
                  value={crawlQuery}
                  onChange={(e) => setCrawlQuery(e.target.value)}
                  placeholder="Dán link Shopee / TikTok Shop hoặc gõ tên SP..."
                  className="w-full pl-3 pr-9 py-2.5 text-xs rounded-xl bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-pink-500 transition"
                />
              </div>
              <button
                type="submit"
                disabled={crawling}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-semibold rounded-xl bg-gradient-to-r from-pink-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 text-white shadow-md shadow-pink-600/20 disabled:opacity-50 transition"
              >
                {crawling ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Đang thu thập dữ liệu & viết kịch bản...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Thu thập & Sinh kịch bản AI</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Danh sách sản phẩm sẵn có */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex-1 flex flex-col min-h-[300px]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-indigo-400" />
                <span>Kho Sản Phẩm ({products.length})</span>
              </h3>
            </div>

            <div className="flex flex-col gap-2 overflow-y-auto max-h-[360px] pr-1">
              {products.map((prod) => {
                const isSelected = prod.external_id === selectedProductId
                const thumb = prod.image_Gallery?.[0]?.url || ''
                return (
                  <div
                    key={prod.external_id}
                    onClick={() => handleSelectProduct(prod.external_id)}
                    className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer border transition ${
                      isSelected
                        ? 'bg-pink-950/30 border-pink-500/60 shadow-sm shadow-pink-500/10'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="w-12 h-12 rounded-lg bg-slate-800 overflow-hidden shrink-0 flex items-center justify-center border border-slate-700">
                      {thumb ? (
                        <img src={thumb} alt={prod.title} className="w-full h-full object-cover" />
                      ) : (
                        <ShoppingBag className="w-5 h-5 text-slate-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-semibold text-slate-200 line-clamp-1">{prod.title}</h4>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs font-bold text-pink-400">{prod.price || 'Liên hệ'}</span>
                        {prod.sales_count && (
                          <span className="text-[10px] text-slate-500">Đã bán {prod.sales_count}</span>
                        )}
                      </div>
                    </div>
                    {isSelected && <CheckCircle2 className="w-4 h-4 text-pink-400 shrink-0" />}
                  </div>
                )
              })}
            </div>

            {/* Chi tiết sản phẩm đang chọn */}
            {selectedProduct && (
              <div className="mt-4 pt-3 border-t border-slate-800 text-xs">
                <div className="text-slate-400 line-clamp-2">{selectedProduct.description}</div>
                {selectedProduct.image_Gallery && selectedProduct.image_Gallery.length > 0 && (
                  <div className="flex gap-1.5 mt-2 overflow-x-auto pb-1">
                    {selectedProduct.image_Gallery.map((img, idx) => (
                      <img
                        key={idx}
                        src={img.url}
                        alt="thumb"
                        className="w-10 h-10 rounded-md object-cover border border-slate-700 shrink-0"
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* CỘT 2: Studio: Giọng ElevenLabs & Kịch bản 5 Biến thể (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* Bộ chọn 16 Giọng ElevenLabs */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-slate-200">Kho 16 Giọng Đọc ElevenLabs</h3>
              </div>
              <div className="flex gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px]">
                {(['all', 'male', 'female'] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setVoiceFilter(g)}
                    className={`px-2 py-0.5 rounded-md font-medium transition ${
                      voiceFilter === g ? 'bg-slate-800 text-pink-300' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {g === 'all' ? 'Tất cả' : g === 'male' ? 'Nam' : 'Nữ'}
                  </button>
                ))}
              </div>
            </div>

            {/* Grid 16 giọng với nút nghe thử Demo Audio */}
            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
              {filteredVoices.map((voice) => {
                const isSelected = selectedVoiceId === voice.id
                const isPlaying = playingVoiceId === voice.id
                return (
                  <div
                    key={voice.id}
                    onClick={() => setSelectedVoiceId(voice.id)}
                    className={`flex items-center justify-between p-2 rounded-xl cursor-pointer border text-xs transition ${
                      isSelected
                        ? 'bg-indigo-950/40 border-indigo-500 text-indigo-100 shadow-sm'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="min-w-0 flex-1 mr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-xs truncate">{voice.name}</span>
                        <span className="text-[10px] px-1 py-0.2 rounded bg-slate-800 text-slate-400 shrink-0">
                          {voice.gender === 'male' ? 'Nam' : 'Nữ'}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 truncate mt-0.5">{voice.description}</div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        togglePlayVoiceDemo(voice)
                      }}
                      className={`p-1.5 rounded-lg shrink-0 transition ${
                        isPlaying
                          ? 'bg-rose-500 text-white animate-pulse'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                      }`}
                      title={isPlaying ? 'Dừng phát' : 'Nghe thử giọng này'}
                    >
                      {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Kịch bản 5 Biến thể Tabs */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex-1 flex flex-col min-h-[420px]">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-pink-400" />
                <h3 className="text-sm font-semibold text-slate-200">5 Biến Thể Kịch Bản A/B Testing</h3>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Sliders className="w-3.5 h-3.5" />
                <select
                  value={visualMode}
                  onChange={(e) => setVisualMode(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none"
                >
                  <option value="real_video">Chế độ: Video Thật (Real MP4)</option>
                  <option value="storyboard">Chế độ: Visual Motion Storyboard</option>
                </select>
              </div>
            </div>

            {/* 5 Tabs Biến thể */}
            <div className="grid grid-cols-5 gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800 mb-3">
              {[1, 2, 3, 4, 5].map((idx) => {
                const isSelected = selectedVariant === idx
                return (
                  <button
                    key={idx}
                    onClick={() => handleVariantChange(idx)}
                    className={`py-1.5 px-1 rounded-lg text-[11px] font-medium text-center truncate transition ${
                      isSelected
                        ? 'bg-gradient-to-r from-pink-600 to-indigo-600 text-white font-semibold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    B#{idx}: {VARIANT_NAMES[idx - 1]?.split(' ')[0]}
                  </button>
                )
              })}
            </div>

            {/* Chi tiết Biến thể hiện tại */}
            <div className="flex-1 flex flex-col overflow-y-auto space-y-3 pr-1 max-h-[380px]">
              {currentScriptPack ? (
                <>
                  <div className="p-2.5 rounded-xl bg-pink-950/20 border border-pink-500/30 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-pink-300">
                        {VARIANT_NAMES[selectedVariant - 1]}
                      </div>
                      <div className="text-[11px] text-pink-200/70 mt-0.5">
                        Kịch bản: <span className="font-medium text-white">{currentScriptPack.variant_name || VARIANT_NAMES[selectedVariant - 1]}</span>
                      </div>
                    </div>
                  </div>

                  {/* 4 Cảnh quay */}
                  <div className="space-y-2">
                    {currentScriptPack.scenes.map((scene, sIdx) => (
                      <div
                        key={sIdx}
                        className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 transition"
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">
                            Cảnh {sIdx + 1}: {scene.scene_type}
                          </span>
                          <span className="text-[10px] text-slate-500">{scene.timing?.duration || 3}s</span>
                        </div>
                        <textarea
                          rows={2}
                          value={scene.text}
                          onChange={(e) => handleSceneTextChange(sIdx, e.target.value)}
                          className="w-full p-2 text-xs rounded-lg bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500 transition resize-none"
                        />
                      </div>
                    ))}
                  </div>

                  {/* Caption gợi ý */}
                  <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Caption & Hashtags TikTok
                      </span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(currentScriptPack.caption)
                          toast.success('Đã sao chép caption')
                        }}
                        className="text-[10px] text-pink-400 hover:underline flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Sao chép</span>
                      </button>
                    </div>
                    <div className="text-xs text-slate-300 bg-slate-900 p-2 rounded-lg border border-slate-800 font-mono">
                      {currentScriptPack.caption}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs">
                  <FileText className="w-8 h-8 text-slate-600 mb-2" />
                  <span>Chọn sản phẩm để nạp kịch bản</span>
                </div>
              )}
            </div>

            {/* Buttons Render */}
            <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-800">
              <button
                onClick={handleRenderSingleVideo}
                disabled={rendering || renderingBatch}
                className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-pink-600 hover:bg-pink-500 text-white text-xs font-semibold shadow-md shadow-pink-600/20 disabled:opacity-50 transition"
              >
                {rendering ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Đang render...</span>
                  </>
                ) : (
                  <>
                    <Film className="w-4 h-4" />
                    <span>Tạo 1 Video Này (MP4)</span>
                  </>
                )}
              </button>

              <button
                onClick={handleRenderBatch5}
                disabled={rendering || renderingBatch}
                className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 disabled:opacity-50 transition"
              >
                {renderingBatch ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Đang render 5 video...</span>
                  </>
                ) : (
                  <>
                    <Layers className="w-4 h-4" />
                    <span>Render Hàng Loạt 5 Biến Thể</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* CỘT 3: Preview Video 9:16 Mockup & Lịch sử Jobs (3 cols) */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          {/* Phone Mockup 9:16 Preview */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-col items-center shadow-sm">
            <div className="w-full flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5 text-pink-400" />
                <span>TikTok 9:16 Preview</span>
              </span>
              {activeJob && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  {activeJob.status || 'Ready'}
                </span>
              )}
            </div>

            {/* Khung điện thoại */}
            <div className="relative w-[210px] h-[373px] bg-black rounded-3xl border-4 border-slate-800 overflow-hidden shadow-2xl flex flex-col items-center justify-center">
              {activeJob?.video_url ? (
                <video
                  key={activeJob.video_url}
                  src={activeJob.video_url}
                  controls
                  autoPlay
                  loop
                  playsInline
                  className="w-full h-full object-cover"
                />
              ) : selectedProduct?.image_Gallery?.[0]?.url ? (
                <div className="relative w-full h-full flex flex-col justify-end p-3">
                  <img
                    src={selectedProduct.image_Gallery[0].url}
                    alt="preview"
                    className="absolute inset-0 w-full h-full object-cover opacity-75"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/30" />
                  <div className="relative z-10 text-[11px] font-semibold text-white bg-black/60 p-2 rounded-lg backdrop-blur-sm border border-white/10 text-center">
                    {currentScriptPack?.scenes?.[0]?.text || 'Bấm "Tạo 1 Video Này" để xuất file MP4'}
                  </div>
                </div>
              ) : (
                <div className="text-slate-600 text-xs text-center p-4">
                  <Film className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <span>Chưa có video được chọn</span>
                </div>
              )}
            </div>

            {/* Các nút hành động tải về */}
            {activeJob?.video_url && (
              <div className="w-full flex flex-col gap-1.5 mt-3">
                <a
                  href={activeJob.video_url}
                  download={`tiktok_affiliate_${activeJob.product_id}_v${activeJob.variant_index}.mp4`}
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Tải Video MP4 Về Máy</span>
                </a>

                <div className="flex gap-1.5">
                  {activeJob.audio_url && (
                    <a
                      href={activeJob.audio_url}
                      download={`voice_elevenlabs_${activeJob.variant_index}.mp3`}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700 transition"
                    >
                      <Volume2 className="w-3 h-3" />
                      <span>Tải Voice MP3</span>
                    </a>
                  )}
                  {activeJob.script_url && (
                    <a
                      href={activeJob.script_url}
                      download={`script_v${activeJob.variant_index}.txt`}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700 transition"
                    >
                      <FileText className="w-3 h-3" />
                      <span>Tải Kịch Bản</span>
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Lịch sử Jobs gần đây */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex-1 flex flex-col min-h-[220px]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-indigo-400" />
                <span>Video Đã Xuất ({jobs.length})</span>
              </span>
            </div>

            <div className="flex flex-col gap-2 overflow-y-auto max-h-[220px] pr-1">
              {jobs.length === 0 ? (
                <div className="text-slate-500 text-xs text-center py-6">Chưa có video nào được render</div>
              ) : (
                jobs.map((job) => {
                  const isActive = activeJob?.id === job.id
                  return (
                    <div
                      key={job.id}
                      onClick={() => setActiveJob(job)}
                      className={`flex items-center justify-between p-2 rounded-xl cursor-pointer border text-xs transition ${
                        isActive
                          ? 'bg-indigo-950/40 border-indigo-500 text-white'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-300'
                      }`}
                    >
                      <div className="min-w-0 flex-1 mr-2">
                        <div className="font-semibold text-xs truncate">
                          {job.product_title || `Sản phẩm #${job.product_id}`}
                        </div>
                        <div className="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5">
                          <span>Biến thể #{job.variant_index}</span>
                          <span>•</span>
                          <span>{job.created_at?.slice(11, 16) || ''}</span>
                        </div>
                      </div>
                      {job.video_url && (
                        <a
                          href={job.video_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                          title="Mở trong tab mới"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* MODAL CÀI ĐẶT API KEYS */}
      {showKeysModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Key className="w-5 h-5 text-amber-400" />
                <span>Cấu Hình API Keys</span>
              </h3>
              <button
                onClick={() => setShowKeysModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveKeys} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Gemini API Key (Tạo kịch bản AI)
                </label>
                <input
                  type="password"
                  placeholder={keysStatus.gemini_masked || 'Nhập AI Studio Key: AIzaSy...'}
                  value={geminiKeyInput}
                  onChange={(e) => setGeminiKeyInput(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-pink-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  ElevenLabs API Key (Lồng tiếng 16 giọng cao cấp)
                </label>
                <input
                  type="password"
                  placeholder={keysStatus.elevenlabs_masked || 'Nhập ElevenLabs Key: sk_...'}
                  value={elevenlabsKeyInput}
                  onChange={(e) => setElevenlabsKeyInput(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-950 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-pink-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowKeysModal(false)}
                  className="px-4 py-2 text-xs rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={savingKeys}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-pink-600 hover:bg-pink-500 text-white transition"
                >
                  {savingKeys ? 'Đang lưu...' : 'Lưu Cấu Hình'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
