import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, RefreshCcw, Search, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/commons/component/ui/button";
import { Input } from "@/commons/component/ui/input";
import { crawlBilibiliFeedNowApi, fetchBilibiliFeedApi, getBilibiliCrawlerImageProxyUrl, getBilibiliCrawlerSeriesInfoApi, normalizeBilibiliSeriesInfoPayload, type BilibiliFeedItem } from "@/commons/apis/bilibiliCrawler";
import { VideoLocalizationWorkspace } from "@/features/video-localization/VideoLocalizationWorkspace";
import { bilibiliSource } from "./source";

export function BilibiliPage() {
  const [tab, setTab] = useState<"feed" | "workspace">("feed");

  if (tab === "workspace") {
    return (
      <div className="relative h-screen min-h-0">
        <div className="absolute right-4 top-2 z-20">
          <Button className="h-8 bg-[#252526] text-[12px] text-[#d4d4d4] hover:bg-[#2f2f2f]" onClick={() => setTab("feed")}>
            Automation feed
          </Button>
        </div>
        <VideoLocalizationWorkspace source={bilibiliSource} />
      </div>
    );
  }

  return <BilibiliAutomationFeed onOpenWorkspace={() => setTab("workspace")} />;
}

function BilibiliAutomationFeed({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const feed = useQuery({
    queryKey: ["bilibili-feed", search],
    queryFn: () => fetchBilibiliFeedApi({ page: 1, limit: 40, search: search || undefined }),
  });
  const crawl = useMutation({
    mutationFn: () => crawlBilibiliFeedNowApi({ limit: 10, evaluate: true }),
    onSuccess: (result) => {
      toast.success(`Bilibili crawl xong: ${result.inserted} mới, ${result.queued} vào queue`);
      queryClient.invalidateQueries({ queryKey: ["bilibili-feed"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Crawl Bilibili lỗi"),
  });
  const items = feed.data?.items ?? [];
  const selected = useMemo(() => items.find((item) => item.link === selectedLink) ?? items[0] ?? null, [items, selectedLink]);

  return (
    <main className="grid h-screen min-h-0 grid-rows-[46px_minmax(0,1fr)] overflow-hidden bg-[#1f1f1f] text-[13px] text-[#d4d4d4]">
      <header className="flex items-center justify-between border-b border-[#303030] bg-[#181818] px-4">
        <div className="flex items-center gap-2">
          <div className="h-5 w-1 rounded bg-[#0e639c]" />
          <div>
            <h1 className="text-[15px] font-semibold text-white">Bilibili Automation Feed</h1>
            <p className="text-[11px] text-[#8f8f8f]">Search định kỳ, crawl detail/pages, AI match vào queue theo social profile.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button className="h-8 bg-[#252526] text-[12px] text-[#d4d4d4] hover:bg-[#2f2f2f]" onClick={onOpenWorkspace}>
            <Video className="mr-1 h-3.5 w-3.5" />
            Workspace
          </Button>
          <Button className="h-8 bg-[#0e639c] text-[12px] text-white hover:bg-[#1177bb]" disabled={crawl.isPending} onClick={() => crawl.mutate()}>
            {crawl.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="mr-1 h-3.5 w-3.5" />}
            Crawl now
          </Button>
        </div>
      </header>

      <section className="grid min-h-0 grid-cols-[420px_minmax(480px,1fr)] overflow-hidden">
        <aside className="flex min-h-0 flex-col border-r border-[#303030] bg-[#1e1e1e]">
          <div className="border-b border-[#303030] p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-[#777]" />
              <Input
                className="h-8 border-[#3c3c3c] bg-[#252526] pl-7 text-[12px] text-[#d4d4d4] focus-visible:ring-[#0e639c]"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Lọc feed Bilibili..."
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {feed.isLoading && <div className="p-6 text-center text-[#8f8f8f]">Đang tải feed...</div>}
            {!feed.isLoading && items.length === 0 && <div className="p-6 text-center text-[#8f8f8f]">Chưa có video crawl.</div>}
            {items.map((item) => (
              <FeedRow key={item.link} item={item} selected={selected?.link === item.link} onSelect={() => setSelectedLink(item.link)} />
            ))}
          </div>
        </aside>

        <section className="min-h-0 overflow-auto bg-[#1b1b1b]">
          {selected ? <FeedDetail item={selected} /> : <div className="flex h-full items-center justify-center text-[#777]">Chọn video để xem preview</div>}
        </section>
      </section>
    </main>
  );
}

function FeedRow({ item, selected, onSelect }: { item: BilibiliFeedItem; selected: boolean; onSelect: () => void }) {
  return (
    <button
      className={`mb-2 grid w-full grid-cols-[96px_1fr] gap-2 rounded border p-2 text-left ${selected ? "border-[#0e639c] bg-[#04395e]" : "border-[#303030] bg-[#252526] hover:bg-[#2a2d2e]"}`}
      onClick={onSelect}
    >
      <div className="flex aspect-video items-center justify-center overflow-hidden rounded bg-[#111]">
        {item.thumbnail_url ? <img className="h-full w-full object-cover" src={getBilibiliCrawlerImageProxyUrl(item.thumbnail_url)} /> : <Play className="h-5 w-5 text-[#777]" />}
      </div>
      <div className="min-w-0">
        <div className="line-clamp-2 text-[12px] font-medium text-[#f0f0f0]">{item.title}</div>
        <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-[#9d9d9d]">
          <span>{item.episode_count ?? 1} tập</span>
          <span>{formatDuration(item.duration_seconds)}</span>
          {item.play_count ? <span>{formatCompact(item.play_count)} views</span> : null}
        </div>
      </div>
    </button>
  );
}

function FeedDetail({ item }: { item: BilibiliFeedItem }) {
  const detailPayload = buildSeriesInfoPayload(item);
  const detail = useQuery({
    queryKey: ["bilibili-feed-series-info", item.link, item.aid, item.bvid],
    queryFn: () => getBilibiliCrawlerSeriesInfoApi(detailPayload),
    enabled: Boolean(detailPayload.aid || detailPayload.bvid || detailPayload.url),
  });
  const detailEpisodes = detail.data?.episodes ?? [];
  const episodes = detailEpisodes.length > 0 ? detailEpisodes : item.episodes ?? [];
  const episodeCount = detail.data?.episode_count || item.episode_count || episodes.length || 1;
  const source = detail.data?.source || item.series_source;
  const seasonTitle = detail.data?.season_title || item.season_title;
  const previewUrl = item.preview_url || item.link;
  return (
    <div className="p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-white">{item.title}</h2>
          <p className="mt-1 text-[12px] text-[#9d9d9d]">{item.description || item.link}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[#9ad4ff]">
            <span className="rounded bg-[#17334a] px-2 py-1">{episodeCount} tập</span>
            {source ? <span className="rounded bg-[#17334a] px-2 py-1">{source}</span> : null}
            {seasonTitle ? <span className="rounded bg-[#17334a] px-2 py-1">{seasonTitle}</span> : null}
            {detail.isFetching ? <span className="rounded bg-[#333] px-2 py-1 text-[#cfcfcf]">Đang tải detail...</span> : null}
          </div>
        </div>
        <a className="shrink-0 rounded bg-[#252526] px-3 py-2 text-[12px] text-[#d4d4d4] hover:bg-[#2f2f2f]" href={item.link} target="_blank" rel="noreferrer">
          Mở gốc
        </a>
      </div>
      <div className="aspect-video overflow-hidden rounded border border-[#303030] bg-black">
        <iframe className="h-full w-full" src={previewUrl ?? item.link} allow="autoplay; fullscreen; picture-in-picture" />
      </div>
      <div className="mt-4 rounded border border-[#303030] bg-[#1e1e1e]">
        <div className="border-b border-[#303030] px-3 py-2 text-[11px] font-medium uppercase text-[#bbbbbb]">Pages / tập</div>
        <div className="max-h-72 overflow-auto p-2">
          {episodes.length ? episodes.map((episode, index) => (
            <a key={`${episode.url}-${index}`} className="mb-1 flex items-center justify-between gap-2 rounded bg-[#252526] px-2 py-1.5 text-[12px] text-[#d4d4d4] hover:bg-[#2a2d2e]" href={episode.url || item.link} target="_blank" rel="noreferrer">
              <span className="min-w-0 truncate">EP {episode.episode_index ?? index + 1} · {episode.title}</span>
              <span className="shrink-0 text-[#8f8f8f]">{formatDuration(episode.duration_seconds)}</span>
            </a>
          )) : <div className="p-4 text-center text-[12px] text-[#8f8f8f]">{detail.isFetching ? "Đang tải danh sách tập..." : "Video này chưa có pages."}</div>}
        </div>
      </div>
    </div>
  );
}

function formatDuration(value?: number | null) {
  if (!value) return "-";
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function formatCompact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function buildSeriesInfoPayload(item: BilibiliFeedItem) {
  const episodeAid = item.episodes?.find((episode) => episode.aid)?.aid ?? null;
  return normalizeBilibiliSeriesInfoPayload({
    url: item.link,
    aid: item.aid ?? episodeAid,
    bvid: item.bvid,
  });
}
