import re

path = "d:/DATN/frontend/src/features/video-localization/VideoLocalizationWorkspace.tsx"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

old_panel = """function TikTokMetadataPanel(props: { job: Job; generating: boolean; publishing: boolean; onGenerate: () => void; onPublish: (profileId: number, caption: string) => void }) {
  const source = useVideoLocalizationSource();
  const metadata = getTikTokMetadata(props.job);
  const profiles = useQuery({
    queryKey: ["tiktok-profiles"],
    queryFn: source.listTikTokProfiles,
  });
  const tiktokProfiles = profiles.data ?? [];
  const activeProfiles = tiktokProfiles.filter((profile) => profile.status === "active");
  const [profileId, setProfileId] = useState("");
  const [caption, setCaption] = useState("");

  useEffect(() => {
    if (!profileId && activeProfiles[0]) {
      setProfileId(String(activeProfiles[0].id));
    }
  }, [activeProfiles, profileId]);

  useEffect(() => {
    setCaption(buildTikTokCaption(props.job));
  }, [props.job.id, props.job.artifacts.tiktok_metadata]);

  return (
    <div className="space-y-3 p-3">
      <Button
        className="h-8 bg-[#0e639c] text-[12px] text-white hover:bg-[#1177bb]"
        onClick={props.onGenerate}
        disabled={props.generating}
      >
        {props.generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        Auto generate
      </Button>
      <Panel title="Publish">
        <Field label="Tài khoản TikTok">
          <Select value={profileId} onValueChange={setProfileId}>
            <SelectTrigger className="h-8 border-[#3c3c3c] bg-[#252526] text-[12px] text-[#d4d4d4] focus:ring-[#0e639c]">
              <SelectValue placeholder={profiles.isLoading ? "Đang tải tài khoản..." : "Chọn tài khoản"} />
            </SelectTrigger>
            <SelectContent className={darkSelectContentClass}>
              {tiktokProfiles.map((profile) => (
                <SelectItem className={darkSelectItemClass} key={profile.id} value={String(profile.id)} disabled={profile.status !== "active"}>
                  {profile.profile_name}{profile.username ? ` · ${profile.username}` : ""}
                  {profile.status !== "active" ? ` · ${profile.status}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
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
          disabled={props.publishing || !profileId || !caption.trim() || !getOutputFolderTarget(props.job)}
          onClick={() => props.onPublish(Number(profileId), caption)}
          title="Mở TikTok Studio bằng profile đã login và tự upload video thành phẩm"
        >
          {props.publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Đăng lên TikTok
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
}"""

new_panel = """function TikTokMetadataPanel(props: { job: Job; checkedSegmentIndexes: number[]; generating: boolean; publishing: boolean; onGenerate: () => void; onPublish: (profileIds: number[], caption: string, segmentIndexes?: number[]) => void }) {
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
}"""

if old_panel in content:
    content = content.replace(old_panel, new_panel)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("Updated TikTokMetadataPanel")
else:
    print("Could not find TikTokMetadataPanel in the file")

