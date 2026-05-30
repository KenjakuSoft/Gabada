import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  CornerDownLeft,
  Download,
  Home,
  Moon,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Store as StoreIcon,
  Sun,
  Tag,
  Target,
} from 'lucide-react'
import { productsApi, scraperApi } from '@/api'
import type { Product } from '@/api'
import { toast } from '@/components/ui/toast-store'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import { useCommandStore } from '@/store/command'
import { useThemeStore } from '@/store/theme'

type Action = {
  id: string
  label: string
  hint?: string
  icon: typeof Home
  group: 'Navigate' | 'Actions' | 'Products'
  run: () => void
  keywords?: string
}

const GROUP_ORDER: Action['group'][] = ['Actions', 'Navigate', 'Products']

export function CommandPalette() {
  const open = useCommandStore((s) => s.open)
  const setOpen = useCommandStore((s) => s.setOpen)
  const toggle = useCommandStore((s) => s.toggle)

  // Global ⌘K / Ctrl+K to toggle; "/" opens from anywhere outside an input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        toggle()
        return
      }
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      if (!typing && e.key === '/') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, setOpen])

  // Mount fresh each open so query/cursor reset without an effect.
  if (!open) return null
  return <CommandDialog onClose={() => setOpen(false)} />
}

function CommandDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const setTheme = useThemeStore((s) => s.setTheme)
  const theme = useThemeStore((s) => s.theme)
  const [query, setQuery] = useState('')
  const [rawCursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  const products = useQuery<Product[]>({
    queryKey: ['products', { categoryId: null }],
    queryFn: () => productsApi.list(),
    staleTime: 30_000,
  })

  const scrapeAll = useMutation({
    mutationFn: () => scraperApi.scrapeAll(),
    onSuccess: async (summary) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['products'] }),
        qc.invalidateQueries({ queryKey: ['activity'] }),
      ])
      toast.success('Scrape complete', `${summary.scraped} stores refreshed`)
    },
    onError: () => toast.error('Scrape failed', 'Check the backend is reachable'),
  })

  const actions = useMemo<Action[]>(() => {
    const go = (to: string) => () => {
      navigate(to)
      onClose()
    }
    const nav: Action[] = [
      { id: 'nav-home', label: 'Home', icon: Home, group: 'Navigate', run: go('/'), keywords: 'dashboard products' },
      { id: 'nav-cat', label: 'Categories', icon: Tag, group: 'Navigate', run: go('/categories') },
      { id: 'nav-stores', label: 'Stores', icon: StoreIcon, group: 'Navigate', run: go('/stores') },
      { id: 'nav-import', label: 'Import', icon: Download, group: 'Navigate', run: go('/import') },
      { id: 'nav-probe', label: 'Probe', icon: Search, group: 'Navigate', run: go('/probe') },
      { id: 'nav-lab', label: 'Selector Lab', icon: Target, group: 'Navigate', run: go('/selector-lab') },
      { id: 'nav-activity', label: 'Activity', icon: Activity, group: 'Navigate', run: go('/activity') },
      { id: 'nav-settings', label: 'Settings', icon: Settings, group: 'Navigate', run: go('/settings') },
    ]
    const quick: Action[] = [
      { id: 'act-add', label: 'Add product', hint: 'Paste URLs', icon: Plus, group: 'Actions', run: go('/add') },
      {
        id: 'act-scrape',
        label: 'Scrape all now',
        hint: 'Refresh every store',
        icon: RefreshCw,
        group: 'Actions',
        run: () => {
          scrapeAll.mutate()
          onClose()
        },
        keywords: 'refresh update',
      },
      {
        id: 'act-theme',
        label: theme === 'dark' ? 'Switch to light' : 'Switch to dark',
        icon: theme === 'dark' ? Sun : Moon,
        group: 'Actions',
        run: () => {
          setTheme(theme === 'dark' ? 'light' : 'dark')
          onClose()
        },
        keywords: 'theme appearance',
      },
    ]
    const productActions: Action[] = (products.data ?? []).map((p) => ({
      id: `prod-${p.id}`,
      label: p.canonical_name,
      hint: p.stores.length === 1 ? '1 store' : `${p.stores.length} stores`,
      icon: Package,
      group: 'Products',
      run: () => {
        navigate(`/product/${p.id}`)
        onClose()
      },
      keywords: p.stores.map((s) => s.store_name).join(' '),
    }))
    return [...quick, ...nav, ...productActions]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products.data, theme])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? actions.filter((a) =>
          `${a.label} ${a.keywords ?? ''} ${a.group}`.toLowerCase().includes(q),
        )
      : actions
    const prods = list.filter((a) => a.group === 'Products').slice(0, q ? 8 : 4)
    const rest = list.filter((a) => a.group !== 'Products')
    return [...rest, ...prods]
  }, [actions, query])

  // Derive a safe cursor instead of clamping in an effect.
  const cursor = Math.min(rawCursor, Math.max(0, filtered.length - 1))

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const grouped = filtered.reduce<Record<string, Action[]>>((acc, a) => {
    ;(acc[a.group] ??= []).push(a)
    return acc
  }, {})

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <button
        aria-label="Close command palette"
        className="absolute inset-0 cursor-default bg-background/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="gbd-glow-card gbd-pop relative w-full max-w-xl overflow-hidden rounded-2xl border border-border/80">
        <span aria-hidden className="gbd-glow-card-before" style={{ opacity: 0.5 }} />
        <div className="gbd-glass">
          <div className="flex items-center gap-3 border-b border-border/70 px-4">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setCursor(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setCursor(Math.min(filtered.length - 1, cursor + 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setCursor(Math.max(0, cursor - 1))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  filtered[cursor]?.run()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  onClose()
                }
              }}
              placeholder="Search products, jump to a page, run an action…"
              className="h-14 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <Kbd>Esc</Kbd>
          </div>

          <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                No matches for “{query}”.
              </div>
            ) : (
              GROUP_ORDER.filter((g) => grouped[g]?.length).map((group) => (
                <div key={group} className="mb-1">
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                    {group}
                  </div>
                  {grouped[group].map((a) => {
                    const idx = filtered.indexOf(a)
                    const active = idx === cursor
                    const Icon = a.icon
                    return (
                      <button
                        key={a.id}
                        data-idx={idx}
                        onMouseEnter={() => setCursor(idx)}
                        onClick={() => a.run()}
                        className={cn(
                          'group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                          active
                            ? 'bg-accent text-accent-foreground'
                            : 'text-foreground/80 hover:bg-accent/50',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-card/70 transition-colors',
                            active && 'border-primary/40 text-primary',
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {a.label}
                        </span>
                        {a.hint ? (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {a.hint}
                          </span>
                        ) : null}
                        {active ? (
                          <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> navigate
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> select
              </span>
            </div>
            <span className="flex items-center gap-1">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd> anywhere
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
