import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, ChevronDown, ChevronUp, FileVideo2, HardDriveUpload, Image, ImagePlus, Link, Loader2, Send, Upload, X } from 'lucide-react'
import { AppButton, SelectControl } from '@/commons/component/social-ui'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/commons/component/ui/dialog'
import { getCloudinarySignApi, uploadImageToCloudinary } from '@/commons/apis/api'

export type ManualQueueProfile = {
  id: string
  platform: string
  profile_name: string
  username?: string | null
  status: string
  strategy?: {
    schedule_timezone?: string
  } | null
}

export type ManualQueuePostVideoPayload = {
  type: 'video'
  profileId: string
  video: File
  caption: string
  scheduledAt: string
  timezone: string
}

export type ManualQueuePostPhotoPayload = {
  type: 'photo'
  profileId: string
  photoUrls: string[]
  photoCoverIndex: number
  title: string
  caption: string
  autoAddMusic: boolean
  postMode: 'DIRECT_POST' | 'MEDIA_UPLOAD'
  scheduledAt: string
  timezone: string
  isAigc: boolean
  privacyLevel: string
}

export type ManualQueuePostPayload = ManualQueuePostVideoPayload | ManualQueuePostPhotoPayload

const zonedInputDateTime = (date: Date, timezone: string) => {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`
  } catch {
    return zonedInputDateTime(date, 'Asia/Bangkok')
  }
}

const defaultDateTimeForDay = (dateKey: string | null, timezone: string) => {
  if (!dateKey) return zonedInputDateTime(new Date(Date.now() + 15 * 60_000), timezone)
  const now = zonedInputDateTime(new Date(Date.now() + 15 * 60_000), timezone)
  const candidate = `${dateKey}T09:00`
  return candidate > now ? candidate : now
}

export function ManualQueuePostDialog({
  open,
  profiles,
  initialProfileId,
  initialDateKey,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean
  profiles: ManualQueueProfile[]
  initialProfileId?: string
  initialDateKey?: string | null
  loading: boolean
  onClose: () => void
  onSubmit: (payload: ManualQueuePostPayload) => Promise<boolean>
}) {
  const activeProfiles = useMemo(() => profiles.filter((profile) => profile.status !== 'deleted'), [profiles])
  const fallbackProfileId = activeProfiles[0]?.id || ''
  const [profileId, setProfileId] = useState('')
  const [video, setVideo] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')

  const selectedProfile = activeProfiles.find((profile) => String(profile.id) === String(profileId))
  const timezone = selectedProfile?.strategy?.schedule_timezone || 'Asia/Bangkok'
  const isTikTok = selectedProfile?.platform?.toLowerCase() === 'tiktok'
  const minimum = useMemo(() => zonedInputDateTime(new Date(Date.now() + 60_000), timezone), [timezone, open])

  // Post type
  const [postType, setPostType] = useState<'video' | 'photo'>('video')

  // Photo state
  const [photoInputMode, setPhotoInputMode] = useState<'url' | 'upload'>('url')
  const [photoUrlInput, setPhotoUrlInput] = useState('')
  const [photoUrls, setPhotoUrls] = useState<string[]>([])
  const [photoCoverIndex, setPhotoCoverIndex] = useState(0)
  const [title, setTitle] = useState('')
  const [autoAddMusic, setAutoAddMusic] = useState(false)
  const [postMode, setPostMode] = useState<'DIRECT_POST' | 'MEDIA_UPLOAD'>('DIRECT_POST')
  const [photoUploading, setPhotoUploading] = useState(false)

  useEffect(() => {
    if (!open) return
    const nextProfileId = initialProfileId && initialProfileId !== 'all' ? initialProfileId : fallbackProfileId
    const nextProfile = activeProfiles.find((profile) => String(profile.id) === String(nextProfileId))
    const nextTimezone = nextProfile?.strategy?.schedule_timezone || 'Asia/Bangkok'
    setProfileId(nextProfileId)
    setVideo(null)
    setCaption('')
    setScheduledAt(defaultDateTimeForDay(initialDateKey || null, nextTimezone))
    setPostType('video')
    setPhotoUrls([])
    setPhotoCoverIndex(0)
    setTitle('')
    setPhotoUrlInput('')
    setAutoAddMusic(false)
    setPostMode('DIRECT_POST')
    setPhotoUploading(false)
  }, [activeProfiles, fallbackProfileId, initialDateKey, initialProfileId, open])

  useEffect(() => {
    if (!open || !scheduledAt) return
    if (scheduledAt < minimum) setScheduledAt(minimum)
  }, [minimum, open, scheduledAt])

  const save = async () => {
    if (postType === 'video') {
      if (!video) return
      const saved = await onSubmit({
        type: 'video',
        profileId,
        video,
        caption: caption.trim(),
        scheduledAt,
        timezone,
      })
      if (saved) onClose()
    } else {
      if (photoUrls.length < 2) return
      const saved = await onSubmit({
        type: 'photo',
        profileId,
        photoUrls,
        photoCoverIndex,
        title: title.trim(),
        caption: caption.trim(),
        autoAddMusic,
        postMode,
        scheduledAt,
        timezone,
        isAigc: false,
        privacyLevel: 'PUBLIC_TO_EVERYONE',
      })
      if (saved) onClose()
    }
  }

  const canSave =
    postType === 'video'
      ? Boolean(profileId && video && caption.trim() && scheduledAt && scheduledAt >= minimum)
      : Boolean(profileId && photoUrls.length >= 2 && scheduledAt && scheduledAt >= minimum)

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !loading && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Thêm bài đăng thủ công</DialogTitle>
          <DialogDescription>
            Chọn tài khoản, tải nội dung, nhập caption và đặt thời gian xuất bản.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <label className="grid gap-2 text-sm font-bold text-[#34415a]">
            Tài khoản đăng
            <SelectControl value={profileId} onChange={setProfileId} icon={<Send size={15} />}>
              {activeProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.profile_name}{profile.username ? ` (@${profile.username})` : ''} - {profile.platform}
                </option>
              ))}
            </SelectControl>
          </label>

          {/* Type selector — only for TikTok */}
          {isTikTok && (
            <div className="flex gap-2">
              {(['video', 'photo'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={loading}
                  onClick={() => setPostType(t)}
                  className={`flex h-9 flex-1 items-center justify-center gap-2 rounded-[8px] border text-sm font-bold transition
                    ${postType === t
                      ? 'border-[#6d5dfc] bg-[#6d5dfc] text-white'
                      : 'border-[var(--outline-variant)] bg-white text-[#526179] hover:bg-slate-50'
                    }`}
                >
                  {t === 'video' ? <FileVideo2 size={15} /> : <Image size={15} />}
                  {t === 'video' ? 'Video' : 'Ảnh (Carousel)'}
                </button>
              ))}
            </div>
          )}

          {/* Video section */}
          {postType === 'video' && (
            <label className="grid gap-2 text-sm font-bold text-[#34415a]">
              Video
              <div className="flex min-h-24 items-center gap-3 rounded-[8px] border border-dashed border-[var(--outline-variant)] bg-white p-4">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[8px] bg-[#eef2ff] text-[#4f46e5]">
                  <FileVideo2 size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-extrabold text-[#172033]">
                    {video ? video.name : 'Chọn file video để đưa vào lịch đăng'}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-[#64748b]">MP4, MOV, M4V hoặc WEBM, tối đa 500MB</div>
                </div>
                <input
                  type="file"
                  accept="video/mp4,video/quicktime,video/x-m4v,video/webm"
                  disabled={loading}
                  onChange={(event) => setVideo(event.target.files?.[0] || null)}
                  className="max-w-[190px] text-xs font-semibold text-[#526179] file:mr-3 file:h-9 file:rounded-[8px] file:border-0 file:bg-[#172033] file:px-3 file:text-xs file:font-bold file:text-white"
                />
              </div>
            </label>
          )}

          {/* Photo section */}
          {postType === 'photo' && (
            <div className="space-y-3">
              {/* Source mode tabs */}
              <div className="flex gap-2">
                {(['url', 'upload'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={loading}
                    onClick={() => setPhotoInputMode(m)}
                    className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[8px] border text-xs font-bold transition
                      ${photoInputMode === m
                        ? 'border-[#4f46e5] bg-[#eef2ff] text-[#4f46e5]'
                        : 'border-[var(--outline-variant)] bg-white text-[#526179]'
                      }`}
                  >
                    {m === 'url' ? <Link size={13} /> : <HardDriveUpload size={13} />}
                    {m === 'url' ? 'Nhập URL' : 'Upload Cloudinary'}
                  </button>
                ))}
              </div>

              {/* URL input */}
              {photoInputMode === 'url' && (
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={photoUrlInput}
                    disabled={loading}
                    onChange={(e) => setPhotoUrlInput(e.target.value)}
                    placeholder="https://..."
                    className="h-9 min-w-0 flex-1 rounded-[8px] border border-[var(--outline-variant)] bg-white px-3 text-sm font-medium outline-none focus:border-[#6d5dfc] focus:ring-2 focus:ring-[#6d5dfc]/15"
                  />
                  <AppButton
                    variant="secondary"
                    disabled={loading || !photoUrlInput.trim() || photoUrls.length >= 35}
                    onClick={() => {
                      const url = photoUrlInput.trim()
                      if (url) {
                        setPhotoUrls((prev) => [...prev, url])
                        setPhotoUrlInput('')
                      }
                    }}
                  >
                    Thêm
                  </AppButton>
                </div>
              )}

              {/* Cloudinary upload */}
              {photoInputMode === 'upload' && (
                <label className="flex min-h-20 cursor-pointer items-center gap-3 rounded-[8px] border border-dashed border-[var(--outline-variant)] bg-white p-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] bg-[#eef2ff] text-[#4f46e5]">
                    {photoUploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-[#172033]">Chọn ảnh để upload Cloudinary</div>
                    <div className="mt-0.5 text-xs text-[#64748b]">JPEG, WEBP — tối đa 35 ảnh</div>
                  </div>
                  <input
                    type="file"
                    multiple
                    accept="image/jpeg,image/webp"
                    disabled={loading || photoUploading}
                    className="hidden"
                    onChange={async (e) => {
                      const files = Array.from(e.target.files || [])
                      if (!files.length) return
                      setPhotoUploading(true)
                      try {
                        const sign = await getCloudinarySignApi()
                        const urls = await Promise.all(files.map((f) => uploadImageToCloudinary(sign, f)))
                        setPhotoUrls((prev) => [...prev, ...urls].slice(0, 35))
                      } catch (err) {
                        console.error('Cloudinary upload failed', err)
                      } finally {
                        setPhotoUploading(false)
                        e.target.value = ''
                      }
                    }}
                  />
                </label>
              )}

              {/* Photo list with reorder + cover selection */}
              {photoUrls.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#34415a]">Danh sách ảnh ({photoUrls.length}/35)</span>
                    <span className="text-xs text-[#64748b]">Nhấn ★ để chọn ảnh bìa</span>
                  </div>
                  {photoUrls.map((url, index) => (
                    <div
                      key={index}
                      className={`flex items-center gap-2 rounded-[8px] border p-2 ${
                        photoCoverIndex === index ? 'border-[#6d5dfc] bg-[#f5f3ff]' : 'border-[var(--outline-variant)] bg-white'
                      }`}
                    >
                      <img
                        src={url}
                        alt={`Ảnh ${index + 1}`}
                        className="h-10 w-10 shrink-0 rounded-[4px] object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).src = '' }}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-[#526179]">{url}</span>
                      <button
                        type="button"
                        onClick={() => setPhotoCoverIndex(index)}
                        className={`shrink-0 text-base leading-none ${photoCoverIndex === index ? 'text-[#6d5dfc]' : 'text-[#cbd5e1]'}`}
                        title="Chọn làm ảnh bìa"
                      >★</button>
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => {
                          setPhotoUrls((prev) => {
                            const next = [...prev]
                            ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                            return next
                          })
                          if (photoCoverIndex === index) setPhotoCoverIndex(index - 1)
                          else if (photoCoverIndex === index - 1) setPhotoCoverIndex(index)
                        }}
                        className="icon-button text-[#526179] disabled:opacity-30"
                      ><ChevronUp size={14} /></button>
                      <button
                        type="button"
                        disabled={index === photoUrls.length - 1}
                        onClick={() => {
                          setPhotoUrls((prev) => {
                            const next = [...prev]
                            ;[next[index + 1], next[index]] = [next[index], next[index + 1]]
                            return next
                          })
                          if (photoCoverIndex === index) setPhotoCoverIndex(index + 1)
                          else if (photoCoverIndex === index + 1) setPhotoCoverIndex(index)
                        }}
                        className="icon-button text-[#526179] disabled:opacity-30"
                      ><ChevronDown size={14} /></button>
                      <button
                        type="button"
                        onClick={() => {
                          setPhotoUrls((prev) => prev.filter((_, i) => i !== index))
                          setPhotoCoverIndex((prev) => {
                            if (prev === index) return 0
                            if (prev > index) return prev - 1
                            return prev
                          })
                        }}
                        className="icon-button text-red-400"
                      ><X size={14} /></button>
                    </div>
                  ))}
                </div>
              )}

              {photoUrls.length < 2 && (
                <p className="text-xs text-amber-600">Cần ít nhất 2 ảnh để tạo photo carousel.</p>
              )}
            </div>
          )}

          {/* Title field — only for photo */}
          {postType === 'photo' && (
            <label className="grid gap-2 text-sm font-bold text-[#34415a]">
              Tiêu đề (tối đa 90 ký tự)
              <input
                type="text"
                value={title}
                disabled={loading}
                maxLength={90}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Nhập tiêu đề..."
                className="h-10 rounded-[8px] border border-[var(--outline-variant)] bg-white px-3 text-sm font-medium outline-none focus:border-[#6d5dfc] focus:ring-2 focus:ring-[#6d5dfc]/15"
              />
              <span className="text-right text-xs font-semibold text-[#64748b]">{title.length}/90</span>
            </label>
          )}

          <label className="grid gap-2 text-sm font-bold text-[#34415a]">
            Caption
            <textarea
              value={caption}
              disabled={loading}
              onChange={(event) => setCaption(event.target.value)}
              rows={5}
              maxLength={postType === 'photo' ? 4000 : 2200}
              placeholder="Nhập caption cho bài đăng..."
              className="min-h-32 resize-y rounded-[8px] border border-[var(--outline-variant)] bg-white px-3 py-2 text-sm font-medium text-[#172033] outline-none transition focus:border-[#6d5dfc] focus:ring-2 focus:ring-[#6d5dfc]/15"
            />
            <span className="text-right text-xs font-semibold text-[#64748b]">{caption.length}/{postType === 'photo' ? 4000 : 2200}</span>
          </label>

          {/* TikTok photo options */}
          {postType === 'photo' && (
            <div className="space-y-2 rounded-[8px] border border-[var(--outline-variant)] bg-slate-50 p-3">
              <div className="text-xs font-bold text-[#34415a]">Tuỳ chọn TikTok</div>

              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoAddMusic}
                  disabled={loading}
                  onChange={(e) => setAutoAddMusic(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-[#6d5dfc]"
                />
                <span className="font-medium text-[#34415a]">Tự động thêm nhạc (auto_add_music)</span>
              </label>

              <div className="space-y-1">
                <div className="text-xs font-bold text-[#64748b]">Chế độ đăng</div>
                {(['DIRECT_POST', 'MEDIA_UPLOAD'] as const).map((pm) => (
                  <label key={pm} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="postMode"
                      value={pm}
                      checked={postMode === pm}
                      disabled={loading}
                      onChange={() => setPostMode(pm)}
                      className="accent-[#6d5dfc]"
                    />
                    <span className="font-medium text-[#34415a]">
                      {pm === 'DIRECT_POST' ? 'Đăng trực tiếp (Direct Post)' : 'Gửi vào inbox (Media Upload)'}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <label className="grid gap-2 text-sm font-bold text-[#34415a]">
            Thời gian đăng
            <div className="flex h-11 items-center gap-2 rounded-[8px] border border-[var(--outline-variant)] bg-white px-3 focus-within:border-[#6d5dfc] focus-within:ring-2 focus-within:ring-[#6d5dfc]/15">
              <CalendarClock size={16} className="shrink-0 text-[#64748b]" />
              <input
                type="datetime-local"
                min={minimum}
                value={scheduledAt}
                disabled={loading}
                onChange={(event) => setScheduledAt(event.target.value)}
                className="h-full min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
              />
            </div>
          </label>

          <p className="text-xs leading-5 text-[#64748b]">
            Múi giờ của tài khoản: <span className="font-extrabold text-[#34415a]">{timezone}</span>.
          </p>
        </DialogBody>

        <DialogFooter>
          <AppButton variant="secondary" disabled={loading} onClick={onClose}>
            Hủy
          </AppButton>
          <AppButton
            icon={loading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            disabled={loading || !canSave}
            onClick={() => void save()}
          >
            {loading ? 'Đang thêm...' : 'Thêm vào lịch'}
          </AppButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
