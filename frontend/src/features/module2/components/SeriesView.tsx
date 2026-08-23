import React from 'react'
import { Plus, RefreshCcw, Edit, Trash2, Clock3, Layers, Sparkles } from 'lucide-react'
import type { ContentSeries, StoryScene, ContentPlan } from '../../../commons/apis/planning'
import { PlanActionMenu } from './PlanActionMenu'

const tone: Record<string, string> = {
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  COMPLETED: 'border-blue-200 bg-blue-50 text-blue-700',
  ARCHIVED: 'border-slate-200 bg-slate-100 text-slate-600',
  RUNNING: 'border-sky-200 bg-sky-50 text-sky-700',
  SUCCESS: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  FAILED: 'border-red-200 bg-red-50 text-red-700',
}

function shortId(id: string) {
  return id ? `${id.slice(0, 8)}...` : '-'
}

function Badge({ value }: { value: string }) {
  return (
    <span className={`inline-flex w-fit items-center rounded-full border px-2 py-1 text-[11px] font-semibold ${tone[value] || 'border-slate-200 bg-slate-50 text-slate-700'}`}>
      {value}
    </span>
  )
}

function Empty({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className={`flex items-center justify-center gap-2 text-sm text-[#94a3b8] ${compact ? 'py-4' : 'py-12'}`}>
      <Clock3 size={16} /> {label}
    </div>
  )
}

function Panel({
  title,
  subtitle,
  headerAction,
  children,
}: {
  title: string
  subtitle: string
  headerAction?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#d9e0ea] bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <h3 className="text-base font-bold text-[#0f172a]">{title}</h3>
          <p className="mt-1 text-xs text-[#64748b]">{subtitle}</p>
        </div>
        {headerAction}
      </div>
      {children}
    </div>
  )
}

function TableHeader({ columns }: { columns: string[] }) {
  return (
    <div
      className="grid gap-3 rounded-t-lg bg-[#fbfcfd] px-4 py-3 text-[11px] font-semibold text-[#64748b] border-t border-b border-[#eef2f7]"
      style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
    >
      {columns.map((column) => (
        <div key={column}>{column}</div>
      ))}
    </div>
  )
}

interface SeriesViewProps {
  series: ContentSeries[]
  selectedSeries: ContentSeries | null
  plans: ContentPlan[]
  parts: StoryScene[]
  onSelect: (series: ContentSeries) => void
  onRegenerate: (series: ContentSeries) => void
  onCreateSeries: () => void
  onEditSeries: (series: ContentSeries) => void
  onDeleteSeries: (seriesId: string) => void
  onOpenReassignModal: (plan: ContentPlan) => void
  onRegeneratePlan: (plan: ContentPlan) => void
}

