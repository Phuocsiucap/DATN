import { useState, type ReactNode } from 'react'
import { ListPagination } from './list-pagination'

/** Client pagination for complete, already loaded lists. Server-paged lists keep their API controls. */
export function PaginatedList<T>({ items, children, loading = false, resetKey = '', pageSize = 20 }: {
  items: T[]
  children: (visibleItems: T[]) => ReactNode
  loading?: boolean
  resetKey?: string
  pageSize?: number
}) {
  const [selection, setSelection] = useState({ key: resetKey, page: 1 })
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const page = selection.key === resetKey ? Math.min(selection.page, totalPages) : 1
  const start = (page - 1) * pageSize
  return (
    <div className="app-list-panel">
      <div className="app-list-scroll">
        {children(items.slice(start, start + pageSize))}
      </div>
      <div className="app-list-footer">
        <span className="text-xs font-medium text-slate-600" aria-live="polite">
          {items.length ? `${start + 1}–${Math.min(start + pageSize, items.length)}` : '0'} / {items.length}
        </span>
        <ListPagination page={page} totalPages={totalPages} loading={loading} onPageChange={(nextPage) => setSelection({ key: resetKey, page: nextPage })} />
      </div>
    </div>
  )
}
