import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis } from './pagination'

export function ListPagination({ page, totalPages, loading = false, onPageChange }: {
  page: number
  totalPages: number
  loading?: boolean
  onPageChange: (page: number) => void
}) {
  const total = Math.max(1, totalPages)
  const current = Math.min(Math.max(1, page), total)
  const pages = Array.from(new Set([1, current - 1, current, current + 1, total]))
    .filter(value => value >= 1 && value <= total).sort((a, b) => a - b)
  const linkProps = (target: number, disabled = false) => ({
    href: '#',
    'aria-disabled': disabled || loading,
    tabIndex: disabled || loading ? -1 : undefined,
    className: disabled || loading ? 'pointer-events-none opacity-40' : '',
    onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault()
      if (!disabled && !loading && target !== current) onPageChange(target)
    },
  })
  return (
    <Pagination className="mx-0 w-auto" aria-busy={loading}>
      <PaginationContent>
        <PaginationItem><PaginationPrevious {...linkProps(current - 1, current <= 1)} /></PaginationItem>
        {pages.map((value, index) => (
          <PaginationItem key={value} className="flex items-center gap-1">
            {index > 0 && value - pages[index - 1] > 1 && <PaginationEllipsis />}
            <PaginationLink {...linkProps(value)} isActive={value === current} aria-label={`Trang ${value}`}>{value}</PaginationLink>
          </PaginationItem>
        ))}
        <PaginationItem><PaginationNext {...linkProps(current + 1, current >= total)} /></PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}
