import { useEffect, useState } from 'react'
import { ShoppingBag, Store, Search, Link2, Package, Trash2, Calendar } from 'lucide-react'
import { toast } from 'sonner'
import {
  fetchTikTokShopCredentialsApi,
  disconnectTikTokShopCredentialApi,
  type TikTokShopCredential,
} from '@/commons/apis/tiktokShopApi'
import TikTokShopAuthButton from './TikTokShopAuthButton'
import ProductSearchPanel from './ProductSearchPanel'
import ShowcasePanel from './ShowcasePanel'
import AffiliateLinkGenerator from './AffiliateLinkGenerator'
import OrderTracker from './OrderTracker'

type TabMode = 'account' | 'search' | 'showcase' | 'link' | 'orders'

export default function TikTokShopPage() {
  const [activeTab, setActiveTab] = useState<TabMode>('account')
  const [credentials, setCredentials] = useState<TikTokShopCredential[]>([])
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadCredentials = async () => {
    setLoading(true)
    try {
      const data = await fetchTikTokShopCredentialsApi()
      setCredentials(data)
      if (data.length > 0 && !selectedCredentialId) {
        setSelectedCredentialId(data[0].id)
      }
    } catch (error) {
      const message = error && typeof error === 'object' && 'response' in error
        ? String((error as { response?: { data?: { message?: string } } }).response?.data?.message || 'Không thể tải danh sách tài khoản')
        : 'Không thể tải danh sách tài khoản'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadCredentials()
  }, [])

  const handleAuthSuccess = (credential: TikTokShopCredential) => {
    setCredentials((prev) => [...prev, credential])
    if (!selectedCredentialId) {
      setSelectedCredentialId(credential.id)
    }
  }

  const handleDisconnect = async (credentialId: string) => {
    if (!confirm('Bạn có chắc muốn ngắt kết nối tài khoản TikTok Shop này?')) {
      return
    }

    try {
      await disconnectTikTokShopCredentialApi(credentialId)
      setCredentials((prev) => prev.filter((c) => c.id !== credentialId))
      if (selectedCredentialId === credentialId) {
        const remaining = credentials.filter((c) => c.id !== credentialId)
        setSelectedCredentialId(remaining.length > 0 ? remaining[0].id : null)
      }
      toast.success('Đã ngắt kết nối tài khoản')
    } catch (error) {
      const message = error && typeof error === 'object' && 'response' in error
        ? String((error as { response?: { data?: { message?: string } } }).response?.data?.message || 'Ngắt kết nối thất bại')
        : 'Ngắt kết nối thất bại'
      toast.error(message)
    }
  }

  const formatTokenExpiry = (expiryStr: string | null | undefined) => {
    if (!expiryStr) return 'N/A'
    try {
      const date = new Date(expiryStr)
      return date.toLocaleString('vi-VN')
    } catch {
      return expiryStr
    }
  }

  const tabs = [
    { key: 'account' as TabMode, label: 'Tài khoản', icon: <Store size={16} /> },
    { key: 'search' as TabMode, label: 'Open Collaboration', icon: <Search size={16} />, needsCredential: true },
    { key: 'showcase' as TabMode, label: 'Showcase', icon: <ShoppingBag size={16} />, needsCredential: true },
    { key: 'link' as TabMode, label: 'Tạo link', icon: <Link2 size={16} />, needsCredential: true },
    { key: 'orders' as TabMode, label: 'Đơn hàng', icon: <Package size={16} />, needsCredential: true },
  ]

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--surface)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--outline-variant)] bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-gradient-to-br from-[#2556ea] to-[#6d5dfc]">
            <ShoppingBag size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-[#111827]">TikTok Shop Affiliate</h1>
            <p className="text-xs text-[#64748b]">Quản lý affiliate marketing trên TikTok Shop Partner Platform</p>
          </div>
        </div>

        {credentials.length > 1 && activeTab !== 'account' && (
          <select
            value={selectedCredentialId || ''}
            onChange={(e) => setSelectedCredentialId(e.target.value)}
            className="rounded-lg border border-[var(--outline-variant)] px-3 py-2 text-sm font-medium outline-none focus:border-[var(--accent)]"
          >
            {credentials.map((cred) => (
              <option key={cred.id} value={cred.id}>
                {cred.shop_name || cred.shop_id}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-[var(--outline-variant)] bg-white px-6">
        <div className="flex gap-1">
          {tabs.map((tab) => {
            const disabled = tab.needsCredential && credentials.length === 0
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => !disabled && setActiveTab(tab.key)}
                disabled={disabled}
                className={`relative flex h-11 items-center gap-2 rounded-t-lg px-4 text-sm font-bold transition-colors ${
                  activeTab === tab.key
                    ? 'bg-[#eff4ff] text-[#2556ea]'
                    : disabled
                    ? 'text-slate-300 cursor-not-allowed'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                {tab.icon}
                {tab.label}
                {activeTab === tab.key && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#2556ea]" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading && (
          <div className="flex h-full items-center justify-center">
            <div className="text-sm font-medium text-slate-500">Đang tải...</div>
          </div>
        )}

        {!loading && activeTab === 'account' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--outline-variant)] bg-white p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-extrabold text-slate-800">Tài khoản đã kết nối</h2>
                <TikTokShopAuthButton onAuthSuccess={handleAuthSuccess} />
              </div>

              {credentials.length === 0 && (
                <div className="rounded-xl border border-[var(--outline-variant)] bg-[#f8fafc] p-8 text-center">
                  <Store size={32} className="mx-auto mb-2 text-slate-400" />
                  <p className="text-sm font-medium text-slate-600 mb-3">
                    Chưa có tài khoản TikTok Shop nào được kết nối
                  </p>
                  <p className="text-xs text-slate-500">
                    Kết nối tài khoản TikTok Shop để bắt đầu tìm sản phẩm và tạo affiliate link
                  </p>
                </div>
              )}

              {credentials.length > 0 && (
                <div className="space-y-3">
                  {credentials.map((cred) => (
                    <div
                      key={cred.id}
                      className="rounded-lg border border-[var(--outline-variant)] bg-slate-50 p-4 hover:shadow-sm transition-shadow"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-[#2556ea] to-[#6d5dfc] flex items-center justify-center">
                              <Store size={16} className="text-white" />
                            </div>
                            <div>
                              <h3 className="text-sm font-extrabold text-slate-900">
                                {cred.shop_name || cred.shop_id}
                              </h3>
                              <p className="text-xs text-slate-500">Shop ID: {cred.shop_id}</p>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3 text-xs">
                            {cred.authorized_scopes && cred.authorized_scopes.length > 0 && (
                              <div>
                                <span className="font-bold text-slate-600">Scopes: </span>
                                <span className="text-slate-700">{cred.authorized_scopes.join(', ')}</span>
                              </div>
                            )}
                            {cred.token_expires_at && (
                              <div>
                                <span className="font-bold text-slate-600 flex items-center gap-1">
                                  <Calendar size={12} /> Token hết hạn: 
                                </span>
                                <span className="text-slate-700">{formatTokenExpiry(cred.token_expires_at)}</span>
                              </div>
                            )}
                            {cred.region && (
                              <div>
                                <span className="font-bold text-slate-600">Region: </span>
                                <span className="text-slate-700">{cred.region}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleDisconnect(cred.id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 bg-white text-red-600 hover:bg-red-50 transition-colors"
                          title="Ngắt kết nối"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {!loading && activeTab === 'search' && selectedCredentialId && (
          <div className="rounded-xl border border-[var(--outline-variant)] bg-white p-5">
            <h2 className="text-base font-extrabold text-slate-800 mb-4">Open Collaboration Products</h2>
            <ProductSearchPanel credentialId={selectedCredentialId} />
          </div>
        )}

        {!loading && activeTab === 'showcase' && selectedCredentialId && (
          <div className="rounded-xl border border-[var(--outline-variant)] bg-white p-5">
            <h2 className="text-base font-extrabold text-slate-800 mb-4">Showcase Products</h2>
            <ShowcasePanel credentialId={selectedCredentialId} />
          </div>
        )}

        {!loading && activeTab === 'link' && selectedCredentialId && (
          <div className="rounded-xl border border-[var(--outline-variant)] bg-white p-5">
            <h2 className="text-base font-extrabold text-slate-800 mb-4">Tạo affiliate link</h2>
            <AffiliateLinkGenerator credentialId={selectedCredentialId} />
          </div>
        )}

        {!loading && activeTab === 'orders' && selectedCredentialId && (
          <div className="rounded-xl border border-[var(--outline-variant)] bg-white p-5">
            <h2 className="text-base font-extrabold text-slate-800 mb-4">Theo dõi đơn hàng</h2>
            <OrderTracker credentialId={selectedCredentialId} />
          </div>
        )}

        {!loading && activeTab !== 'account' && !selectedCredentialId && (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-xl border border-[var(--outline-variant)] bg-[#f8fafc] p-8 text-center max-w-md">
              <Store size={32} className="mx-auto mb-2 text-slate-400" />
              <p className="text-sm font-medium text-slate-600">
                Vui lòng kết nối tài khoản TikTok Shop trước
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
