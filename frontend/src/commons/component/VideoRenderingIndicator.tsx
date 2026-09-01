import GenerationIndicator, { type GenerationIndicatorProps } from './GenerationIndicator'
import IndicatorPencil from './IndicatorPencil'
import './VideoRenderingIndicator.css'

export default function VideoRenderingIndicator({
  className = '',
  ...props
}: GenerationIndicatorProps) {
  return (
    <GenerationIndicator {...props} activity="rendering" label="Đang render video" queuedLabel="Đang chờ render" className={`video-rendering-indicator ${className}`}>
      <svg className="generation-indicator__drawing" viewBox="0 -12 240 124" fill="none" aria-hidden="true" focusable="false">
        <ellipse cx="120" cy="96" rx="52" ry="4" fill="#e0e7ff" opacity=".65" />
        <rect x="64" y="23" width="100" height="70" rx="14" fill="white" />
        <path d="M72 85V31H156V85H72Z M108 46V70L130 58Z" stroke="#dce3f4" strokeWidth="2" strokeLinejoin="round" />
        <path className="video-rendering-indicator__frame" d="M72 85V31H156V85H72Z" pathLength="100" stroke="#6366f1" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path className="video-rendering-indicator__play" d="M108 46V70L130 58Z" pathLength="100" stroke="#6366f1" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="51" cy="51" r="3" fill="#c7d2fe" />
        <path d="M182 69V77M178 73H186" stroke="#a5b4fc" strokeWidth="2" strokeLinecap="round" />

        <g className="video-rendering-indicator__pen">
          <IndicatorPencil />
        </g>
      </svg>
    </GenerationIndicator>
  )
}
