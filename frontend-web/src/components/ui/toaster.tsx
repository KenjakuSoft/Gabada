import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dismissToast, getToasts, subscribeToasts, type Toast } from './toast-store'

export function Toaster() {
  const [items, setItems] = useState<Toast[]>(() => getToasts())

  useEffect(() => {
    return subscribeToasts(setItems)
  }, [])

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {items.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}

function ToastItem({ toast }: { toast: Toast }) {
  const Icon =
    toast.variant === 'success'
      ? CheckCircle2
      : toast.variant === 'error'
        ? AlertCircle
        : Info
  const tone =
    toast.variant === 'success'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : toast.variant === 'error'
        ? 'border-destructive/30 bg-destructive/10 text-destructive'
        : 'border-border bg-card text-foreground'

  return (
    <div
      className={cn(
        'gbd-toast-in pointer-events-auto flex items-start gap-3 rounded-xl border px-3 py-2.5 shadow-[var(--shadow-elevated)] backdrop-blur transition-transform hover:-translate-y-0.5',
        tone,
      )}
      role="status"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{toast.title}</div>
        {toast.description ? (
          <div className="mt-0.5 text-xs opacity-80">{toast.description}</div>
        ) : null}
      </div>
      <button
        onClick={() => dismissToast(toast.id)}
        className="text-current/60 hover:text-current"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
