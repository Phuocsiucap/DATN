import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Clock3,
  Download,
  FolderOpen,
  Link2,
  Loader2,
  RefreshCcw,
  Send,
  Settings,
  Search,
  Trash2,
  Video
} from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  Job,
  JobsWebSocketEvent,
  SearchMode,
  SearchCandidate,
  SeriesInfo,
  SubtitleStyleInput,
  VideoFilterInput
} from "@/features/bilibili/api";
import type { VideoDetailEpisode } from "@/features/bilibili/types";
import type { VideoLocalizationSourceAdapter } from "./types";
import { Button } from "@/commons/component/ui/button";
import { Input } from "@/commons/component/ui/input";
import { Label } from "@/commons/component/ui/label";
import { Progress } from "@/commons/component/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/commons/component/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/commons/component/ui/table";
import { useVideoLocalizationStore } from "./hooks/useVideoLocalizationStore";

const VideoLocalizationSourceContext = createContext<VideoLocalizationSourceAdapter | null>(null);

function useVideoLocalizationSource() {
  const source = useContext(VideoLocalizationSourceContext);
  if (!source) {
    throw new Error("VideoLocalizationWorkspace must be rendered with a source adapter.");
  }
  return source;
}

const darkSelectContentClass = "border-[#3c3c3c] bg-[#252526] text-[#d4d4d4] shadow-xl shadow-black/40";
const darkSelectItemClass = "text-[#d4d4d4] focus:bg-[#094771] focus:text-white data-[highlighted]:bg-[#094771] data-[highlighted]:text-white";

