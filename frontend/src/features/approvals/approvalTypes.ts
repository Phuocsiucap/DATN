export type ApprovalQueueItem = {
  id: string
  profile_id: string
  profile_name?: string | null
  profile_username?: string | null
  profile_avatar_url?: string | null
  profile_scopes?: string[]
  profile_strategy?: { approval_mode: string; auto_queue_enabled: boolean; auto_publish_enabled: boolean } | null
  content_id?: string | null
  article_link?: string | null
  article_title: string
  platform: string
  generated_content?: string | null
  caption?: string | null
  ai_reason?: string | null
  status: string
  platform_publish_id?: string | null
  publish_status?: Record<string, unknown>
  scheduled_at?: string | null
  scheduled_at_local?: string | null
  published_at?: string | null
  created_at?: string | null
  updated_at?: string | null
  error?: string | null
  video_url?: string | null
  thumbnail_url?: string | null
  source_url?: string | null
  category?: string | null
  tags?: string[]
  quality_score?: number | null
  duration_seconds?: number | null
  creator_name?: string | null
  can_upload_inbox?: boolean
  can_publish_direct?: boolean
}
