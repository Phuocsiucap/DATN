import { useState } from 'react'
import { X, Plus, Trash2, Link as LinkIcon, FileText, Image as ImageIcon } from 'lucide-react'
import { createContentApi, type ContentCreateInput } from '@/commons/apis/module1'

type ManualContentModalProps = {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  isSystemUser?: boolean
}

type MediaInput = {
  url: string
  type: 'IMAGE' | 'VIDEO' | 'AUDIO'
  thumbnail_url?: string
  caption?: string
}

export function ManualContentModal({ open, onClose, onSuccess, isSystemUser = false }: ManualContentModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Form state
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [fullText, setFullText] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [contentType, setContentType] = useState<'ARTICLE' | 'VIDEO' | 'IMAGE' | 'POST'>('ARTICLE')
  const [category, setCategory] = useState('')
  const [tags, setTags] = useState('')
  const [sourceAuthor, setSourceAuthor] = useState('')
  const [contentScope, setContentScope] = useState<'PRIVATE' | 'GLOBAL'>('PRIVATE')
  const [mediaItems, setMediaItems] = useState<MediaInput[]>([])
  const [newMediaUrl, setNewMediaUrl] = useState('')
  const [newMediaType, setNewMediaType] = useState<'IMAGE' | 'VIDEO' | 'AUDIO'>('IMAGE')

  const resetForm = () => {
    setTitle('')
    setSummary('')
    setFullText('')
    setSourceUrl('')
    setContentType('ARTICLE')
    setCategory('')
    setTags('')
    setSourceAuthor('')
    setContentScope('PRIVATE')
    setMediaItems([])
    setNewMediaUrl('')
    setNewMediaType('IMAGE')
    setError(null)
  }

  const handleAddMedia = () => {
    if (!newMediaUrl.trim()) return
    setMediaItems([...mediaItems, { url: newMediaUrl.trim(), type: newMediaType }])
    setNewMediaUrl('')
  }

  const handleRemoveMedia = (index: number) => {
    setMediaItems(mediaItems.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!title.trim()) {
      setError('Tiêu đề là bắt buộc')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const payload: ContentCreateInput = {
        canonical_title: title.trim(),
        summary: summary.trim() || null,
        full_text: fullText.trim() || null,
        canonical_url: sourceUrl.trim() || null,
        content_type: contentType,
        source_type: 'MANUAL',
        category: category.trim() || null,
        tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        language: 'vi',
        content_scope: contentScope,
        source_author: sourceAuthor.trim() || null,
        media_items: mediaItems.length > 0 ? mediaItems : undefined,
      }

      await createContentApi(payload)
      resetForm()
      onSuccess()
      onClose()
    } catch (err: any) {
      console.error('Failed to create content:', err)
      setError(err.response?.data?.detail || err.message || 'Không thể tạo nội dung. Vui lòng thử lại.')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) {
      resetForm()
      onClose()
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Thêm nội dung thủ công</h2>
            <p className="text-sm text-gray-500">Nhập bài viết, URL hoặc thêm media vào kho nội dung</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="overflow-y-auto max-h-[calc(90vh-140px)]">
          <div className="space-y-5 px-6 py-5">
            {/* Error Message */}
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
                {error}
              </div>
            )}

            {/* Title */}
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">
                Tiêu đề <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Nhập tiêu đề bài viết..."
                disabled={loading}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-50"
                required
              />
            </div>

            {/* Summary */}
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">
                Tóm tắt
              </label>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Mô tả ngắn gọn về nội dung..."
                rows={2}
                disabled={loading}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-50"
              />
            </div>

            {/* Full Text */}
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">
                Nội dung đầy đủ
              </label>
              <textarea
                value={fullText}
                onChange={(e) => setFullText(e.target.value)}
                placeholder="Nhập toàn bộ nội dung bài viết..."
                rows={6}
                disabled={loading}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-50"
              />
            </div>

            {/* Row: Content Type & Category */}
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-700">
                  Loại nội dung
                </label>
                <select
                  value={contentType}
                  onChange={(e) => setContentType(e.target.value as any)}
                  disabled={loading}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-50"
                >
                  <option value="ARTICLE">Bài viết</option>
                  <option value="VIDEO">Video</option>
                  <option value="IMAGE">Hình ảnh</option>
                  <option value="POST">Bài đăng</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-700">
                  Chuyên mục
                </label>
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="VD: Thời sự, Giải trí..."
                  disabled={loading}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-50"
                />
              </div>
            </div>

            {/* Tags */}
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">
                Thẻ (Tags)
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="Nhập các thẻ, phân cách bằng dấu phẩy..."
                disabled={loading}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-50"
              />
              <p className="mt-1 text-xs text-gray-500">VD: công nghệ, AI, tin tức</p>
            </div>

            {/* Row: Source URL & Author */}
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-700">
                  URL nguồn
                </label>
                <div className="relative">
                  <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input
                    type="url"
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                    placeholder="https://..."
                    disabled={loading}
                    className="w-full rounded-lg border border-gray-300 pl-10 pr-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-50"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-700">
                  Tác giả
                </label>
                <input
                  type="text"
                  value={sourceAuthor}
                  onChange={(e) => setSourceAuthor(e.target.value)}
                  placeholder="Tên tác giả..."
                  disabled={loading}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-50"
                />
              </div>
            </div>

            {/* Content Scope (Admin only) */}
            {isSystemUser && (
              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-700">
                  Phạm vi
                </label>
                <select
                  value={contentScope}
                  onChange={(e) => setContentScope(e.target.value as any)}
                  disabled={loading}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-50"
                >
                  <option value="PRIVATE">Riêng tư (Private)</option>
                  <option value="GLOBAL">Toàn cục (Global)</option>
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  Global: Chia sẻ với tất cả người dùng. Private: Chỉ bạn có thể sử dụng.
                </p>
              </div>
            )}

            {/* Media Section */}
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="mb-3 flex items-center gap-2">
                <ImageIcon size={18} className="text-gray-600" />
                <h3 className="text-sm font-semibold text-gray-700">Media (Hình ảnh / Video)</h3>
              </div>

              {/* Add Media Input */}
              <div className="mb-3 flex gap-2">
                <select
                  value={newMediaType}
                  onChange={(e) => setNewMediaType(e.target.value as any)}
                  disabled={loading}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none disabled:bg-gray-50"
                >
                  <option value="IMAGE">Ảnh</option>
                  <option value="VIDEO">Video</option>
                  <option value="AUDIO">Audio</option>
                </select>
                <input
                  type="url"
                  value={newMediaUrl}
                  onChange={(e) => setNewMediaUrl(e.target.value)}
                  placeholder="Nhập URL của media..."
                  disabled={loading}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-50"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleAddMedia()
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={handleAddMedia}
                  disabled={loading || !newMediaUrl.trim()}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus size={16} />
                </button>
              </div>

              {/* Media List */}
              {mediaItems.length > 0 ? (
                <ul className="space-y-2">
                  {mediaItems.map((media, index) => (
                    <li key={index} className="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                      <span className="inline-flex items-center rounded bg-indigo-100 px-2 py-1 text-xs font-medium text-indigo-700">
                        {media.type}
                      </span>
                      <span className="flex-1 truncate text-gray-700">{media.url}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveMedia(index)}
                        disabled={loading}
                        className="text-red-500 hover:text-red-700 disabled:opacity-50"
                      >
                        <Trash2 size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-center text-sm text-gray-400 py-2">Chưa có media nào</p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 bg-gray-50">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim()}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Đang tạo...
                </>
              ) : (
                <>
                  <FileText size={16} />
                  Tạo nội dung
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
