import { useState } from 'react'
import { Search, ShoppingBag } from 'lucide-react'
import { toast } from 'sonner'
import { searchTikTokShopProductsApi, applyCollaborationApi, type TikTokShopProduct } from '@/commons/apis/tiktokShopApi'

type ProductSearchPanelProps = {
  credentialId: string
}

export default function ProductSearchPanel({ credentialId }: ProductSearchPanelProps) {
  const [query, setQuery] = useState('')
  const [products, setProducts] = useState<TikTokShopProduct[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [applyingProductId, setApplyingProductId] = useState<string | null>(null)

  const handleSearch = async () => {
    if (!query.trim()) {
      toast.error('Vui lòng nhập từ khóa tìm kiếm')
      return
    }

    setLoading(true)
    try {
      const response = await searchTikTokShopProductsApi(credentialId, {
        query: query.trim(),
        page_number: 1,
        page_size: 12,
      })
      setProducts(response.products)
      setHasMore(response.has_more)
      setPage(1)
      toast.success(`Tìm thấy ${response.total} sản phẩm`)
    } catch (error) {
      const message = error && typeof error === 'object' && 'response' in error
        ? String((error as { response?: { data?: { message?: string } } }).response?.data?.message || 'Tìm kiếm thất bại')
        : 'Tìm kiếm thất bại'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const handleLoadMore = async () => {
    if (!hasMore || loading) return

    setLoading(true)
    try {
      const nextPage = page + 1
      const response = await searchTikTokShopProductsApi(credentialId, {
        query: query.trim(),
        page_number: nextPage,
        page_size: 12,
      })
      setProducts((prev) => [...prev, ...response.products])
      setHasMore(response.has_more)
      setPage(nextPage)
    } catch (error) {
      const message = error && typeof error === 'object' && 'response' in error
        ? String((error as { response?: { data?: { message?: string } } }).response?.data?.message || 'Tải thêm thất bại')
        : 'Tải thêm thất bại'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const handleApply = async (productId: string) => {
    setApplyingProductId(productId)
    try {
      const result = await applyCollaborationApi(credentialId, productId)
      toast.success(result.message || 'Đã thêm vào showcase thành công!')
    } catch (error) {
      const message = error && typeof error === 'object' && 'response' in error
        ? String((error as { response?: { data?: { message?: string } } }).response?.data?.message || 'Đăng ký thất bại')
        : 'Đăng ký thất bại'
      toast.error(message)
    } finally {
      setApplyingProductId(null)
    }
  }

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
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Nhập tên sản phẩm hoặc từ khóa..."
          className="flex-1 rounded-lg border border-[var(--outline-variant)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={loading}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-[#2556ea] px-4 text-sm font-semibold text-white hover:bg-[#1e47c8] disabled:opacity-60 transition-colors"
        >
          <Search size={16} /> Tìm kiếm
        </button>
      </div>

      {products.length === 0 && !loading && (
        <div className="rounded-xl border border-[var(--outline-variant)] bg-[#f8fafc] p-8 text-center">
          <ShoppingBag size={32} className="mx-auto mb-2 text-slate-400" />
          <p className="text-sm font-medium text-slate-600">
            Nhập từ khóa và tìm kiếm sản phẩm Open Collaboration để bắt đầu
          </p>
        </div>
      )}

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

      {products.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {products.map((product) => (
              <div key={product.product_id} className="rounded-xl border border-[var(--outline-variant)] bg-white p-3 hover:shadow-md transition-shadow">
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
                <h3 className="text-sm font-bold text-slate-800 line-clamp-2 mb-2">
                  {product.product_name}
                </h3>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-extrabold text-[#2556ea]">
                    {formatPrice(product.price, product.currency)}
                  </span>
                  <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded">
                    Hoa hồng: {formatCommissionRate(product.commission_rate)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleApply(product.product_id)}
                  disabled={applyingProductId === product.product_id}
                  className="w-full h-8 rounded-md border border-[#2556ea] bg-white text-[#2556ea] text-xs font-bold hover:bg-[#eff4ff] disabled:opacity-60 transition-colors"
                >
                  {applyingProductId === product.product_id ? 'Đang thêm...' : 'Thêm vào Showcase'}
                </button>
              </div>
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loading}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--outline-variant)] bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {loading ? 'Đang tải...' : 'Tải thêm'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
