import re

path = "d:/DATN/frontend/src/features/video-localization/VideoLocalizationWorkspace.tsx"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Replace Inspector props invocation
content = content.replace(
"""          selectedSegmentIndex={selectedSegmentIndex}
          onSelectSegment={setSelectedSegmentIndex}""",
"""          selectedSegmentIndex={selectedSegmentIndex}
          checkedSegmentIndexes={checkedSegmentIndexes}
          onSelectSegment={setSelectedSegmentIndex}
          onToggleCheckedSegment={(index) => {
            setCheckedSegmentIndexes(prev => prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]);
          }}""")

# Add checkedJobIds and checkedSegmentIndexes to ProcessedWorkspace Props
content = content.replace(
"""function ProcessedWorkspace(props: {
  jobs: Job[];
  selectedJob: Job | null;
  selectedJobId: number | null;
  selectedSegmentIndex: number | null;
  title: string;
  emptyText: string;
  onSelectJob: (jobId: number) => void;
  onSelectSegment: (index: number | null) => void;
}) {""",
"""function ProcessedWorkspace(props: {
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
  onSelectJob: (jobId: number) => void;
  onSelectSegment: (index: number | null) => void;
}) {""")

# Pass it to ProcessedResults
content = content.replace(
"""<ProcessedResults jobs={props.jobs} selectedJobId={props.selectedJobId} emptyText={props.emptyText} onSelectJob={props.onSelectJob} />""",
"""<ProcessedResults jobs={props.jobs} selectedJobId={props.selectedJobId} emptyText={props.emptyText} onSelectJob={props.onSelectJob} checkedJobIds={props.checkedJobIds} onToggleCheckedJob={props.onToggleCheckedJob} mergingJobs={props.mergingJobs} onMergeJobs={props.onMergeJobs} />""")

# Pass it to ProcessedPlayer
content = content.replace(
"""<ProcessedPlayer job={props.selectedJob} selectedSegmentIndex={props.selectedSegmentIndex} onSelectSegment={props.onSelectSegment} />""",
"""<ProcessedPlayer job={props.selectedJob} selectedSegmentIndex={props.selectedSegmentIndex} onSelectSegment={props.onSelectSegment} checkedSegmentIndexes={props.checkedSegmentIndexes} onToggleCheckedSegment={props.onToggleCheckedSegment} mergingParts={props.mergingParts} onMergeParts={props.onMergeParts} />""")

# Update ProcessedResults Props
content = content.replace(
"""function ProcessedResults(props: {
  jobs: Job[];
  selectedJobId: number | null;
  emptyText: string;
  onSelectJob: (jobId: number) => void;
}) {""",
"""function ProcessedResults(props: {
  jobs: Job[];
  selectedJobId: number | null;
  emptyText: string;
  checkedJobIds: number[];
  onToggleCheckedJob: (jobId: number) => void;
  mergingJobs: boolean;
  onMergeJobs: () => void;
  onSelectJob: (jobId: number) => void;
}) {""")

# Add Checkbox to ProcessedResults table headers
content = content.replace(
"""            <TableHead className="h-8 text-[11px] text-[#999]">ID</TableHead>""",
"""            <TableHead className="h-8 w-8 text-[11px] text-[#999]"></TableHead>
            <TableHead className="h-8 text-[11px] text-[#999]">ID</TableHead>""")

# Add Checkbox to ProcessedResults table body
content = content.replace(
"""              <TableCell className="py-2 text-[12px] text-[#ddd]">{job.id}</TableCell>""",
"""              <TableCell className="py-2 pl-3">
                <input type="checkbox" checked={props.checkedJobIds.includes(job.id)} onChange={() => props.onToggleCheckedJob(job.id)} onClick={(e) => e.stopPropagation()} className="h-3.5 w-3.5 rounded border-[#3c3c3c] bg-[#252526] text-[#0e639c]" />
              </TableCell>
              <TableCell className="py-2 text-[12px] text-[#ddd]">{job.id}</TableCell>""")

# Add Merge button to ProcessedResults
content = content.replace(
"""        <div className="flex h-10 items-center justify-between border-b border-[#303030] px-4">
          <div>
            <h2 className="text-[13px] font-semibold text-white">{props.title}</h2>
            <p className="text-[11px] text-[#8f8f8f]">{props.jobs.length} jobs</p>
          </div>
        </div>
        <ProcessedResults""",
"""        <div className="flex h-10 items-center justify-between border-b border-[#303030] px-4">
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
        <ProcessedResults""")

