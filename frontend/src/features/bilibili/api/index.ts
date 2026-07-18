import { z } from "zod";
import {
  applyBilibiliCrawlerFilterApi,
  applyBilibiliCrawlerSubtitlesApi,
  cancelBilibiliCrawlerJobApi,
  createBilibiliCrawlerJobApi,
  createBilibiliCrawlerKeywordPlanApi,
  deleteBilibiliCrawlerJobApi,
  fetchBilibiliCrawlerDeepSeekConfigApi,
  fetchBilibiliCrawlerJobsApi,
  getBilibiliCrawlerSeriesInfoApi,
  fetchSocialProfilesApi,
  generateBilibiliCrawlerTikTokMetadataApi,
  getBilibiliCrawlerImageProxyUrl,
  getBilibiliCrawlerMediaUrl,
  getBilibiliCrawlerPreviewUrlApi,
  getBilibiliCrawlerSegmentUrl,
  openBilibiliCrawlerOutputFolderApi,
  retryBilibiliCrawlerJobApi,
  retranslateBilibiliCrawlerJobApi,
  mergeBilibiliCrawlerJobsApi,
  mergeBilibiliCrawlerPartsApi,
  searchBilibiliCrawlerApi,
  translateBilibiliCrawlerTitleApi,
  updateBilibiliCrawlerDeepSeekConfigApi
} from "@/commons/apis/api";
import { publishBilibiliJobToTikTokApi } from "@/commons/apis/publish";
import {
  DeepSeekConfigSchema,
  JobSchema,
  KeywordPlanSchema,
  PreviewUrlSchema,
  SearchResponseSchema,
  SeriesInfoSchema,
  TikTokMetadataSchema,
  TranslateTitleResponseSchema
} from "../schemas";
import type {
  CreateJobInput,
  DeepSeekConfig,
  DeepSeekConfigInput,
  Job,
  KeywordPlan,
  PreviewUrl,
  SearchCandidate,
  SearchMode,
  SearchResponse,
  SeriesInfo,
  SocialProfile,
  Source,
  SubtitleStyleInput,
  TikTokMetadata,
  TranslateTitleResponse,
  VideoFilterInput
} from "../types";

export async function searchCandidates(input: {
  input_text: string;
  sources: Source[];
  max_duration_seconds: number;
  limit: number;
  mode?: SearchMode;
}): Promise<SearchResponse> {
  return SearchResponseSchema.parse(await searchBilibiliCrawlerApi(input));
}

export async function getDeepSeekConfig(): Promise<DeepSeekConfig> {
  return DeepSeekConfigSchema.parse(await fetchBilibiliCrawlerDeepSeekConfigApi());
}

export async function updateDeepSeekConfig(input: DeepSeekConfigInput): Promise<DeepSeekConfig> {
  return DeepSeekConfigSchema.parse(await updateBilibiliCrawlerDeepSeekConfigApi(input));
}

export async function getPreviewUrl(url: string): Promise<PreviewUrl> {
  return PreviewUrlSchema.parse(await getBilibiliCrawlerPreviewUrlApi(url));
}

export async function getSeriesInfo(input: {
  url?: string | null;
  aid?: number | null;
  bvid?: string | null;
}): Promise<SeriesInfo> {
  return SeriesInfoSchema.parse(await getBilibiliCrawlerSeriesInfoApi(input));
}

export async function translateTitle(title: string): Promise<TranslateTitleResponse> {
  return TranslateTitleResponseSchema.parse(await translateBilibiliCrawlerTitleApi(title));
}

export async function createKeywordPlan(input: Pick<CreateJobInput, "input_text" | "niche">): Promise<KeywordPlan> {
  return KeywordPlanSchema.parse(await createBilibiliCrawlerKeywordPlanApi(input));
}

export async function createJob(input: CreateJobInput): Promise<Job> {
  const payload = {
    ...input,
    source_url: input.source_url ? input.source_url : null
  };
  return JobSchema.parse(await createBilibiliCrawlerJobApi(payload));
}

export async function createJobFromCandidate(input: {
  input_text: string;
  candidate: SearchCandidate;
  max_duration_seconds: number;
}): Promise<Job> {
  return createJob({
    input_text: input.input_text,
    niche: "smart_home",
    source_url: input.candidate.url,
    source_platform: input.candidate.platform,
    source_title: input.candidate.title,
    max_duration_seconds: input.max_duration_seconds
  });
}

export async function listJobs(): Promise<Job[]> {
  return z.array(JobSchema).parse(await fetchBilibiliCrawlerJobsApi());
}

export async function deleteJob(jobId: number): Promise<Job> {
  return JobSchema.parse(await deleteBilibiliCrawlerJobApi(jobId));
}

export async function retranslateJob(jobId: number): Promise<Job> {
  return JobSchema.parse(await retranslateBilibiliCrawlerJobApi(jobId));
}

export async function retryJob(jobId: number): Promise<Job> {
  return JobSchema.parse(await retryBilibiliCrawlerJobApi(jobId));
}

export async function cancelJob(jobId: number): Promise<Job> {
  return JobSchema.parse(await cancelBilibiliCrawlerJobApi(jobId));
}

export async function applyJobSubtitles(input: { jobId: number; style: SubtitleStyleInput }): Promise<Job> {
  return JobSchema.parse(await applyBilibiliCrawlerSubtitlesApi(input.jobId, input.style));
}

export async function applyJobFilter(input: { jobId: number; style: VideoFilterInput }): Promise<Job> {
  return JobSchema.parse(await applyBilibiliCrawlerFilterApi(input.jobId, input.style));
}

export async function mergeParts(input: { jobId: number; segmentIndexes: number[] }): Promise<Job> {
  return JobSchema.parse(await mergeBilibiliCrawlerPartsApi(input.jobId, input.segmentIndexes));
}

export async function mergeJobs(input: { jobIds: number[] }): Promise<Job> {
  return JobSchema.parse(await mergeBilibiliCrawlerJobsApi(input.jobIds));
}

export async function generateTikTokMetadata(jobId: number): Promise<TikTokMetadata> {
  return TikTokMetadataSchema.parse(await generateBilibiliCrawlerTikTokMetadataApi(jobId));
}

export async function openJobOutputFolder(jobId: number): Promise<void> {
  await openBilibiliCrawlerOutputFolderApi(jobId);
}

export async function listTikTokProfiles(): Promise<SocialProfile[]> {
  const data = await fetchSocialProfilesApi("tiktok");
  return Array.isArray(data.items) ? data.items : [];
}

export async function publishJobToTikTok(input: { jobId: number; profileIds: number[]; caption: string; segmentIndexes?: number[] }): Promise<unknown> {
  return publishBilibiliJobToTikTokApi(input.jobId, { profile_ids: input.profileIds, caption: input.caption, segment_indexes: input.segmentIndexes });
}

export function mediaUrl(jobId: number, key: "raw_video_path" | "output_video_path", version?: string) {
  return getBilibiliCrawlerMediaUrl(jobId, key, version);
}

export function segmentUrl(jobId: number, segmentIndex: number, version?: string) {
  return getBilibiliCrawlerSegmentUrl(jobId, segmentIndex, version);
}

export function imageProxyUrl(url: string | null) {
  return getBilibiliCrawlerImageProxyUrl(url);
}
