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
    if (value == null) {
      setDisplay(null)
      fromRef.current = 0
      return
    }
    if (firstRef.current) {
      firstRef.current = false
      fromRef.current = value
      setDisplay(value)
      return
    }
    const from = fromRef.current
    const to = value
    if (from === to) return
    const start = performance.now()
    const step = (t: number) => {
      const progress = Math.min(1, (t - start) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      const cur = from + (to - from) * eased
      setDisplay(Number(cur.toFixed(decimals)))
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
