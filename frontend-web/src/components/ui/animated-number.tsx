import { useCountUp } from '@/hooks/useCountUp'
import { cn } from '@/lib/utils'

interface AnimatedNumberProps {
  value: number | null | undefined
  decimals?: number
  prefix?: string
  suffix?: string
  /** Apply the gold gradient treatment (reserve for hero / headline metrics). */
  gold?: boolean
  className?: string
  /** Localized grouping (1,234). Defaults to true. */
  group?: boolean
}

/**
 * Big tabular numeral that smoothly counts up on change. The display font +
 * tabular-nums keep digits from jittering as they animate.
 */
export function AnimatedNumber({
  value,
  decimals = 0,
  prefix,
  suffix,
  gold = false,
  className,
  group = true,
}: AnimatedNumberProps) {
  const animated = useCountUp(value == null ? null : value, { decimals })
  const shown =
    animated == null
      ? '—'
      : animated.toLocaleString(undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
          useGrouping: group,
        })
  return (
    <span className={cn('gbd-numeral inline-flex items-baseline', className)}>
      {prefix ? (
        <span className="mr-0.5 text-[0.5em] font-semibold opacity-70">
          {prefix}
        </span>
      ) : null}
      <span className={cn(gold && 'gbd-gold-text', animated == null && 'opacity-40')}>
        {shown}
      </span>
      {suffix ? (
        <span className="ml-1 text-[0.42em] font-medium tracking-normal opacity-60">
          {suffix}
        </span>
      ) : null}
    </span>
  )
}
