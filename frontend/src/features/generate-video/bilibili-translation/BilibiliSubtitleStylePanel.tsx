import type { SubtitleStyle } from './types'

type Props = {
  value: SubtitleStyle
  onChange: (next: SubtitleStyle) => void
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export default function BilibiliSubtitleStylePanel({ value, onChange }: Props) {
  const update = (patch: Partial<SubtitleStyle>) => onChange({ ...value, ...patch })

  return (
    <aside className="flex h-full min-h-0 w-[280px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--on-surface)]">Subtitle</h2>
        <p className="mt-1 text-xs text-[var(--on-surface-variant)]">Vị trí, cỡ chữ và tốc độ preview.</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 text-xs text-[var(--on-surface)]">
        <label className="grid gap-2">
          <span className="font-medium">Cỡ chữ: {value.fontSize}px</span>
          <input type="range" min={18} max={72} value={value.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} />
        </label>
        <label className="grid gap-2">
          <span className="font-medium">Vị trí ngang: {value.positionX}%</span>
          <input type="range" min={5} max={95} value={value.positionX} onChange={(event) => update({ positionX: Number(event.target.value) })} />
        </label>
        <label className="grid gap-2">
          <span className="font-medium">Vị trí dọc: {value.positionY}%</span>
          <input type="range" min={45} max={95} value={value.positionY} onChange={(event) => update({ positionY: Number(event.target.value) })} />
        </label>
        <label className="grid gap-2">
          <span className="font-medium">Độ rộng: {value.maxWidth}%</span>
          <input type="range" min={35} max={96} value={value.maxWidth} onChange={(event) => update({ maxWidth: Number(event.target.value) })} />
        </label>
        <label className="grid gap-2">
          <span className="font-medium">Tốc độ video: {value.playbackRate.toFixed(2)}x</span>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={value.playbackRate}
            onChange={(event) => update({ playbackRate: clamp(Number(event.target.value), 0.5, 2) })}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-2">
            <span className="font-medium">Màu chữ</span>
            <input className="h-9 w-full" type="color" value={value.color} onChange={(event) => update({ color: event.target.value })} />
          </label>
          <label className="grid gap-2">
            <span className="font-medium">Màu viền</span>
            <input className="h-9 w-full" type="color" value={value.outlineColor} onChange={(event) => update({ outlineColor: event.target.value })} />
          </label>
        </div>
        <label className="grid gap-2">
          <span className="font-medium">Độ dày viền: {value.outlineWidth}px</span>
          <input type="range" min={0} max={10} value={value.outlineWidth} onChange={(event) => update({ outlineWidth: Number(event.target.value) })} />
        </label>
      </div>
    </aside>
  )
}