export function VideoLocalizationWorkspace({
  source,
  onOpenCandidateDetail,
}: {
  source: VideoLocalizationSourceAdapter;
  onOpenCandidateDetail?: (candidate: SearchCandidate) => void;
}) {
  const queryClient = useQueryClient();
  const {
    defaultMaxDurationSeconds,
    sourceValue,
    applyJobFilter,
    applyJobSubtitles,
    cancelJob,
    createJobFromCandidate,
    deleteJob,
    generateTikTokMetadata,
    getDeepSeekConfig,
    getSeriesInfo,
    listJobs,
    publishJobToTikTok,
    retranslateJob,
    retryJob,
    searchCandidates,
    subscribeJobsSocket,
    translateTitle,
    updateDeepSeekConfig
  } = source;
  const selectedJobId = useVideoLocalizationStore((state) => state.selectedJobId);
  const setSelectedJobId = useVideoLocalizationStore((state) => state.setSelectedJobId);
  const [keyword, setKeyword] = useState(source.defaultKeyword);
  const [bilibiliUrl, setBilibiliUrl] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("keyword");
  const [searchLimit, setSearchLimit] = useState(12);
  const [selectedCandidate, setSelectedCandidate] = useState<SearchCandidate | null>(null);
  const [activeTab, setActiveTab] = useState<"search" | "processed" | "completed" | "config">("search");
  const [inspectorJobTab, setInspectorJobTab] = useState<"detail" | "tiktok">("detail");
  const [translatedTitles, setTranslatedTitles] = useState<Record<string, string>>({});
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState<number | null>(null);
  const [checkedSegmentIndexes, setCheckedSegmentIndexes] = useState<number[]>([]);
  const [checkedJobIds, setCheckedJobIds] = useState<number[]>([]);
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyleInput>({ font_size: 16, position: "bottom" });
  const [videoFilter, setVideoFilter] = useState<VideoFilterInput>({ preset: "studio_bright", speed: 1.05 });
  const [streamedCandidates, setStreamedCandidates] = useState<SearchCandidate[]>([]);
  const [streamingSearch, setStreamingSearch] = useState(false);
  const [searchStatus, setSearchStatus] = useState("");
  const stopSearchStreamRef = useRef<(() => void) | null>(null);

  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: listJobs,
    refetchInterval: false
  });
  const deepseekConfig = useQuery({
    queryKey: ["deepseek-config"],
    queryFn: getDeepSeekConfig
  });
  const allJobs = jobs.data ?? [];
  const activeJobs = allJobs.filter((job) => job.status !== "completed");
  const completedJobs = allJobs.filter((job) => job.status === "completed");
  const visibleJobs = activeTab === "completed" ? completedJobs : activeTab === "processed" ? activeJobs : allJobs;
  const selectedJob = visibleJobs.find((job) => job.id === selectedJobId) ?? visibleJobs[0] ?? null;
  const showError = (error: Error) => {
    const message = formatApiError(error.message);
    toast.error(message);
    if (message.includes("Chưa cấu hình DeepSeek")) {
      setActiveTab("config");
    }
  };

  useEffect(() => {
    if (activeTab === "search" || activeTab === "config") return;
    if (selectedJobId && visibleJobs.some((job) => job.id === selectedJobId)) return;
    if (visibleJobs[0]) {
      setSelectedJobId(visibleJobs[0].id);
    } else if (selectedJobId !== null) {
      setSelectedJobId(null);
    }
  }, [activeTab, selectedJobId, setSelectedJobId, visibleJobs]);

  useEffect(() => {
    const applyEvent = (event: JobsWebSocketEvent) => {
      queryClient.setQueryData<Job[]>(["jobs"], (current = []) => {
        if (event.type === "jobs_snapshot") return event.jobs;
        if (event.type === "job_deleted") return current.filter((job) => job.id !== event.job.id);
        const withoutJob = current.filter((job) => job.id !== event.job.id);
        return [event.job, ...withoutJob].sort((left, right) => right.id - left.id);
      });
    };

    return subscribeJobsSocket(applyEvent);
  }, [queryClient, subscribeJobsSocket]);

  useEffect(() => {
    if ((activeTab !== "processed" && activeTab !== "completed") || !selectedJob) return;
    const segments = getSegments(selectedJob);
    if (segments.length === 0) {
      if (selectedSegmentIndex !== null) setSelectedSegmentIndex(null);
      return;
    }
    const stillValid = segments.some((segment) => segment.index === selectedSegmentIndex);
    if (!stillValid) setSelectedSegmentIndex(segments[0].index);
  }, [activeTab, selectedJob, selectedSegmentIndex]);

  useEffect(() => {
    const style = selectedJob?.artifacts.subtitle_style;
    if (!style || typeof style !== "object") return;
    const record = style as Record<string, unknown>;
    const fontSize = typeof record.font_size === "number" ? record.font_size : 16;
    const position = record.position === "middle" || record.position === "top" || record.position === "bottom" ? record.position : "bottom";
    setSubtitleStyle({ font_size: fontSize, position });
  }, [selectedJob?.id]);

  useEffect(() => {
    return () => {
      stopSearchStreamRef.current?.();
      stopSearchStreamRef.current = null;
    };
  }, []);

  const searchMutation = useMutation({
    mutationFn: searchCandidates,
    onMutate: () => {
      setSearchStatus(`Đang tìm trên ${source.label}...`);
      setSelectedCandidate(null);
    },
    onSuccess: (data) => {
      const firstCandidate = data.candidates[0] ?? null;
      setSelectedCandidate(firstCandidate);
      setSearchStatus(`Hoàn tất · ${data.candidates.length} video`);
      toast.success(`Tìm thấy ${data.candidates.length} video`);
      if (searchMode === "link" && firstCandidate) {
        onOpenCandidateDetail?.(firstCandidate);
      }
    },
    onError: (error) => {
      setSearchStatus("");
      showError(error);
    }
  });

  const jobMutation = useMutation({
    mutationFn: createJobFromCandidate,
    onSuccess: (job) => {
      toast.success("Đã đưa video vào pipeline");
      setSelectedJobId(job.id);
      setActiveTab("processed");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: showError
  });

  const deleteMutation = useMutation({
    mutationFn: deleteJob,
    onSuccess: () => {
      toast.success("Đã xóa job và file trên máy");
      setSelectedJobId(null);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: showError
  });

  const translateTitleMutation = useMutation({
    mutationFn: (candidate: SearchCandidate) => translateTitle(candidate.title),
    onSuccess: (data) => {
      setTranslatedTitles((current) => ({ ...current, [data.title]: data.title_vi }));
    },
    onError: showError
  });

  const retranslateMutation = useMutation({
    mutationFn: retranslateJob,
    onSuccess: () => {
      toast.success("Đã đưa job vào bước dịch lại");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: showError
  });

  const retryMutation = useMutation({
    mutationFn: retryJob,
    onSuccess: () => {
      toast.success("Đã đưa job vào pipeline chạy lại");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: showError
  });

  const cancelMutation = useMutation({
    mutationFn: cancelJob,
    onSuccess: () => {
      toast.success("Đã dừng tiến trình job");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: showError
  });

  const applySubtitlesMutation = useMutation({
    mutationFn: applyJobSubtitles,
    onSuccess: () => {
      toast.success("Đã đưa job vào bước apply sub");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: showError
  });

  const applyFilterMutation = useMutation({
    mutationFn: applyJobFilter,
    onSuccess: () => {
      toast.success("Đã đưa job vào bước apply filter");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: showError
  });

  const tiktokMetadataMutation = useMutation({
    mutationFn: generateTikTokMetadata,
    onSuccess: () => {
      toast.success("Đã tạo metadata TikTok");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: showError
  });

  const publishTikTokMutation = useMutation({
    mutationFn: publishJobToTikTok,
    onSuccess: () => {
      toast.success("Đã gửi video sang TikTok Studio");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: showError
  });

  const mergePartsMutation = useMutation({
    mutationFn: source.mergeParts!,
    onSuccess: () => {
      toast.success("Đã yêu cầu gộp các phần (parts)");
      setCheckedSegmentIndexes([]);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: showError
  });

  const mergeJobsMutation = useMutation({
    mutationFn: source.mergeJobs!,
    onSuccess: () => {
      toast.success("Đã yêu cầu gộp các jobs");
      setCheckedJobIds([]);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: showError
  });

  const updateDeepSeekConfigMutation = useMutation({
    mutationFn: updateDeepSeekConfig,
    onSuccess: () => {
      toast.success("Đã lưu cấu hình DeepSeek");
      queryClient.invalidateQueries({ queryKey: ["deepseek-config"] });
    },
    onError: (error) => toast.error(error.message)
  });

  const candidates = streamedCandidates.length ? streamedCandidates : searchMutation.data?.candidates ?? [];
  const selectedSeriesInfo = useQuery({
    queryKey: ["video-series-info", source.id, selectedCandidate?.url, selectedCandidate?.aid, selectedCandidate?.bvid],
    queryFn: () => {
      if (!selectedCandidate || !getSeriesInfo) throw new Error("Series info is not supported.");
      return getSeriesInfo({
        url: selectedCandidate.url,
        aid: selectedCandidate.aid ?? null,
        bvid: selectedCandidate.bvid ?? null,
      });
    },
    enabled: activeTab === "search" && !!selectedCandidate && !!getSeriesInfo,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <VideoLocalizationSourceContext.Provider value={source}>
      <main className="grid h-screen min-h-0 grid-rows-[46px_minmax(0,1fr)] overflow-hidden bg-[#1f1f1f] text-[13px] text-[#d4d4d4]">
      <header className="flex items-center gap-4 border-b border-[#303030] bg-[#181818] px-4">
        <div className="flex items-center gap-2">
          <div className="h-5 w-1 rounded bg-[#0e639c]" />
          <h1 className="text-[16px] font-semibold tracking-wide text-white">Zentra</h1>
        </div>
        <nav className="flex h-full items-center">
          <TopNavButton active={activeTab === "search"} label="Search" onClick={() => setActiveTab("search")}>
            <Search className="h-3.5 w-3.5" />
            Search
          </TopNavButton>
          <TopNavButton active={activeTab === "processed"} label="Processed" onClick={() => setActiveTab("processed")}>
            <Video className="h-3.5 w-3.5" />
            Processing
          </TopNavButton>
          <TopNavButton active={activeTab === "completed"} label="Completed" onClick={() => setActiveTab("completed")}>
            <Check className="h-3.5 w-3.5" />
            Completed
          </TopNavButton>
          <TopNavButton active={activeTab === "config"} label="Config" onClick={() => setActiveTab("config")}>
            <Settings className="h-3.5 w-3.5" />
            Config
          </TopNavButton>
        </nav>
      </header>

      <section className={`grid min-h-0 overflow-hidden ${activeTab === "config" ? "grid-cols-[minmax(520px,1fr)]" : "grid-cols-[minmax(520px,1fr)_420px]"}`}>
        {activeTab === "search" ? (
          <div className="grid min-h-0 overflow-hidden grid-cols-[300px_minmax(420px,1fr)]">
            <SearchPanel
              keyword={keyword}
              bilibiliUrl={bilibiliUrl}
              searching={searchMutation.isPending || streamingSearch}
              searchStatus={searchStatus}
              mode={searchMode}
              sourceLabel={source.label}
              linkPlaceholder={source.linkPlaceholder}
              onKeywordChange={setKeyword}
              onBilibiliUrlChange={setBilibiliUrl}
              onModeChange={setSearchMode}
              onSearch={() => {
                if (searchMode === "keyword" && !keyword.trim()) {
                  toast.error("Nhập keyword trước");
                  return;
                }
                if (searchMode === "link" && !bilibiliUrl.trim()) {
                  toast.error(source.linkPlaceholder);
                  return;
                }
                stopSearchStreamRef.current?.();
                stopSearchStreamRef.current = null;
                setStreamingSearch(false);
                setStreamedCandidates([]);
                searchMutation.mutate({
                  input_text: searchMode === "trending" ? "" : searchMode === "link" ? bilibiliUrl : keyword,
                  sources: [sourceValue],
                  max_duration_seconds: defaultMaxDurationSeconds,
                  limit: searchMode === "link" ? 5 : searchLimit,
                  mode: searchMode
                });
              }}
              limit={searchLimit}
              onLimitChange={setSearchLimit}
            />
            <SearchWorkspace
              candidates={candidates}
              selectedCandidate={selectedCandidate}
              translatedTitles={translatedTitles}
              translatingTitle={translateTitleMutation.variables?.title ?? null}
              translating={translateTitleMutation.isPending}
              processing={jobMutation.isPending}
              onSelectCandidate={(candidate) => {
                setSelectedCandidate(candidate);
                onOpenCandidateDetail?.(candidate);
              }}
              onTranslateTitle={(candidate) => {
                if (translatedTitles[candidate.title]) return;
                translateTitleMutation.mutate(candidate);
              }}
              onProcess={() => {
                if (!selectedCandidate) return;
                jobMutation.mutate({
                  input_text: selectedCandidate.title || (searchMode === "link" ? bilibiliUrl : keyword),
                  candidate: selectedCandidate,
                  max_duration_seconds: defaultMaxDurationSeconds
                });
              }}
            />
          </div>
        ) : activeTab === "processed" || activeTab === "completed" ? (
          <ProcessedWorkspace
            jobs={visibleJobs}
            selectedJob={selectedJob}
            selectedJobId={selectedJobId}
            checkedJobIds={checkedJobIds}
            onToggleCheckedJob={(jobId) => {
              setCheckedJobIds((prev) => prev.includes(jobId) ? prev.filter((id) => id !== jobId) : [...prev, jobId]);
            }}
            checkedSegmentIndexes={checkedSegmentIndexes}
            onToggleCheckedSegment={(index) => {
              setCheckedSegmentIndexes((prev) => prev.includes(index) ? prev.filter((item) => item !== index) : [...prev, index]);
            }}
            selectedSegmentIndex={selectedSegmentIndex}
            title={activeTab === "completed" ? "Completed Videos" : "Processing Queue"}
            emptyText={activeTab === "completed" ? "Chưa có video hoàn thành." : "Chưa có job đang xử lý hoặc lỗi."}
            mergingParts={mergePartsMutation.isPending}
            mergingJobs={mergeJobsMutation.isPending}
            onMergeParts={() => {
              if (!selectedJob || checkedSegmentIndexes.length < 2 || !source.mergeParts) return;
              mergePartsMutation.mutate({ jobId: selectedJob.id, segmentIndexes: checkedSegmentIndexes });
            }}
            onMergeJobs={() => {
              if (checkedJobIds.length < 2 || !source.mergeJobs) return;
              mergeJobsMutation.mutate({ jobIds: checkedJobIds });
            }}
            stoppingJobId={cancelMutation.isPending ? cancelMutation.variables ?? null : null}
            onCancelJob={(jobId) => cancelMutation.mutate(jobId)}
            onSelectJob={(jobId) => {
              setSelectedJobId(jobId);
              const job = visibleJobs.find((item) => item.id === jobId) ?? null;
              setSelectedSegmentIndex(getSegments(job)[0]?.index ?? null);
              setCheckedSegmentIndexes([]);
            }}
            onSelectSegment={setSelectedSegmentIndex}
          />
        ) : (
          <ConfigWorkspace
            config={deepseekConfig.data ?? null}
            loading={deepseekConfig.isLoading}
            saving={updateDeepSeekConfigMutation.isPending}
            onSave={(input) => updateDeepSeekConfigMutation.mutate(input)}
          />
        )}
        {activeTab !== "config" && <Inspector
          activeTab={activeTab}
          candidate={selectedCandidate}
          candidateSeriesInfo={selectedSeriesInfo.data ?? null}
          loadingCandidateSeriesInfo={selectedSeriesInfo.isFetching}
          translatedTitle={selectedCandidate ? translatedTitles[selectedCandidate.title] : null}
          translatingTitle={translateTitleMutation.variables?.title ?? null}
          translating={translateTitleMutation.isPending}
          job={selectedJob}
          jobs={visibleJobs}
          deleting={deleteMutation.isPending}
          retranslating={retranslateMutation.isPending}
          applyingSubtitles={applySubtitlesMutation.isPending}
          applyingFilter={applyFilterMutation.isPending}
          subtitleStyle={subtitleStyle}
          videoFilter={videoFilter}
          onSubtitleStyleChange={setSubtitleStyle}
          onVideoFilterChange={setVideoFilter}
          selectedSegmentIndex={selectedSegmentIndex}
          checkedSegmentIndexes={checkedSegmentIndexes}
          onSelectSegment={setSelectedSegmentIndex}
          onToggleCheckedSegment={(index) => {
            setCheckedSegmentIndexes(prev => prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]);
          }}
          onSelectJob={setSelectedJobId}
          onTranslateTitle={(candidate) => {
            if (translatedTitles[candidate.title]) return;
            translateTitleMutation.mutate(candidate);
          }}
          onDelete={(job) => deleteMutation.mutate(job.id)}
          onRetry={(job) => retryMutation.mutate(job.id)}
          onRetranslate={(job) => retranslateMutation.mutate(job.id)}
          onApplySubtitles={(job) => applySubtitlesMutation.mutate({ jobId: job.id, style: subtitleStyle })}
          onApplyFilter={(job) => applyFilterMutation.mutate({ jobId: job.id, style: videoFilter })}
          inspectorJobTab={inspectorJobTab}
          onInspectorJobTabChange={setInspectorJobTab}
          generatingTikTokMetadata={tiktokMetadataMutation.isPending}
          publishingTikTok={publishTikTokMutation.isPending}
          retrying={retryMutation.isPending}
          onGenerateTikTokMetadata={(job) => tiktokMetadataMutation.mutate(job.id)}
          onPublishTikTok={(job, profileIds, caption, segmentIndexes) => publishTikTokMutation.mutate({ jobId: job.id, profileIds, caption, segmentIndexes })}
        />}
      </section>
      </main>
    </VideoLocalizationSourceContext.Provider>
  );
}

function TopNavButton(props: { active: boolean; label: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      title={props.label}
      className={`flex h-full items-center gap-1.5 border-b-2 px-3 text-[12px] ${props.active ? "border-[#0e639c] bg-[#252526] text-white" : "border-transparent text-[#9d9d9d] hover:bg-[#202020] hover:text-white"}`}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function ConfigWorkspace(props: {
  config: import("@/features/bilibili/api").DeepSeekConfig | null;
  loading: boolean;
  saving: boolean;
  onSave: (input: import("@/features/bilibili/api").DeepSeekConfigInput) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com");
  const [keywordModel, setKeywordModel] = useState("deepseek-v4-flash");
  const [subtitleModel, setSubtitleModel] = useState("deepseek-v4-flash");
  const [reasoningEffort, setReasoningEffort] = useState("");

  useEffect(() => {
    if (!props.config) return;
    setBaseUrl(props.config.base_url);
    setKeywordModel(props.config.keyword_model);
    setSubtitleModel(props.config.subtitle_model);
    setReasoningEffort(props.config.reasoning_effort ?? "");
  }, [props.config]);

  return (
    <section className="min-h-0 overflow-auto bg-[#1e1e1e] p-5">
      <div className="max-w-2xl">
        <div className="mb-4">
          <h2 className="text-[15px] font-semibold text-white">DeepSeek Config</h2>
          <p className="mt-1 text-[12px] text-[#8f8f8f]">Sửa API key/model runtime, không cần build lại app.</p>
        </div>
        <div className="space-y-4 rounded border border-[#303030] bg-[#252526] p-4">
          <Field label="API key">
            <Input
              className="h-8 border-[#3c3c3c] bg-[#1e1e1e] text-[13px] text-[#d4d4d4] focus-visible:ring-[#0e639c]"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={props.config?.has_api_key ? `Đang dùng ${props.config.api_key_masked}; nhập key mới nếu muốn đổi` : "sk-..."}
            />
          </Field>
          <Field label="Base URL">
            <Input className="h-8 border-[#3c3c3c] bg-[#1e1e1e] text-[13px] text-[#d4d4d4] focus-visible:ring-[#0e639c]" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Keyword model">
              <Input className="h-8 border-[#3c3c3c] bg-[#1e1e1e] text-[13px] text-[#d4d4d4] focus-visible:ring-[#0e639c]" value={keywordModel} onChange={(event) => setKeywordModel(event.target.value)} />
            </Field>
            <Field label="Subtitle model">
              <Input className="h-8 border-[#3c3c3c] bg-[#1e1e1e] text-[13px] text-[#d4d4d4] focus-visible:ring-[#0e639c]" value={subtitleModel} onChange={(event) => setSubtitleModel(event.target.value)} />
            </Field>
          </div>
          <Field label="Reasoning effort">
            <Input
              className="h-8 border-[#3c3c3c] bg-[#1e1e1e] text-[13px] text-[#d4d4d4] focus-visible:ring-[#0e639c]"
              value={reasoningEffort}
              onChange={(event) => setReasoningEffort(event.target.value)}
              placeholder="Để trống cho non-thinking nhanh hơn"
            />
          </Field>
          <div className="rounded bg-[#1e1e1e] px-3 py-2 text-[11px] text-[#8f8f8f]">
            Config file: {props.config?.config_path ?? (props.loading ? "Đang tải..." : "-")}
          </div>
          <Button
            className="h-8 bg-[#0e639c] text-[13px] text-white hover:bg-[#1177bb]"
            disabled={props.saving || props.loading}
            onClick={() => props.onSave({
              api_key: apiKey.trim() || undefined,
              base_url: baseUrl,
              keyword_model: keywordModel,
              subtitle_model: subtitleModel,
              reasoning_effort: reasoningEffort,
            })}
          >
            {props.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Save config
          </Button>
        </div>
      </div>
    </section>
  );
}

function SearchPanel(props: {
  keyword: string;
  bilibiliUrl: string;
  searching: boolean;
  searchStatus: string;
  mode: SearchMode;
  sourceLabel: string;
  linkPlaceholder: string;
  limit: number;
  onKeywordChange: (value: string) => void;
  onBilibiliUrlChange: (value: string) => void;
  onModeChange: (value: SearchMode) => void;
  onLimitChange: (value: number) => void;
  onSearch: () => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col border-r border-[#303030] bg-[#252526]">
      <SectionTitle>Search</SectionTitle>
      <div className="flex flex-col gap-4 p-4">
        <Field label="Mode">
          <Select value={props.mode} onValueChange={(value) => props.onModeChange(value as SearchMode)}>
            <SelectTrigger className="h-8 border-[#3c3c3c] bg-[#1e1e1e] text-[13px] text-[#d4d4d4] focus:ring-[#0e639c]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className={darkSelectContentClass}>
              <SelectItem className={darkSelectItemClass} value="keyword">Search keyword</SelectItem>
              <SelectItem className={darkSelectItemClass} value="trending">{props.sourceLabel} trending</SelectItem>
              <SelectItem className={darkSelectItemClass} value="link">{props.sourceLabel} link</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {props.mode === "keyword" && (
          <Field label="Keyword">
            <Input
              className="h-8 border-[#3c3c3c] bg-[#1e1e1e] text-[13px] text-[#d4d4d4] focus-visible:ring-[#0e639c]"
              value={props.keyword}
              onChange={(event) => props.onKeywordChange(event.target.value)}
              placeholder="Tên riêng, chủ đề, sản phẩm..."
            />
          </Field>
        )}
        {props.mode === "link" && (
          <Field label={`${props.sourceLabel} URL`}>
            <Input
              className="h-8 border-[#3c3c3c] bg-[#1e1e1e] text-[13px] text-[#d4d4d4] focus-visible:ring-[#0e639c]"
              value={props.bilibiliUrl}
              onChange={(event) => props.onBilibiliUrlChange(event.target.value)}
              placeholder={props.linkPlaceholder}
            />
          </Field>
        )}
        {props.mode !== "link" && (
          <Field label="Search limit">
            <Select value={String(props.limit)} onValueChange={(value) => props.onLimitChange(Number(value))}>
              <SelectTrigger className="h-8 border-[#3c3c3c] bg-[#1e1e1e] text-[13px] text-[#d4d4d4] focus:ring-[#0e639c]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={darkSelectContentClass}>
                <SelectItem className={darkSelectItemClass} value="12">12 videos</SelectItem>
                <SelectItem className={darkSelectItemClass} value="20">20 videos</SelectItem>
                <SelectItem className={darkSelectItemClass} value="30">30 videos</SelectItem>
                <SelectItem className={darkSelectItemClass} value="50">50 videos</SelectItem>
                <SelectItem className={darkSelectItemClass} value="80">80 videos</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}
        <Button className="h-8 bg-[#0e639c] text-[13px] text-white hover:bg-[#1177bb]" onClick={props.onSearch} disabled={props.searching}>
          {props.searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : props.mode === "link" ? <Link2 className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
          {props.mode === "trending" ? "Load trending" : props.mode === "link" ? "Fetch metadata" : "Search videos"}
        </Button>
        {props.searchStatus && (
          <div className="rounded bg-[#1e1e1e] px-3 py-2 text-[11px] text-[#9d9d9d]">
            {props.searchStatus}
          </div>
        )}
      </div>
    </aside>
  );
}

function SearchWorkspace(props: {
  candidates: SearchCandidate[];
  selectedCandidate: SearchCandidate | null;
  translatedTitles: Record<string, string>;
  translatingTitle: string | null;
  translating: boolean;
  processing: boolean;
  onSelectCandidate: (candidate: SearchCandidate) => void;
  onTranslateTitle: (candidate: SearchCandidate) => void;
  onProcess: () => void;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#1e1e1e]">
      <div className="flex h-10 items-center justify-between border-b border-[#303030] px-4">
        <div className="text-[11px] text-[#8f8f8f]">{props.candidates.length} candidates · {groupSearchCandidates(props.candidates).length} nhóm</div>
        <Button
          className="h-8 bg-[#0e639c] text-[13px] text-white hover:bg-[#1177bb]"
          disabled={!props.selectedCandidate || props.selectedCandidate.downloadable === false || props.processing}
          onClick={props.onProcess}
          title={props.selectedCandidate?.downloadable === false ? props.selectedCandidate.availability_note ?? "Video này chưa hỗ trợ download" : undefined}
        >
          {props.processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Download and Sub
        </Button>
      </div>
      <SearchResults
        candidates={props.candidates}
        selectedCandidate={props.selectedCandidate}
        translatedTitles={props.translatedTitles}
        translatingTitle={props.translatingTitle}
        translating={props.translating}
        onSelectCandidate={props.onSelectCandidate}
        onTranslateTitle={props.onTranslateTitle}
      />
    </section>
  );
}

function SearchResults(props: {
  candidates: SearchCandidate[];
  selectedCandidate: SearchCandidate | null;
  translatedTitles: Record<string, string>;
  translatingTitle: string | null;
  translating: boolean;
  onSelectCandidate: (candidate: SearchCandidate) => void;
  onTranslateTitle: (candidate: SearchCandidate) => void;
}) {
  const groups = groupSearchCandidates(props.candidates);
  return (
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="grid gap-2">
          {groups.map((group) => (
            <div key={group.key} className={group.items.length > 1 ? "rounded border border-[#303030] bg-[#202020]" : ""}>
              {group.items.length > 1 && (
                <div className="border-b border-[#303030] px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium text-[#dcdcdc]">{group.title}</div>
                      <div className="text-[11px] text-[#8f8f8f]">{group.items.length} tập tìm thấy · chọn tập để xem/tải</div>
                    </div>
                    <span className="shrink-0 rounded bg-[#094771] px-2 py-1 text-[11px] text-[#cde8ff]">Playlist</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {group.items.map((candidate, index) => (
                      <button
                        key={candidate.url}
                        className={`h-7 rounded border px-2 text-[11px] ${props.selectedCandidate?.url === candidate.url ? "border-[#0e639c] bg-[#04395e] text-white" : "border-[#3a3a3a] bg-[#252526] text-[#cfcfcf] hover:bg-[#2a2d2e]"}`}
                        onClick={() => props.onSelectCandidate(candidate)}
                        title={candidate.title}
                      >
                        {episodeLabel(candidate, index)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className={group.items.length > 1 ? "grid gap-1 p-2" : "grid gap-2"}>
                {group.items.map((candidate) => (
                  <SearchCandidateRow
                    key={candidate.url}
                    candidate={candidate}
                    selected={props.selectedCandidate?.url === candidate.url}
                    titleVi={props.translatedTitles[candidate.title] ?? candidate.title_vi ?? null}
                    isTranslating={props.translating && props.translatingTitle === candidate.title}
                    onSelect={props.onSelectCandidate}
                    onTranslateTitle={props.onTranslateTitle}
                  />
                ))}
              </div>
            </div>
          ))}
          {props.candidates.length === 0 && (
            <div className="flex h-64 items-center justify-center rounded border border-dashed border-[#3a3a3a] text-[13px] text-[#8f8f8f]">
              Search để xem danh sách video crawl được.
            </div>
          )}
        </div>
      </div>
  );
}

function SearchCandidateRow(props: {
  candidate: SearchCandidate;
  selected: boolean;
  titleVi: string | null;
  isTranslating: boolean;
  onSelect: (candidate: SearchCandidate) => void;
  onTranslateTitle: (candidate: SearchCandidate) => void;
}) {
  const candidate = props.candidate;
  const source = useVideoLocalizationSource();
  return (
    <div
      className={`grid grid-cols-[116px_1fr_auto] gap-3 rounded border p-2 text-left ${props.selected ? "border-[#0e639c] bg-[#04395e]" : "border-[#303030] bg-[#252526] hover:bg-[#2a2d2e]"}`}
      role="button"
      tabIndex={0}
      onClick={() => props.onSelect(candidate)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") props.onSelect(candidate);
      }}
    >
      <div className="flex aspect-video items-center justify-center overflow-hidden rounded bg-[#111]">
        {candidate.thumbnail_url ? <img className="h-full w-full object-cover" src={source.imageProxyUrl(candidate.thumbnail_url) ?? ""} /> : <Video className="h-5 w-5 text-[#777]" />}
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {candidate.episode_index && (
            <span className="shrink-0 rounded bg-[#333] px-1.5 py-0.5 text-[10px] text-[#cde8ff]">EP {candidate.episode_index}</span>
          )}
          <div className="truncate text-[13px] font-medium text-[#e6e6e6]">{props.titleVi || candidate.title}</div>
        </div>
        {props.titleVi && <div className="mt-0.5 truncate text-[12px] text-[#9d9d9d]">{candidate.title}</div>}
        <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-[#9d9d9d]">{candidate.description || candidate.url}</div>
        <div className="mt-1 text-[11px] text-[#858585]">{candidate.query}</div>
        {candidate.series_title && (
          <div className="mt-1 text-[11px] text-[#9ac7e8]">
            Series: {candidate.series_title}{candidate.episode_index ? ` · Ep ${candidate.episode_index}` : ""}{candidate.playlist_size ? ` · ${candidate.playlist_size} phần` : ""}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-2 text-[11px] text-[#9d9d9d]">
        <span className="rounded bg-[#333] px-2 py-1">{candidate.platform}</span>
        {candidate.review_count ? <span className="rounded bg-[#3b2f1f] px-2 py-1 text-[#f3d08a]">{candidate.review_count} review</span> : null}
        {candidate.episode_count_text ? <span className="rounded bg-[#17334a] px-2 py-1 text-[#9ad4ff]">{candidate.episode_count_text}</span> : null}
        <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" />{formatDuration(candidate.duration_seconds)}</span>
        {candidate.downloadable === false && <span className="rounded bg-[#4b3320] px-2 py-1 text-[#f0c28b]">Unavailable</span>}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] text-[#c8c8c8] hover:bg-[#3a3a3a]"
          disabled={!!props.titleVi || props.isTranslating}
          onClick={(event) => {
            event.stopPropagation();
            props.onTranslateTitle(candidate);
          }}
        >
          {props.isTranslating ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {props.titleVi ? "Đã dịch" : "Dịch title"}
        </Button>
      </div>
    </div>
  );
}

function ProcessedResults(props: {
  jobs: Job[];
  selectedJobId: number | null;
  emptyText: string;
  checkedJobIds: number[];
  onToggleCheckedJob: (jobId: number) => void;
  mergingJobs: boolean;
  onMergeJobs: () => void;
  stoppingJobId: number | null;
  onCancelJob: (jobId: number) => void;
  onSelectJob: (jobId: number) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <Table>
        <TableHeader>
          <TableRow className="border-[#333] hover:bg-transparent">
            <TableHead className="h-8 w-8 text-[11px] text-[#999]"></TableHead>
            <TableHead className="h-8 text-[11px] text-[#999]">ID</TableHead>
            <TableHead className="h-8 text-[11px] text-[#999]">Video</TableHead>
            <TableHead className="h-8 text-[11px] text-[#999]">Stage</TableHead>
            <TableHead className="h-8 text-[11px] text-[#999]">Progress</TableHead>
            <TableHead className="h-8 text-[11px] text-[#999]">Status</TableHead>
            <TableHead className="h-8 w-20 text-right text-[11px] text-[#999]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.jobs.map((job) => {
            const canStop = job.status === "running";
            const stopping = props.stoppingJobId === job.id;
            return (
              <TableRow
                key={job.id}
                className={`border-[#333] hover:bg-[#2a2d2e] ${props.selectedJobId === job.id ? "bg-[#04395e]" : ""}`}
                onClick={() => props.onSelectJob(job.id)}
              >
                <TableCell className="py-2 pl-3">
                  <input type="checkbox" checked={props.checkedJobIds.includes(job.id)} onChange={() => props.onToggleCheckedJob(job.id)} onClick={(e) => e.stopPropagation()} className="h-3.5 w-3.5 rounded border-[#3c3c3c] bg-[#252526] text-[#0e639c]" />
                </TableCell>
                <TableCell className="py-2 text-[12px] text-[#ddd]">{job.id}</TableCell>
                <TableCell className="max-w-[420px] truncate py-2 text-[12px] text-[#ddd]">
                  {String(job.artifacts.crawler_title ?? job.artifacts.raw_title ?? job.input_text)}
                </TableCell>
                <TableCell className="py-2 text-[12px] text-[#bbb]">{job.stage}</TableCell>
                <TableCell className="py-2"><Progress value={job.progress} className="h-1.5 bg-[#3a3a3a] [&>div]:bg-[#0e639c]" /></TableCell>
                <TableCell className="py-2 text-[12px] text-[#bbb]">{job.status}</TableCell>
                <TableCell className="py-2 text-right">
                  {canStop && (
                    <Button
                      size="sm"
                      className="h-7 border border-[#5a2d2d] bg-[#2d1f1f] px-2 text-[11px] text-[#ffb4ab] hover:bg-[#402424]"
                      disabled={stopping}
                      onClick={(event) => {
                        event.stopPropagation();
                        props.onCancelJob(job.id);
                      }}
                      title="Dừng tiến trình xử lý job này"
                    >
                      {stopping ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                      Dừng
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {props.jobs.length === 0 && (
        <div className="flex h-64 items-center justify-center rounded border border-dashed border-[#3a3a3a] text-[13px] text-[#8f8f8f]">
          {props.emptyText}
        </div>
      )}
    </div>
  );
}

function ProcessedWorkspace(props: {
  jobs: Job[];
  selectedJob: Job | null;
  selectedJobId: number | null;
  checkedJobIds: number[];
  onToggleCheckedJob: (jobId: number) => void;
  checkedSegmentIndexes: number[];
  onToggleCheckedSegment: (index: number) => void;
  selectedSegmentIndex: number | null;
  title: string;
  emptyText: string;
  mergingParts: boolean;
  mergingJobs: boolean;
  onMergeParts: () => void;
  onMergeJobs: () => void;
  stoppingJobId: number | null;
  onCancelJob: (jobId: number) => void;
  onSelectJob: (jobId: number) => void;
  onSelectSegment: (index: number | null) => void;
}) {
  return (
    <section className="grid min-h-0 min-w-0 grid-cols-[420px_minmax(360px,1fr)] bg-[#1e1e1e]">
      <div className="flex min-h-0 min-w-0 flex-col border-r border-[#303030]">
        <div className="flex h-10 items-center justify-between border-b border-[#303030] px-4">
          <div>
            <h2 className="text-[13px] font-semibold text-white">{props.title}</h2>
            <p className="text-[11px] text-[#8f8f8f]">{props.jobs.length} jobs</p>
          </div>
          {props.checkedJobIds.length > 1 && (
            <Button size="sm" className="h-7 bg-[#0e639c] text-[11px] text-white hover:bg-[#1177bb]" disabled={props.mergingJobs} onClick={props.onMergeJobs}>
              {props.mergingJobs ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Gộp {props.checkedJobIds.length} job
            </Button>
          )}
        </div>
        <ProcessedResults jobs={props.jobs} selectedJobId={props.selectedJobId} emptyText={props.emptyText} onSelectJob={props.onSelectJob} checkedJobIds={props.checkedJobIds} onToggleCheckedJob={props.onToggleCheckedJob} mergingJobs={props.mergingJobs} onMergeJobs={props.onMergeJobs} stoppingJobId={props.stoppingJobId} onCancelJob={props.onCancelJob} />
      </div>
      <ProcessedPlayer job={props.selectedJob} selectedSegmentIndex={props.selectedSegmentIndex} onSelectSegment={props.onSelectSegment} checkedSegmentIndexes={props.checkedSegmentIndexes} onToggleCheckedSegment={props.onToggleCheckedSegment} mergingParts={props.mergingParts} onMergeParts={props.onMergeParts} />
    </section>
  );
}

function ProcessedPlayer(props: {
  job: Job | null;
  selectedSegmentIndex: number | null;
  checkedSegmentIndexes: number[];
  onToggleCheckedSegment: (index: number) => void;
  mergingParts: boolean;
  onMergeParts: () => void;
  onSelectSegment: (index: number | null) => void;
}) {
  const source = useVideoLocalizationSource();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [playbackState, setPlaybackState] = useState({
    currentTime: 0,
    duration: 0,
    bufferedEnd: 0,
    paused: true,
    volume: 1,
  });
  const [audioBars, setAudioBars] = useState<number[]>(Array.from({ length: 24 }, () => 0));
  const segments = getSegments(props.job);
  const selectedSegment = segments.find((segment) => segment.index === props.selectedSegmentIndex) ?? segments[0] ?? null;
  const outputReady = !!props.job?.artifacts.output_video_path;
  const rawReady = !!props.job?.artifacts.raw_video_path;
  const mediaVersion = props.job?.updated_at;
  const videoSrc =
    props.job
      ? selectedSegment
        ? source.segmentUrl(props.job.id, selectedSegment.index, mediaVersion)
        : outputReady
          ? source.mediaUrl(props.job.id, "output_video_path", mediaVersion)
          : rawReady
            ? source.mediaUrl(props.job.id, "raw_video_path", mediaVersion)
            : null
      : null;
  const playbackPercent = playbackState.duration > 0 ? Math.min(100, Math.max(0, (playbackState.currentTime / playbackState.duration) * 100)) : 0;
  const bufferedPercent = playbackState.duration > 0 ? Math.min(100, Math.max(0, (playbackState.bufferedEnd / playbackState.duration) * 100)) : 0;

  const updatePlaybackState = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const bufferedEnd = video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : 0;
    setPlaybackState({
      currentTime: video.currentTime || 0,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      bufferedEnd,
      paused: video.paused,
      volume: video.volume,
    });
  }, []);

  const stopAudioMeter = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const startAudioMeter = useCallback(() => {
    const video = videoRef.current;
    if (!video || !videoSrc) return;
    stopAudioMeter();

    try {
      const mediaUrl = new URL(video.currentSrc || videoSrc, window.location.href);
      if (mediaUrl.origin !== window.location.origin) {
        setAudioBars(Array.from({ length: 24 }, () => 0));
        return;
      }

      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = context;
      if (context.state === "suspended") void context.resume();

      if (!analyserRef.current) {
        const sourceNode = context.createMediaElementSource(video);
        const analyser = context.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.78;
        sourceNode.connect(analyser);
        analyser.connect(context.destination);
        analyserRef.current = analyser;
      }

      const analyser = analyserRef.current;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const groupSize = Math.max(1, Math.floor(data.length / 24));
        const nextBars = Array.from({ length: 24 }, (_, index) => {
          const start = index * groupSize;
          const end = Math.min(data.length, start + groupSize);
          let total = 0;
          for (let i = start; i < end; i += 1) total += data[i];
          return Math.round(total / Math.max(1, end - start));
        });
        setAudioBars(nextBars);
        animationFrameRef.current = window.requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setAudioBars(Array.from({ length: 24 }, () => 0));
    }
  }, [stopAudioMeter, videoSrc]);

  useEffect(() => {
    setPlaybackState({ currentTime: 0, duration: 0, bufferedEnd: 0, paused: true, volume: 1 });
    setAudioBars(Array.from({ length: 24 }, () => 0));
    stopAudioMeter();
    analyserRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
  }, [stopAudioMeter, videoSrc]);

  useEffect(() => {
    return () => {
      stopAudioMeter();
      void audioContextRef.current?.close().catch(() => undefined);
    };
  }, [stopAudioMeter]);

  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-[#1b1b1b]">
      <div className="flex h-10 items-center justify-between border-b border-[#303030] px-4">
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold text-white">
            {props.job ? String(props.job.artifacts.crawler_title ?? props.job.artifacts.raw_title ?? props.job.input_text) : "Preview"}
          </h2>
          <p className="text-[11px] text-[#8f8f8f]">
            {selectedSegment ? `${selectedSegment.title} · ${formatDuration(selectedSegment.duration_seconds)}` : "Output video"}
          </p>
        </div>
        {props.checkedSegmentIndexes.length > 1 && (
          <Button size="sm" className="h-7 bg-[#0e639c] text-[11px] text-white hover:bg-[#1177bb]" disabled={props.mergingParts} onClick={props.onMergeParts}>
            {props.mergingParts ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            Gộp {props.checkedSegmentIndexes.length} part
          </Button>
        )}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(240px,1fr)_180px] gap-3 overflow-hidden px-3 py-2">
        <div className="min-h-0">
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded bg-[#0f0f0f]">
            {videoSrc ? (
              <>
                <div className="min-h-0 flex-1">
                  <video
                    ref={videoRef}
                    key={videoSrc}
                    className="h-full w-full object-contain"
                    src={videoSrc}
                    controls
                    preload="metadata"
                    onLoadedMetadata={updatePlaybackState}
                    onTimeUpdate={updatePlaybackState}
                    onProgress={updatePlaybackState}
                    onVolumeChange={updatePlaybackState}
                    onPlay={() => {
                      updatePlaybackState();
                      startAudioMeter();
                    }}
                    onPause={() => {
                      updatePlaybackState();
                      stopAudioMeter();
                    }}
                    onEnded={() => {
                      updatePlaybackState();
                      stopAudioMeter();
                    }}
                  />
                </div>
                <VideoStatePanel
                  audioBars={audioBars}
                  bufferedPercent={bufferedPercent}
                  currentTime={playbackState.currentTime}
                  duration={playbackState.duration}
                  paused={playbackState.paused}
                  progressPercent={playbackPercent}
                  volume={playbackState.volume}
                />
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-[#777]">
                <Video className="h-8 w-8" />
                <span className="text-[13px]">Chọn video đã xử lý</span>
              </div>
            )}
          </div>
        </div>
        <aside className="sticky top-0 self-start rounded border border-[#333] bg-[#1e1e1e]">
          <div className="border-b border-[#333] px-3 py-2 text-[11px] font-medium uppercase text-[#bbbbbb]">Playlist parts</div>
          <div className="max-h-[calc(100vh-150px)] space-y-1 overflow-auto p-2">
            {segments.length > 0 ? segments.map((segment) => (
              <button
                key={segment.index}
                className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-[12px] ${selectedSegment?.index === segment.index ? "bg-[#04395e] text-white" : "bg-[#252526] text-[#cfcfcf] hover:bg-[#2a2d2e]"}`}
                onClick={() => props.onSelectSegment(segment.index)}
              >
                <input type="checkbox" checked={props.checkedSegmentIndexes.includes(segment.index)} onChange={() => props.onToggleCheckedSegment(segment.index)} onClick={(e) => e.stopPropagation()} className="h-3.5 w-3.5 rounded border-[#3c3c3c] bg-[#252526] text-[#0e639c] shrink-0" />
                <span className="min-w-0 flex-1 truncate">{segment.title}</span>
                <span className="shrink-0 text-[#8f8f8f]">{formatDuration(segment.duration_seconds)}</span>
              </button>
            )) : (
              <div className="px-2 py-8 text-center text-[12px] text-[#858585]">Video này chưa có part.</div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

function VideoStatePanel(props: {
  audioBars: number[];
  bufferedPercent: number;
  currentTime: number;
  duration: number;
  paused: boolean;
  progressPercent: number;
  volume: number;
}) {
  return (
    <div className="border-t border-[#252525] bg-[#151515] px-3 py-2">
      <div className="mb-2 h-1.5 overflow-hidden rounded bg-[#303030]">
        <div className="h-full rounded bg-[#3d3d3d]" style={{ width: `${props.bufferedPercent}%` }}>
          <div className="h-full rounded bg-[#0e639c]" style={{ width: props.bufferedPercent > 0 ? `${Math.min(100, (props.progressPercent / props.bufferedPercent) * 100)}%` : "0%" }} />
        </div>
      </div>
      <div className="grid grid-cols-[120px_minmax(120px,1fr)_84px] items-center gap-3 text-[11px] text-[#a8a8a8]">
        <div className="font-medium text-[#d0d0d0]">
          {formatPlaybackTime(props.currentTime)} / {formatPlaybackTime(props.duration)}
        </div>
        <div className="flex h-9 items-end gap-0.5 rounded bg-[#202020] px-2 py-1.5" title="Phổ tần số âm thanh realtime">
          {props.audioBars.map((value, index) => (
            <div
              key={index}
              className="min-h-[2px] flex-1 rounded-sm bg-[#7cc4ff]"
              style={{ height: `${Math.max(2, (value / 255) * 100)}%`, opacity: props.paused ? 0.35 : 0.9 }}
            />
          ))}
        </div>
        <div className="text-right">
          <div>{props.paused ? "paused" : "playing"}</div>
          <div>{Math.round(props.volume * 100)}% vol</div>
        </div>
      </div>
    </div>
  );
}

function Inspector(props: {
  activeTab: "search" | "processed" | "completed" | "config";
  candidate: SearchCandidate | null;
  candidateSeriesInfo: SeriesInfo | null;
  loadingCandidateSeriesInfo: boolean;
  translatedTitle: string | null;
  translatingTitle: string | null;
  translating: boolean;
  job: Job | null;
  jobs: Job[];
  deleting: boolean;
  retranslating: boolean;
  applyingSubtitles: boolean;
  applyingFilter: boolean;
  subtitleStyle: SubtitleStyleInput;
  videoFilter: VideoFilterInput;
  onSubtitleStyleChange: (style: SubtitleStyleInput) => void;
  onVideoFilterChange: (style: VideoFilterInput) => void;
  selectedSegmentIndex: number | null;
  checkedSegmentIndexes: number[];
  onToggleCheckedSegment: (index: number) => void;
  onSelectSegment: (index: number | null) => void;
  onSelectJob: (jobId: number) => void;
  onTranslateTitle: (candidate: SearchCandidate) => void;
  onDelete: (job: Job) => void;
  onRetry: (job: Job) => void;
  onRetranslate: (job: Job) => void;
  onApplySubtitles: (job: Job) => void;
  onApplyFilter: (job: Job) => void;
  inspectorJobTab: "detail" | "tiktok";
  onInspectorJobTabChange: (tab: "detail" | "tiktok") => void;
  generatingTikTokMetadata: boolean;
  publishingTikTok: boolean;
  retrying: boolean;
  onGenerateTikTokMetadata: (job: Job) => void;
  onPublishTikTok: (job: Job, profileIds: number[], caption: string, segmentIndexes?: number[]) => void;
}) {
  const source = useVideoLocalizationSource();
  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-l border-[#303030] bg-[#252526]">
      <SectionTitle>{props.activeTab === "search" ? "Xem trước" : "Chi tiết job"}</SectionTitle>
      {(props.activeTab === "processed" || props.activeTab === "completed") && (
        <div className="flex border-b border-[#303030] bg-[#1e1e1e]">
          <button
            className={`h-9 px-3 text-[12px] ${props.inspectorJobTab === "detail" ? "border-b-2 border-[#0e639c] text-white" : "text-[#9d9d9d] hover:text-white"}`}
            onClick={() => props.onInspectorJobTabChange("detail")}
          >
            Chi tiết
          </button>
          <button
            className={`h-9 px-3 text-[12px] ${props.inspectorJobTab === "tiktok" ? "border-b-2 border-[#0e639c] text-white" : "text-[#9d9d9d] hover:text-white"}`}
            onClick={() => props.onInspectorJobTabChange("tiktok")}
          >
            TikTok
          </button>
        </div>
      )}
      <div className={`min-h-0 flex-1 overflow-auto ${props.activeTab === "search" ? "p-3 pb-3" : ""}`}>
        {props.activeTab === "search" && (
          <div className="mb-3 flex aspect-[9/16] items-center justify-center overflow-hidden rounded bg-[#111]">
            {props.candidate?.embed_url ? (
              <iframe
                key={props.candidate.embed_url}
                className="h-full w-full border-0"
                src={props.candidate.embed_url}
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                referrerPolicy="no-referrer-when-downgrade"
                title={props.candidate.title}
              />
            ) : props.candidate?.thumbnail_url ? (
              <img className="h-full w-full object-contain" src={source.imageProxyUrl(props.candidate.thumbnail_url) ?? ""} />
            ) : (
              <div className="flex flex-col items-center gap-2 text-[#777]"><Video className="h-8 w-8" /><span className="text-[13px]">Preview</span></div>
            )}
          </div>
        )}
        {props.activeTab === "search" && props.candidate && (
          <Panel title="Selected video">
            <div className="mb-2 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px] text-[#c8c8c8] hover:bg-[#3a3a3a]"
                disabled={!!props.translatedTitle || (props.translating && props.translatingTitle === props.candidate.title)}
                onClick={() => props.candidate && props.onTranslateTitle(props.candidate)}
              >
                {props.translating && props.translatingTitle === props.candidate.title ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {props.translatedTitle ? "Đã dịch" : "Dịch title"}
              </Button>
            </div>
            <Info label="Title" value={props.candidate.title} />
            {props.translatedTitle && <Info label="Title VI" value={props.translatedTitle} />}
            <Info label="Platform" value={props.candidate.platform} />
            <Info label="Duration" value={formatDuration(props.candidate.duration_seconds)} />
            {props.candidate.review_count ? <Info label="Search count" value={`${props.candidate.review_count} review/danmaku`} /> : null}
            {props.candidate.series_title && <Info label="Series" value={`${props.candidate.series_title}${props.candidate.episode_index ? ` · Ep ${props.candidate.episode_index}` : ""}`} />}
            <Info label="Series videos" value={formatSeriesInfo(props.candidate, props.candidateSeriesInfo, props.loadingCandidateSeriesInfo)} />
            <CandidateEpisodes
              episodes={props.candidateSeriesInfo?.episodes ?? []}
              selectedUrl={props.candidate.url}
              loading={props.loadingCandidateSeriesInfo}
            />
            {props.candidate.availability_note && <Info label="Note" value={props.candidate.availability_note} />}
          </Panel>
        )}
        {(props.activeTab === "processed" || props.activeTab === "completed") && props.job && props.inspectorJobTab === "detail" && (
          <div className="space-y-2 p-3">
            <div className="text-[11px] font-medium uppercase text-[#bbbbbb]">Job #{props.job.id}</div>
            <div className="grid grid-cols-[1fr_1.2fr] gap-2">
              <Field label="Cỡ chữ">
                <Input
                  className="h-8 border-[#3c3c3c] bg-[#252526] text-[12px] text-[#d4d4d4] focus-visible:ring-[#0e639c]"
                  type="number"
                  min={12}
                  max={34}
                  value={props.subtitleStyle.font_size}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    props.onSubtitleStyleChange({
                      ...props.subtitleStyle,
                      font_size: Number.isFinite(value) ? Math.max(12, Math.min(34, value)) : 18,
                    });
                  }}
                />
              </Field>
              <Field label="Vị trí chữ">
                <Select
                  value={props.subtitleStyle.position}
                  onValueChange={(value) => {
                    if (value === "bottom" || value === "middle" || value === "top") {
                      props.onSubtitleStyleChange({ ...props.subtitleStyle, position: value });
                    }
                  }}
                >
                  <SelectTrigger className="h-8 border-[#3c3c3c] bg-[#252526] text-[12px] text-[#d4d4d4] focus:ring-[#0e639c]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={darkSelectContentClass}>
                    <SelectItem className={darkSelectItemClass} value="bottom">Dưới an toàn</SelectItem>
                    <SelectItem className={darkSelectItemClass} value="middle">Giữa màn hình</SelectItem>
                    <SelectItem className={darkSelectItemClass} value="top">Trên an toàn</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-[1fr_90px] gap-2">
              <Field label="Filter">
                <Select
                  value={props.videoFilter.preset}
                  onValueChange={(value) => {
                    if (value === "studio_bright" || value === "cinematic_dark" || value === "warm_pop" || value === "cool_clean" || value === "natural") {
                      props.onVideoFilterChange({ ...props.videoFilter, preset: value });
                    }
                  }}
                >
                  <SelectTrigger className="h-8 border-[#3c3c3c] bg-[#252526] text-[12px] text-[#d4d4d4] focus:ring-[#0e639c]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={darkSelectContentClass}>
                    <SelectItem className={darkSelectItemClass} value="studio_bright">Sáng studio</SelectItem>
                    <SelectItem className={darkSelectItemClass} value="cinematic_dark">Tối cinematic</SelectItem>
                    <SelectItem className={darkSelectItemClass} value="warm_pop">Ấm nổi màu</SelectItem>
                    <SelectItem className={darkSelectItemClass} value="cool_clean">Lạnh sạch</SelectItem>
                    <SelectItem className={darkSelectItemClass} value="natural">Tự nhiên</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Speed">
                <Input
                  className="h-8 border-[#3c3c3c] bg-[#252526] text-[12px] text-[#d4d4d4] focus-visible:ring-[#0e639c]"
                  type="number"
                  min={0.9}
                  max={1.15}
                  step={0.01}
                  value={props.videoFilter.speed}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    props.onVideoFilterChange({
                      ...props.videoFilter,
                      speed: Number.isFinite(value) ? Math.max(0.9, Math.min(1.15, value)) : 1.05,
                    });
                  }}
                />
              </Field>
            </div>
            <div className="mb-2 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="h-8 text-[12px]"
                onClick={() => props.onRetry(props.job!)}
                disabled={props.retrying || props.job.status === "running"}
                title="Chạy lại pipeline cho job này, giữ lại file đã tải nếu còn trên máy"
              >
                {props.retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                Chạy lại
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="h-8 text-[12px]"
                onClick={() => props.onRetranslate(props.job!)}
                disabled={props.retranslating || props.job.status === "running" || !props.job.artifacts.zh_srt_path}
              >
                {props.retranslating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                Dịch lại
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="h-8 text-[12px]"
                onClick={() => props.onApplySubtitles(props.job!)}
                disabled={props.applyingSubtitles || props.job.status === "running" || !props.job.artifacts.raw_video_path || !props.job.artifacts.vi_srt_path}
              >
                {props.applyingSubtitles ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Áp sub
              </Button>
              <Button variant="destructive" size="sm" className="h-8 text-[12px]" onClick={() => props.onDelete(props.job!)} disabled={props.deleting}>
                {props.deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Xóa file
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="h-8 text-[12px]"
                onClick={() => props.onApplyFilter(props.job!)}
                disabled={props.applyingFilter || props.job.status === "running" || !props.job.artifacts.output_video_path}
                title="Áp preset màu, speed và loudness normalize cho bản xuất bản"
              >
                {props.applyingFilter ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Áp filter
              </Button>
            </div>
            <Info label="Trạng thái" value={props.job.status} />
            <Info label="Nguồn" value={String(props.job.artifacts.search_provider ?? "-")} />
            <Info label="Video gốc" value={String(props.job.artifacts.crawler_title ?? props.job.artifacts.raw_title ?? "-")} />
            {getDownloadProgress(props.job) && (
              <Info
                label="Tiến độ tải"
                value={formatDownloadProgress(getDownloadProgress(props.job)!)}
              />
            )}
            {getStepProgress(props.job) && <StepProgressView progress={getStepProgress(props.job)!} />}
            <Info label="Sub Trung" value={String(props.job.artifacts.zh_srt_path ?? "-")} />
            <Info label="Sub Việt" value={String(props.job.artifacts.vi_srt_path ?? "-")} />
            <Info label="Thành phẩm" value={String(props.job.artifacts.output_video_path ?? "-")} />
            <Button
              variant="secondary"
              size="sm"
              className="h-8 text-[12px]"
              disabled={!getOutputFolderTarget(props.job)}
              onClick={async () => {
                if (!props.job) return;
                try {
                  await source.openJobOutputFolder(props.job.id);
                } catch (error) {
                  toast.error(error instanceof Error ? formatApiError(error.message) : "Không mở được folder thành phẩm.");
                }
              }}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Mở folder thành phẩm
            </Button>
            <Info label="Số part" value={String(getSegments(props.job).length || "-")} />
            {Boolean(props.job.artifacts.publish_filter) && <Info label="Filter" value={formatPublishFilter(props.job.artifacts.publish_filter)} />}
            {props.job.error_message && <Info label="Lỗi" value={formatJobError(props.job.error_message)} />}
          </div>
        )}
        {(props.activeTab === "processed" || props.activeTab === "completed") && props.job && props.inspectorJobTab === "tiktok" && (
          <TikTokMetadataPanel
            job={props.job}
            checkedSegmentIndexes={props.checkedSegmentIndexes}
            generating={props.generatingTikTokMetadata}
            publishing={props.publishingTikTok}
            onGenerate={() => props.onGenerateTikTokMetadata(props.job!)}
            onPublish={(profileIds, caption, segmentIndexes) => props.onPublishTikTok(props.job!, profileIds, caption, segmentIndexes)}
          />
        )}
      </div>
    </aside>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="border-b border-[#303030] px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-[#bbbbbb]">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-2 block text-[11px] font-medium uppercase text-[#9d9d9d]">{label}</Label>
      {children}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded border border-[#333] bg-[#1e1e1e]">
      <div className="border-b border-[#333] px-3 py-2 text-[11px] font-medium uppercase text-[#bbbbbb]">{title}</div>
      <div className="space-y-2 p-3">{children}</div>
    </section>
  );
}

function TikTokMetadataPanel(props: { job: Job; checkedSegmentIndexes: number[]; generating: boolean; publishing: boolean; onGenerate: () => void; onPublish: (profileIds: number[], caption: string, segmentIndexes?: number[]) => void }) {
  const source = useVideoLocalizationSource();
  const metadata = getTikTokMetadata(props.job);
  const profiles = useQuery({
    queryKey: ["tiktok-profiles"],
    queryFn: source.listTikTokProfiles,
  });
  const tiktokProfiles = profiles.data ?? [];
  const activeProfiles = tiktokProfiles.filter((profile) => profile.status === "active");
  const [profileIds, setProfileIds] = useState<number[]>([]);
  const [caption, setCaption] = useState("");

  useEffect(() => {
    if (profileIds.length === 0 && activeProfiles[0]) {
      setProfileIds([activeProfiles[0].id]);
    }
  }, [activeProfiles, profileIds.length]);

  useEffect(() => {
    setCaption(buildTikTokCaption(props.job));
  }, [props.job.id, props.job.artifacts.tiktok_metadata]);

  return (
    <div className="space-y-3 p-3">
      <Button
        className="h-8 bg-[#0e639c] text-[12px] text-white hover:bg-[#1177bb] w-full"
        onClick={props.onGenerate}
        disabled={props.generating}
      >
        {props.generating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Check className="h-3.5 w-3.5 mr-2" />}
        Auto generate metadata
      </Button>
      <Panel title="Publish Configuration">
        <Field label="Tài khoản TikTok">
          <div className="max-h-40 overflow-y-auto rounded-md border border-[#3c3c3c] bg-[#252526] p-2 space-y-1">
            {profiles.isLoading && <div className="text-[12px] text-[#8f8f8f]">Đang tải...</div>}
            {tiktokProfiles.map((profile) => (
              <label key={profile.id} className="flex items-center gap-2 text-[12px] text-[#d4d4d4] cursor-pointer hover:bg-[#2a2d2e] p-1 rounded">
                <input
                  type="checkbox"
                  checked={profileIds.includes(profile.id)}
                  disabled={profile.status !== "active"}
                  onChange={(e) => {
                    if (e.target.checked) setProfileIds(prev => [...prev, profile.id]);
                    else setProfileIds(prev => prev.filter(id => id !== profile.id));
                  }}
                  className="h-3.5 w-3.5 rounded border-[#3c3c3c] bg-[#1e1e1e] text-[#0e639c]"
                />
                <span className={profile.status !== "active" ? "opacity-50" : ""}>
                  {profile.profile_name}{profile.username ? ` · ${profile.username}` : ""}
                  {profile.status !== "active" ? ` (${profile.status})` : ""}
                </span>
              </label>
            ))}
          </div>
        </Field>
        {props.checkedSegmentIndexes.length > 0 && (
          <div className="rounded border border-[#0e639c] bg-[#04395e] px-3 py-2 text-[12px] text-white">
            Đang chọn {props.checkedSegmentIndexes.length} part để đăng. Nếu bỏ chọn hết sẽ đăng part đầu tiên.
          </div>
        )}
        <Field label="Caption">
          <textarea
            className="min-h-[140px] w-full resize-y rounded-md border border-[#3c3c3c] bg-[#252526] px-3 py-2 text-[12px] text-[#d4d4d4] outline-none focus:border-[#0e639c]"
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="Caption TikTok..."
          />
        </Field>
        <Button
          className="h-8 w-full bg-[#0e639c] text-[12px] text-white hover:bg-[#1177bb]"
          disabled={props.publishing || profileIds.length === 0 || !caption.trim() || !getOutputFolderTarget(props.job)}
          onClick={() => props.onPublish(profileIds, caption, props.checkedSegmentIndexes.length > 0 ? props.checkedSegmentIndexes : undefined)}
          title="Mở TikTok Studio bằng profile đã login và tự upload video thành phẩm"
        >
          {props.publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Send className="h-3.5 w-3.5 mr-2" />}
          Đăng lên {profileIds.length > 1 ? `${profileIds.length} tài khoản` : 'TikTok'}
        </Button>
        {profiles.isError && (
          <div className="rounded border border-dashed border-[#5f3b3b] px-3 py-3 text-[12px] text-[#ffb4ab]">
            Không tải được danh sách tài khoản TikTok. Hãy đăng nhập lại dashboard rồi thử mở lại tab này.
          </div>
        )}
        {!profiles.isError && !tiktokProfiles.length && (
          <div className="rounded border border-dashed border-[#3a3a3a] px-3 py-3 text-[12px] text-[#8f8f8f]">
            Chưa có tài khoản TikTok. Vào Social Accounts để thêm tài khoản trước.
          </div>
        )}
        {!profiles.isError && tiktokProfiles.length > 0 && !activeProfiles.length && (
          <div className="rounded border border-dashed border-[#3a3a3a] px-3 py-3 text-[12px] text-[#8f8f8f]">
            Chưa có tài khoản TikTok đang hoạt động. Vào Social Accounts để đăng nhập tài khoản trước.
          </div>
        )}
        {Boolean(props.job.artifacts.last_publish_result) && (
          <Info label="Lần đăng gần nhất" value={formatLastPublishResult(props.job.artifacts.last_publish_result)} />
        )}
      </Panel>
      {metadata ? (
        <div className="space-y-2">
          <Info label="Title" value={metadata.title} />
          <Info label="Description" value={metadata.description} />
          <Info label="Hashtag" value={metadata.hashtags.join(" ")} />
          {metadata.hook && <Info label="Hook" value={metadata.hook} />}
          {metadata.source_summary && <Info label="Content detect" value={metadata.source_summary} />}
        </div>
      ) : (
        <div className="rounded border border-dashed border-[#3a3a3a] px-3 py-8 text-center text-[12px] text-[#8f8f8f]">
          Chưa có metadata TikTok cho job này.
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase text-[#858585]">{label}</div>
      <div className="break-words rounded bg-[#252526] px-2 py-1.5 text-[12px] text-[#cccccc]">{value || "-"}</div>
    </div>
  );
}

function CandidateEpisodes(props: { episodes: VideoDetailEpisode[]; selectedUrl: string; loading: boolean }) {
  if (props.loading) {
    return <Info label="Episodes" value="Đang tải danh sách tập..." />;
  }
  if (props.episodes.length <= 1) return null;

  return (
    <div>
      <div className="mb-1 text-[10px] uppercase text-[#858585]">Episodes</div>
      <div className="max-h-52 space-y-1 overflow-auto rounded bg-[#252526] p-1.5">
        {props.episodes.map((episode, index) => {
          const active = normalizeComparableUrl(episode.url) === normalizeComparableUrl(props.selectedUrl);
          return (
            <a
              key={episode.url}
              className={`block rounded px-2 py-1.5 text-[12px] ${active ? "bg-[#04395e] text-white" : "text-[#cccccc] hover:bg-[#2f2f2f]"}`}
              href={episode.url}
              target="_blank"
              rel="noreferrer"
              title={episode.title}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{episodeLabel(episode, index)} · {episode.title}</span>
                <span className="shrink-0 text-[11px] text-[#8f8f8f]">{formatDuration(episode.duration_seconds)}</span>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

type TikTokMetadata = {
  title: string;
  description: string;
  hashtags: string[];
  hook?: string;
  source_summary?: string;
};

function buildTikTokCaption(job: Job) {
  const metadata = getTikTokMetadata(job);
  if (metadata) {
    return [metadata.title, metadata.description, metadata.hashtags.join(" ")].filter(Boolean).join("\n\n");
  }
  const title = String(job.artifacts.crawler_title ?? job.artifacts.raw_title ?? job.input_text ?? "").trim();
  return `${title}\n\n#phimngan #shortdrama #vietsub`;
}

function formatLastPublishResult(value: unknown) {
  if (!value || typeof value !== "object") return "-";
  const record = value as Record<string, unknown>;
  const profileName = typeof record.profile_name === "string" ? record.profile_name : "TikTok";
  const success = record.success === true ? "thành công" : "lỗi";
  const publishedAt = typeof record.published_at === "string" ? record.published_at : "";
  return `${profileName} · ${success}${publishedAt ? ` · ${publishedAt}` : ""}`;
}

function getTikTokMetadata(job: Job | null): TikTokMetadata | null {
  const value = job?.artifacts.tiktok_metadata;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.title !== "string" || typeof record.description !== "string") return null;
  const hashtags = Array.isArray(record.hashtags) ? record.hashtags.map(String) : [];
  return {
    title: record.title,
    description: record.description,
    hashtags,
    hook: typeof record.hook === "string" ? record.hook : undefined,
    source_summary: typeof record.source_summary === "string" ? record.source_summary : undefined,
  };
}

function formatPublishFilter(value: unknown) {
  if (!value || typeof value !== "object") return "-";
  const record = value as Record<string, unknown>;
  const preset = typeof record.preset === "string" ? record.preset : "-";
  const speed = typeof record.speed === "number" ? record.speed : "-";
  return `${preset} · ${speed}x`;
}

function formatJobError(value: string) {
  const text = value || "";
  const lower = text.toLowerCase();
  if (lower.includes("chưa cấu hình deepseek api key") || lower.includes("missing deepseek_api_key") || lower.includes("acd_deepseek_api_key")) {
    return "Chưa cấu hình DeepSeek API key. Vào tab Config, nhập API key, bấm Save config rồi Chạy lại job.";
  }
  if (lower.includes("silero_vad") && (lower.includes("no_suchfile") || lower.includes("doesn't exist") || lower.includes("file doesn't exist"))) {
    return "Backend thiếu asset STT/OCR nội bộ. Chạy lại setup backend rồi bấm Chạy lại, không cần xóa job.";
  }
  if (lower.includes("invalid api key") || lower.includes("unauthorized") || lower.includes("401")) {
    return "DeepSeek API key không hợp lệ. Kiểm tra lại key trong tab Config rồi Chạy lại job.";
  }
  if (lower.includes("insufficient balance") || lower.includes("402")) {
    return "DeepSeek hết quota hoặc chưa nạp tiền. Đổi/nạp key trong tab Config rồi Chạy lại job.";
  }
  if (lower.includes("rate limit") || lower.includes("429")) {
    return "DeepSeek đang giới hạn tốc độ. Chờ một lát rồi Chạy lại job.";
  }
  return text;
}

function formatApiError(value: string) {
  let text = value || "";
  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (typeof parsed.detail === "string") text = parsed.detail;
  } catch {
    // Keep raw text for non-JSON responses.
  }
  return formatJobError(text);
}

type Segment = { index: number; title: string; path?: string; duration_seconds: number | null };

function formatDuration(value: number | null | undefined) {
  if (!value) return "-";
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatPlaybackTime(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) return "0:00";
  const totalSeconds = Math.max(0, Math.floor(value));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatSeriesInfo(candidate: SearchCandidate, seriesInfo: SeriesInfo | null, loading: boolean) {
  if (loading) return "Đang kiểm tra...";
  if (seriesInfo?.episode_count) {
    const related = seriesInfo.related_count ? ` · ${seriesInfo.related_count} liên quan` : "";
    return `${seriesInfo.episode_count} video${related}`;
  }
  if (candidate.playlist_size) return `${candidate.playlist_size} video tìm thấy trong search`;
  return "Chưa thấy series";
}

type SearchCandidateGroup = {
  key: string;
  title: string;
  items: SearchCandidate[];
};

function groupSearchCandidates(candidates: SearchCandidate[]): SearchCandidateGroup[] {
  const map = new Map<string, SearchCandidateGroup>();
  for (const candidate of candidates) {
    const key = candidate.series_key && candidate.playlist_size && candidate.playlist_size > 1
      ? `series:${candidate.series_key}`
      : `single:${candidate.url}`;
    const title = candidate.series_title || candidate.series_key || candidate.title;
    const existing = map.get(key);
    if (existing) {
      existing.items.push(candidate);
    } else {
      map.set(key, { key, title, items: [candidate] });
    }
  }
  return Array.from(map.values()).map((group) => ({
    ...group,
    items: [...group.items].sort((left, right) => {
      const leftEp = left.episode_index ?? 9999;
      const rightEp = right.episode_index ?? 9999;
      if (leftEp !== rightEp) return leftEp - rightEp;
      return (left.duration_seconds ?? 0) - (right.duration_seconds ?? 0);
    })
  }));
}

function episodeLabel(candidate: Pick<SearchCandidate, "episode_index">, index: number) {
  return `EP ${candidate.episode_index ?? index + 1}`;
}

function normalizeComparableUrl(value: string) {
  return value.replace(/^http:\/\//, "https://").replace(/#.*$/, "");
}

function getSegments(job: Job | null): Segment[] {
  const value = job?.artifacts.segments;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Segment[] => {
    if (!item || typeof item !== "object") return [];
    const segment = item as Record<string, unknown>;
    if (typeof segment.index !== "number") return [];
    return [{
      index: segment.index,
      title: typeof segment.title === "string" ? segment.title : `Part ${segment.index}`,
      path: typeof segment.path === "string" ? segment.path : undefined,
      duration_seconds: typeof segment.duration_seconds === "number" ? segment.duration_seconds : null
    }];
  });
}

function getOutputFolderTarget(job: Job | null) {
  if (!job) return null;
  const outputPath = job.artifacts.output_video_path;
  if (typeof outputPath === "string" && outputPath) return outputPath;
  const masterPath = job.artifacts.master_video_path;
  if (typeof masterPath === "string" && masterPath) return masterPath;
  const segments = getSegments(job);
  if (segments[0]?.path) return segments[0].path;
  const outputDir = job.artifacts.job_output_dir;
  if (typeof outputDir === "string" && outputDir) return outputDir;
  return null;
}

type DownloadProgress = {
  status?: string;
  percent?: number;
  downloaded_bytes?: number | null;
  total_bytes?: number | null;
  speed_bytes_per_sec?: number | null;
  eta_seconds?: number | null;
};

type StepProgress = {
  step?: string;
  label?: string;
  status?: string;
  percent?: number;
  current?: number;
  total?: number;
  detail?: string;
  unit?: string;
  updated_at_ms?: number;
};

function getStepProgress(job: Job | null): StepProgress | null {
  const value = job?.artifacts.step_progress;
  if (!value || typeof value !== "object") return null;
  return value as StepProgress;
}

function StepProgressView({ progress }: { progress: StepProgress }) {
  const percent = typeof progress.percent === "number" ? progress.percent : 0;
  const counter = typeof progress.current === "number" && typeof progress.total === "number"
    ? progress.unit === "byte"
      ? `${formatBytes(progress.current)} / ${formatBytes(progress.total)}`
      : `${progress.current}/${progress.total}${progress.unit ? ` ${progress.unit}` : ""}`
    : "";
  const updated = progress.updated_at_ms ? formatUpdated(progress.updated_at_ms) : "";
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase text-[#858585]">Tiến trình hiện tại</div>
      <div className="rounded bg-[#252526] p-2 text-[12px] text-[#cccccc]">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="font-medium text-[#dcdcdc]">{progress.label ?? progress.step ?? "-"}</span>
          <span className="text-[#9d9d9d]">{typeof progress.percent === "number" ? `${progress.percent.toFixed(1)}%` : progress.status ?? "-"}</span>
        </div>
        <Progress value={percent} className="mb-2 h-1.5 bg-[#3a3a3a] [&>div]:bg-[#0e639c]" />
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#9d9d9d]">
          {progress.status && <span>{progress.status}</span>}
          {counter && <span>{counter}</span>}
          {updated && <span>{updated}</span>}
        </div>
        {progress.detail && <div className="mt-1 text-[11px] text-[#b5b5b5]">{progress.detail}</div>}
      </div>
    </div>
  );
}

function getDownloadProgress(job: Job | null): DownloadProgress | null {
  const value = job?.artifacts.download_progress;
  if (!value || typeof value !== "object") return null;
  return value as DownloadProgress;
}

function formatDownloadProgress(progress: DownloadProgress) {
  const percent = typeof progress.percent === "number" ? `${progress.percent.toFixed(1)}%` : "-";
  const size =
    progress.downloaded_bytes && progress.total_bytes
      ? `${formatBytes(progress.downloaded_bytes)} / ${formatBytes(progress.total_bytes)}`
      : progress.downloaded_bytes
        ? formatBytes(progress.downloaded_bytes)
        : "-";
  const speed = progress.speed_bytes_per_sec ? `${formatBytes(progress.speed_bytes_per_sec)}/s` : "-";
  const eta = progress.eta_seconds ? `${progress.eta_seconds}s` : "-";
  return `${percent} · ${size} · ${speed} · ETA ${eta}`;
}

function formatBytes(value: number) {
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatUpdated(value: number) {
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (seconds < 3) return "vừa cập nhật";
  if (seconds < 60) return `${seconds}s trước`;
  return `${Math.floor(seconds / 60)}m trước`;
}

