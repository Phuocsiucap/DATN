import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/commons/lib/utils'

type DialogContextValue = {
  open: boolean
  onOpenChange: (open: boolean) => void
  titleId: string
  descriptionId: string
}

const DialogContext = React.createContext<DialogContextValue | null>(null)

function useDialog() {
  const context = React.useContext(DialogContext)
  if (!context) throw new Error('Dialog components must be used within Dialog')
  return context
}

function Dialog({
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
    <DialogContext.Provider value={{ open, onOpenChange, titleId, descriptionId }}>
      {children}
    </DialogContext.Provider>
  )
}

function DialogContent({
  className,
  children,
  showClose = true,
}: {
  className?: string
  children: React.ReactNode
  showClose?: boolean
}) {
  const { open, onOpenChange, titleId, descriptionId } = useDialog()
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        aria-label="Đóng hộp thoại"
        className="absolute inset-0 bg-slate-950/55 backdrop-blur-xs"
        onClick={() => onOpenChange(false)}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={cn(
          'relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[var(--outline-variant)] bg-white text-sm shadow-2xl',
          className,
        )}
      >
        {showClose && (
          <button
            type="button"
            aria-label="Đóng"
            className="absolute right-4 top-4 z-20 inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--on-surface-variant)] transition hover:bg-[var(--surface-container)] hover:text-[var(--on-surface)]"
            onClick={() => onOpenChange(false)}
          >
            <X size={18} />
          </button>
        )}
        {children}
      </section>
    </div>
  )
}

function DialogHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <header className={cn('border-b border-[var(--outline-variant)] bg-[var(--surface-container-low)] px-5 py-4 pr-14', className)}>{children}</header>
}

function DialogTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  const { titleId } = useDialog()
  return <h2 id={titleId} className={cn('text-xl font-extrabold leading-7 text-[var(--on-surface)]', className)}>{children}</h2>
}

function DialogDescription({ className, children }: { className?: string; children: React.ReactNode }) {
  const { descriptionId } = useDialog()
  return <p id={descriptionId} className={cn('mt-1 text-sm text-[var(--on-surface-variant)]', className)}>{children}</p>
}

function DialogBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto p-5', className)}>{children}</div>
}

function DialogFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return <footer className={cn('flex flex-wrap items-center justify-end gap-2 border-t border-[var(--outline-variant)] bg-[var(--surface-container-low)] px-5 py-4', className)}>{children}</footer>
}

export { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle }
