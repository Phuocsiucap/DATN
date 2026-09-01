export const TIKTOK_QR_SIZE = 232

export function resolveTikTokQrStatus(data: unknown) {
  if (!data || typeof data !== 'object') return 'stopped'
  const value = data as { authenticated?: boolean; status?: unknown; session_active?: boolean }
  if (value.authenticated) return 'authenticated'
  if (typeof value.status === 'string' && value.status) return value.status
  return value.session_active ? 'waiting_for_scan' : 'stopped'
}

export const isTikTokQrProcessingStatus = (status: string) => ['scanned', 'confirmed'].includes(status)

export function getTikTokQrHelpText(status: string, createsProfile: boolean) {
  if (status === 'scanned') return createsProfile
    ? 'Đã quét mã thành công. Hãy bấm Cho phép trên TikTok, hệ thống sẽ tự tạo profile.'
    : 'Đã quét mã thành công. Hãy bấm Cho phép trên TikTok để hoàn tất kết nối.'
  if (status === 'confirmed') return createsProfile ? 'TikTok đã xác nhận. Đang tạo và lưu profile...' : 'TikTok đã xác nhận. Đang lưu kết nối...'
  return createsProfile ? 'Sau khi TikTok xác thực, profile sẽ được tạo tự động.' : 'Sử dụng ứng dụng TikTok trên điện thoại để quét mã này.'
}

export function getTikTokQrStatusLabel(status: string) {
  const labels: Record<string, string> = {
    authenticated: 'Hoàn tất',
    confirmed: 'Đang lưu kết nối',
    scanned: 'Đã quét mã',
    waiting_for_scan: 'Đang chờ quét',
    new: 'Đang chờ quét',
    expired: 'QR đã hết hạn',
    stopped: 'Đã dừng',
    preparing_qr: 'Đang chuẩn bị QR',
  }
  return labels[status] || status
}
