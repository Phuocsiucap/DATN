import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { BookOpen, FileText, Loader2, Search, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  createMediaWorkflowFromSourcesApi,
} from '@/commons/apis/generateVideo'
import {
  fetchContentStoriesApi,
  type ContentStory,
  type FinalContentItem,
} from '@/commons/apis/module1'
import {
  fetchSocialProfilesApi,
  type SocialProfile,
} from '@/commons/apis/socialProfiles'
import {
  AppButton,
  EmptyBlock,
  SearchField,
  SelectControl,
  SocialProfileAvatar,
  TabStrip,
} from '@/commons/component/social-ui'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/commons/component/ui/dialog'

type SourceTab = 'content' | 'story'
type SourceType = 'content' | 'story'

const sourceKey = (type: SourceType, id: string) => `${type}:${id}`

export function CreateWorkflowModal({
  open,
  contents,
  initialContentIds,
  onClose,
  onCreated,
}: {
  open: boolean
  contents: FinalContentItem[]
  initialContentIds: string[]
  onClose: () => void
  onCreated: (workflowId: string) => void
}) {
  const [profiles, setProfiles] = useState<SocialProfile[]>([])
  const [stories, setStories] = useState<ContentStory[]>([])
  const [profileId, setProfileId] = useState('')
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [primaryKey, setPrimaryKey] = useState('')
  const [sourceTab, setSourceTab] = useState<SourceTab>('content')
  const [search, setSearch] = useState('')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!open) return
    const availableIds = new Set(contents.map((item) => item.id))
    const initialKeys = [...new Set(initialContentIds)]
      .filter((id) => availableIds.has(id))
      .slice(0, 20)
      .map((id) => sourceKey('content', id))

    setSelectedKeys(initialKeys)
    setPrimaryKey(initialKeys[0] || '')
    setSourceTab('content')
    setSearch('')
    setTitle('')
    setNote('')
    setLoadError('')
    setLoadingOptions(true)

    let cancelled = false
    Promise.all([fetchSocialProfilesApi(), fetchContentStoriesApi()])
      .then(([profileResponse, storyResponse]) => {
        if (cancelled) return
        const activeProfiles = (profileResponse.items || []).filter((profile) => String(profile.status || '').toLowerCase() === 'active')
        setProfiles(activeProfiles)
        setStories(storyResponse || [])
        setProfileId((current) => activeProfiles.some((profile) => profile.id === current) ? current : activeProfiles[0]?.id || '')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const candidate = error as { response?: { data?: { detail?: string } }; message?: string }
        setProfiles([])
        setStories([])
        setProfileId('')
        setLoadError(candidate.response?.data?.detail || candidate.message || 'Không tải được kênh và truyện để tạo workflow.')
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false)
      })

    return () => { cancelled = true }
  }, [contents, initialContentIds, open])

  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys])
  const contentByKey = useMemo(() => new Map(contents.map((item) => [sourceKey('content', item.id), item])), [contents])
  const storyByKey = useMemo(() => new Map(stories.map((story) => [sourceKey('story', story.id), story])), [stories])
  const currentProfile = profiles.find((profile) => profile.id === profileId)

  const filteredContents = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return contents
    return contents.filter((item) => [item.canonical_title, item.summary, item.category, item.source_type]
      .some((value) => String(value || '').toLowerCase().includes(query)))
  }, [contents, search])

  const filteredStories = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return stories
    return stories.filter((story) => [story.canonical_name, story.normalized_name, story.completion_status]
      .some((value) => String(value || '').toLowerCase().includes(query)))
  }, [search, stories])

  const primaryTitle = primaryKey.startsWith('content:')
    ? contentByKey.get(primaryKey)?.canonical_title
    : storyByKey.get(primaryKey)?.canonical_name

  const toggleSource = (key: string) => {
    const isSelected = selectedSet.has(key)
    if (!isSelected && selectedKeys.length >= 20) {
      toast.error('Mỗi workflow chỉ hỗ trợ tối đa 20 nguồn.')
      return
    }
    const next = isSelected ? selectedKeys.filter((value) => value !== key) : [...selectedKeys, key]
    setSelectedKeys(next)
    if (!primaryKey || primaryKey === key) setPrimaryKey(next[0] || '')
  }

  const submit = async () => {
    if (!profileId) {
      toast.error('Hãy chọn một kênh social đích.')
      return
    }
    if (!primaryKey || !selectedSet.has(primaryKey)) {
      toast.error('Hãy chọn ít nhất một nguồn và đánh dấu nguồn chính.')
      return
    }

    const [primaryType, primaryId] = primaryKey.split(':') as [SourceType, string]
    const contentIds = selectedKeys.filter((key) => key.startsWith('content:')).map((key) => key.slice('content:'.length))
    const storyIds = selectedKeys.filter((key) => key.startsWith('story:')).map((key) => key.slice('story:'.length))

    setSubmitting(true)
    try {
      const workflow = await createMediaWorkflowFromSourcesApi({
        profile_id: profileId,
        content_ids: contentIds,
        story_ids: storyIds,
        primary_source: { type: primaryType, id: primaryId },
        title: title.trim() || undefined,
        note: note.trim() || undefined,
        selection_mode: 'MANUAL',
      })
      toast.success(`Đã tạo workflow với ${selectedKeys.length} nguồn cho ${currentProfile?.profile_name || 'kênh đã chọn'}.`)
      onCreated(workflow.id)
      onClose()
    } catch (error: unknown) {
      const candidate = error as { response?: { data?: { detail?: string } }; message?: string }
      toast.error(candidate.response?.data?.detail || candidate.message || 'Không thể tạo workflow sản xuất.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !submitting && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Tạo workflow sản xuất</DialogTitle>
          <DialogDescription>Chọn kênh đích, một nguồn chính và các nguồn bổ trợ cho video.</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-5">
          <section>
            <label className="mb-2 block text-sm font-extrabold text-[#34415a]">Kênh social đích</label>
            {loadingOptions ? (
              <div className="flex h-11 items-center gap-2 rounded-[8px] border border-[var(--outline-variant)] px-3 text-sm text-[#64748b]">
                <Loader2 size={16} className="animate-spin" /> Đang tải danh sách kênh...
              </div>
            ) : profiles.length === 0 ? (
              <EmptyBlock label={loadError || 'Chưa có kênh social đang hoạt động.'} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_280px]">
                <SelectControl value={profileId} onChange={setProfileId}>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.profile_name} · {profile.platform}</option>
                  ))}
                </SelectControl>
                {currentProfile && (
                  <div className="flex min-w-0 items-center gap-2 rounded-[8px] bg-[#f8fafc] px-3 py-2">
                    <SocialProfileAvatar avatarUrl={currentProfile.avatar_url} name={currentProfile.profile_name} platform={currentProfile.platform} size="sm" />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-extrabold text-[#172033]">{currentProfile.profile_name}</div>
                      <div className="truncate text-xs text-[#64748b]">{currentProfile.username ? `@${currentProfile.username.replace(/^@/, '')}` : currentProfile.platform}</div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-[10px] border border-[var(--outline-variant)]">
            <div className="border-b border-[var(--outline-variant)] bg-[#fbfcff] px-4 pt-1">
              <TabStrip
                value={sourceTab}
                onChange={setSourceTab}
                tabs={[
                  { value: 'content' as const, label: 'Nội dung', count: contents.length },
                  { value: 'story' as const, label: 'Truyện', count: stories.length },
                ]}
              />
              <div className="pb-3 pt-3">
                <SearchField
                  value={search}
                  onChange={setSearch}
                  placeholder={sourceTab === 'content' ? 'Tìm bài viết...' : 'Tìm truyện...'}
                />
              </div>
            </div>

            <div className="max-h-[330px] overflow-y-auto p-3">
              {sourceTab === 'content' ? (
                filteredContents.length > 0 ? filteredContents.map((item) => {
                  const key = sourceKey('content', item.id)
                  return (
                    <SourceOption
                      key={key}
                      sourceKey={key}
                      title={item.canonical_title}
                      description={[item.source_type, item.category, `${Number(item.quality_score || 0).toFixed(1)}/100`].filter(Boolean).join(' · ')}
                      icon={<FileText size={17} />}
                      selected={selectedSet.has(key)}
                      primary={primaryKey === key}
                      onToggle={() => toggleSource(key)}
                      onPrimary={() => setPrimaryKey(key)}
                    />
                  )
                }) : <EmptyBlock label="Không có nội dung phù hợp." />
              ) : (
                loadingOptions ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-sm text-[#64748b]"><Loader2 size={16} className="animate-spin" /> Đang tải truyện...</div>
                ) : filteredStories.length > 0 ? filteredStories.map((story) => {
                  const key = sourceKey('story', story.id)
                  return (
                    <SourceOption
                      key={key}
                      sourceKey={key}
                      title={story.canonical_name}
                      description={`${story.total_episodes} tập · ${story.completion_status}`}
                      icon={<BookOpen size={17} />}
                      selected={selectedSet.has(key)}
                      primary={primaryKey === key}
                      onToggle={() => toggleSource(key)}
                      onPrimary={() => setPrimaryKey(key)}
                    />
                  )
                }) : <EmptyBlock label={loadError || 'Chưa có truyện nào có thể sử dụng.'} />
              )}
            </div>
          </section>

          <div className="rounded-[8px] border border-[#dbe5ff] bg-[#f6f8ff] px-4 py-3 text-sm">
            <div className="font-extrabold text-[#34415a]">Nguồn chính: <span className="text-[#2556ea]">{primaryTitle || 'Chưa chọn'}</span></div>
            <div className="mt-1 text-xs text-[#64748b]">{selectedKeys.length} nguồn đã chọn · {Math.max(0, selectedKeys.length - 1)} nguồn bổ trợ</div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-extrabold text-[#34415a]">Tên workflow</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Để trống để dùng tên nguồn chính"
                className="h-10 w-full rounded-[8px] border border-[var(--outline-variant)] px-3 text-sm outline-none focus:border-[#6d5dfc] focus:ring-2 focus:ring-[#6d5dfc]/15"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-extrabold text-[#34415a]">Ghi chú</span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Yêu cầu hoặc ngữ cảnh bổ sung"
                className="h-10 w-full rounded-[8px] border border-[var(--outline-variant)] px-3 text-sm outline-none focus:border-[#6d5dfc] focus:ring-2 focus:ring-[#6d5dfc]/15"
              />
            </label>
          </div>
        </DialogBody>

        <DialogFooter className="justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#64748b]">
            <Search size={14} /> Chọn tối đa 20 nguồn
          </div>
          <div className="flex gap-2">
            <AppButton variant="secondary" disabled={submitting} onClick={onClose}>Hủy</AppButton>
            <AppButton
              icon={submitting ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
              disabled={submitting || loadingOptions || !profileId || !primaryKey}
              onClick={() => void submit()}
            >
              {submitting ? 'Đang tạo...' : 'Tạo workflow'}
            </AppButton>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SourceOption({
  sourceKey: key,
  title,
  description,
  icon,
  selected,
  primary,
  onToggle,
  onPrimary,
}: {
  sourceKey: string
  title: string
  description: string
  icon: ReactNode
  selected: boolean
  primary: boolean
  onToggle: () => void
  onPrimary: () => void
}) {
  return (
    <div className={`mb-2 flex items-center gap-3 rounded-[8px] border px-3 py-3 last:mb-0 ${selected ? 'border-[#aebcff] bg-[#f7f8ff]' : 'border-[#edf1f7] bg-white'}`}>
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        aria-label={`Chọn ${title}`}
        className="h-4 w-4 shrink-0 accent-[#6d5dfc]"
      />
      <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[8px] ${selected ? 'bg-[#e6eaff] text-[#2556ea]' : 'bg-[#f1f5f9] text-[#64748b]'}`}>{icon}</span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-extrabold text-[#172033]">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-[#64748b]">{description || key}</span>
        </span>
      </button>
      <label className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${primary ? 'bg-[#2556ea] text-white' : 'bg-[#eef1f7] text-[#526179]'} ${selected ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
        <input
          type="radio"
          name="workflow-primary-source"
          checked={primary}
          disabled={!selected}
          onChange={onPrimary}
          className="h-3.5 w-3.5 accent-[#2556ea]"
        />
        Nguồn chính
      </label>
    </div>
  )
}
