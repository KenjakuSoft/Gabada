import type { ReactNode } from 'react'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { cn } from '@/lib/utils'
import { Skeleton } from './skeleton'

interface StatTileProps {
  label: string
  value: number | string | null | undefined
  icon?: ReactNode
  suffix?: string
  prefix?: string
  decimals?: number
  hint?: ReactNode
  loading?: boolean
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'accent' | 'destructive'
  colSpan?: 1 | 2 | 3
  accent?: ReactNode
}

const TONE_RING: Record<NonNullable<StatTileProps['tone']>, string> = {
  default: 'text-muted-foreground',
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  accent: 'text-primary',
  destructive: 'text-destructive',
}

const COL_SPAN: Record<NonNullable<StatTileProps['colSpan']>, string> = {
  1: 'col-span-1',
  2: 'col-span-2',
  3: 'col-span-2 md:col-span-3',
}

/**
 * KPI tile. Shares the `MetricCard` surface (spotlight + hover lift + big
 * count-up numeral) so every page renders a consistent metric, while keeping
 * the richer API (string values, prefix/decimals, colSpan, accent slot) that
 * the import and Selector Lab flows rely on.
 */
export function StatTile({
  label,
  value,
  icon,
  suffix,
  prefix,
  decimals = 0,
  hint,
  loading = false,
  tone = 'default',
  colSpan = 1,
  accent,
}: StatTileProps) {
  const isNumeric = typeof value === 'number'
  return (
    <div
      className={cn(
        'gbd-spotlight gbd-hover-lift relative overflow-hidden rounded-2xl border border-border/70 p-5 hover:border-primary/25 hover:shadow-[var(--shadow-elevated)]',
        COL_SPAN[colSpan],
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {accent}
          {icon ? (
            <span
              className={cn(
                'grid h-7 w-7 place-items-center rounded-md border border-border/60 bg-card/70',
                TONE_RING[tone],
              )}
            >
              {icon}
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-4">
        {loading ? (
          <Skeleton className="h-10 w-24" />
        ) : isNumeric ? (
          <AnimatedNumber
            value={value as number}
            decimals={decimals}
            prefix={prefix}
            suffix={suffix}
            className="text-4xl font-extrabold"
          />
        ) : (
          <span
            className={cn(
              'gbd-numeral block truncate text-2xl font-extrabold',
              value == null && 'text-muted-foreground',
            )}
          >
            {value == null ? 'n/a' : value}
          </span>
        )}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  )
}