# Update ProcessedPlayer Props
content = content.replace(
"""function ProcessedPlayer(props: {
  job: Job | null;
  selectedSegmentIndex: number | null;
  onSelectSegment: (index: number | null) => void;
}) {""",
"""function ProcessedPlayer(props: {
  job: Job | null;
  selectedSegmentIndex: number | null;
  checkedSegmentIndexes: number[];
  onToggleCheckedSegment: (index: number) => void;
  mergingParts: boolean;
  onMergeParts: () => void;
  onSelectSegment: (index: number | null) => void;
}) {""")

# Update ProcessedPlayer Header for merge parts
content = content.replace(
"""      <div className="flex h-10 items-center justify-between border-b border-[#303030] px-4">
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold text-white">
            {props.job ? String(props.job.artifacts.crawler_title ?? props.job.artifacts.raw_title ?? props.job.input_text) : "Preview"}
          </h2>
          <p className="text-[11px] text-[#8f8f8f]">
            {selectedSegment ? `${selectedSegment.title} · ${formatDuration(selectedSegment.duration_seconds)}` : "Output video"}
          </p>
        </div>
      </div>""",
"""      <div className="flex h-10 items-center justify-between border-b border-[#303030] px-4">
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
      </div>""")

# Update ProcessedPlayer Segment button with checkbox
content = content.replace(
"""              <button
                key={segment.index}
                className={`flex w-full items-center justify-between rounded px-2 py-2 text-left text-[12px] ${selectedSegment?.index === segment.index ? "bg-[#04395e] text-white" : "bg-[#252526] text-[#cfcfcf] hover:bg-[#2a2d2e]"}`}
                onClick={() => props.onSelectSegment(segment.index)}
              >
                <span>{segment.title}</span>
                <span className="text-[#8f8f8f]">{formatDuration(segment.duration_seconds)}</span>
              </button>""",
"""              <button
                key={segment.index}
                className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-[12px] ${selectedSegment?.index === segment.index ? "bg-[#04395e] text-white" : "bg-[#252526] text-[#cfcfcf] hover:bg-[#2a2d2e]"}`}
                onClick={() => props.onSelectSegment(segment.index)}
              >
                <input type="checkbox" checked={props.checkedSegmentIndexes.includes(segment.index)} onChange={() => props.onToggleCheckedSegment(segment.index)} onClick={(e) => e.stopPropagation()} className="h-3.5 w-3.5 rounded border-[#3c3c3c] bg-[#252526] text-[#0e639c] shrink-0" />
                <span className="min-w-0 flex-1 truncate">{segment.title}</span>
                <span className="shrink-0 text-[#8f8f8f]">{formatDuration(segment.duration_seconds)}</span>
              </button>""")

# Update Inspector Props
content = content.replace(
"""  selectedSegmentIndex: number | null;
  onSelectSegment: (index: number | null) => void;
  onSelectJob: (jobId: number) => void;""",
"""  selectedSegmentIndex: number | null;
  checkedSegmentIndexes: number[];
  onToggleCheckedSegment: (index: number) => void;
  onSelectSegment: (index: number | null) => void;
  onSelectJob: (jobId: number) => void;""")

# Pass Checked segments to TikTok Metadata panel
content = content.replace(
"""          <TikTokMetadataPanel
            job={props.job}
            generating={props.generatingTikTokMetadata}
            publishing={props.publishingTikTok}
            onGenerate={() => props.onGenerateTikTokMetadata(props.job!)}
            onPublish={(profileId, caption) => props.onPublishTikTok(props.job!, profileId, caption)}
          />""",
"""          <TikTokMetadataPanel
            job={props.job}
            checkedSegmentIndexes={props.checkedSegmentIndexes}
            generating={props.generatingTikTokMetadata}
            publishing={props.publishingTikTok}
            onGenerate={() => props.onGenerateTikTokMetadata(props.job!)}
            onPublish={(profileIds, caption, segmentIndexes) => props.onPublishTikTok(props.job!, profileIds, caption, segmentIndexes)}
          />""")

with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("Updated VideoLocalizationWorkspace.tsx")
