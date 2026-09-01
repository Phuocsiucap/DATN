import type { ReactNode } from 'react'
import './GenerationIndicator.css'

export type GenerationIndicatorProps = {
  progress?: number | null
  queued?: boolean
  className?: string
}

type Props = GenerationIndicatorProps & {
  activity: 'draft' | 'voice' | 'rendering'
  label: string
  queuedLabel: string
  children: ReactNode
}

/** The illustration loops independently; progress always comes from the job. */
export default function GenerationIndicator({
  progress,
  queued = false,
  className = '',
  activity,
  label,
  queuedLabel,
  children,
}: Props) {
  const percent = typeof progress === 'number' && Number.isFinite(progress)
    ? Math.round(Math.min(100, Math.max(0, progress)))
    : undefined
  const statusLabel = queued ? queuedLabel : label

  return (
    <div className={`generation-indicator generation-indicator--${activity} ${className}`} data-state={queued ? 'queued' : activity}>
      {children}
      <span className="generation-indicator__label">{statusLabel}</span>
      <div className="generation-indicator__progress">
        <div
          className="generation-indicator__track"
          role="progressbar"
          aria-label={statusLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          {percent !== undefined && <div className="generation-indicator__fill" style={{ width: `${percent}%` }} />}
        </div>
        <span className="generation-indicator__percent">{percent === undefined ? 'Đang xử lý' : `${percent}%`}</span>
      </div>
    </div>
  )
}
