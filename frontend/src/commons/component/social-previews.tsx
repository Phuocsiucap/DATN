import type { ReactNode } from 'react'
import { Bookmark, Heart, Home, MessageCircle, MoreHorizontal, Music2, Plus, Search, Send, Share2, UserRound } from 'lucide-react'
import { cn } from '@/commons/lib/utils'
import { Thumbnail, platformKey } from './social-ui'

export type SocialPreviewPost = {
  platform?: string | null
  profileName?: string | null
  username?: string | null
  avatarUrl?: string | null
  title?: string | null
  caption?: string | null
  mediaUrl?: string | null
  imageIndex?: number
  status?: string | null
  duration?: string | null
}

export function SocialPostPreview({ post, className }: { post: SocialPreviewPost; className?: string }) {
  return platformKey(post.platform) === 'tiktok'
    ? <TikTokPostPreview post={post} className={className} />
    : <InstagramPostPreview post={post} className={className} />
}

export function TikTokPostPreview({ post, className }: { post: SocialPreviewPost; className?: string }) {
  const username = post.username || post.profileName || 'socialcontenthub'
  const caption = post.caption || post.title || 'Nội dung video đang chờ duyệt.'

  return (
    <div className={cn('mx-auto w-full max-w-[315px]', className)}>
      <div className="mb-3 text-center text-sm font-bold text-[#526179]">Xem trước TikTok</div>
      <div className="relative aspect-[9/16] overflow-hidden rounded-[24px] border-[8px] border-[#111827] bg-[#0b0b10] shadow-[0_20px_55px_rgba(15,23,42,0.25)]">
        <PreviewMedia post={post} className="absolute inset-0 h-full w-full rounded-none" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.42),rgba(0,0,0,0.03)_24%,rgba(0,0,0,0.08)_52%,rgba(0,0,0,0.76))]" />

        <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-4 pt-4 text-white">
          <Search size={18} className="opacity-85" />
          <div className="flex items-center gap-4 text-sm font-extrabold">
            <span className="text-white/65">Following</span>
            <span className="relative">
              For You
              <span className="absolute -bottom-1 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full bg-white" />
            </span>
          </div>
          <MoreHorizontal size={18} className="opacity-85" />
        </div>

        <div className="absolute right-3 top-[34%] z-10 flex flex-col items-center gap-4 text-white">
          <div className="relative">
            <PreviewAvatar src={post.avatarUrl} name={username} />
            <span className="absolute -bottom-2 left-1/2 grid h-5 w-5 -translate-x-1/2 place-items-center rounded-full bg-[#ff2d55] text-white">
              <Plus size={13} strokeWidth={3} />
            </span>
          </div>
          <TikTokAction icon={<Heart fill="currentColor" size={25} />} label="12.4K" />
          <TikTokAction icon={<MessageCircle fill="currentColor" size={25} />} label="428" />
          <TikTokAction icon={<Bookmark fill="currentColor" size={24} />} label="1.2K" />
          <TikTokAction icon={<Share2 size={24} />} label="Share" />
        </div>

        <div className="absolute bottom-[54px] left-4 right-[64px] z-10 text-white">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-base font-black">@{slugify(username)}</span>
            <span className="rounded-[4px] border border-white/50 px-1.5 py-0.5 text-xs font-bold">Follow</span>
          </div>
          <p className="line-clamp-3 text-sm font-semibold leading-5 drop-shadow">{caption}</p>
          <div className="mt-2 flex items-center gap-1 text-xs font-bold">
            <Music2 size={14} />
            <span className="line-clamp-1">original sound - SocialContentHub</span>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 z-10 grid h-[46px] grid-cols-5 items-center bg-black/55 px-2 text-white/90 backdrop-blur-sm">
          <BottomNav icon={<Home size={17} />} label="Home" active />
          <BottomNav icon={<Search size={17} />} label="Friends" />
          <div className="mx-auto grid h-7 w-10 place-items-center rounded-[8px] bg-white text-black">
            <Plus size={18} strokeWidth={3} />
          </div>
          <BottomNav icon={<MessageCircle size={17} />} label="Inbox" />
          <BottomNav icon={<UserRound size={17} />} label="Profile" />
        </div>

        {post.status && (
          <div className="absolute left-4 top-12 z-10 rounded-full bg-black/35 px-2.5 py-1 text-xs font-black uppercase text-white backdrop-blur">
            {post.status}
          </div>
        )}
        {post.duration && (
          <div className="absolute bottom-[108px] right-[72px] z-10 rounded-[5px] bg-black/70 px-1.5 py-0.5 text-xs font-bold text-white">
            {post.duration}
          </div>
        )}
      </div>
    </div>
  )
}

