import type { ReactNode } from 'react'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface MetricCardProps {
  label: string
  /** Numeric metric — animated count-up. Ignored when `text` is provided. */
  value?: number
  /** Non-numeric metric (e.g. a name) rendered in the numeral style. */
  text?: string
  icon: ReactNode
  hint?: string
  suffix?: string
  loading?: boolean
  /** Brand-accent treatment on the numeral (reserve for the headline metric). */
  accent?: boolean
  tone?: 'default' | 'primary' | 'success' | 'warning'
}

const TONE_RING: Record<NonNullable<MetricCardProps['tone']>, string> = {
  default: 'text-muted-foreground',
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
}

/** Shared dark-luxury KPI: big count-up numeral, spotlight surface, hover lift. */
export function MetricCard({
  label,
  value,
  text,
  icon,
  hint,
  suffix,
  loading,
  accent = false,
  tone = 'default',
}: MetricCardProps) {
  return (
    <div className="gbd-spotlight gbd-hover-lift relative overflow-hidden rounded-2xl border border-border/70 p-5 hover:border-primary/25 hover:shadow-[var(--shadow-elevated)]">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            'grid h-7 w-7 place-items-center rounded-md border border-border/60 bg-card/70',
            TONE_RING[tone],
          )}
        >
          {icon}
        </span>
      </div>
      <div className="mt-4">
        {loading ? (
          <Skeleton className="h-10 w-24" />
        ) : text != null ? (
          <span
            className={cn(
              'gbd-numeral block truncate text-2xl font-extrabold',
              accent && 'gbd-brand-text',
            )}
          >
            {text}
          </span>
        ) : (
          <AnimatedNumber
            value={value ?? null}
            accent={accent}
            suffix={suffix}
            className="text-4xl font-extrabold"
          />
        )}
      </div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
