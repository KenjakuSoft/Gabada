import { NavLink, Outlet } from 'react-router-dom'
import {
  Activity,
  Download,
  Home,
  Moon,
  Package,
  Plus,
  Search,
  Settings,
  Store as StoreIcon,
  Sun,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useThemeStore, type Theme } from '@/store/theme'

interface NavItem {
  to: string
  label: string
  icon: typeof Home
}

const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/add', label: 'Add product', icon: Plus },
  { to: '/stores', label: 'Stores', icon: StoreIcon },
  { to: '/import', label: 'Import', icon: Download },
  { to: '/probe', label: 'Probe', icon: Search },
  { to: '/activity', label: 'Activity', icon: Activity },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Shell() {
  return (
    <div className="flex h-full min-h-screen bg-background text-foreground">
      <aside className="w-60 shrink-0 border-r border-border bg-card/50">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <Package className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold tracking-tight">Gabada</span>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
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

  const next: Record<Theme, Theme> = {
    system: 'light',
    light: 'dark',
    dark: 'system',
  }

  const label =
    theme === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light'

  return (
    <header className="flex h-14 items-center justify-between border-b border-border px-6">
      <div className="text-sm text-muted-foreground">
        Price &amp; stock tracker
      </div>
      <div className="flex items-center gap-2">
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
