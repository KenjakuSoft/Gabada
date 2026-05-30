import { useEffect } from 'react'
import { create } from 'zustand'

export type Theme = 'light' | 'dark' | 'system'

interface ThemeState {
  theme: Theme
  setTheme: (t: Theme) => void
}

const LS_KEY = 'gabada.theme'

function readInitial(): Theme {
  const v = localStorage.getItem(LS_KEY)
  if (v === 'light' || v === 'dark' || v === 'system') return v
  // Dark Luxury is the intended showcase experience.
  return 'dark'
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: readInitial(),
  setTheme: (t) => {
    localStorage.setItem(LS_KEY, t)
    set({ theme: t })
  },
}))

function apply(theme: Theme) {
  const isDark =
    theme === 'dark' ||
    (theme === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', isDark)
}

export function useApplyTheme(): void {
  const theme = useThemeStore((s) => s.theme)
  useEffect(() => {
    apply(theme)
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])
}
