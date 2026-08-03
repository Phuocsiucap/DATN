import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/commons/lib/utils'

type SheetContextValue = {
  open: boolean
  onOpenChange: (open: boolean) => void
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
  React.useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onOpenChange, open])

  return (
    <SheetContext.Provider value={{ open, onOpenChange }}>
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
  const { open, onOpenChange } = useSheet()

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100]">
      <button
        aria-label="Close sheet overlay"
        className="absolute inset-0 bg-black/35"
        onClick={() => onOpenChange(false)}
      />
      <div
        className={cn(
          'absolute top-0 h-full w-full max-w-[760px] overflow-hidden border-[#d9e0ea] bg-white shadow-2xl',
          side === 'left' ? 'left-0 border-r' : 'right-0 border-l',
          className,
        )}
      >
        <button
          aria-label="Close"
          className="absolute right-4 top-4 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#d9e0ea] bg-white text-[#64748b] hover:bg-[#f8fafc]"
          onClick={() => onOpenChange(false)}
        >
          <X size={16} />
        </button>
        {children}
      </div>
    </div>
  )
}

export { Sheet, SheetContent, SheetTrigger }
