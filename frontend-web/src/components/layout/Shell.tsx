import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useIsFetching, useIsMutating, useQuery } from '@tanstack/react-query'
import {
  Activity,
  Download,
  Home,
  Moon,
  Plus,
  Radio,
  Search,
  Settings,
  Store as StoreIcon,
  Sun,
  Tag,
  Target,
} from 'lucide-react'
import { Kbd } from '@/components/ui/kbd'
import { Button } from '@/components/ui/button'
import { CommandPalette } from '@/components/command/CommandPalette'
import { cn } from '@/lib/utils'
import { useCommandStore } from '@/store/command'
import { useThemeStore, type Theme } from '@/store/theme'
import { settingsApi } from '@/api'

interface NavItem {
  to: string
  label: string
  icon: typeof Home
  section: 'Track' | 'Tools'
}

const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, section: 'Track' },
  { to: '/categories', label: 'Categories', icon: Tag, section: 'Track' },
  { to: '/add', label: 'Add product', icon: Plus, section: 'Track' },
  { to: '/stores', label: 'Stores', icon: StoreIcon, section: 'Track' },
  { to: '/activity', label: 'Activity', icon: Activity, section: 'Track' },
  { to: '/import', label: 'Import', icon: Download, section: 'Tools' },
  { to: '/probe', label: 'Probe', icon: Search, section: 'Tools' },
  { to: '/selector-lab', label: 'Selector Lab', icon: Target, section: 'Tools' },
  { to: '/settings', label: 'Settings', icon: Settings, section: 'Tools' },
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

  const sections: NavItem['section'][] = ['Track', 'Tools']

  return (
    <div className="relative flex h-full min-h-screen overflow-hidden text-foreground">
      <aside className="gbd-glass relative z-10 hidden w-64 shrink-0 border-r border-border/60 md:flex md:flex-col">
        <div className="flex h-16 items-center gap-3 px-5">
          <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/30 bg-gradient-to-br from-[color-mix(in_oklch,var(--brand)_30%,var(--card))] to-card shadow-[0_8px_24px_-14px_var(--brand)]">
            <img src="/gabada-mark.svg" alt="" className="h-6 w-6" />
          </div>
          <div>
            <span className="block font-display text-sm font-extrabold tracking-[0.28em]">
              GABADA
            </span>
            <span className="text-[10px] tracking-wide text-muted-foreground">
              Price &amp; stock intelligence
            </span>
          </div>
        </div>
        <span aria-hidden className="gbd-hairline mx-5 h-px" />

        <nav ref={navRef} className="relative flex-1 overflow-y-auto px-3 py-4">
          {pill ? (
            <span
              aria-hidden
              className="pointer-events-none absolute left-3 right-3 z-0 rounded-xl border border-primary/20 bg-gradient-to-r from-accent to-[color-mix(in_oklch,var(--accent)_50%,var(--brand))] shadow-[0_10px_26px_-22px_var(--brand)] transition-[top,height] duration-200 ease-out"
              style={{ top: pill.top, height: pill.height }}
            />
          ) : null}
          {sections.map((section) => (
            <div key={section} className="mb-2">
              <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
                {section}
              </div>
              {NAV.filter((n) => n.section === section).map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    cn(
                      'group/nav relative z-10 flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-[transform,color] duration-200 hover:translate-x-0.5',
                      isActive
                        ? 'font-semibold text-accent-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon
                        className={cn(
                          'h-4 w-4 transition-transform duration-200 group-hover/nav:scale-110',
                          isActive && 'text-primary',
                        )}
                      />
                      {label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="px-3 pb-4">
          <CommandTrigger />
        </div>
      </aside>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <TopBar />
        <MobileNav />
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
          <div className="mx-auto max-w-[1760px]">
            <Outlet />
          </div>
        </main>
      </div>

      <CommandPalette />
    </div>
  )
}

function CommandTrigger() {
  const setOpen = useCommandStore((s) => s.setOpen)
  return (
    <button
      onClick={() => setOpen(true)}
      className="group flex w-full items-center gap-2 rounded-xl border border-border/70 bg-card/50 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
    >
      <Search className="h-3.5 w-3.5" />
      <span className="flex-1">Search…</span>
      <span className="flex items-center gap-0.5">
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  )
}

function MobileNav() {
  const setOpen = useCommandStore((s) => s.setOpen)
  return (
    <nav className="gbd-glass z-20 flex items-center gap-2 overflow-x-auto border-b border-border/60 px-3 py-2 md:hidden">
      <button
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-card/60 px-3 py-1.5 text-xs text-muted-foreground"
      >
        <Search className="h-3.5 w-3.5" /> Search
      </button>
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            cn(
              'inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-[background-color,border-color,color,transform]',
              isActive
                ? 'border-primary/30 bg-accent text-accent-foreground'
                : 'border-border/70 bg-card/50 text-muted-foreground hover:-translate-y-0.5 hover:border-primary/25 hover:text-foreground',
            )
          }
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </NavLink>
      ))}
    </nav>
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
    <header className="gbd-glass sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border/60 px-4 sm:px-8">
      {active > 0 ? (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent"
        />
      ) : null}
      <div className="flex items-center gap-2.5 text-xs">
        <span className="relative inline-flex h-2 w-2">
          {active > 0 ? (
            <span className="absolute inset-0 rounded-full bg-primary gbd-pulse-ring" />
          ) : null}
          <span
            className={cn(
              'relative inline-flex h-2 w-2 rounded-full',
              active > 0 ? 'bg-primary' : 'bg-success',
            )}
          />
        </span>
        <span className="font-medium text-muted-foreground">
          {active > 0
            ? `${active} request${active === 1 ? '' : 's'} in flight`
            : 'Live · idle'}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {nextLabel ? (
          <div className="hidden items-center gap-1.5 rounded-full border border-border/70 bg-card/50 px-3 py-1.5 text-xs text-muted-foreground shadow-sm sm:flex">
            <Radio className="h-3.5 w-3.5 text-primary" />
            Next scrape{' '}
            <span className="font-semibold text-foreground">{nextLabel}</span>
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
