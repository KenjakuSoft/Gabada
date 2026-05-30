import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleCheck,
  Layers,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Store as StoreIcon,
  TrendingDown,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast-store'
import { ProductTile } from '@/components/products/ProductTile'
import { activityApi, categoriesApi, productsApi, scraperApi } from '@/api'
import {
  useCurrencySymbol,
  useCurrencyCode,
  useExchangeRates,
  useLocale,
  usePriceDisplayMode,
} from '@/hooks/useSettings'
import { cn } from '@/lib/utils'
import type { ActivityEntry, Category, Product, ProductStoreSummary } from '@/api'

const LIVE_INTERVAL = 20_000

export function HomePage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const symbol = useCurrencySymbol()
  const localCurrency = useCurrencyCode()
  const exchangeRates = useExchangeRates()
  const priceDisplayMode = usePriceDisplayMode()
  const locale = useLocale()
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [live, setLive] = useState(true)
  const initialCategoryId = (() => {
    const raw = searchParams.get('category')
    const parsed = raw == null ? NaN : Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  })()
  const [categoryId, setCategoryId] = useState<number | null>(initialCategoryId)

  useEffect(() => {
    const current = searchParams.get('category')
    const next = categoryId == null ? null : String(categoryId)
    if (current === next) return
    const params = new URLSearchParams(searchParams)
    if (next == null) params.delete('category')
    else params.set('category', next)
    setSearchParams(params, { replace: true })
  }, [categoryId, searchParams, setSearchParams])

  const products = useQuery<Product[]>({
    queryKey: ['products', { categoryId }],
    queryFn: () => productsApi.list(categoryId ?? undefined),
    refetchInterval: live ? LIVE_INTERVAL : false,
  })

  const activity = useQuery<ActivityEntry[]>({
    queryKey: ['activity', { limit: 12 }],
    queryFn: () => activityApi.list(12),
    refetchInterval: live ? LIVE_INTERVAL : false,
  })

  const categories = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
    staleTime: 5 * 60_000,
  })

  const scrapeAll = useMutation({
    mutationFn: () => scraperApi.scrapeAll(),
    onSuccess: async (summary) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['products'] }),
        qc.invalidateQueries({ queryKey: ['activity'] }),
      ])
      if (summary.failed > 0) {
        toast.error(
          'Scrape finished with issues',
          `${summary.scraped} refreshed, ${summary.failed} failed`,
        )
      } else {
        toast.success('Scrape complete', `${summary.scraped} stores refreshed`)
      }
    },
    onError: () => toast.error('Scrape failed', 'Check the backend is reachable'),
  })

  const filtered = useMemo(() => {
    const list = products.data ?? []
    if (!search.trim()) return list
    const q = search.trim().toLowerCase()
    return list.filter(
      (p) =>
        p.canonical_name.toLowerCase().includes(q) ||
        p.stores.some((s) => s.store_name.toLowerCase().includes(q)),
    )
  }, [products.data, search])

  const stats = useMemo(() => computeStats(products.data ?? []), [products.data])
  const movers = useMemo(() => computeMovers(products.data ?? []), [products.data])

  return (
    <div className="space-y-7">
      <Hero
        onScrape={() => scrapeAll.mutate()}
        scraping={scrapeAll.isPending}
        onAdd={() => navigate('/add')}
        live={live}
        onToggleLive={() => setLive((v) => !v)}
      />

      {/* KPI row — hero numerals */}
      <div className="gbd-stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Tracked"
          value={stats.products}
          icon={<Layers className="h-4 w-4" />}
          hint="products in catalog"
          loading={products.isLoading}
          accent
        />
        <KpiCard
          label="Store links"
          value={stats.storeLinks}
          icon={<StoreIcon className="h-4 w-4" />}
          hint={`across ${stats.uniqueStores} shops`}
          loading={products.isLoading}
        />
        <KpiCard
          label="In stock"
          value={stats.inStock}
          suffix={`/ ${stats.products}`}
          icon={<CircleCheck className="h-4 w-4" />}
          hint={`${stats.inStockPct}% available now`}
          loading={products.isLoading}
          tone="success"
        />
        <KpiCard
          label="Price drops"
          value={stats.drops}
          icon={<TrendingDown className="h-4 w-4" />}
          hint="since last scrape"
          loading={products.isLoading}
          tone="primary"
        />
      </div>

      {/* Market pulse: biggest movers + live ticker */}
      <div className="grid gap-4 lg:grid-cols-3">
        <MoversPanel
          movers={movers}
          loading={products.isLoading}
          symbol={symbol}
          onOpen={(id) => navigate(`/product/${id}`)}
        />
        <LiveTicker
          entries={activity.data ?? []}
          loading={activity.isLoading}
          live={live}
          symbol={symbol}
          onOpen={(id) => navigate(`/product/${id}`)}
        />
      </div>

      {/* Catalog */}
      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-baseline gap-2">
            <h2 className="font-display text-lg font-bold tracking-tight">Catalog</h2>
            <span className="text-sm text-muted-foreground">
              {filtered.length} {filtered.length === 1 ? 'product' : 'products'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 w-full pl-8 sm:w-72"
                placeholder="Search products or stores…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryPill
            active={categoryId == null}
            label="All"
            onClick={() => setCategoryId(null)}
          />
          {(categories.data ?? []).map((c) => (
            <CategoryPill
              key={c.id}
              active={categoryId === c.id}
              label={c.name}
              color={c.color}
              onClick={() => setCategoryId(c.id)}
            />
          ))}
        </div>

        {products.isLoading ? (
          <LoadingGrid />
        ) : products.isError ? (
          <EmptyState text="Failed to load. Is the backend running on :8000?" />
        ) : filtered.length === 0 ? (
          <EmptyState
            text={
              search
                ? 'No products match your search.'
                : 'No products yet. Paste URLs on Add product.'
            }
            cta={
              !search ? (
                <Button size="sm" onClick={() => navigate('/add')}>
                  <Plus className="h-4 w-4" />
                  Add your first
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="gbd-stagger space-y-2">
            {filtered.map((p) => (
              <ProductTile
                key={p.id}
                product={p}
                symbol={symbol}
                displayMode={priceDisplayMode}
                locale={locale}
                localCurrency={localCurrency}
                exchangeRates={exchangeRates}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/* ── Hero ──────────────────────────────────────────────────────────────── */

function Hero({
  onScrape,
  scraping,
  onAdd,
  live,
  onToggleLive,
}: {
  onScrape: () => void
  scraping: boolean
  onAdd: () => void
  live: boolean
  onToggleLive: () => void
}) {
  return (
    <div className="gbd-reveal gbd-glow-card relative overflow-hidden rounded-2xl border border-border/70 p-6 sm:p-8">
      <span aria-hidden className="gbd-glow-card-before" />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-50 blur-3xl"
        style={{
          background:
            'radial-gradient(circle, color-mix(in oklch, var(--glow-a) 26%, transparent), transparent 70%)',
        }}
      />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <button
            onClick={onToggleLive}
            className={cn(
              'mb-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors',
              live
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border/70 bg-card/50 text-muted-foreground hover:text-foreground',
            )}
            title={live ? 'Live updates on — click to pause' : 'Paused — click to resume'}
          >
            <span className="relative inline-flex h-1.5 w-1.5">
              {live ? (
                <span className="absolute inset-0 rounded-full bg-primary gbd-pulse-ring" />
              ) : null}
              <span
                className={cn(
                  'relative inline-flex h-1.5 w-1.5 rounded-full',
                  live ? 'bg-primary' : 'bg-muted-foreground',
                )}
              />
            </span>
            {live ? 'Live' : 'Paused'}
          </button>
          <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            Your market, <span className="gbd-brand-text">in real time</span>.
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Price and stock across every store you track — refreshed automatically,
            highlighted the moment something moves.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleLive}
            title="Toggle live updates"
          >
            {live ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {live ? 'Pause' : 'Resume'}
          </Button>
          <Button variant="outline" size="sm" onClick={onScrape} disabled={scraping}>
            <RefreshCw className={cn('h-4 w-4', scraping && 'animate-spin')} />
            Scrape all
          </Button>
          <Button size="sm" onClick={onAdd}>
            <Plus className="h-4 w-4" />
            Add product
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ── KPI card ──────────────────────────────────────────────────────────── */

function KpiCard({
  label,
  value,
  icon,
  hint,
  suffix,
  loading,
  accent = false,
  tone = 'default',
}: {
  label: string
  value: number
  icon: React.ReactNode
  hint?: string
  suffix?: string
  loading?: boolean
  accent?: boolean
  tone?: 'default' | 'primary' | 'success'
}) {
  const toneRing =
    tone === 'success'
      ? 'text-success'
      : tone === 'primary'
        ? 'text-primary'
        : 'text-muted-foreground'
  return (
    <div className="gbd-spotlight gbd-hover-lift group relative overflow-hidden rounded-2xl border border-border/70 p-5 hover:border-primary/25 hover:shadow-[var(--shadow-elevated)]">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            'grid h-7 w-7 place-items-center rounded-md border border-border/60 bg-card/70',
            toneRing,
          )}
        >
          {icon}
        </span>
      </div>
      <div className="mt-4 flex items-end gap-1.5">
        {loading ? (
          <Skeleton className="h-10 w-24" />
        ) : (
          <AnimatedNumber
            value={value}
            accent={accent}
            suffix={suffix}
            className="text-4xl font-extrabold"
          />
        )}
      </div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/* ── Movers panel ──────────────────────────────────────────────────────── */

interface Mover {
  productId: number
  name: string
  storeName: string
  delta: number
  price: number | null
}

function MoversPanel({
  movers,
  loading,
  symbol,
  onOpen,
}: {
  movers: Mover[]
  loading: boolean
  symbol: string
  onOpen: (id: number) => void
}) {
  return (
    <div className="gbd-glass relative overflow-hidden rounded-2xl border border-border/70 p-5 lg:col-span-2">
      <div className="mb-3 flex items-center gap-2">
        <TrendingDown className="h-4 w-4 text-primary" />
        <h3 className="font-display text-sm font-bold tracking-tight">Biggest movers</h3>
        <span className="text-xs text-muted-foreground">last scrape</span>
      </div>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : movers.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No price changes recorded yet. Run a scrape to populate movement.
        </p>
      ) : (
        <ul className="divide-y divide-border/50">
          {movers.map((m) => {
            const down = m.delta < 0
            return (
              <li key={`${m.productId}-${m.storeName}`}>
                <button
                  onClick={() => onOpen(m.productId)}
                  className="group flex w-full items-center gap-3 py-2.5 text-left"
                >
                  <span
                    className={cn(
                      'grid h-8 w-8 shrink-0 place-items-center rounded-lg border',
                      down
                        ? 'border-success/30 bg-success/10 text-success'
                        : 'border-warning/30 bg-warning/10 text-warning',
                    )}
                  >
                    {down ? (
                      <ArrowDownRight className="h-4 w-4" />
                    ) : (
                      <ArrowUpRight className="h-4 w-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium group-hover:text-primary">
                      {m.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {m.storeName}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className={cn(
                        'gbd-numeral block text-sm font-bold',
                        down ? 'text-success' : 'text-warning',
                      )}
                    >
                      {down ? '−' : '+'}
                      {symbol}
                      {Math.abs(m.delta).toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                    </span>
                    {m.price != null ? (
                      <span className="block text-[11px] text-muted-foreground">
                        now {symbol}
                        {m.price.toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/* ── Live ticker ───────────────────────────────────────────────────────── */

function LiveTicker({
  entries,
  loading,
  live,
  symbol,
  onOpen,
}: {
  entries: ActivityEntry[]
  loading: boolean
  live: boolean
  symbol: string
  onOpen: (id: number) => void
}) {
  return (
    <div className="gbd-glass relative flex flex-col overflow-hidden rounded-2xl border border-border/70 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Zap className="h-4 w-4 text-primary" />
        <h3 className="font-display text-sm font-bold tracking-tight">Live activity</h3>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="relative inline-flex h-1.5 w-1.5">
            {live ? (
              <span className="absolute inset-0 rounded-full bg-primary gbd-pulse-ring" />
            ) : null}
            <span
              className={cn(
                'relative inline-flex h-1.5 w-1.5 rounded-full',
                live ? 'bg-primary' : 'bg-muted-foreground',
              )}
            />
          </span>
          {live ? 'streaming' : 'paused'}
        </span>
      </div>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing yet. Activity appears here as prices and stock change.
        </p>
      ) : (
        <ul className="-mr-1 max-h-72 space-y-1 overflow-y-auto pr-1">
          {entries.map((e) => (
            <li key={e.id} className="gbd-ticker-up">
              <button
                onClick={() => onOpen(e.product_id)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/40"
              >
                <ChangeDot delta={e.price_delta} type={e.change_type} />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {e.product_name}
                </span>
                <span className="shrink-0 text-muted-foreground">{e.store_name}</span>
                {e.price_delta != null && e.price_delta !== 0 ? (
                  <span
                    className={cn(
                      'gbd-numeral shrink-0 font-semibold',
                      e.price_delta < 0 ? 'text-success' : 'text-warning',
                    )}
                  >
                    {e.price_delta < 0 ? '−' : '+'}
                    {symbol}
                    {Math.abs(e.price_delta).toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}
                  </span>
                ) : (
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {e.change_type}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ChangeDot({ delta, type }: { delta: number | null; type: string }) {
  const color =
    delta != null && delta < 0
      ? 'bg-success'
      : delta != null && delta > 0
        ? 'bg-warning'
        : type === 'new'
          ? 'bg-primary'
          : 'bg-muted-foreground'
  return <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', color)} />
}

/* ── Stats + movers derivation ─────────────────────────────────────────── */

interface Stats {
  products: number
  storeLinks: number
  uniqueStores: number
  inStock: number
  inStockPct: number
  drops: number
}

function effectivePrice(s: ProductStoreSummary): number | null {
  return s.manual_price ?? s.latest_discounted_price ?? s.latest_price
}

function computeStats(list: Product[]): Stats {
  const uniq = new Set<number>()
  let storeLinks = 0
  let inStock = 0
  let drops = 0
  for (const p of list) {
    storeLinks += p.stores.length
    for (const s of p.stores) {
      uniq.add(s.store_id)
      if (s.latest_price_delta != null && s.latest_price_delta < 0) drops += 1
    }
    if (
      p.stores.some((s) => {
        const v = s.manual_stock_status ?? s.latest_stock_status
        return v === 'in_stock' || v === 'limited'
      })
    ) {
      inStock += 1
    }
  }
  return {
    products: list.length,
    storeLinks,
    uniqueStores: uniq.size,
    inStock,
    inStockPct: list.length ? Math.round((inStock / list.length) * 100) : 0,
    drops,
  }
}

function computeMovers(list: Product[]): Mover[] {
  const movers: Mover[] = []
  for (const p of list) {
    for (const s of p.stores) {
      if (s.latest_price_delta != null && s.latest_price_delta !== 0) {
        movers.push({
          productId: p.id,
          name: p.canonical_name,
          storeName: s.store_name,
          delta: s.latest_price_delta,
          price: effectivePrice(s),
        })
      }
    }
  }
  return movers
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 5)
}

/* ── Bits ──────────────────────────────────────────────────────────────── */

function LoadingGrid() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-border/70 bg-card/60 px-4 py-3"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <div className="flex flex-wrap gap-1.5">
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-6 w-24 rounded-full" />
                <Skeleton className="h-6 w-28 rounded-full" />
              </div>
            </div>
            <div className="flex gap-1.5">
              <Skeleton className="h-8 w-16 rounded-md" />
              <Skeleton className="h-8 w-14 rounded-md" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

interface CategoryPillProps {
  active: boolean
  label: string
  color?: string
  onClick: () => void
}

function CategoryPill({ active, label, color, onClick }: CategoryPillProps) {
  return (
    <button onClick={onClick} className="focus:outline-none">
      <Badge
        variant={active ? 'default' : 'outline'}
        style={!active && color ? { borderColor: color, color } : undefined}
        className="cursor-pointer transition-transform hover:scale-[1.03]"
      >
        {label}
      </Badge>
    </button>
  )
}

function EmptyState({ text, cta }: { text: string; cta?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/70 bg-card/40 p-12 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
      {cta}
    </div>
  )
}
