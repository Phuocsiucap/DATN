import { Loader2, AlertTriangle, Settings2, FileText } from 'lucide-react'
import type { PlanningAiDecision, PlanningRun, PlanningRunDetail } from '@/commons/apis/planning'
import { Sheet, SheetContent } from '@/commons/component/ui/sheet'

const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleString('vi-VN') : '-')
const shortId = (value: string) => value.slice(0, 8)
const asNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const asStringArray = (value: unknown) => Array.isArray(value) ? value.map(String).filter(Boolean) : []
const asRecord = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const asAiDecision = (value: unknown) => asRecord(value) as PlanningAiDecision | null
const asTopicScores = (value: unknown) => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const topic = String(record.topic || '').trim()
      const similarity = asNumber(record.similarity, NaN)
      if (!topic || !Number.isFinite(similarity)) return null
      return {
        topic,
        topicKey: String(record.topic_key || ''),
        description: String(record.description || ''),
        similarity,
        threshold: Number.isFinite(asNumber(record.threshold, NaN)) ? asNumber(record.threshold) : undefined,
        matched: Boolean(record.matched),
        matchSource: String(record.match_source || ''),
      }
    })
    .filter(Boolean) as Array<{ topic: string; topicKey?: string; description?: string; similarity: number; threshold?: number; matched: boolean; matchSource?: string }>
}

const asTopicScore = (value: unknown) => asTopicScores(value ? [value] : [])[0]

const isTopicConfigError = (job: PlanningRun) =>
  job.status === 'FAILED' &&
  !!job.error_message &&
  (job.error_message.includes('Content Topics') ||
    job.error_message.includes('content_topics') ||
    job.error_message.includes('chu de') ||
    job.error_message.includes('Chua cau hinh'))

function Badge({ value }: { value: string }) {
  let color = 'bg-slate-100 text-slate-700'
  if (['SUCCEEDED', 'COMPLETED', 'READY', 'APPROVED'].includes(value)) color = 'bg-emerald-100 text-emerald-800'
  if (['FAILED', 'REJECTED'].includes(value)) color = 'bg-red-100 text-red-800'
  if (['RUNNING', 'PENDING', 'PROCESSING', 'GENERATED'].includes(value)) color = 'bg-blue-100 text-blue-800'
  if (['NEEDS_REVIEW'].includes(value)) color = 'bg-amber-100 text-amber-800'
  return (
    <span className={`px-2 py-1 inline-flex items-center justify-center rounded-md text-[10px] font-bold uppercase tracking-wider ${color}`}>
      {value}
    </span>
  )
}

