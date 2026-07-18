import type { z } from "zod";
import type {
  CreateJobSchema,
  DeepSeekConfigInputSchema,
  DeepSeekConfigSchema,
  JobSchema,
  JobsWebSocketEventSchema,
  KeywordPlanSchema,
  PreviewUrlSchema,
  SearchCandidateSchema,
  SearchResponseSchema,
  SeriesInfoSchema,
  SourceSchema,
  SubtitleStyleSchema,
  TikTokMetadataSchema,
  TranslateTitleResponseSchema,
  VideoDetailEpisodeSchema,
  VideoDetailRelatedSchema,
  VideoFilterSchema
} from "./schemas";

export type Job = z.infer<typeof JobSchema>;
export type JobsWebSocketEvent = z.infer<typeof JobsWebSocketEventSchema>;
export type CreateJobInput = z.infer<typeof CreateJobSchema>;
export type SubtitleStyleInput = z.infer<typeof SubtitleStyleSchema>;
export type VideoFilterInput = z.infer<typeof VideoFilterSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type KeywordPlan = z.infer<typeof KeywordPlanSchema>;
export type SearchCandidate = z.infer<typeof SearchCandidateSchema>;
export type VideoDetailEpisode = z.infer<typeof VideoDetailEpisodeSchema>;
export type VideoDetailRelated = z.infer<typeof VideoDetailRelatedSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type SearchMode = "keyword" | "trending" | "link";
export type PreviewUrl = z.infer<typeof PreviewUrlSchema>;
export type SeriesInfo = z.infer<typeof SeriesInfoSchema>;
export type TranslateTitleResponse = z.infer<typeof TranslateTitleResponseSchema>;
export type TikTokMetadata = z.infer<typeof TikTokMetadataSchema>;
export type DeepSeekConfig = z.infer<typeof DeepSeekConfigSchema>;
export type DeepSeekConfigInput = z.infer<typeof DeepSeekConfigInputSchema>;

export type SocialProfile = {
  id: number;
  platform: string;
  profile_name: string;
  username?: string | null;
  status: string;
};
