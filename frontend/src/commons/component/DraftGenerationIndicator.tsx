import GenerationIndicator, { type GenerationIndicatorProps } from './GenerationIndicator'
import IndicatorPencil from './IndicatorPencil'
import './DraftGenerationIndicator.css'

export default function DraftGenerationIndicator({ className = '', ...props }: GenerationIndicatorProps) {
  return (
    <GenerationIndicator {...props} activity="draft" label="Đang tạo draft" queuedLabel="Đang chờ tạo draft" className={`draft-generation-indicator ${className}`}>
      <svg className="generation-indicator__drawing" viewBox="0 -12 240 124" fill="none" aria-hidden="true" focusable="false">
        <ellipse cx="120" cy="101" rx="48" ry="4" fill="#ede3fc" />
        <path d="M84 11H139L157 29V91A6 6 0 0 1 151 97H84A6 6 0 0 1 78 91V17A6 6 0 0 1 84 11Z" fill="white" stroke="#e9dffc" strokeWidth="2" />
        <path d="M139 12V23A6 6 0 0 0 145 29H156" fill="#f3edff" stroke="#e9dffc" strokeWidth="2" />
        <path d="M90 40H140M90 57H140M90 74H124" stroke="#ede3fc" strokeWidth="3" strokeLinecap="round" />
        <g stroke="var(--indicator-accent)" strokeWidth="3" strokeLinecap="round">
          <path className="draft-generation-indicator__line draft-generation-indicator__line--first" d="M90 40H140" pathLength="100" />
          <path className="draft-generation-indicator__line draft-generation-indicator__line--second" d="M90 57H140" pathLength="100" />
          <path className="draft-generation-indicator__line draft-generation-indicator__line--third" d="M90 74H124" pathLength="100" />
        </g>
        <circle cx="55" cy="70" r="3" fill="#ddd6fe" />
        <path d="M180 50V58M176 54H184" stroke="#c4b5fd" strokeWidth="2" strokeLinecap="round" />
        <g className="draft-generation-indicator__pen"><IndicatorPencil /></g>
      </svg>
    </GenerationIndicator>
  )
}
