import { QRCodeSVG } from 'qrcode.react'
import { ExternalLink, QrCode, RefreshCw } from 'lucide-react'
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
  onPlatformChange,
  onNameChange,
  onUsernameChange,
  onClose,
  onCreate,
  onStartQr,
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
  onPlatformChange: (value: string) => void
  onNameChange: (value: string) => void
  onUsernameChange: (value: string) => void
  onClose: () => void
  onCreate: () => void
  onStartQr: () => void
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
        </DialogBody>
        <DialogFooter>
          {sessionId ? <button onClick={onClose} className="h-9 rounded-lg border border-[var(--outline-variant)] px-4 text-sm font-bold text-[var(--on-surface-variant)] hover:bg-white">Dừng QR</button> : <>
            <button onClick={onCreate} disabled={adding} className="h-9 rounded-md border border-[var(--outline-variant)] px-4 text-sm font-semibold text-[var(--on-surface-variant)] hover:bg-white disabled:opacity-60">
              {platform === 'tiktok' ? 'Tạo trước, đăng nhập sau' : 'Thêm kênh social'}
            </button>
            {platform === 'tiktok' && (
              <button onClick={onStartQr} disabled={adding} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--accent-strong)] disabled:opacity-60"><QrCode size={14} /> Thêm bằng QR</button>
            )}
          </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
