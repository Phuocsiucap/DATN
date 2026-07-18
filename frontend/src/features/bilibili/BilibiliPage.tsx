import { VideoLocalizationWorkspace } from "@/features/video-localization/VideoLocalizationWorkspace";
import { bilibiliSource } from "./source";

export function BilibiliPage() {
  return <VideoLocalizationWorkspace source={bilibiliSource} />;
}
