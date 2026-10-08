import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Globe, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { startTikTokShopOAuthApi, pollTikTokShopOAuthStatusApi, type TikTokShopCredential } from '@/commons/apis/tiktokShopApi'

type TikTokShopAuthButtonProps = {
  onAuthSuccess: (credential: TikTokShopCredential) => void
}

export default function TikTokShopAuthButton({ onAuthSuccess }: TikTokShopAuthButtonProps) {
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [polling, setPolling] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const popupRef = useRef<Window | null>(null)

  const handleStartAuth = async () => {
    try {
      const response = await startTikTokShopOAuthApi()
      setAuthUrl(response.auth_url)
      setSessionId(response.session_id)
      setPolling(true)
      setAuthenticated(false)

      // Open popup window
      const width = 600
      const height = 700
      const left = window.screen.width / 2 - width / 2
      const top = window.screen.height / 2 - height / 2
      const popup = window.open(
        response.auth_url,
        'TikTokShopAuth',
        `width=${width},height=${height},left=${left},top=${top},toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes`
      )
      popupRef.current = popup
    } catch (error) {
      const message = error && typeof error === 'object' && 'response' in error
        ? String((error as { response?: { data?: { message?: string } } }).response?.data?.message || 'Không thể khởi tạo OAuth')
        : 'Không thể khởi tạo OAuth'
      toast.error(message)
    }
  }

  const handleCancelAuth = () => {
    setPolling(false)
    setSessionId(null)
    setAuthUrl(null)
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close()
    }
    popupRef.current = null
  }

  useEffect(() => {
    if (!polling || !sessionId) return

    const intervalId = setInterval(async () => {
      // Check if popup was closed manually
      if (popupRef.current && popupRef.current.closed) {
        handleCancelAuth()
        return
      }

      try {
        const response = await pollTikTokShopOAuthStatusApi(sessionId)
        if (response.authenticated && response.credential) {
          setAuthenticated(true)
          setPolling(false)
          if (popupRef.current && !popupRef.current.closed) {
            popupRef.current.close()
          }
          popupRef.current = null
          toast.success(`Đã kết nối TikTok Shop: ${response.credential.shop_name || response.credential.shop_id}`)
          onAuthSuccess(response.credential)
          setSessionId(null)
          setAuthUrl(null)
        }
      } catch (error) {
        console.error('Polling error:', error)
      }
    }, 2000)

    return () => clearInterval(intervalId)
  }, [polling, sessionId, onAuthSuccess])

  if (polling && sessionId) {
    return (
      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <RefreshCw size={18} className="animate-spin text-indigo-600" />
          <span className="font-bold text-indigo-900 text-sm">Đang chờ xác thực qua trình duyệt</span>
        </div>
        <p className="text-xs text-indigo-800 mb-3">
          Hoàn tất đăng nhập trên cửa sổ TikTok Shop đã mở. Trang này sẽ tự động cập nhật.
        </p>
        {authUrl && (
          <div className="flex gap-2 justify-center">
            <a
              href={authUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-indigo-200 bg-white px-3 text-xs font-bold text-indigo-700 hover:bg-indigo-50"
            >
              <ExternalLink size={14} /> Mở lại trang đăng nhập
            </a>
            <button
              type="button"
              onClick={handleCancelAuth}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              Hủy
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={handleStartAuth}
      className="inline-flex h-9 items-center gap-2 rounded-md bg-[#2556ea] px-4 text-sm font-semibold text-white hover:bg-[#1e47c8] transition-colors"
    >
      <Globe size={16} /> Kết nối TikTok Shop
    </button>
  )
}
