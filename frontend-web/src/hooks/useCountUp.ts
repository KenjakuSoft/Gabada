import { useEffect, useRef, useState } from 'react'

interface UseCountUpOptions {
  duration?: number
  decimals?: number
}

/**
 * Smoothly animates a numeric display from the previous value to the next
 * whenever `value` changes. Skips the animation on first paint so the
 * initial render is the actual value.
 */
export function useCountUp(
  value: number | null | undefined,
  { duration = 600, decimals = 0 }: UseCountUpOptions = {},
): number | null {
  const [display, setDisplay] = useState<number | null>(value ?? null)
  const fromRef = useRef<number>(value ?? 0)
  const rafRef = useRef<number | null>(null)
  const firstRef = useRef(true)

  useEffect(() => {
    const scheduleDisplay = (next: number | null) => {
      rafRef.current = requestAnimationFrame(() => {
        setDisplay(next)
        rafRef.current = null
      })
    }

    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    if (value == null) {
      fromRef.current = 0
      scheduleDisplay(null)
      return
    }
    if (firstRef.current) {
      firstRef.current = false
      fromRef.current = value
      scheduleDisplay(value)
      return
    }
    const from = fromRef.current
    const to = value
    if (from === to) {
      scheduleDisplay(to)
      return
    }
    const start = performance.now()
    const step = (t: number) => {
      const progress = Math.min(1, (t - start) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      const cur = from + (to - from) * eased
      const rounded = Number(cur.toFixed(decimals))
      setDisplay(rounded)
      // Keep the animation origin in sync with what the user sees so an
      // interrupted animation resumes from the current value, not the old
      // target.
      fromRef.current = rounded
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        fromRef.current = to
      }
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [value, duration, decimals])

  return display
}
