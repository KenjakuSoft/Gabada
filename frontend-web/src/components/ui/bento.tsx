import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Span = 1 | 2 | 3 | 4 | 5 | 6

interface BentoGridProps extends HTMLAttributes<HTMLDivElement> {
  cols?: Span
  dense?: boolean
}

export function BentoGrid({
  className,
  cols = 6,
  dense = true,
  ...props
}: BentoGridProps) {
  const colsClass: Record<Span, string> = {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
    5: 'grid-cols-5',
    6: 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6',
  }
  return (
    <div
      className={cn(
        'gbd-stagger grid auto-rows-[minmax(120px,auto)] gap-4',
        colsClass[cols],
        dense && '[grid-auto-flow:dense]',
        className,
      )}
      {...props}
    />
  )
}

interface BentoTileProps extends HTMLAttributes<HTMLDivElement> {
  colSpan?: Span
  rowSpan?: Span
  interactive?: boolean
  padded?: boolean
  tone?: 'default' | 'accent' | 'primary' | 'success' | 'warning' | 'destructive'
}

const toneClass: Record<NonNullable<BentoTileProps['tone']>, string> = {
  default: 'bg-card',
  accent: 'bg-accent/30',
  primary:
    'bg-gradient-to-br from-[color-mix(in_oklch,var(--primary)_14%,var(--card))] to-card',
  success:
    'bg-gradient-to-br from-[color-mix(in_oklch,var(--success)_14%,var(--card))] to-card',
  warning:
    'bg-gradient-to-br from-[color-mix(in_oklch,var(--warning)_14%,var(--card))] to-card',
  destructive:
    'bg-gradient-to-br from-[color-mix(in_oklch,var(--destructive)_12%,var(--card))] to-card',
}

const colSpanClass: Record<Span, string> = {
  1: 'col-span-1',
  2: 'col-span-2',
  3: 'col-span-2 md:col-span-3',
  4: 'col-span-2 md:col-span-4',
  5: 'col-span-2 md:col-span-4 lg:col-span-5',
  6: 'col-span-2 md:col-span-4 lg:col-span-6',
}
const rowSpanClass: Record<Span, string> = {
  1: 'row-span-1',
  2: 'row-span-2',
  3: 'row-span-3',
  4: 'row-span-4',
  5: 'row-span-5',
  6: 'row-span-6',
}

export const BentoTile = forwardRef<HTMLDivElement, BentoTileProps>(
  (
    {
      className,
      colSpan = 1,
      rowSpan = 1,
      interactive = false,
      padded = true,
      tone = 'default',
      children,
      ...props
    },
    ref,
  ) => (
    <div
      ref={ref}
      className={cn(
        'gbd-glass group/bento relative isolate overflow-hidden rounded-xl border border-border/80 text-card-foreground shadow-sm',
        'transition-[transform,box-shadow,border-color,background-color] duration-150 hover:border-primary/25 hover:shadow-[var(--shadow-elevated)]',
        toneClass[tone],
        colSpanClass[colSpan],
        rowSpanClass[rowSpan],
        padded && 'p-5',
        interactive &&
          'cursor-pointer hover:-translate-y-px active:translate-y-0',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
)
BentoTile.displayName = 'BentoTile'

interface TileHeaderProps {
  eyebrow?: ReactNode
  title?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  className?: string
}

export function TileHeader({
  eyebrow,
  title,
  action,
  icon,
  className,
}: TileHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon ? (
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-accent/60 text-foreground/80 shadow-sm transition-colors duration-150 group-hover/bento:border-primary/25">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0">
          {eyebrow ? (
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {eyebrow}
            </div>
          ) : null}
          {title ? (
            <div className="truncate text-sm font-semibold">{title}</div>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
