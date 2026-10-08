import { useState } from 'react'
import { CalendarDays, Package } from 'lucide-react'
import { toast } from 'sonner'
import { fetchOrdersApi, type TikTokShopOrder } from '@/commons/apis/tiktokShopApi'

type OrderTrackerProps = {
  credentialId: string
}

export default function OrderTracker({ credentialId }: OrderTrackerProps) {
  const [startTime, setStartTime] = useState<Date>(() => {
    const date = new Date()
    date.setDate(date.getDate() - 7) // Default: 7 days ago
    return date
  })
  const [endTime, setEndTime] = useState<Date>(new Date())
  const [orders, setOrders] = useState<TikTokShopOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)

  const formatDateForInput = (date: Date) => {
    return date.toISOString().slice(0, 16)
  }

  const formatDateForApi = (date: Date) => {
    return date.toISOString()
  }

  const handleFetch = async (pageNumber = 1) => {
    setLoading(true)
    try {
      const response = await fetchOrdersApi(
        credentialId,
        formatDateForApi(startTime),
        formatDateForApi(endTime),
        pageNumber,
        20
      )
      
      if (pageNumber === 1) {
        setOrders(response.orders)
      } else {
        setOrders((prev) => [...prev, ...response.orders])
      }
      
      setPage(pageNumber)
      setHasMore(response.orders.length === response.page_size)
      toast.success(`Tìm thấy ${response.total} đơn hàng`)
    } catch (error) {
      const message = error && typeof error === 'object' && 'response' in error
        ? String((error as { response?: { data?: { message?: string } } }).response?.data?.message || 'Lấy đơn hàng thất bại')
        : 'Lấy đơn hàng thất bại'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const handleLoadMore = () => {
    handleFetch(page + 1)
  }

  const formatCurrency = (amount: number | null | undefined) => {
    if (amount === null || amount === undefined) return 'N/A'
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount)
  }

  const formatDateTime = (dateStr: string | null | undefined) => {
    if (!dateStr) return 'N/A'
    try {
      return new Date(dateStr).toLocaleString('vi-VN')
    } catch {
      return dateStr
    }
  }

  const getOrderStatusColor = (status: string | null | undefined) => {
    if (!status) return 'bg-slate-100 text-slate-700'
    const lower = status.toLowerCase()
    if (lower.includes('completed') || lower.includes('paid')) return 'bg-green-100 text-green-700'
    if (lower.includes('pending')) return 'bg-yellow-100 text-yellow-700'
    if (lower.includes('cancelled') || lower.includes('failed')) return 'bg-red-100 text-red-700'
    return 'bg-blue-100 text-blue-700'
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--outline-variant)] bg-white p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <label className="block space-y-2">
            <span className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
              <CalendarDays size={14} /> Từ ngày
            </span>
            <input
              type="datetime-local"
              value={formatDateForInput(startTime)}
              onChange={(e) => setStartTime(new Date(e.target.value))}
              className="w-full rounded-lg border border-[var(--outline-variant)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
              <CalendarDays size={14} /> Đến ngày
            </span>
            <input
              type="datetime-local"
              value={formatDateForInput(endTime)}
              onChange={(e) => setEndTime(new Date(e.target.value))}
              className="w-full rounded-lg border border-[var(--outline-variant)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => handleFetch(1)}
          disabled={loading}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-[#2556ea] px-4 text-sm font-semibold text-white hover:bg-[#1e47c8] disabled:opacity-60 transition-colors"
        >
          <Package size={16} />
          {loading ? 'Đang tải...' : 'Lấy đơn hàng'}
        </button>
      </div>

      {orders.length === 0 && !loading && (
        <div className="rounded-xl border border-[var(--outline-variant)] bg-[#f8fafc] p-8 text-center">
          <Package size={32} className="mx-auto mb-2 text-slate-400" />
          <p className="text-sm font-medium text-slate-600">
            Chọn khoảng thời gian và lấy đơn hàng để xem thống kê
          </p>
        </div>
      )}

      {loading && orders.length === 0 && (
        <div className="rounded-xl border border-[var(--outline-variant)] bg-white p-4 animate-pulse">
          <div className="h-8 bg-slate-200 rounded mb-3" />
          {Array.from({ length: 5 }).map((_, idx) => (
            <div key={idx} className="h-12 bg-slate-100 rounded mb-2" />
          ))}
        </div>
      )}

      {orders.length > 0 && (
        <>
          <div className="rounded-xl border border-[var(--outline-variant)] bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-[var(--outline-variant)]">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-extrabold text-slate-700 uppercase">Order ID</th>
                    <th className="px-4 py-3 text-left text-xs font-extrabold text-slate-700 uppercase">Sản phẩm</th>
                    <th className="px-4 py-3 text-right text-xs font-extrabold text-slate-700 uppercase">Giá trị</th>
                    <th className="px-4 py-3 text-right text-xs font-extrabold text-slate-700 uppercase">Hoa hồng</th>
                    <th className="px-4 py-3 text-center text-xs font-extrabold text-slate-700 uppercase">Trạng thái</th>
                    <th className="px-4 py-3 text-left text-xs font-extrabold text-slate-700 uppercase">Ngày tạo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--outline-variant)]">
                  {orders.map((order) => (
                    <tr key={order.order_id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">
                        {order.order_id}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {order.product_name || order.product_id || 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-sm font-bold text-slate-900 text-right">
                        {formatCurrency(order.order_amount)}
                      </td>
                      <td className="px-4 py-3 text-sm font-bold text-green-600 text-right">
                        {formatCurrency(order.commission_amount)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block px-2 py-1 rounded text-xs font-bold ${getOrderStatusColor(order.order_status)}`}>
                          {order.order_status || 'Unknown'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {formatDateTime(order.create_time)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