export function InstagramPostPreview({ post, className }: { post: SocialPreviewPost; className?: string }) {
  return (
    <div className={cn('mx-auto w-full max-w-[300px]', className)}>
      <div className="mb-3 text-center text-sm font-bold text-[#526179]">Xem trước bài viết</div>
      <div className="overflow-hidden rounded-[8px] border border-[var(--outline-variant)] bg-white">
        <div className="border-b border-[var(--outline-variant)] py-3 text-center font-serif text-lg text-[#111827]">Instagram</div>
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-2">
            <PreviewAvatar src={post.avatarUrl} name={post.profileName || 'SocialContentHub'} small />
            <span className="text-xs font-bold text-[#111827]">{post.profileName || 'aha.coffee'}</span>
          </div>
          <MoreHorizontal size={17} />
        </div>
        <PreviewMedia post={post} className="aspect-square rounded-none" />
        <div className="space-y-3 p-3">
          <div className="flex items-center justify-between">
            <div className="flex gap-3 text-[#111827]">
              <Heart size={18} fill="#ef233c" className="text-[#ef233c]" />
              <MessageCircle size={18} />
              <Send size={17} />
            </div>
            <Bookmark size={17} />
          </div>
          <p className="text-xs leading-5 text-[#34415a]">
            <strong>{post.profileName || 'aha.coffee'}</strong> {post.caption || post.title}
          </p>
          <p className="text-xs font-semibold text-[#2556ea]">#SocialContentHub #ContentAI #Vietnam</p>
          <p className="text-xs text-[#94a3b8]">1 phút trước</p>
        </div>
      </div>
    </div>
  )
}

function TikTokAction({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 drop-shadow">
      {icon}
      <span className="text-xs font-black">{label}</span>
    </div>
  )
}

function BottomNav({ icon, label, active }: { icon: ReactNode; label: string; active?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center gap-0.5 text-xs font-bold', active ? 'text-white' : 'text-white/65')}>
      {icon}
      {label}
    </div>
  )
}

function PreviewAvatar({ src, name, small }: { src?: string | null; name: string; small?: boolean }) {
  return (
    <div className={cn('overflow-hidden rounded-full border-2 border-white bg-slate-200', small ? 'h-7 w-7' : 'h-11 w-11')}>
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center bg-[#101827] text-xs font-black text-white">
          {name.slice(0, 1).toUpperCase()}
        </div>
      )}
    </div>
  )
}

function PreviewMedia({ post, className }: { post: SocialPreviewPost; className?: string }) {
  const mediaUrl = post.mediaUrl || ''
  const isVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(mediaUrl)
  const isImage = /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(mediaUrl)

  if (isVideo) {
    return (
      <div className={cn('relative overflow-hidden bg-black', className)}>
        <video src={mediaUrl} className="h-full w-full object-cover" autoPlay muted loop playsInline />
      </div>
    )
  }

  return (
    <Thumbnail
      src={isImage ? mediaUrl : null}
      title={post.title || ''}
      index={post.imageIndex || 0}
      className={className}
    />
  )
}

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, '')
    .slice(0, 24) || 'socialcontenthub'
}
