import React, { useEffect, useState } from 'react'
import { ExternalLink, RefreshCw, Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react'

export default function TikTokStudioPage() {
  const [serverOnline, setServerOnline] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(true)
  const [iframeKey, setIframeKey] = useState(0)

  const studioUrl = 'http://localhost:8088'

  const checkServerStatus = async () => {
    try {
      setChecking(true)
      const res = await fetch(`${studioUrl}/api/bootstrap`, { method: 'GET' })
      if (res.ok) {
        setServerOnline(true)
      } else {
        setServerOnline(false)
      }
    } catch {
      setServerOnline(false)
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    checkServerStatus()
    const timer = setInterval(checkServerStatus, 10000)
    return () => clearInterval(timer)
  }, [])

  const handleReload = () => {
    setIframeKey((prev) => prev + 1)
    checkServerStatus()
  }

  return (
    <div className="flex flex-col flex-1 h-full min-h-0 w-full overflow-hidden bg-slate-950 text-slate-100">
      {/* Thanh Header kết nối trong dự án chính */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-pink-600/20 text-pink-400 border border-pink-500/30">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">TikTok Affiliate Video AI Studio</span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                Gắn trực tiếp từ repo gốc
              </span>
              {serverOnline ? (
                <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-500/30">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Server 8088 Online</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11px] text-amber-400 font-medium bg-amber-950/40 px-2 py-0.5 rounded-full border border-amber-500/30">
                  <AlertTriangle className="w-3 h-3" />
                  <span>{checking ? 'Đang kiểm tra kết nối...' : 'Chưa kết nối Server 8088'}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleReload}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
            title="Tải lại giao diện"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            <span>Làm mới</span>
          </button>
          <a
            href={studioUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-pink-600/80 hover:bg-pink-600 text-white transition"
            title="Mở trong tab riêng biệt"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Mở tab riêng (8088)</span>
          </a>
        </div>
      </div>

      {/* Vùng hiển thị giao diện nguyên bản của repo TikTok */}
      <div className="flex-1 min-h-0 w-full relative bg-slate-950">
        {serverOnline === false && !checking ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
            <div className="p-3 rounded-2xl bg-amber-950/40 border border-amber-500/30 text-amber-400 mb-3">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">Server TikTok Studio Chưa Khởi Động</h3>
            <p className="text-xs text-slate-400 max-w-md mb-4">
              Vui lòng chạy server TikTok Affiliate Studio bằng lệnh dưới đây trong thư mục{' '}
              <code className="text-pink-400 bg-slate-900 px-1 py-0.5 rounded">tiktok_affiliate_studio</code>:
            </p>
            <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl font-mono text-xs text-pink-300 mb-4 select-all">
              python tiktok_affiliate_studio/app.py
            </div>
            <button
              onClick={checkServerStatus}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl bg-pink-600 hover:bg-pink-500 text-white transition"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Kiểm Tra Lại Kết Nối</span>
            </button>
          </div>
        ) : (
          <iframe
            key={iframeKey}
            src={studioUrl}
            className="w-full h-full border-0"
            title="TikTok Affiliate Video AI Studio"
          />
        )}
      </div>
    </div>
  )
}
