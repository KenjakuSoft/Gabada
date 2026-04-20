import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useIsFetching, useIsMutating, useQuery } from '@tanstack/react-query'
import {
  Activity,
  Download,
  Home,
  Moon,
  Package,
  Plus,
  Radio,
  Search,
  Settings,
  Store as StoreIcon,
  Sun,
  Tag,
  Target,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useThemeStore, type Theme } from '@/store/theme'
import { settingsApi } from '@/api'

interface NavItem {
  to: string
  label: string
  icon: typeof Home
}

const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/categories', label: 'Categories', icon: Tag },
  { to: '/add', label: 'Add product', icon: Plus },
  { to: '/stores', label: 'Stores', icon: StoreIcon },
  { to: '/import', label: 'Import', icon: Download },
  { to: '/probe', label: 'Probe', icon: Search },
  { to: '/selector-lab', label: 'Selector Lab', icon: Target },
  { to: '/activity', label: 'Activity', icon: Activity },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Shell() {
  const location = useLocation()
  const navRef = useRef<HTMLElement | null>(null)
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null)

  useEffect(() => {
    if (!navRef.current) return
    const active = navRef.current.querySelector<HTMLElement>(
      'a[aria-current="page"]',
    )
    if (active) {
      setPill({ top: active.offsetTop, height: active.offsetHeight })
    }
  }, [location.pathname])

  return (
    <div className="flex h-full min-h-screen bg-background text-foreground">
      <aside className="w-60 shrink-0 border-r border-border bg-card/40 backdrop-blur-sm">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-primary to-[color-mix(in_oklch,var(--primary)_60%,var(--accent))] text-primary-foreground shadow-sm">
            <Package className="h-4 w-4" />
          </div>
          <span className="text-sm font-semibold tracking-tight">Gabada</span>
        </div>
        <nav ref={navRef} className="relative flex flex-col gap-1 p-3">
          {pill ? (
            <span
              aria-hidden
              className="pointer-events-none absolute left-3 right-3 rounded-md bg-accent transition-[top,height] duration-300 ease-out"
              style={{ top: pill.top, height: pill.height }}
            />
          ) : null}
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'relative z-10 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto px-6 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function TopBar() {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const fetching = useIsFetching()
  const mutating = useIsMutating()
  const active = fetching + mutating

  const next: Record<Theme, Theme> = {
    system: 'light',
    light: 'dark',
    dark: 'system',
  }
  const label =
    theme === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light'

  const schedule = useQuery({
    queryKey: ['settings', 'next-run'],
    queryFn: () => settingsApi.nextRun(),
    refetchInterval: 30_000,
    staleTime: 20_000,
  })

  const nextRun = schedule.data?.next_run_time ?? null
  const nextLabel = useMemo(() => formatNextRun(nextRun), [nextRun])

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur-md">
      <div className="flex items-center gap-3 text-xs">
        <span className="relative inline-flex h-2 w-2">
          {active > 0 ? (
            <span className="absolute inset-0 rounded-full bg-primary gbd-pulse-ring" />
          ) : null}
          <span
            className={cn(
              'relative inline-flex h-2 w-2 rounded-full',
              active > 0 ? 'bg-primary' : 'bg-emerald-500',
            )}
          />
        </span>
        <span className="text-muted-foreground">
          {active > 0
            ? `${active} request${active === 1 ? '' : 's'} in flight`
            : 'Idle'}
        </span>
      </div>

      <div className="flex items-center gap-4">
        {nextLabel ? (
          <div className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <Radio className="h-3.5 w-3.5" />
            Next scrape <span className="font-medium text-foreground">{nextLabel}</span>
          </div>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTheme(next[theme])}
          title={`Theme: ${label}`}
        >
          {theme === 'dark' ? (
            <Moon className="h-4 w-4" />
          ) : (
            <Sun className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">{label}</span>
        </Button>
      </div>
    </header>
  )
}

function formatNextRun(iso: string | null): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const diff = t - Date.now()
  if (diff <= 0) return 'now'
  const mins = Math.round(diff / 60_000)
  if (mins < 60) return `in ${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `in ${hours}h`
  const days = Math.round(hours / 24)
  return `in ${days}d`
}
