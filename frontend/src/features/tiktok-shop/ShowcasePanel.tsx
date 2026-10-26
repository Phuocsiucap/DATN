import { useState, useEffect, useCallback } from 'react'
import { ShoppingBag, RefreshCw, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { getShowcaseProductsApi, type TikTokShopProduct } from '@/commons/apis/tiktokShopApi'

type ShowcasePanelProps = {
  credentialId: string
}

export default function ShowcasePanel({ credentialId }: ShowcasePanelProps) {
  const [products, setProducts] = useState<TikTokShopProduct[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)

  const loadShowcase = useCallback(async () => {
    setLoading(true)
    try {
      const response = await getShowcaseProductsApi(credentialId, 20)
      setProducts(response.products || [])
      setTotal(response.total || 0)
    } catch (error) {
      const message = error && typeof error === 'object' && 'response' in error
        ? String((error as { response?: { data?: { message?: string } } }).response?.data?.message || 'Không thể tải showcase')
        : 'Không thể tải showcase'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [credentialId])

  useEffect(() => {
    if (credentialId) {
      loadShowcase()
    }
  }, [credentialId, loadShowcase])

  const formatPrice = (price: number | null | undefined, currency: string | null | undefined) => {
    if (price === null || price === undefined) return 'N/A'
    const formatted = new Intl.NumberFormat('vi-VN').format(price)
    return currency === 'VND' ? `${formatted}₫` : `${formatted} ${currency || ''}`
  }

  const formatCommissionRate = (rate: number | null | undefined) => {
    if (rate === null || rate === undefined) return 'N/A'
    return `${(rate / 100).toFixed(2)}%`
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Danh sách sản phẩm đã được ghim/thêm vào Showcase của Creator ({total} sản phẩm)
        </p>
        <button
          type="button"
          onClick={loadShowcase}
          disabled={loading}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--outline-variant)] bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 transition-colors"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Làm mới
        </button>
      </div>

      {loading && products.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="rounded-xl border border-[var(--outline-variant)] bg-white p-3 animate-pulse">
              <div className="aspect-square bg-slate-200 rounded-lg mb-3" />
              <div className="h-4 bg-slate-200 rounded mb-2" />
              <div className="h-3 bg-slate-200 rounded w-2/3" />
            </div>
          ))}
        </div>
      )}

      {products.length === 0 && !loading && (
        <div className="rounded-xl border border-[var(--outline-variant)] bg-[#f8fafc] p-8 text-center">
          <ShoppingBag size={32} className="mx-auto mb-2 text-slate-400" />
          <p className="text-sm font-medium text-slate-600">
            Chưa có sản phẩm nào trong Showcase
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Hãy tìm kiếm sản phẩm tại tab Open Collaboration và thêm vào Showcase
          </p>
        </div>
      )}

      {products.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {products.map((product) => (
            <div
              key={product.product_id}
              className="rounded-xl border border-[var(--outline-variant)] bg-white p-3 hover:shadow-md transition-shadow flex flex-col justify-between"
            >
              <div>
                {product.image_url ? (
                  <img
                    src={product.image_url}
                    alt={product.product_name}
                    className="aspect-square w-full rounded-lg object-cover mb-3"
                  />
                ) : (
                  <div className="aspect-square w-full rounded-lg bg-slate-100 flex items-center justify-center mb-3">
                    <ShoppingBag size={32} className="text-slate-400" />
                  </div>
                )}
                <h3 className="text-sm font-bold text-slate-800 line-clamp-2 mb-1">
                  {product.product_name}
                </h3>
                {product.shop_name && (
                  <p className="text-xs text-slate-500 mb-2">{product.shop_name}</p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-extrabold text-[#2556ea]">
                    {formatPrice(product.price, product.currency)}
                  </span>
                  <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded">
                    Hoa hồng: {formatCommissionRate(product.commission_rate)}
                  </span>
                </div>
                {product.detail_link && (
                  <a
                    href={product.detail_link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex w-full h-8 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 text-slate-700 text-xs font-semibold hover:bg-slate-100 transition-colors"
                  >
                    <ExternalLink size={13} /> Xem sản phẩm
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
