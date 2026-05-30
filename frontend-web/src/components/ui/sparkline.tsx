import { useId } from 'react'
import { cn } from '@/lib/utils'

interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  className?: string
  /** Tint by trend: down = success (cheaper), up = warning/destructive. */
  trend?: 'auto' | 'up' | 'down' | 'flat'
  strokeWidth?: number
  /** Show a soft area fill under the line. */
  fill?: boolean
}

/**
 * Dependency-free SVG sparkline for inline price history. Recharts is reserved
 * for the full interactive charts; this stays cheap enough to render per-row.
 */
export function Sparkline({
  data,
  width = 96,
  height = 28,
  className,
  trend = 'auto',
  strokeWidth = 1.6,
  fill = true,
}: SparklineProps) {
  const gradientId = useId()
  const points = data.filter((n) => Number.isFinite(n))

  if (points.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        className={cn('opacity-40', className)}
        aria-hidden
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
      </svg>
    )
  }

  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const pad = strokeWidth + 1
  const stepX = (width - pad * 2) / (points.length - 1)

  const coords = points.map((value, i) => {
    const x = pad + i * stepX
    const y = pad + (1 - (value - min) / span) * (height - pad * 2)
    return [x, y] as const
  })

  const line = coords
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${height} L${coords[0][0].toFixed(1)},${height} Z`

  const direction =
    trend === 'auto'
      ? points[points.length - 1] < points[0]
        ? 'down'
        : points[points.length - 1] > points[0]
          ? 'up'
          : 'flat'
      : trend

  const color =
    direction === 'down'
      ? 'var(--success)'
      : direction === 'up'
        ? 'var(--warning)'
        : 'var(--muted-foreground)'

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {fill ? <path d={area} fill={`url(#${gradientId})`} /> : null}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={coords[coords.length - 1][0]}
        cy={coords[coords.length - 1][1]}
        r={strokeWidth + 0.6}
        fill={color}
      />
    </svg>
  )
}
