import type {
  DeepSeekConfig,
  DeepSeekConfigInput,
  CreateJobInput,
  Job,
  JobsWebSocketEvent,
  KeywordPlan,
  PreviewUrl,
  SearchCandidate,
  SearchMode,
  SearchResponse,
  SeriesInfo,
  Source,
  SubtitleStyleInput,
  TikTokMetadata,
  TranslateTitleResponse,
  VideoFilterInput
} from "@/features/bilibili/api";

export type VideoLocalizationSourceAdapter = {
  id: string;
  label: string;
  defaultKeyword: string;
  linkPlaceholder: string;
  sourceValue: Source;
  defaultMaxDurationSeconds: number;
  listJobs: () => Promise<Job[]>;
  searchCandidates: (input: {
    input_text: string;
    sources: Source[];
    max_duration_seconds: number;
    limit: number;
    mode?: SearchMode;
  }) => Promise<SearchResponse>;
  createJobFromCandidate: (input: {
    input_text: string;
    candidate: SearchCandidate;
    max_duration_seconds: number;
  }) => Promise<Job>;
  deleteJob: (jobId: number) => Promise<Job>;
  cancelJob: (jobId: number) => Promise<Job>;
  retranslateJob: (jobId: number) => Promise<Job>;
  retryJob: (jobId: number) => Promise<Job>;
  applyJobSubtitles: (input: { jobId: number; style: SubtitleStyleInput }) => Promise<Job>;
  applyJobFilter: (input: { jobId: number; style: VideoFilterInput }) => Promise<Job>;
  mergeParts?: (input: { jobId: number; segmentIndexes: number[] }) => Promise<Job>;
  mergeJobs?: (input: { jobIds: number[] }) => Promise<Job>;
  getDeepSeekConfig: () => Promise<DeepSeekConfig>;
  updateDeepSeekConfig: (input: DeepSeekConfigInput) => Promise<DeepSeekConfig>;
  translateTitle: (title: string) => Promise<TranslateTitleResponse>;
  createKeywordPlan: (input: Pick<CreateJobInput, "input_text" | "niche">) => Promise<KeywordPlan>;
  getPreviewUrl: (url: string) => Promise<PreviewUrl>;
  getSeriesInfo?: (input: { url?: string | null; aid?: number | null; bvid?: string | null }) => Promise<SeriesInfo>;
  generateTikTokMetadata: (jobId: number) => Promise<TikTokMetadata>;
  listTikTokProfiles: () => Promise<Array<{ id: number; platform: string; profile_name: string; username?: string | null; status: string }>>;
  publishJobToTikTok: (input: { jobId: number; profileIds: number[]; caption: string; segmentIndexes?: number[] }) => Promise<unknown>;
  openJobOutputFolder: (jobId: number) => Promise<void>;
  mediaUrl: (jobId: number, key: "raw_video_path" | "output_video_path", version?: string) => string;
  segmentUrl: (jobId: number, segmentIndex: number, version?: string) => string;
  imageProxyUrl: (url: string | null) => string | null;
  subscribeJobsSocket: (listener: (event: JobsWebSocketEvent) => void) => () => void;
};
