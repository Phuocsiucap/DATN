import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/commons/lib/utils'

type SheetContextValue = {
  open: boolean
  onOpenChange: (open: boolean) => void
  titleId: string
  descriptionId: string
}

const SheetContext = React.createContext<SheetContextValue | null>(null)

function useSheet() {
  const context = React.useContext(SheetContext)
  if (!context) {
    throw new Error('Sheet components must be used within Sheet')
  }
  return context
}

function Sheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) {
  const titleId = React.useId()
  const descriptionId = React.useId()

  React.useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }

    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onOpenChange, open])

  return (
    <SheetContext.Provider value={{ open, onOpenChange, titleId, descriptionId }}>
      {children}
    </SheetContext.Provider>
  )
}

function SheetTrigger({
  asChild,
  children,
}: {
  asChild?: boolean
  children: React.ReactElement<{ onClick?: React.MouseEventHandler }>
}) {
  const { onOpenChange } = useSheet()

  if (asChild) {
    return React.cloneElement(children, {
      onClick: (event: React.MouseEvent) => {
        children.props.onClick?.(event)
        onOpenChange(true)
      },
    })
  }

  return <button onClick={() => onOpenChange(true)}>{children}</button>
}

function SheetContent({
  side = 'right',
  className,
  children,
}: {
  side?: 'left' | 'right'
  className?: string
  children: React.ReactNode
}) {
  const { open, onOpenChange, titleId, descriptionId } = useSheet()

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100]">
      <button
        aria-label="Close sheet overlay"
        className="absolute inset-0 bg-black/35"
        onClick={() => onOpenChange(false)}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Chi tiết"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={cn(
          'absolute top-0 h-full w-full max-w-[680px] overflow-hidden border-[var(--outline-variant)] bg-white text-sm shadow-xl',
          side === 'left' ? 'left-0 border-r' : 'right-0 border-l',
          className,
        )}
      >
        <button
          aria-label="Close"
          className="absolute right-3 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--outline-variant)] bg-white text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-low)]"
          onClick={() => onOpenChange(false)}
        >
          <X size={16} />
        </button>
        {children}
      </aside>
    </div>
  )
}

function SheetHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <header className={cn('border-b border-[var(--outline-variant)] bg-[var(--surface-container-low)] px-5 py-4 pr-14', className)}>{children}</header>
}

function SheetTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  const { titleId } = useSheet()
  return <h2 id={titleId} className={cn('text-xl font-extrabold leading-7 text-[var(--on-surface)]', className)}>{children}</h2>
}

function SheetDescription({ className, children }: { className?: string; children: React.ReactNode }) {
  const { descriptionId } = useSheet()
  return <p id={descriptionId} className={cn('mt-1 text-sm text-[var(--on-surface-variant)]', className)}>{children}</p>
}

function SheetBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto p-5', className)}>{children}</div>
}

function SheetFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return <footer className={cn('flex flex-wrap items-center justify-end gap-2 border-t border-[var(--outline-variant)] bg-[var(--surface-container-low)] px-5 py-4', className)}>{children}</footer>
}

export { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger }
