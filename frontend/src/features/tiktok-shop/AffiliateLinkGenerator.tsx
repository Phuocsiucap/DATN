import { useState } from 'react'
import { Copy, Link2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { generateAffiliateLinkApi } from '@/commons/apis/tiktokShopApi'

type AffiliateLinkGeneratorProps = {
  credentialId: string
}

export default function AffiliateLinkGenerator({ credentialId }: AffiliateLinkGeneratorProps) {
  const [productId, setProductId] = useState('')
  const [linkType] = useState<'ShortLink' | 'NormalLink'>('ShortLink')
  const [generatedLink, setGeneratedLink] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleGenerate = async () => {
    if (!productId.trim()) {
      toast.error('Vui lòng nhập Product ID')
      return
    }

    setLoading(true)
    try {
      const response = await generateAffiliateLinkApi(credentialId, {
        product_id: productId.trim(),
        link_type: linkType,
      })
      setGeneratedLink(response.link)
      toast.success('Đã tạo affiliate link')
    } catch (error) {
      const message = error && typeof error === 'object' && 'response' in error
        ? String((error as { response?: { data?: { message?: string } } }).response?.data?.message || 'Tạo link thất bại')
        : 'Tạo link thất bại'
      toast.error(message)
      setGeneratedLink(null)
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!generatedLink) return
    try {
      await navigator.clipboard.writeText(generatedLink)
      setCopied(true)
      toast.success('Đã copy link vào clipboard')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Không thể copy link')
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--outline-variant)] bg-white p-5">
        <label className="block space-y-2 mb-4">
          <span className="text-sm font-bold text-slate-700">Product ID</span>
          <input
            type="text"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
            placeholder="Nhập Product ID từ TikTok Shop..."
            className="w-full rounded-lg border border-[var(--outline-variant)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
        </label>

        <label className="block space-y-2 mb-4">
          <span className="text-sm font-bold text-slate-700">Loại link</span>
          <select
            value={linkType}
            disabled
            className="w-full rounded-lg border border-[var(--outline-variant)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] bg-slate-50"
          >
            <option value="ShortLink">Short Link (Khuyến nghị)</option>
            <option value="NormalLink">Normal Link</option>
          </select>
        </label>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading || !productId.trim()}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-[#2556ea] px-4 text-sm font-semibold text-white hover:bg-[#1e47c8] disabled:opacity-60 transition-colors"
        >
          <Link2 size={16} />
          {loading ? 'Đang tạo...' : 'Tạo link'}
        </button>
      </div>

      {generatedLink && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-5">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 size={18} className="text-green-600" />
            <span className="text-sm font-bold text-green-900">Affiliate link đã được tạo</span>
          </div>

          <div className="rounded-lg border border-green-200 bg-white p-3 mb-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={generatedLink}
                readOnly
                className="flex-1 bg-transparent text-sm text-slate-700 outline-none"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-green-200 bg-white text-green-700 hover:bg-green-50 transition-colors"
                title="Copy link"
              >
                {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>

          <p className="text-xs text-green-800">
            Sử dụng link này để quảng bá sản phẩm và nhận hoa hồng khi có đơn hàng.
          </p>
        </div>
      )}

      {!generatedLink && (
        <div className="rounded-xl border border-[var(--outline-variant)] bg-[#f8fafc] p-8 text-center">
          <Link2 size={32} className="mx-auto mb-2 text-slate-400" />
          <p className="text-sm font-medium text-slate-600">
            Nhập Product ID và tạo affiliate link để bắt đầu kiếm hoa hồng
          </p>
        </div>
      )}
    </div>
  )
}
