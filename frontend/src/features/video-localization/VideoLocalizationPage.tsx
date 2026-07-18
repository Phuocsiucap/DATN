import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { useEffect, useState } from "react";
import { BilibiliVideoDetailPage } from "./BilibiliVideoDetailPage";
import { VideoLocalizationWorkspace } from "./VideoLocalizationWorkspace";
import { bilibiliSource } from "@/features/bilibili/source";

const bilibiliCrawlerQueryClient = new QueryClient();

export default function VideoLocalizationPage() {
  const [detailAid, setDetailAid] = useState(getDetailAidFromPath);

  useEffect(() => {
    const handlePopState = () => setDetailAid(getDetailAidFromPath());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const openDetail = (aid: number) => {
    window.history.pushState(null, "", `/video-localization/bilibili/${aid}`);
    setDetailAid(aid);
  };

  const backToSearch = () => {
    window.history.pushState(null, "", "/video-localization");
    setDetailAid(null);
  };

  return (
    <QueryClientProvider client={bilibiliCrawlerQueryClient}>
      {detailAid ? (
        <BilibiliVideoDetailPage aid={detailAid} onBack={backToSearch} onOpenVideo={openDetail} />
      ) : (
        <VideoLocalizationWorkspace source={bilibiliSource} onOpenCandidateDetail={(candidate) => candidate.aid && openDetail(candidate.aid)} />
      )}
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}

function getDetailAidFromPath() {
  const match = window.location.pathname.match(/^\/video-localization\/bilibili\/(\d+)\/?$/);
  return match ? Number(match[1]) : null;
}
