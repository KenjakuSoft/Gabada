import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Kbd({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] border border-border/80 bg-card/80 px-1.5',
        'font-mono text-[10px] font-semibold text-muted-foreground shadow-sm',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
