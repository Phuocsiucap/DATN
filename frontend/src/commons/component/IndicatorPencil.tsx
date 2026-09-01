/** The pencil tip is at (0, 0), so each drawing can move it along its own path. */
export default function IndicatorPencil() {
  return (
    <g transform="rotate(34)">
      <path d="M-5-13L0 0L5-13Z" fill="#f4cc96" />
      <path d="M-1.8-4.7L0 0L1.8-4.7Z" fill="#312e81" />
      <path d="M-5-39H5V-13H-5Z" fill="var(--indicator-accent)" />
      <path d="M-5-39H-1.5V-13H-5Z" fill="var(--indicator-soft)" />
      <path d="M-5-42A5 5 0 0 1 5-42V-39H-5Z" fill="#f9a8d4" />
      <path d="M-5-39H5" stroke="#e0e7ff" strokeWidth="3" />
    </g>
  )
}
