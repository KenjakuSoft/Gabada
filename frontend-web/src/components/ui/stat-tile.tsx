import type { ReactNode } from 'react'
import { useCountUp } from '@/hooks/useCountUp'
import { cn } from '@/lib/utils'
import { BentoTile, TileHeader } from './bento'
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
  const isNumericValue = typeof value === 'number'
  const animated = useCountUp(isNumericValue ? value : null, { decimals })
  const shown =
    typeof value === 'string'
      ? value
      : animated == null
        ? 'n/a'
        : animated.toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          })

  return (
    <BentoTile tone={tone} colSpan={colSpan}>
      <TileHeader eyebrow={label} icon={icon} action={accent} />
      <div className="mt-4 flex items-baseline gap-1">
        {loading ? (
          <Skeleton className="h-9 w-24" />
        ) : (
          <>
            {prefix ? (
              <span className="text-lg font-medium text-muted-foreground">
                {prefix}
              </span>
            ) : null}
            <span
              className={cn(
                'text-3xl font-semibold tabular-nums tracking-tight',
                value == null && 'text-muted-foreground',
              )}
            >
              {shown}
            </span>
            {suffix ? (
              <span className="text-sm text-muted-foreground">{suffix}</span>
            ) : null}
          </>
        )}
      </div>
      {hint ? (
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </BentoTile>
  )
}