function RunMetric({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${accent ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-slate-50'}`}>
      <div className="text-[10px] font-black uppercase text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-black tabular-nums ${accent ? 'text-blue-700' : 'text-slate-800'}`}>{value}</div>
    </div>
  )
}

export function PlanningRunDetailSheet({
  run,
  detail,
  loading,
  onClose,
  onOpenProfileSettings,
}: {
  run: PlanningRun | null
  detail: PlanningRunDetail | null
  loading: boolean
  onClose: () => void
  onOpenProfileSettings?: (profileId: string) => void
}) {
  if (!run) return null

  const candidates = detail?.candidates || []
  const detailReasons = asStringArray(detail?.reason?.selection_reasons)
  const selectionReasons = detailReasons.length > 0 ? detailReasons : (detail?.selection_reasons || run.selection_reasons || [])
  const outputAiDecisions = Array.isArray(detail?.output?.ai_decisions) ? detail.output.ai_decisions : []
  const aiDecision = asAiDecision(detail?.output?.ai_decision) || asAiDecision(outputAiDecisions[0])
  const aiReasoning = asStringArray(aiDecision?.reasoning)
  const aiDecisionTone = aiDecision?.should_create_workflow === false
    ? {
        panel: 'border-red-200 bg-red-50/70',
        title: 'text-red-900',
        icon: 'text-red-700',
        label: 'text-red-700',
        body: 'text-red-950',
      }
    : {
        panel: 'border-emerald-200 bg-emerald-50/70',
        title: 'text-emerald-900',
        icon: 'text-emerald-700',
        label: 'text-emerald-700',
        body: 'text-emerald-950',
      }

  return (
    <Sheet open={!!run} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent side="right" className="w-[calc(100vw-1rem)] max-w-[760px] overflow-y-auto bg-slate-50 p-6">
        <div className="space-y-6">
          {/* Header */}
          <div className="border-b border-slate-200 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs font-bold text-slate-500">#{shortId(run.id)}</span>
              <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase">{run.planning_mode}</span>
              <Badge value={run.status} />
            </div>
            <h2 className="text-xl font-black text-slate-900 leading-snug">{run.workflow_title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span>Kênh social: <strong className="text-slate-800">{run.profile_name}</strong></span>
              {(run.crawl_job_name || run.crawl_job_id) && (
                <span>
                  Crawl Job:{' '}
                  <strong className="text-slate-800">
                    {run.crawl_job_name || 'Crawl job'}
                    {run.crawl_job_id ? <span className="font-mono"> #{shortId(run.crawl_job_id)}</span> : null}
                  </strong>
                </span>
              )}
            </div>
          </div>

          {/* Error Callout */}
          {isTopicConfigError(run) && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
              <div className="flex-1">
                <p className="font-bold text-amber-900">Chưa cấu hình chủ đề nội dung (Content Topics)</p>
                <p className="mt-1 text-xs leading-5 text-amber-800">
                  Profile này chưa được thiết lập Content Topics. Auto Planning cần ít nhất 1 từ khóa chủ đề để thực hiện chọn bài phù hợp.
                </p>
              </div>
              <button
                onClick={() => {
                  onClose()
                  onOpenProfileSettings?.(run.profile_id)
                }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 transition-colors"
              >
                <Settings2 size={13} /> Cấu hình
              </button>
            </div>
          )}

          {/* Metrics */}
          <div className="grid grid-cols-3 gap-3">
            <RunMetric label="Content đầu vào" value={run.candidate_count} />
            <RunMetric label="Đủ điều kiện" value={run.eligible_count} />
            <RunMetric label="Được chọn" value={run.selected_count} accent />
          </div>

          {/* Timing details */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs space-y-2.5">
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500 font-medium">Trigger thực thi:</span>
              <span className="font-bold text-slate-800 uppercase">{run.trigger || 'CRAWL_JOB_COMPLETED'}</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500 font-medium">Tiến độ & Giai đoạn:</span>
              <span className="font-bold text-slate-800">{run.current_stage} ({Number(run.progress_percent).toFixed(0)}%)</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-500 font-medium">Thời gian bắt đầu:</span>
              <span className="font-bold text-slate-800">{formatDate(run.started_at || run.created_at)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 font-medium">Thời gian hoàn tất:</span>
              <span className="font-bold text-slate-800">{formatDate(run.completed_at)}</span>
            </div>
          </div>

          {/* Selection Reasons */}
          {selectionReasons.length > 0 && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
              <div className="text-xs font-black uppercase text-blue-900 mb-2 flex items-center gap-1.5">
                <FileText size={14} className="text-blue-700" /> Lý do đánh giá & Chọn lọc
              </div>
              <ul className="space-y-1.5 text-xs text-blue-950">
                {selectionReasons.map((reason, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-600 mt-1.5 shrink-0" />
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {aiDecision && Object.keys(aiDecision).length > 0 && (
            <div className={`rounded-xl border p-4 ${aiDecisionTone.panel}`}>
              <div className={`mb-2 flex items-center gap-1.5 text-xs font-black uppercase ${aiDecisionTone.title}`}>
                <Settings2 size={14} className={aiDecisionTone.icon} /> Quyết định AI cuối
              </div>
              <div className={`grid gap-2 text-xs sm:grid-cols-3 ${aiDecisionTone.body}`}>
                <div>
                  <div className={`text-[10px] font-black uppercase ${aiDecisionTone.label}`}>Trạng thái</div>
                  <div className="mt-0.5 font-bold">
                    {aiDecision.should_create_workflow === false ? 'LLM từ chối' : String(aiDecision.status || 'LLM duyệt')}
                  </div>
                </div>
                <div>
                  <div className={`text-[10px] font-black uppercase ${aiDecisionTone.label}`}>Model</div>
                  <div className="mt-0.5 font-bold">{String(aiDecision.model || aiDecision.provider || '-')}</div>
                </div>
                <div>
                  <div className={`text-[10px] font-black uppercase ${aiDecisionTone.label}`}>Confidence</div>
                  <div className="mt-0.5 font-bold">{asNumber(aiDecision.confidence_score).toFixed(1)}/100</div>
                </div>
              </div>
              {(aiDecision.plan_title || aiDecision.content_angle || aiDecision.workflow_id) && (
                <div className={`mt-3 grid gap-2 text-xs sm:grid-cols-3 ${aiDecisionTone.body}`}>
                  {aiDecision.plan_title && (
                    <div>
                      <div className={`text-[10px] font-black uppercase ${aiDecisionTone.label}`}>Plan</div>
                      <div className="mt-0.5 font-bold">{aiDecision.plan_title}</div>
                    </div>
                  )}
                  {aiDecision.content_angle && (
                    <div>
                      <div className={`text-[10px] font-black uppercase ${aiDecisionTone.label}`}>Góc nội dung</div>
                      <div className="mt-0.5 font-bold">{aiDecision.content_angle}</div>
                    </div>
                  )}
                  {aiDecision.workflow_id && (
                    <div>
                      <div className={`text-[10px] font-black uppercase ${aiDecisionTone.label}`}>Workflow</div>
                      <div className="mt-0.5 font-mono font-bold">#{shortId(aiDecision.workflow_id)}</div>
                    </div>
                  )}
                </div>
              )}
              {Boolean(aiDecision.reason) && (
                <p className={`mt-3 text-xs leading-5 ${aiDecisionTone.body}`}>{String(aiDecision.reason)}</p>
              )}
              {aiReasoning.length > 0 && (
                <div className={`mt-3 space-y-1 text-xs leading-5 ${aiDecisionTone.body}`}>
                  {aiReasoning.slice(0, 3).map((reason, idx) => (
                    <div key={idx}>{reason}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Evaluated Candidates */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-700">
                Danh sách bài viết ứng viên ({loading ? '...' : candidates.length})
              </h3>
            </div>

            {loading ? (
              <div className="flex items-center justify-center p-8 text-xs text-slate-500 bg-white rounded-xl border border-slate-200">
                <Loader2 className="animate-spin mr-2" size={16} /> Đang tải bài viết ứng viên...
              </div>
            ) : candidates.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
                Lần chạy này không lưu danh sách bài viết ứng viên chi tiết.
              </div>
            ) : (
              <div className="space-y-3">
                {candidates.map((cand, idx) => {
                  const isSelected = cand.selected
                  const isEligible = cand.eligible
                  const metadata = cand.metadata || {}
                  const breakdown = (metadata.score_breakdown || {}) as Record<string, unknown>
                  const strategyScore = asNumber(metadata.strategy_score ?? breakdown.strategy_score ?? cand.score)
                  const qualityScore = asNumber(metadata.quality_score ?? breakdown.quality_score)
                  const cosine = asNumber(metadata.embedding_similarity ?? metadata.cosine_similarity ?? breakdown.embedding_similarity ?? breakdown.cosine_similarity)
                  const similarityThreshold = asNumber(metadata.similarity_threshold ?? breakdown.similarity_threshold, NaN)
                  const rawPassedSimilarityGate = metadata.passed_similarity_gate ?? breakdown.passed_similarity_gate
                  const passedSimilarityGate = typeof rawPassedSimilarityGate === 'boolean' ? rawPassedSimilarityGate : cand.eligible
                  const similaritySource = String(metadata.similarity_source ?? breakdown.similarity_source ?? '')
                  const topTopicMatch = asTopicScore(metadata.top_topic_match ?? breakdown.top_topic_match)
                  const matchedTopics = asStringArray(metadata.matched_topics ?? breakdown.matched_topics)
                  const avoidedTopics = asStringArray(metadata.avoided_topics ?? breakdown.avoided_topics)
                  const topicScores = asTopicScores(metadata.topic_scores ?? metadata.topic_matches ?? breakdown.topic_scores ?? breakdown.topic_matches)
                  const selectionNotes = asStringArray(cand.reason?.selection_reasons)
                  const rejectionNotes = asStringArray(cand.reason?.rejection_reasons)
                  const candidateAiDecision = asAiDecision(cand.ai_decision) || asAiDecision(cand.reason?.ai_decision) || asAiDecision(metadata.ai_decision)
                  const candidateAiReasoning = asStringArray(candidateAiDecision?.reasoning)
                  const candidateWorkflowId = cand.workflow_id || cand.media_workflow_id || candidateAiDecision?.workflow_id
                  return (
                    <div
                      key={cand.id || idx}
                      className={`rounded-xl border p-4 transition-all bg-white ${
                        isSelected
                          ? 'border-emerald-300 ring-2 ring-emerald-500/20 bg-emerald-50/30'
                          : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">
                            #{cand.rank_order ?? idx + 1}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                              isSelected
                                ? 'bg-emerald-100 text-emerald-800'
                                : isEligible
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {isSelected ? 'ĐÃ CHỌN' : isEligible ? 'ĐỦ ĐIỀU KIỆN' : 'KHÔNG ĐỦ'}
                          </span>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-black text-slate-700">
                            Strategy: <span className="text-blue-700">{strategyScore.toFixed(1)}</span>/100
                          </div>
                          <div className="mt-0.5 text-[11px] font-bold text-slate-500">
                            Quality {qualityScore.toFixed(1)} | Top cosine {cosine.toFixed(4)}
                          </div>
                        </div>
                      </div>

                      <h4 className="text-sm font-bold text-slate-900 leading-snug mb-1">
                        {cand.title || 'Bài viết ứng viên'}
                      </h4>
                      {cand.summary && (
                        <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed mb-2">
                          {cand.summary}
                        </p>
                      )}

                      {candidateAiDecision && (
                        <div
                          className={`mt-2 rounded-md border p-2 text-[11px] leading-5 ${
                            candidateAiDecision.should_create_workflow === false
                              ? 'border-red-100 bg-red-50 text-red-950'
                              : 'border-emerald-100 bg-emerald-50 text-emerald-950'
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-1.5 font-bold">
                            <span
                              className={`rounded-md px-2 py-0.5 text-[10px] uppercase ${
                                candidateAiDecision.should_create_workflow === false
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              {candidateAiDecision.should_create_workflow === false ? 'LLM TỪ CHỐI' : 'LLM DUYỆT'}
                            </span>
                            {candidateAiDecision.model && <span>Model {candidateAiDecision.model}</span>}
                            {Number.isFinite(asNumber(candidateAiDecision.confidence_score, NaN)) && (
                              <span>Confidence {asNumber(candidateAiDecision.confidence_score).toFixed(1)}/100</span>
                            )}
                            {candidateWorkflowId && <span>Workflow #{shortId(candidateWorkflowId)}</span>}
                          </div>
                          {candidateAiDecision.reason && (
                            <div className="mt-1">{candidateAiDecision.reason}</div>
                          )}
                          {(candidateAiDecision.plan_title || candidateAiDecision.content_angle) && (
                            <div className="mt-1 font-medium">
                              {[candidateAiDecision.plan_title, candidateAiDecision.content_angle].filter(Boolean).join(' · ')}
                            </div>
                          )}
                          {candidateAiReasoning.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {candidateAiReasoning.slice(0, 2).map((reason, reasonIndex) => (
                                <div key={reasonIndex}>{reason}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {topicScores.length > 0 && (
                        <div className="mt-2 rounded-md border border-slate-100 bg-slate-50 p-2">
                          <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-slate-500">
                            <span className={passedSimilarityGate ? 'rounded-md bg-emerald-100 px-2 py-0.5 text-emerald-800' : 'rounded-md bg-amber-100 px-2 py-0.5 text-amber-800'}>
                              Gate {passedSimilarityGate ? 'PASSED' : 'FAILED'}
                            </span>
                            {Number.isFinite(similarityThreshold) && <span>Ngưỡng {similarityThreshold.toFixed(4)}</span>}
                            {similaritySource && <span>Nguồn {similaritySource}</span>}
                            {topTopicMatch && <span>Cao nhất {topTopicMatch.topic} {topTopicMatch.similarity.toFixed(4)}</span>}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {topicScores.slice(0, 6).map((item) => (
                              <span
                                key={`topic-score-${item.topic}`}
                                title={item.description || item.topicKey || item.topic}
                                className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                                  item.matched
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                    : 'bg-white text-slate-700 border border-slate-200'
                                }`}
                              >
                                {item.topic} ({item.similarity.toFixed(4)})
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {(matchedTopics.length > 0 || avoidedTopics.length > 0) && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {matchedTopics.map((topic) => (
                            <span key={`match-${topic}`} className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                              Match: {topic}
                            </span>
                          ))}
                          {avoidedTopics.map((topic) => (
                            <span key={`avoid-${topic}`} className="rounded-md bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-800">
                              Avoid: {topic}
                            </span>
                          ))}
                        </div>
                      )}

                      {(selectionNotes.length > 0 || rejectionNotes.length > 0) && (
                        <div className="mt-2 rounded-md border border-slate-100 bg-slate-50 p-2 text-[11px] leading-5 text-slate-600">
                          {[...selectionNotes, ...rejectionNotes].slice(0, 4).map((note, noteIndex) => (
                            <div key={noteIndex}>{note}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
