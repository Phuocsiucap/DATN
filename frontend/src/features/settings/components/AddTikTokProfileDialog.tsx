import { QRCodeSVG } from 'qrcode.react'
import { ExternalLink, Globe, QrCode, RefreshCw } from 'lucide-react'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/commons/component/ui/dialog'
import { getTikTokQrHelpText, getTikTokQrStatusLabel, isTikTokQrProcessingStatus, TIKTOK_QR_SIZE } from '../tiktokQr'

export function AddTikTokProfileDialog({
  open,
  platform,
  name,
  username,
  adding,
  sessionId,
  qrImage,
  qrUrl,
  qrReady,
  sessionStatus,
  oauthState,
  oauthAuthUrl,
  onPlatformChange,
  onNameChange,
  onUsernameChange,
  onClose,
  onCreate,
  onStartQr,
  onStartOAuth,
  onCancelOAuth,
}: {
  open: boolean
  platform: string
  name: string
  username: string
  adding: boolean
  sessionId: string | null
  qrImage: string | null
  qrUrl: string | null
  qrReady: boolean
  sessionStatus: string
  oauthState: string | null
  oauthPolling: boolean
  oauthAuthUrl: string | null
  onPlatformChange: (value: string) => void
  onNameChange: (value: string) => void
  onUsernameChange: (value: string) => void
  onClose: () => void
  onCreate: () => void
  onStartQr: () => void
  onStartOAuth: () => void
  onCancelOAuth: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Thêm Kênh Social</DialogTitle>
          <DialogDescription>Tạo profile social content mới và kết nối nền tảng.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <label className="block space-y-1.5 text-sm">
            <span className="font-bold text-slate-700">Nền tảng</span>
            <select value={platform} onChange={(event) => onPlatformChange(event.target.value)} className="w-full rounded-lg border border-[var(--outline-variant)] px-3 py-2 outline-none focus:border-[var(--accent)] bg-white">
              <option value="tiktok">TikTok</option>
              <option value="facebook">Facebook</option>
              <option value="instagram">Instagram</option>
              <option value="youtube">YouTube</option>
            </select>
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-bold text-slate-700">Tên profile</span>
            <input value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="VD: TikTok Storytelling Channel" className="w-full rounded-lg border border-[var(--outline-variant)] px-3 py-2 outline-none focus:border-[var(--accent)]" />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-bold text-slate-700">Username</span>
            <input value={username} onChange={(event) => onUsernameChange(event.target.value)} placeholder="@username hoặc để trống" className="w-full rounded-lg border border-[var(--outline-variant)] px-3 py-2 outline-none focus:border-[var(--accent)]" />
          </label>

          {/* Case A: QR session active */}
          {sessionId && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-center">
              <h3 className="text-base font-bold text-blue-900">Quét QR để hoàn tất</h3>
              <p className="mb-4 mt-1 text-xs text-blue-800">{qrReady ? getTikTokQrHelpText(sessionStatus, true) : 'Đang chuẩn bị mã QR, vui lòng chờ vài giây.'}</p>
              {!qrReady ? <div className="mx-auto flex h-64 w-64 animate-pulse items-center justify-center rounded-xl bg-blue-100 text-sm font-semibold text-blue-800">Đang chuẩn bị QR...</div>
                : qrImage ? <img src={qrImage} alt="QR Code" className="mx-auto h-64 w-64 rounded-xl border-2 border-white bg-white p-2 shadow-sm" />
                  : qrUrl ? <div className="mx-auto inline-flex rounded-xl border-2 border-white bg-white p-2 shadow-sm"><QRCodeSVG value={qrUrl} size={TIKTOK_QR_SIZE} level="M" includeMargin /></div>
                    : <div className="mx-auto flex h-64 w-64 items-center justify-center rounded-xl bg-blue-100 text-sm text-blue-800">Đang tải...</div>}
              {qrReady && qrUrl && <a href={qrUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-blue-200 bg-white px-3 text-xs font-bold text-blue-700 hover:bg-blue-50"><ExternalLink size={14} /> Mở link QR</a>}
              <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold uppercase text-blue-700">{qrReady && isTikTokQrProcessingStatus(sessionStatus) && <RefreshCw size={14} className="animate-spin" />}Trạng thái: {getTikTokQrStatusLabel(qrReady ? sessionStatus : 'preparing_qr')}</div>
            </div>
          )}

          {/* Case B: OAuth waiting */}
          {!sessionId && oauthState && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <RefreshCw size={18} className="animate-spin text-indigo-600" />
                <span className="font-bold text-indigo-900">Đang chờ xác thực qua trình duyệt</span>
              </div>
              <p className="text-xs text-indigo-800 mb-4">Hoàn tất đăng nhập trên cửa sổ TikTok đã mở. Trang này sẽ tự động cập nhật.</p>
              {oauthAuthUrl && (
                <a href={oauthAuthUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-indigo-200 bg-white px-3 text-xs font-bold text-indigo-700 hover:bg-indigo-50">
                  <ExternalLink size={14} /> Mở lại trang đăng nhập
                </a>
              )}
            </div>
          )}

          {/* Case C: method selector (TikTok, no session, no oauth) */}
          {platform === 'tiktok' && !sessionId && !oauthState && (
            <div className="space-y-2">
              <p className="text-sm font-bold text-slate-700">Chọn phương thức kết nối TikTok</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={onStartQr}
                  disabled={adding}
                  className="flex flex-col items-center gap-2 rounded-xl border-2 border-[var(--outline-variant)] bg-white p-4 text-center transition hover:border-[var(--accent)] hover:bg-indigo-50/30 disabled:opacity-60"
                >
                  <QrCode size={28} className="text-[var(--accent)]" />
                  <span className="text-sm font-bold text-slate-800">Quét mã QR</span>
                  <span className="text-xs text-slate-500">Dùng app TikTok</span>
                </button>
                <button
                  type="button"
                  onClick={onStartOAuth}
                  disabled={adding}
                  className="flex flex-col items-center gap-2 rounded-xl border-2 border-[var(--outline-variant)] bg-white p-4 text-center transition hover:border-[var(--accent)] hover:bg-indigo-50/30 disabled:opacity-60"
                >
                  <Globe size={28} className="text-[var(--accent)]" />
                  <span className="text-sm font-bold text-slate-800">Qua trình duyệt</span>
                  <span className="text-xs text-slate-500">Đăng nhập TikTok web</span>
                </button>
              </div>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {/* Footer: QR session active */}
          {sessionId && (
            <button onClick={onClose} className="h-9 rounded-lg border border-[var(--outline-variant)] px-4 text-sm font-bold text-[var(--on-surface-variant)] hover:bg-white">
              Dừng QR
            </button>
          )}

          {/* Footer: OAuth waiting */}
          {!sessionId && oauthState && (
            <button onClick={onCancelOAuth} className="h-9 rounded-lg border border-[var(--outline-variant)] px-4 text-sm font-bold text-[var(--on-surface-variant)] hover:bg-white">
              Hủy kết nối
            </button>
          )}

          {/* Footer: no session, no oauth */}
          {!sessionId && !oauthState && (
            platform === 'tiktok' ? (
              <>
                <button onClick={onClose} className="h-9 rounded-lg border border-[var(--outline-variant)] px-4 text-sm font-bold text-[var(--on-surface-variant)] hover:bg-white">
                  Hủy
                </button>
                <button
                  onClick={onCreate}
                  disabled={adding || !name.trim()}
                  className="h-9 rounded-md border border-[var(--outline-variant)] px-4 text-sm font-semibold text-[var(--on-surface-variant)] hover:bg-white disabled:opacity-60"
                >
                  Tạo trước, đăng nhập sau
                </button>
              </>
            ) : (
              <button onClick={onCreate} disabled={adding} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--accent-strong)] disabled:opacity-60">
                Thêm kênh social
              </button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