export function SeriesView({
  series,
  selectedSeries,
  plans,
  parts,
  onSelect,
  onRegenerate,
  onCreateSeries,
  onEditSeries,
  onDeleteSeries,
  onOpenReassignModal,
  onRegeneratePlan,
}: SeriesViewProps) {
  const detailsPanelRef = React.useRef<HTMLDivElement>(null)

  const seriesPlans = selectedSeries
    ? plans.filter((p) => p.series_id === selectedSeries.id)
    : []

  React.useEffect(() => {
    if (selectedSeries && detailsPanelRef.current) {
      detailsPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [selectedSeries])

  return (
    <div className="space-y-6">
      {/* Panel 1: Danh sách Series */}
      <Panel
        title="Danh Sách Series & Chuỗi Nội Dung"
        subtitle="Quản lý và chọn một series để xem kịch bản chi tiết từng tập"
        headerAction={
          <button
            onClick={onCreateSeries}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#2563eb] px-4 text-xs font-bold text-white shadow-sm hover:bg-[#1d4ed8]"
          >
            <Plus size={14} /> Thêm Series Mới
          </button>
        }
      >
        <TableHeader columns={['Series Title', 'Type', 'Tập', 'Current', 'Version', 'Status', 'Thao Tác']} />
        {series.length === 0 ? (
          <Empty label="Chưa có series nào được tạo" />
        ) : (
          series.map((item) => (
            <div
              key={item.id}
              onClick={() => onSelect(item)}
              className={`grid cursor-pointer grid-cols-[2.2fr_0.7fr_0.5fr_0.5fr_0.7fr_0.7fr_0.9fr] gap-3 border-t border-[#eef2f7] px-4 py-4 text-xs transition-colors hover:bg-slate-50 ${
                selectedSeries?.id === item.id ? 'bg-blue-50/70 border-l-2 border-l-[#2563eb]' : 'border-l-2 border-l-transparent'
              }`}
            >
              <div className="font-bold text-[#0f172a]">
                {item.title}
                <div className="mt-1 truncate text-[11px] font-normal text-[#64748b]">
                  {item.description || shortId(item.id)}
                </div>
              </div>
              <div className="text-[#64748b] font-medium">{item.series_type}</div>
              <div className="text-[#64748b] font-bold">{item.total_parts}</div>
              <div className="text-[#64748b]">{item.current_part}</div>
              <div className="text-[#2563eb] font-semibold">v{item.context_version}</div>
              <Badge value={item.status} />
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => onEditSeries(item)}
                  className="inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                  title="Chỉnh sửa series"
                >
                  <Edit size={12} /> Sửa
                </button>
                <button
                  onClick={() => onDeleteSeries(item.id)}
                  className="inline-flex h-7 items-center gap-1 rounded border border-red-200 bg-white px-2 text-[11px] font-medium text-red-600 hover:bg-red-50"
                  title="Xóa series"
                >
                  <Trash2 size={12} /> Xóa
                </button>
              </div>
            </div>
          ))
        )}
      </Panel>

      {/* Panel 2: Danh Sách Bài Kịch Bản (Items) Thuộc Series Được Chọn */}
      <div ref={detailsPanelRef}>
        <Panel
          title={`Các Bài Kịch Bản Thuộc Series: ${selectedSeries ? selectedSeries.title : 'Chưa chọn'}`}
          subtitle="Danh sách các bài kịch bản / tập nội dung đã được gán vào Series này. Nhấn nút (...) để đổi Series hoặc xem bài gốc."
        >
        {!selectedSeries ? (
          <Empty label="Hãy chọn một Series ở bảng trên để xem danh sách các bài kịch bản" compact />
        ) : seriesPlans.length === 0 ? (
          <Empty label="Series này chưa có bài kịch bản nào được gán" compact />
        ) : (
          <div className="divide-y divide-slate-100">
            <div className="grid grid-cols-[0.8fr_2.5fr_1fr_1fr_0.5fr] gap-3 bg-[#fbfcfd] px-4 py-3 text-[11px] font-semibold text-[#64748b] border-t border-b border-[#eef2f7]">
              <div>Tập / Bài</div>
              <div>Tên Kịch Bản</div>
              <div>Chế Độ</div>
              <div>Trạng Thái</div>
              <div className="text-right">Tùy Chọn</div>
            </div>
            {seriesPlans.map((plan, idx) => (
              <div
                key={plan.id}
                className="grid grid-cols-[0.8fr_2.5fr_1fr_1fr_0.5fr] items-center gap-3 px-4 py-3.5 text-xs transition-colors hover:bg-slate-50"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700 font-bold text-xs">
                    #{idx + 1}
                  </span>
                  <span className="text-slate-500 font-medium">Tập {idx + 1}</span>
                </div>
                <div>
                  <div className="font-bold text-slate-900 text-sm">{plan.title}</div>
                  <div className="text-[11px] text-slate-500 italic mt-0.5">{plan.content_angle || 'Không có góc khai thác'}</div>
                </div>
                <div className="text-slate-600 font-medium">{plan.planning_mode}</div>
                <div>
                  <Badge value={plan.status} />
                </div>
                <div className="flex justify-end">
                  <PlanActionMenu
                    plan={{
                      ...plan,
                      series_id: plan.series_id || selectedSeries?.id || null,
                    }}
                    onOpenReassignModal={onOpenReassignModal}
                    onRegenerate={onRegeneratePlan}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>

      {/* Panel 3: Story Data Timeline (Scenes) */}
      <Panel title="Story Data Timeline" subtitle="Chi tiết từng scene đã được AI sinh để đưa vào xưởng video">
        {selectedSeries && (
          <div className="flex flex-wrap justify-end gap-3 px-6 pb-4 border-b border-[#eef2f7]">
            <button
              onClick={() => onRegenerate(selectedSeries)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#cbd5e1] bg-white px-4 text-xs font-bold text-[#475569] hover:bg-slate-50 transition-colors"
            >
              <RefreshCcw size={14} /> Làm lại Series
            </button>
          </div>
        )}

        <div className="p-6">
          {parts.length === 0 ? (
            <Empty label="Series hiện chưa có scene nào" compact />
          ) : (
            <div className="flex flex-col gap-6 relative">
              <div className="absolute left-8 top-4 bottom-4 w-0.5 bg-[#e2e8f0] z-0"></div>

              {parts.map((scene, index) => (
                <div key={`${scene.image || 'scene'}-${index}`} className="relative z-10 flex gap-5">
                  <div className="flex flex-col items-center shrink-0 w-16">
                    <div className="h-10 w-10 flex items-center justify-center rounded-full bg-[#eff6ff] border-2 border-[#2563eb] shadow-sm font-black text-[#1e40af] text-sm">
                      S{index + 1}
                    </div>
                  </div>

                  <div className="flex-1 rounded-xl border border-[#cbd5e1] bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-[#f8fafc] px-5 py-3 border-b border-[#cbd5e1] flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-[#0f172a]">Scene {index + 1}</span>
                        <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                          {scene.duration}s
                        </span>
                      </div>
                      <span className="rounded bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600">
                        {scene.effect || 'slow-zoom'}
                      </span>
                    </div>

                    <div className="p-5 space-y-4">
                      <div className="grid md:grid-cols-2 gap-4">
                        {scene.subtitle && (
                          <div className="border-l-4 border-blue-500 bg-blue-50/70 p-3 rounded-r-lg">
                            <span className="font-bold text-blue-900 text-[11px] uppercase tracking-wider block mb-1">
                              Subtitle
                            </span>
                            <span className="text-xs text-blue-800 leading-relaxed">{scene.subtitle}</span>
                          </div>
                        )}
                        {scene.voice_text && (
                          <div className="border-l-4 border-red-500 bg-red-50/70 p-3 rounded-r-lg">
                            <span className="font-bold text-red-900 text-[11px] uppercase tracking-wider block mb-1">
                              Voice text
                            </span>
                            <span className="text-xs text-red-800 leading-relaxed">{scene.voice_text}</span>
                          </div>
                        )}
                      </div>

                      {scene.image && (
                        <div className="pt-2 border-t border-slate-100">
                          <span className="font-bold text-slate-700 text-[11px] uppercase tracking-wider block mb-2">
                            Image
                          </span>
                          <div className="text-xs leading-relaxed text-slate-700">{scene.image}</div>
                        </div>
                      )}
                    </div>

                    <div className="bg-slate-50 px-5 py-2.5 border-t border-slate-200 text-right">
                      <span className="text-[11px] font-bold text-slate-500">
                        Thời lượng scene: {scene.duration || 4}s
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>
    </div>
  )
}
