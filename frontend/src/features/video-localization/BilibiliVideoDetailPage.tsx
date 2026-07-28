import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Clock3, Download, Loader2, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/commons/component/ui/button";
import type { SearchCandidate } from "@/features/bilibili/api";
import type { VideoDetailEpisode, VideoDetailRelated } from "@/features/bilibili/types";
import { bilibiliSource } from "@/features/bilibili/source";

type Props = {
  aid: number;
  onBack: () => void;
  onOpenVideo: (aid: number) => void;
};

export function BilibiliVideoDetailPage({ aid, onBack, onOpenVideo }: Props) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["bilibili-video-detail", aid],
    queryFn: () => bilibiliSource.getSeriesInfo?.({ aid }) ?? Promise.reject(new Error("Series detail is not supported.")),
  });
  const episodes = detail.data?.episodes ?? [];
  const [selectedEpisodeUrl, setSelectedEpisodeUrl] = useState<string | null>(null);
  const selectedEpisode = episodes.find((item) => item.url === selectedEpisodeUrl) ?? episodes[0] ?? null;
  const current = selectedEpisode ?? detail.data?.current ?? null;
  const related = detail.data?.related ?? [];
  const currentCandidate = current ? toSearchCandidate(current, "view_detail") : null;

  const bvidToUse = current?.bvid || detail.data?.bvid;
  const pageToUse = current?.episode_index || 1;
  const embedUrlToUse = current?.embed_url || (bvidToUse ? `https://player.bilibili.com/player.html?bvid=${bvidToUse}&page=${pageToUse}&autoplay=0` : null);

  useEffect(() => {
    setSelectedEpisodeUrl(null);
  }, [aid]);

  const createJob = useMutation({
    mutationFn: (candidate: SearchCandidate) => bilibiliSource.createJobFromCandidate({
      input_text: candidate.title,
      candidate,
      max_duration_seconds: bilibiliSource.defaultMaxDurationSeconds,
    }),
    onSuccess: () => {
      toast.success("Đã đưa video vào pipeline");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <main className="grid h-full min-h-0 grid-rows-[46px_minmax(0,1fr)] overflow-hidden bg-[#1f1f1f] text-[13px] text-[#d4d4d4]">
      <header className="flex items-center justify-between border-b border-[#303030] bg-[#181818] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="sm" className="h-8 px-2 text-[#c8c8c8] hover:bg-[#2a2d2e]" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-medium text-white">{detail.data?.title || current?.title || `Bilibili #${aid}`}</div>
            <div className="text-[11px] text-[#8f8f8f]">
              {detail.isFetching ? "Đang tải detail..." : `${episodes.length || detail.data?.episode_count || 0} tập · ${detail.data?.related_count ?? related.length} liên quan`}
            </div>
          </div>
        </div>
        {currentCandidate && (
          <Button className="h-8 bg-[#0e639c] text-[13px] text-white hover:bg-[#1177bb]" disabled={createJob.isPending} onClick={() => createJob.mutate(currentCandidate)}>
            {createJob.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Download and Sub
          </Button>
        )}
      </header>

      <section className="grid min-h-0 grid-cols-[minmax(520px,1fr)_420px] overflow-hidden">
        <div className="min-h-0 overflow-auto bg-[#1e1e1e] p-4">
          <div className="aspect-video overflow-hidden rounded bg-[#111]">
            {embedUrlToUse ? (
              <iframe className="h-full w-full border-0" src={embedUrlToUse} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen title={current?.title || "Video player"} />
            ) : current?.thumbnail_url ? (
              <img className="h-full w-full object-contain" src={bilibiliSource.imageProxyUrl(current.thumbnail_url) ?? ""} />
            ) : (
              <div className="flex h-full items-center justify-center text-[#777]"><Video className="h-8 w-8" /></div>
            )}
          </div>
          <div className="mt-4 rounded border border-[#303030] bg-[#252526] p-4">
            <h2 className="text-[15px] font-semibold text-white">{current?.title || "Video detail"}</h2>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[#9d9d9d]">
              <span className="rounded bg-[#333] px-2 py-1">aid {detail.data?.aid ?? aid}</span>
              {detail.data?.bvid && <span className="rounded bg-[#333] px-2 py-1">{detail.data.bvid}</span>}
              {current?.duration_seconds && <span className="flex items-center gap-1 rounded bg-[#333] px-2 py-1"><Clock3 className="h-3 w-3" />{formatDuration(current.duration_seconds)}</span>}
              {current?.episode_index && <span className="rounded bg-[#17334a] px-2 py-1 text-[#9ad4ff]">P{current.episode_index}</span>}
              <span className="rounded bg-[#17334a] px-2 py-1 text-[#9ad4ff]">{episodes.length || detail.data?.episode_count || 0} tập</span>
            </div>
            {current?.description && <p className="mt-3 text-[12px] leading-5 text-[#aaa]">{current.description}</p>}
          </div>
        </div>

        <aside className="min-h-0 overflow-auto border-l border-[#303030] bg-[#252526]">
          <div className="sticky top-0 z-10 border-b border-[#303030] bg-[#252526] px-3 py-2 text-[12px] font-medium text-white">Danh sách tập</div>
          <div className="grid gap-1.5 p-3">
            {episodes.length > 0 ? episodes.map((episode, index) => {
              const active = current?.url === episode.url;
              return (
                <button
                  key={episode.url}
                  className={`grid grid-cols-[54px_1fr_auto] items-center gap-2 rounded border p-2 text-left ${active ? "border-[#0e639c] bg-[#04395e] text-white" : "border-[#303030] bg-[#202020] text-[#d4d4d4] hover:bg-[#2a2d2e]"}`}
                  onClick={() => setSelectedEpisodeUrl(episode.url)}
                  title={episode.title}
                >
                  <span className="rounded bg-[#333] px-2 py-1 text-center text-[11px] text-[#cde8ff]">P{episode.episode_index ?? index + 1}</span>
                  <span className="min-w-0 truncate text-[12px] font-medium">{episode.title}</span>
                  <span className="text-[11px] text-[#9d9d9d]">{formatDuration(episode.duration_seconds)}</span>
                </button>
              );
            }) : (
              <div className="rounded border border-dashed border-[#3a3a3a] px-3 py-8 text-center text-[12px] text-[#858585]">
                Video này không có danh sách tập.
              </div>
            )}
          </div>

          <div className="border-y border-[#303030] bg-[#252526] px-3 py-2 text-[12px] font-medium text-white">Phim liên quan</div>
          <div className="grid gap-2 p-3">
            {related.map((item) => (
              <button key={item.url} className="grid grid-cols-[96px_1fr] gap-3 rounded border border-[#303030] bg-[#202020] p-2 text-left hover:bg-[#2a2d2e]" onClick={() => item.aid && onOpenVideo(item.aid)}>
                <div className="aspect-video overflow-hidden rounded bg-[#111]">
                  {item.thumbnail_url ? <img className="h-full w-full object-cover" src={bilibiliSource.imageProxyUrl(item.thumbnail_url) ?? ""} /> : null}
                </div>
                <div className="min-w-0">
                  <div className="line-clamp-2 text-[12px] font-medium text-[#e6e6e6]">{item.title}</div>
                  <div className="mt-1 text-[11px] text-[#858585]">{formatDuration(item.duration_seconds)}</div>
                </div>
              </button>
            ))}
            {!detail.isLoading && related.length === 0 && <div className="py-12 text-center text-[12px] text-[#858585]">Không có phim liên quan.</div>}
          </div>
        </aside>
      </section>
    </main>
  );
}

function formatDuration(value: number | null | undefined) {
  if (!value) return "-";
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function toSearchCandidate(
  item: SearchCandidate | VideoDetailEpisode | VideoDetailRelated,
  fallbackQuery: string,
): SearchCandidate {
  return {
    ...item,
    query: "query" in item && item.query ? item.query : fallbackQuery,
  };
}
