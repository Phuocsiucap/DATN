import { type ReactNode, useState } from 'react'
import { createPortal } from 'react-dom'
import { Activity, Bot, Clock, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { AppButton, SelectControl, SocialProfileAvatar, StatusPill } from '@/commons/component/social-ui'
import { cn } from '@/commons/lib/utils'

export type SocialProfile = {
  id: string
  platform: string
  profile_name: string
  username?: string | null
  external_id?: string | null
  avatar_url?: string | null
  follower_count?: number | null
  following_count?: number | null
  likes_count?: number | null
  video_count?: number | null
  metadata?: Record<string, any> | null
  scopes?: string[]
  status: string
}

export type StrategyTopicDetail = {
  topic: string
  topic_key: string
  description: string
  embedding_text: string
  custom_description: boolean
}

type SocialProfileStrategyDialogProps = {
  open: boolean
  profile: SocialProfile | null
  strategyForm: any
  strategyLoading: boolean
  saving: boolean
  onClose: () => void
  onChange: (key: string, value: any) => void
  onSave: () => void
}

const splitTopicList = (value?: string | null) =>
  String(value || '')
    .replace(/\n/g, ',')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

const strategyTopicKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim()

const topicDescriptionRows = (topics?: string | null, descriptions?: Record<string, string> | null): StrategyTopicDetail[] => {
  const descriptionMap = descriptions || {}
  return splitTopicList(topics).map((topic) => {
    const topic_key = strategyTopicKey(topic)
    const description = String(descriptionMap[topic_key] || '').trim()
    return {
      topic,
      topic_key,
      description,
      embedding_text: description ? `Topic: ${topic}\nDescription: ${description}` : '',
      custom_description: Boolean(description),
    }
  })
}

const setTopicDescription = (descriptions: Record<string, string> | undefined, topicKey: string, description: string) => {
  const next = { ...(descriptions || {}) }
  const clean = description.trim()
  if (clean) next[topicKey] = clean
  else delete next[topicKey]
  return next
}

const removeTopicFromList = (topics: string | undefined, topicKey: string) =>
  splitTopicList(topics).filter((topic) => strategyTopicKey(topic) !== topicKey).join(', ')

function formatProfileMetric(value: number | null) {
  if (value === null) return '-'
  return new Intl.NumberFormat('vi-VN', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

function resolveProfileMetric(profile: SocialProfile, key: 'follower_count' | 'following_count' | 'likes_count' | 'video_count') {
  const directValue = profile[key]
  const metadata = profile.metadata || {}
  const metadataUser = metadata.user && typeof metadata.user === 'object' ? metadata.user : {}
  const metadataValue = metadataUser[key] ?? metadata[key]
  const value = directValue ?? metadataValue
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(numeric, 0) : null
}

export function SocialProfileStrategyDialog({
  open,
  profile,
  strategyForm,
  strategyLoading,
  saving,
  onClose,
  onChange,
  onSave,
}: SocialProfileStrategyDialogProps) {
  const [activeTab, setActiveTab] = useState<'content' | 'ai' | 'automation'>('content')

  if (!open || !profile) return null

  const contentTopicDescriptions = strategyForm.content_topic_descriptions || {}
  const avoidTopicDescriptions = strategyForm.avoid_topic_descriptions || {}
  const contentTopicItems = topicDescriptionRows(strategyForm.content_topics, contentTopicDescriptions)
  const avoidTopicItems = topicDescriptionRows(strategyForm.avoid_topics, avoidTopicDescriptions)

  const followers = resolveProfileMetric(profile, 'follower_count')
  const likes = resolveProfileMetric(profile, 'likes_count')
  const videos = resolveProfileMetric(profile, 'video_count')

  const dialogContent = (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-xs sm:p-6">
      <div
        className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl"
        style={{ borderColor: 'var(--outline-variant)' }}
      >
        {/* Header with profile info */}
        <div
          className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b px-6 py-4"
          style={{ borderColor: 'var(--outline-variant)', backgroundColor: 'var(--surface-container-low)' }}
        >
          <div className="flex items-center gap-4 min-w-0">
            <SocialProfileAvatar
              avatarUrl={profile.avatar_url}
              name={profile.profile_name}
              platform={profile.platform}
              size="xl"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold truncate text-[var(--on-surface)]">
                  {profile.profile_name}
                </h2>
                <StatusPill value={profile.status || 'active'} />
              </div>
              <p className="text-xs text-[var(--on-surface-variant)] truncate mt-0.5">
                {profile.username ? `@${profile.username}` : profile.platform} · {profile.platform.toUpperCase()}
              </p>
              <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-600">
                {followers !== null && <span><strong>{formatProfileMetric(followers)}</strong> Follower</span>}
                {likes !== null && <span>· <strong>{formatProfileMetric(likes)}</strong> Lượt thích</span>}
                {videos !== null && <span>· <strong>{formatProfileMetric(videos)}</strong> Video</span>}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-white hover:bg-slate-100 transition"
            style={{ borderColor: 'var(--outline-variant)', color: 'var(--on-surface)' }}
          >
            <X size={17} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex shrink-0 border-b px-6 bg-slate-50/50" style={{ borderColor: 'var(--outline-variant)' }}>
          {[
            { id: 'content', label: '1. Nội dung & Topic AI', icon: <Bot size={15} /> },
            { id: 'ai', label: '2. Ngưỡng tương đồng AI', icon: <Activity size={15} /> },
            { id: 'automation', label: '3. Tự động hóa & Lịch đăng', icon: <Clock size={15} /> },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                'flex items-center gap-2 border-b-2 py-3 px-4 text-xs font-bold transition',
                activeTab === tab.id
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
          {strategyLoading ? (
            <div className="flex min-h-[360px] items-center justify-center text-sm text-[var(--on-surface-variant)]">
              <RefreshCw className="mr-2 animate-spin" size={20} /> Đang tải cấu hình chiến lược...
            </div>
          ) : (
            <>
              {activeTab === 'content' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-bold text-[var(--on-surface)] flex items-center gap-2">
                      <Bot size={16} className="text-[var(--accent)]" /> Định hướng chủ đề & Phong cách
                    </h3>
                    <p className="mt-1 text-xs text-[var(--on-surface-variant)] leading-5">
                      Xác định chủ đề ưu tiên, từ khóa loại trừ và giọng điệu chính để AI chấm điểm, đề xuất bài viết và biên soạn kịch bản.
                    </p>
                  </div>

                  <Field label="Preferred Topics" description="Các chủ đề AI nên ưu tiên khi crawl và chọn bài. Phân tách bằng dấu phẩy.">
                    <TagInput
                      value={strategyForm.content_topics || ''}
                      onChange={(value) => onChange('content_topics', value)}
                      placeholder="Cà phê, Pha chế, Kinh doanh F&B"
                    />
                  </Field>

                  <TopicDescriptionList
                    title="Topic embedding descriptions"
                    items={contentTopicItems}
                    onDescriptionChange={(topicKey, description) =>
                      onChange('content_topic_descriptions', setTopicDescription(contentTopicDescriptions, topicKey, description))
                    }
                    onDelete={(topicKey) => {
                      onChange('content_topics', removeTopicFromList(strategyForm.content_topics, topicKey))
                      onChange('content_topic_descriptions', setTopicDescription(contentTopicDescriptions, topicKey, ''))
                    }}
                  />

                  <Field label="Topics to Avoid" description="Các chủ đề rủi ro hoặc lệch định hướng kênh cần loại khỏi luồng AI.">
                    <TagInput
                      danger
                      value={strategyForm.avoid_topics || ''}
                      onChange={(value) => onChange('avoid_topics', value)}
                      placeholder="Chính trị, Tin đồn, Nội dung gây tranh cãi"
                    />
                  </Field>

                  <TopicDescriptionList
                    danger
                    title="Avoid topic descriptions"
                    items={avoidTopicItems}
                    onDescriptionChange={(topicKey, description) =>
                      onChange('avoid_topic_descriptions', setTopicDescription(avoidTopicDescriptions, topicKey, description))
                    }
                    onDelete={(topicKey) => {
                      onChange('avoid_topics', removeTopicFromList(strategyForm.avoid_topics, topicKey))
                      onChange('avoid_topic_descriptions', setTopicDescription(avoidTopicDescriptions, topicKey, ''))
                    }}
                  />

                  <Field label="Primary Tone" description="Giọng điệu chủ đạo khi viết caption, hook và kịch bản video.">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {[
                        { value: 'Professional & Authoritative', helper: 'Rõ ràng, chuyên nghiệp' },
                        { value: 'Dramatic & Urgent', helper: 'Mạnh mẽ, thời sự' },
                        { value: 'Mystery & Intrigue', helper: 'Gợi tò mò, bí ẩn' },
                        { value: 'Casual & Approachable', helper: 'Gần gũi, tự nhiên' },
                      ].map((tone) => (
                        <button
                          key={tone.value}
                          type="button"
                          onClick={() => onChange('tone', tone.value)}
                          className={cn(
                            'min-h-[64px] rounded-lg border px-3 py-2 text-left transition',
                            strategyForm.tone === tone.value
                              ? 'border-[var(--accent)] bg-indigo-50 text-[var(--accent)] shadow-[0_0_0_1px_rgba(53,37,205,0.18)]'
                              : 'border-[var(--outline-variant)] text-[var(--on-surface)] hover:border-indigo-200 hover:bg-slate-50'
                          )}
                        >
                          <span className="block text-xs font-bold leading-4">{tone.value}</span>
                          <span className="mt-1 block text-[11px] font-medium leading-4 text-[var(--on-surface-variant)]">
                            {tone.helper}
                          </span>
                        </button>
                      ))}
                    </div>
                  </Field>

                  <Field label="Target Audience Persona" description="Mô tả chân dung khán giả mục tiêu (độ tuổi, sở thích, hành vi).">
                    <textarea
                      rows={4}
                      value={strategyForm.target_audience || ''}
                      onChange={(event) => onChange('target_audience', event.target.value)}
                      className="w-full resize-y rounded-lg border border-[var(--outline-variant)] bg-white px-3 py-2 text-sm leading-6 text-[var(--on-surface)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-indigo-100"
                      placeholder="Chủ quán cà phê, barista và người yêu cà phê..."
                    />
                  </Field>
                </div>
              )}

              {activeTab === 'ai' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-bold text-[var(--on-surface)] flex items-center gap-2">
                      <Activity size={16} className="text-[var(--accent)]" /> Cài đặt điểm tương đồng AI Matching
                    </h3>
                    <p className="mt-1 text-xs text-[var(--on-surface-variant)] leading-5">
                      Điều chỉnh các ngưỡng Cosine Similarity để lọc bài viết đạt yêu cầu trước khi đề xuất cho kênh.
                    </p>
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <SwitchRow
                      label="Receive System Content"
                      description="Cho phép nhận gợi ý tự động từ nguồn bài crawlers toàn hệ thống"
                      checked={strategyForm.receive_system_content ?? true}
                      onChange={(checked) => onChange('receive_system_content', checked)}
                    />

                    <Field label="Max Recommendations / Day" description="Số lượng bài AI đề xuất tối đa mỗi ngày cho kênh này">
                      <input
                        className="app-input"
                        type="number"
                        value={strategyForm.max_system_recommendations ?? 10}
                        onChange={(event) => onChange('max_system_recommendations', parseInt(event.target.value, 10))}
                      />
                    </Field>
                  </div>

                  <div className="space-y-5 rounded-xl border border-[var(--outline-variant)] bg-slate-50/50 p-5">
                    <SliderField
                      label="Embedding Similarity Threshold (Ngưỡng khớp topic)"
                      value={Number(strategyForm.min_similarity ?? 0.62)}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(value) => onChange('min_similarity', value)}
                    />

                    <SliderField
                      label="Avoid Topic Similarity Limit (Ngưỡng tránh rủi ro)"
                      value={Number(strategyForm.avoid_similarity_threshold ?? 0.72)}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(value) => onChange('avoid_similarity_threshold', value)}
                    />
                  </div>
                </div>
              )}

              {activeTab === 'automation' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-bold text-[var(--on-surface)] flex items-center gap-2">
                      <Clock size={16} className="text-[var(--accent)]" /> Luồng tự động hóa & Lịch đăng
                    </h3>
                    <p className="mt-1 text-xs text-[var(--on-surface-variant)] leading-5">
                      Duyệt nội dung, chọn lịch và tự đăng là ba bước riêng. Duyệt tại Approvals, quản lý lịch tại Lịch đăng.
                    </p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Duyệt video thành phẩm">
                      <SelectControl value={strategyForm.approval_mode || 'manual'} onChange={(value) => onChange('approval_mode', value)}>
                        <option value="manual">Thủ công: Đưa vào tab Chờ duyệt</option>
                        <option value="auto">Tự động: Duyệt khi render xong và qua kiểm tra cơ bản</option>
                      </SelectControl>
                    </Field>

                    <Field label="Video Render Mode">
                      <SelectControl value={strategyForm.video_render_mode || 'manual'} onChange={(value) => onChange('video_render_mode', value)}>
                        <option value="manual">Manual render sau khi duyệt kịch bản</option>
                        <option value="auto">Auto render ngay khi kịch bản sẵn sàng</option>
                      </SelectControl>
                    </Field>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <SwitchRow
                      label="Auto Create Workflow"
                      description="Tự tạo kịch bản từ nội dung đạt điểm cao"
                      checked={strategyForm.auto_project_queue_enabled || false}
                      onChange={(checked) => onChange('auto_project_queue_enabled', checked)}
                    />
                    <SwitchRow
                      label="Tự lên lịch sau khi tự duyệt"
                      description="Bật: luồng tự động chọn giờ đăng sau khi duyệt. Tắt: video nằm ở tab Đã duyệt, chờ bạn bấm Lên lịch. Nút Duyệt thủ công luôn chỉ duyệt."
                      checked={strategyForm.auto_queue_enabled ?? true}
                      onChange={(checked) => onChange('auto_queue_enabled', checked)}
                    />
                  </div>

                  <div className="border-t pt-5 space-y-4" style={{ borderColor: 'var(--outline-variant)' }}>
                    <h4 className="text-xs font-extrabold uppercase text-[var(--on-surface-variant)]">Cấu hình khung giờ đăng bài</h4>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <SwitchRow
                        label="Tự động đăng theo lịch"
                        description="Tự động gửi bài đủ điều kiện lên TikTok khi tới lịch. Tắt để chỉ lưu lịch, không tự đăng."
                        checked={strategyForm.auto_publish_enabled ?? false}
                        onChange={(checked) => onChange('auto_publish_enabled', checked)}
                      />
                      <Field label="Múi giờ">
                        <input
                          className="app-input"
                          value={strategyForm.schedule_timezone || 'Asia/Bangkok'}
                          onChange={(event) => onChange('schedule_timezone', event.target.value)}
                        />
                      </Field>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Các ngày chạy scheduler trong tuần (0: CN, 1: T2...)">
                        <input
                          className="app-input"
                          value={strategyForm.schedule_days || '0,1,2,3,4,5,6'}
                          onChange={(event) => onChange('schedule_days', event.target.value)}
                        />
                      </Field>
                      <Field label="Khung giờ xuất bản bài viết">
                        <input
                          className="app-input"
                          value={strategyForm.schedule_times || '08:30,20:30'}
                          onChange={(event) => onChange('schedule_times', event.target.value)}
                        />
                      </Field>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div
          className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-6 py-4 bg-slate-50"
          style={{ borderColor: 'var(--outline-variant)' }}
        >
          <div className="text-xs text-slate-500">
            Profile: <strong className="text-slate-800">{profile.profile_name}</strong>
          </div>
          <div className="flex items-center gap-2">
            <AppButton variant="secondary" onClick={onClose} disabled={saving}>
              Hủy
            </AppButton>
            <AppButton icon={<Save size={15} />} disabled={saving || strategyLoading} onClick={onSave}>
              {saving ? 'Đang lưu...' : 'Lưu cấu hình chiến lược'}
            </AppButton>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(dialogContent, document.body)
}

function Field({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-[var(--on-surface)]">{label}</span>
      {description && <span className="block text-[11px] leading-4 text-[var(--on-surface-variant)]">{description}</span>}
      {children}
    </label>
  )
}

function TagInput({ value, onChange, placeholder, danger = false }: { value: string; onChange: (value: string) => void; placeholder: string; danger?: boolean }) {
  const tags = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  return (
    <div
      className={cn(
        'rounded-lg border bg-white px-3 py-2 transition focus-within:ring-2',
        danger
          ? 'border-rose-100 focus-within:border-rose-400 focus-within:ring-rose-100'
          : 'border-[var(--outline-variant)] focus-within:border-[var(--accent)] focus-within:ring-indigo-100'
      )}
    >
      <div className="mb-2 flex min-h-7 flex-wrap gap-1.5">
        {tags.length > 0 ? (
          tags.map((tag) => (
            <span
              key={tag}
              className={cn(
                'inline-flex max-w-full items-center rounded-md px-2 py-1 text-[11px] font-semibold leading-none',
                danger ? 'bg-rose-50 text-rose-700' : 'bg-indigo-50 text-[var(--accent)]'
              )}
            >
              {tag}
            </span>
          ))
        ) : (
          <span className="text-[11px] leading-7 text-slate-400">Chưa có tag nào</span>
        )}
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full resize-y border-0 bg-transparent p-0 text-sm leading-6 text-[var(--on-surface)] outline-none placeholder:text-slate-400 focus:ring-0"
      />
    </div>
  )
}

function TopicDescriptionList({
  title,
  items,
  danger = false,
  onDescriptionChange,
  onDelete,
}: {
  title: string
  items: StrategyTopicDetail[]
  danger?: boolean
  onDescriptionChange: (topicKey: string, description: string) => void
  onDelete: (topicKey: string) => void
}) {
  if (!items.length) return null
  return (
    <div className={cn('rounded-lg border p-3.5', danger ? 'border-rose-100 bg-rose-50/50' : 'border-indigo-100 bg-indigo-50/50')}>
      <div className={cn('text-[11px] font-extrabold uppercase', danger ? 'text-rose-700' : 'text-[var(--accent)]')}>{title}</div>
      <div className="mt-2 space-y-2">
        {items.map((item) => (
          <div key={`${title}-${item.topic_key}`} className="rounded-md bg-white p-3 border border-slate-100 shadow-2xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-xs font-extrabold text-[var(--on-surface)]">{item.topic}</span>
                <span className="rounded-[5px] bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-500">{item.topic_key}</span>
                {item.custom_description && (
                  <span className={cn('rounded-[5px] px-2 py-0.5 text-[10px] font-bold', danger ? 'bg-rose-50 text-rose-700' : 'bg-indigo-50 text-[var(--accent)]')}>
                    custom
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onDelete(item.topic_key)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                title="Xóa topic"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <textarea
              value={item.description}
              onChange={(event) => onDescriptionChange(item.topic_key, event.target.value)}
              placeholder="Nhập description riêng cho topic này..."
              rows={2}
              className={cn(
                'mt-2 min-h-[60px] w-full resize-y rounded-md border bg-white px-2.5 py-2 text-[12px] leading-5 text-[var(--on-surface)] outline-none placeholder:text-slate-400 focus:ring-2',
                danger
                  ? 'border-rose-100 focus:border-rose-400 focus:ring-rose-100'
                  : 'border-[var(--outline-variant)] focus:border-[var(--accent)] focus:ring-indigo-100'
              )}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-1.5 bg-white p-3 rounded-lg border border-slate-200">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-[var(--on-surface)]">{label}</span>
        <span className="rounded-md border border-[var(--outline-variant)] bg-slate-50 px-2 py-0.5 font-mono font-bold text-[var(--accent)]">
          {suffix ? `${Math.round(value)}${suffix}` : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[var(--accent)]"
      />
    </div>
  )
}

function SwitchRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--outline-variant)] bg-white px-4 py-3">
      <div className="min-w-0">
        <div className="text-xs font-bold text-[var(--on-surface)]">{label}</div>
        <div className="truncate text-[11px] text-[var(--on-surface-variant)]">{description}</div>
      </div>
      <label className="relative inline-flex shrink-0 cursor-pointer items-center">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span className="h-5 w-9 rounded-full bg-slate-200 transition peer-checked:bg-[var(--accent)]" />
        <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition peer-checked:translate-x-4" />
      </label>
    </div>
  )
}
