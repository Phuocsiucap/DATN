import GenerationIndicator, { type GenerationIndicatorProps } from './GenerationIndicator'
import './VoiceGenerationIndicator.css'

export default function VoiceGenerationIndicator({ className = '', ...props }: GenerationIndicatorProps) {
  return (
    <GenerationIndicator {...props} activity="voice" label="Đang tạo voice" queuedLabel="Đang chờ tạo voice" className={`voice-generation-indicator ${className}`}>
      <svg className="generation-indicator__drawing" viewBox="0 -12 240 124" fill="none" aria-hidden="true" focusable="false">
        <ellipse cx="120" cy="101" rx="48" ry="4" fill="#d7edf9" />
        <circle className="voice-generation-indicator__halo" cx="120" cy="55" r="40" stroke="#7dd3fc" strokeWidth="2" opacity=".35" />
        <circle cx="120" cy="55" r="35" fill="white" />
        <g className="voice-generation-indicator__bars" fill="var(--indicator-accent)">
          <rect x="51" y="42" width="4" height="26" rx="2" />
          <rect x="61" y="32" width="4" height="46" rx="2" />
          <rect x="71" y="38" width="4" height="34" rx="2" />
          <rect x="165" y="38" width="4" height="34" rx="2" />
          <rect x="175" y="32" width="4" height="46" rx="2" />
          <rect x="185" y="42" width="4" height="26" rx="2" />
        </g>
        <g stroke="var(--indicator-accent)" strokeWidth="3" strokeLinecap="round">
          <rect x="110" y="24" width="20" height="40" rx="10" fill="#e0f2fe" />
          <path d="M101 52V56A19 19 0 0 0 139 56V52M120 75V87M110 87H130" />
          <path d="M117 35H123M117 43H123M117 51H123" stroke="var(--indicator-soft)" strokeWidth="2" />
        </g>
      </svg>
    </GenerationIndicator>
  )
}
