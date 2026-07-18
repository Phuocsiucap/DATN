import { z } from "zod";

export const JobSchema = z.object({
  id: z.number(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  stage: z.enum([
    "queued",
    "keyword",
    "downloading",
    "transcribing",
    "translating",
    "rendering",
    "completed",
    "failed"
  ]),
  progress: z.number(),
  input_text: z.string(),
  niche: z.enum(["generic", "short_film", "cooking", "smart_home", "gadgets"]),
  max_duration_seconds: z.number().optional(),
  source_url: z.string().nullable(),
  artifacts: z.record(z.string(), z.unknown()),
  error_message: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

export const JobsSnapshotEventSchema = z.object({
  type: z.literal("jobs_snapshot"),
  jobs: z.array(JobSchema)
});

export const JobChangedEventSchema = z.object({
  type: z.enum(["job_created", "job_updated", "job_deleted"]),
  job: JobSchema
});

export const JobsWebSocketEventSchema = z.union([JobsSnapshotEventSchema, JobChangedEventSchema]);

export const CreateJobSchema = z.object({
  input_text: z.string().min(1),
  niche: z.enum(["generic", "short_film", "cooking", "smart_home", "gadgets"]),
  source_url: z.string().url().optional().or(z.literal("")),
  source_platform: z.string().optional().nullable(),
  source_title: z.string().optional().nullable(),
  max_duration_seconds: z.number().min(15).max(14400)
});

export const SubtitleStyleSchema = z.object({
  font_size: z.number().min(12).max(34),
  position: z.enum(["bottom", "middle", "top"])
});

export const VideoFilterSchema = z.object({
  preset: z.enum(["studio_bright", "cinematic_dark", "warm_pop", "cool_clean", "natural"]),
  speed: z.number().min(0.9).max(1.15)
});

export const SourceSchema = z.enum(["bilibili"]);

export const KeywordPlanSchema = z.object({
  source_text_vi: z.string(),
  keyword_zh: z.string(),
  queries: z.array(z.string()),
  platform_priority: z.array(z.string()),
  provider: z.string(),
  inferred_niche: z.string().optional(),
  confidence: z.number().optional(),
  reasoning: z.string().optional()
});

export const SearchCandidateSchema = z.object({
  title: z.string(),
  title_vi: z.string().nullable().optional(),
  url: z.string(),
  aid: z.number().nullable().optional(),
  bvid: z.string().nullable().optional(),
  platform: z.string(),
  duration_seconds: z.number().nullable(),
  query: z.string(),
  thumbnail_url: z.string().nullable(),
  description: z.string().nullable(),
  review_count: z.number().nullable().optional(),
  danmaku_count: z.number().nullable().optional(),
  episode_count_text: z.string().nullable().optional(),
  embed_url: z.string().nullable().optional(),
  preview_mode: z.enum(["iframe"]).optional(),
  downloadable: z.boolean().optional(),
  availability_note: z.string().nullable().optional(),
  series_key: z.string().nullable().optional(),
  series_title: z.string().nullable().optional(),
  episode_index: z.number().nullable().optional(),
  playlist_size: z.number().nullable().optional()
});

const VideoDetailItemBaseSchema = z.object({
  title: z.string(),
  url: z.string(),
  aid: z.number().nullable().optional(),
  bvid: z.string().nullable().optional(),
  platform: z.string(),
  duration_seconds: z.number().nullable(),
  thumbnail_url: z.string().nullable(),
  description: z.string().nullable(),
  embed_url: z.string().nullable().optional(),
  preview_mode: z.enum(["iframe"]).optional(),
  downloadable: z.boolean().optional()
});

export const VideoDetailEpisodeSchema = VideoDetailItemBaseSchema.extend({
  episode_index: z.number().nullable().optional(),
  playlist_size: z.number().nullable().optional(),
  query: z.literal("view_detail_pages").optional()
});

export const VideoDetailRelatedSchema = VideoDetailItemBaseSchema.extend({
  query: z.literal("related").optional()
});

export const SearchResponseSchema = z.object({
  keyword_plan: KeywordPlanSchema,
  candidates: z.array(SearchCandidateSchema)
});

export const PreviewUrlSchema = z.object({
  url: z.string(),
  title: z.string().nullable(),
  duration_seconds: z.number().nullable()
});

export const SeriesInfoSchema = z.object({
  aid: z.number().nullable(),
  bvid: z.string().nullable(),
  title: z.string(),
  episode_count: z.number(),
  related_count: z.number(),
  source: z.string(),
  current: SearchCandidateSchema.nullable().optional(),
  episodes: z.array(VideoDetailEpisodeSchema).optional(),
  related: z.array(VideoDetailRelatedSchema).optional()
});

export const TranslateTitleResponseSchema = z.object({
  title: z.string(),
  title_vi: z.string()
});

export const TikTokMetadataSchema = z.object({
  title: z.string(),
  description: z.string(),
  hashtags: z.array(z.string()),
  hook: z.string().optional(),
  source_summary: z.string().optional()
});

export const DeepSeekConfigSchema = z.object({
  api_key_masked: z.string(),
  has_api_key: z.boolean(),
  base_url: z.string(),
  keyword_model: z.string(),
  subtitle_model: z.string(),
  reasoning_effort: z.string(),
  config_path: z.string()
});

export const DeepSeekConfigInputSchema = z.object({
  api_key: z.string().optional(),
  base_url: z.string().min(1),
  keyword_model: z.string().min(1),
  subtitle_model: z.string().min(1),
  reasoning_effort: z.string().optional()
});
