import { useEffect, useState } from 'react'
import { formatRelativeTime } from '@/lib/utils'

/**
 * Returns a relative-time string ("3m ago") that re-renders on a cadence
 * matching the magnitude of the elapsed time. Cheap: one shared tick per
 * hook instance, no global interval.
 */
export function useLiveTime(iso: string | null | undefined): string {
  const [, force] = useState(0)

  useEffect(() => {
    if (!iso) return
    const then = new Date(iso).getTime()
    if (Number.isNaN(then)) return

    let timer: number | undefined
    const schedule = () => {
      const diff = Math.abs(Date.now() - then)
      // tick frequency ramps with age
      const next =
        diff < 60_000 ? 5_000 : diff < 3_600_000 ? 30_000 : 5 * 60_000
      timer = window.setTimeout(() => {
        force((n) => n + 1)
        schedule()
      }, next)
    }
    schedule()
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [iso])

  return formatRelativeTime(iso)
}
