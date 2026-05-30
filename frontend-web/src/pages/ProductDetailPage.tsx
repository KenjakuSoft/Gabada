import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Boxes,
  CalendarDays,
  Clock,
  ImageOff,
  LineChart as LineChartIcon,
  Pencil,
  RefreshCw,
  Tag,
  Trash2,
  TrendingDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast-store'
import { StoreRow } from '@/components/products/StoreRow'
import { AddStoreCard } from '@/components/products/AddStoreCard'
import { EditProductCard } from '@/components/products/EditProductCard'
import { PriceChart } from '@/components/products/PriceChart'
import { LogsTable } from '@/components/products/LogsTable'
import { logsApi, productsApi, scraperApi } from '@/api'
import {
  useCurrencySymbol,
  useCurrencyCode,
  useExchangeRates,
  useLocale,
  usePriceDisplayMode,
  useTimezone,
} from '@/hooks/useSettings'
import { useLiveTime } from '@/hooks/useLiveTime'
import type { PriceLog, Product, ProductStoreSummary } from '@/api'
import {
  cn,
  convertToLocalCurrency,
  formatApiDate,
  formatDisplayMoney,
  formatLocalEquivalent,
  parseApiDate,
} from '@/lib/utils'

type HistoryRange = 'all' | 'today' | '7d' | '30d' | '90d' | 'custom'

const HISTORY_RANGES: { value: HistoryRange; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'custom', label: 'Custom' },
]

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const productId = Number(id)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const symbol = useCurrencySymbol()
  const localCurrency = useCurrencyCode()
  const exchangeRates = useExchangeRates()
  const priceDisplayMode = usePriceDisplayMode()
  const locale = useLocale()
  const timezone = useTimezone()
  const [editing, setEditing] = useState(false)
  const [historyStoreId, setHistoryStoreId] = useState('all')
  const [historyRange, setHistoryRange] = useState<HistoryRange>('all')
  const [customFrom, setCustomFrom] = useState(dateDaysAgoInput(30))
  const [customTo, setCustomTo] = useState(todayInputDate())
  const historyDates = useMemo(
    () => resolveHistoryDates(historyRange, customFrom, customTo),
    [customFrom, customTo, historyRange],
  )

  const product = useQuery<Product>({
    queryKey: ['product', productId],
    queryFn: () => productsApi.get(productId),
    enabled: Number.isFinite(productId) && productId > 0,
    refetchInterval: 30_000,
  })

  const logs = useQuery<PriceLog[]>({
    queryKey: ['product-logs', productId, historyDates.from, historyDates.to],
    queryFn: () =>
      logsApi.forProduct(productId, {
        from: historyDates.from,
        to: historyDates.to,
        limit: 5000,
      }),
    enabled: Number.isFinite(productId) && productId > 0,
  })

  const historyStores = useMemo(() => {
    const stores = product.data?.stores ?? []
    if (historyStoreId === 'all') return stores
    return stores.filter((store) => String(store.id) === historyStoreId)
  }, [historyStoreId, product.data?.stores])

  const historyLogs = useMemo(() => {
    const list = logs.data ?? []
    if (historyStoreId === 'all') return list
    return list.filter((log) => String(log.product_store_id) === historyStoreId)
  }, [historyStoreId, logs.data])

  const historyLogGroups = useMemo(() => {
    return historyStores
      .map((store) => ({
        store,
        logs: historyLogs.filter((log) => log.product_store_id === store.id),
      }))
      .filter((group) => historyStoreId !== 'all' || group.logs.length > 0)
  }, [historyLogs, historyStoreId, historyStores])

  const scrapeAll = useMutation({
    mutationFn: async () => {
      const stores = product.data?.stores ?? []
      await Promise.all(stores.map((s) => scraperApi.scrapeOne(s.id)))
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['product', productId] }),
        qc.invalidateQueries({ queryKey: ['product-logs', productId] }),
        qc.invalidateQueries({ queryKey: ['products'] }),
      ])
      toast.success('Scrape complete', 'All stores refreshed')
    },
    onError: (err: unknown) => {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? 'At least one store scrape failed'
      toast.error('Scrape failed', detail)
    },
  })

  const remove = useMutation({
    mutationFn: () => productsApi.remove(productId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
      toast.info('Product deleted')
      navigate('/')
    },
  })

  if (!Number.isFinite(productId) || productId <= 0) {
    return <ErrorState text="Invalid product id." />
  }
  if (product.isLoading) return <DetailSkeleton />
  if (product.isError || !product.data) {
    return <ErrorState text="Failed to load product." />
  }

  const p = product.data
  const stats = computeStats(p, localCurrency, exchangeRates)
  const lowestPriceText =
    stats.low != null && stats.lowStore
      ? formatStorePrice(stats.low, stats.lowStore, {
          symbol,
          mode: priceDisplayMode,
          locale,
          localCurrency,
          exchangeRates,
        })
      : null
  const latestDropText =
    stats.bestDrop != null && stats.bestDropStore
      ? formatDisplayMoney(stats.bestDrop, {
          symbol,
          mode: priceDisplayMode,
          currencyCode: stats.bestDropStore.latest_currency_code,
          locale,
        })
      : null
  const recent = mostRecentScrape(p)
  const selectedHistoryStore =
    historyStoreId === 'all'
      ? null
      : p.stores.find((store) => String(store.id) === historyStoreId)
  const historyScope = selectedHistoryStore?.store_name ?? 'All stores'
  const historyRangeLabel = labelHistoryRange(historyRange, historyDates)

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate('/')}
        className="-ml-2 text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Button>

      {/* Hero */}
      <div className="gbd-reveal flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">
            {p.canonical_name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {p.category_name ? (
              <Badge
                variant="outline"
                style={
                  p.category_color
                    ? { borderColor: p.category_color, color: p.category_color }
                    : undefined
                }
              >
                {p.category_name}
              </Badge>
            ) : (
              <span>Uncategorized</span>
            )}
            <span>·</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              <LiveTimeLine iso={recent} />
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
            <Pencil className="h-4 w-4" />
            {editing ? 'Close edit' : 'Edit'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => scrapeAll.mutate()}
            disabled={scrapeAll.isPending || p.stores.length === 0}
          >
            <RefreshCw className={cn('h-4 w-4', scrapeAll.isPending && 'animate-spin')} />
            Scrape all
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (confirm(`Delete "${p.canonical_name}" and all its data?`)) {
                remove.mutate()
              }
            }}
            disabled={remove.isPending}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      {editing ? (
        <EditProductCard product={p} onClose={() => setEditing(false)} />
      ) : null}

      {/* Image + KPIs */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="gbd-glow-card relative overflow-hidden rounded-2xl border border-border/70">
          <span aria-hidden className="gbd-glow-card-before" />
          <div className="relative aspect-[4/3] bg-gradient-to-br from-muted/60 to-muted/20">
            {p.image_url ? (
              <img
                src={p.image_url}
                alt=""
                className="absolute inset-0 h-full w-full object-contain p-6"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <ImageOff className="h-12 w-12 text-muted-foreground/40" />
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          <NumeralStat
            label="Lowest price"
            icon={<Tag className="h-4 w-4" />}
            text={lowestPriceText ?? '—'}
            hint={stats.lowStore ? `at ${stats.lowStore.store_name}` : undefined}
            accent
          />
          <NumeralStat
            label="Latest drop"
            icon={<TrendingDown className="h-4 w-4" />}
            text={latestDropText ? `−${latestDropText}` : '—'}
            hint={stats.bestDrop != null ? 'vs previous' : 'no drops'}
            tone="success"
          />
          <NumeralStat
            label="Stores"
            icon={<Boxes className="h-4 w-4" />}
            value={p.stores.length}
            hint={`${stats.inStockStores} in stock`}
          />
          <NumeralStat
            label="Price logs"
            icon={<LineChartIcon className="h-4 w-4" />}
            value={logs.data?.length ?? 0}
            loading={logs.isLoading}
            hint="snapshots"
          />
        </div>
      </div>

      {/* Stores */}
      <Section eyebrow="Stores" title={`${p.stores.length} linked`}>
        <div className="space-y-1.5">
          {p.stores.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
              No stores linked yet.
            </div>
          ) : (
            p.stores.map((s) => (
              <StoreRow
                key={s.id}
                store={s}
                symbol={symbol}
                displayMode={priceDisplayMode}
                locale={locale}
                localCurrency={localCurrency}
                exchangeRates={exchangeRates}
                productId={p.id}
              />
            ))
          )}
          <div className="pt-2">
            <AddStoreCard productId={p.id} />
          </div>
        </div>
      </Section>

      {/* History controls */}
      <Section
        eyebrow="History"
        title={`${historyScope} · ${historyRangeLabel}`}
        icon={<CalendarDays className="h-4 w-4" />}
        action={
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="muted">{historyLogs.length} logs</Badge>
            {logs.isFetching ? <Badge variant="info">Refreshing</Badge> : null}
          </div>
        }
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(180px,240px)_1fr]">
          <label className="space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Store
            </span>
            <Select
              value={historyStoreId}
              onChange={(event) => setHistoryStoreId(event.target.value)}
            >
              <option value="all">All stores</option>
              {p.stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.store_name}
                </option>
              ))}
            </Select>
          </label>

          <div className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Date range
            </span>
            <div className="flex flex-wrap gap-1.5">
              {HISTORY_RANGES.map((range) => (
                <Button
                  key={range.value}
                  type="button"
                  variant={historyRange === range.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setHistoryRange(range.value)}
                >
                  {range.label}
                </Button>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-[11px] text-muted-foreground">From</span>
                <Input
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(event) => {
                    setCustomFrom(event.target.value)
                    setHistoryRange('custom')
                  }}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-muted-foreground">To</span>
                <Input
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(event) => {
                    setCustomTo(event.target.value)
                    setHistoryRange('custom')
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      </Section>

      {/* Price graph */}
      <Section
        eyebrow="Price history"
        title={historyScope}
        icon={<LineChartIcon className="h-4 w-4" />}
      >
        {logs.isLoading ? (
          <Skeleton className="h-80 w-full" />
        ) : (
          <PriceChart
            logs={historyLogs}
            stores={historyStores}
            symbol={symbol}
            displayMode={priceDisplayMode}
            locale={locale}
          />
        )}
      </Section>

      {/* Logs */}
      <Section
        eyebrow="Previous logs"
        title={`${historyLogs.length} entries`}
        hint="Follows the selected store and date range above."
      >
        {logs.isLoading ? (
          <Skeleton className="h-52 w-full" />
        ) : historyStoreId === 'all' ? (
          <StoreLogSections
            groups={historyLogGroups}
            stores={p.stores}
            symbol={symbol}
            displayMode={priceDisplayMode}
            locale={locale}
            localCurrency={localCurrency}
            exchangeRates={exchangeRates}
          />
        ) : (
          <LogsTable
            logs={historyLogs}
            stores={p.stores}
            symbol={symbol}
            displayMode={priceDisplayMode}
            locale={locale}
            localCurrency={localCurrency}
            exchangeRates={exchangeRates}
            showStoreColumn={false}
          />
        )}
      </Section>

      <p className="text-center text-xs text-muted-foreground">
        Created {formatApiDate(p.created_at, timezone)} · product #{p.id}
      </p>
    </div>
  )
}

/* ── Presentational helpers ────────────────────────────────────────────── */

function Section({
  eyebrow,
  title,
  icon,
  action,
  hint,
  children,
}: {
  eyebrow: string
  title: ReactNode
  icon?: ReactNode
  action?: ReactNode
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="gbd-glass overflow-hidden rounded-2xl border border-border/70 p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {icon ? (
            <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-md border border-border/60 bg-card/70 text-primary">
              {icon}
            </span>
          ) : null}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {eyebrow}
            </div>
            <div className="font-display text-sm font-bold tracking-tight">
              {title}
            </div>
          </div>
        </div>
        {action}
      </div>
      {hint ? <p className="-mt-2 mb-3 text-xs text-muted-foreground">{hint}</p> : null}
      {children}
    </section>
  )
}

function NumeralStat({
  label,
  icon,
  value,
  text,
  hint,
  loading,
  accent = false,
  tone = 'default',
}: {
  label: string
  icon: ReactNode
  value?: number
  text?: string
  hint?: string
  loading?: boolean
  accent?: boolean
  tone?: 'default' | 'success'
}) {
  return (
    <div className="gbd-spotlight gbd-hover-lift relative overflow-hidden rounded-2xl border border-border/70 p-5 hover:border-primary/25 hover:shadow-[var(--shadow-elevated)]">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            'grid h-7 w-7 place-items-center rounded-md border border-border/60 bg-card/70',
            tone === 'success' ? 'text-success' : 'text-muted-foreground',
          )}
        >
          {icon}
        </span>
      </div>
      <div className="mt-3">
        {loading ? (
          <Skeleton className="h-9 w-24" />
        ) : text != null ? (
          <span
            className={cn(
              'gbd-numeral block truncate text-2xl font-extrabold',
              accent && 'gbd-brand-text',
              tone === 'success' && 'text-success',
            )}
          >
            {text}
          </span>
        ) : (
          <AnimatedNumber
            value={value ?? null}
            accent={accent}
            className="text-3xl font-extrabold"
          />
        )}
      </div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function StoreLogSections({
  groups,
  stores,
  symbol,
  displayMode,
  locale,
  localCurrency,
  exchangeRates,
}: {
  groups: Array<{ store: ProductStoreSummary; logs: PriceLog[] }>
  stores: ProductStoreSummary[]
  symbol: string
  displayMode: 'regional' | 'source'
  locale: string
  localCurrency: string
  exchangeRates: Record<string, number>
}) {
  if (groups.length === 0) {
    return (
      <LogsTable
        logs={[]}
        stores={stores}
        symbol={symbol}
        displayMode={displayMode}
        locale={locale}
        localCurrency={localCurrency}
        exchangeRates={exchangeRates}
      />
    )
  }

  return (
    <div className="space-y-5">
      {groups.map(({ store, logs }) => (
        <section key={store.id} className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">{store.store_name}</div>
            <Badge variant="muted" className="text-[10px]">
              {logs.length} log{logs.length === 1 ? '' : 's'}
            </Badge>
          </div>
          <LogsTable
            logs={logs}
            stores={[store]}
            symbol={symbol}
            displayMode={displayMode}
            locale={locale}
            localCurrency={localCurrency}
            exchangeRates={exchangeRates}
            showStoreColumn={false}
          />
        </section>
      ))}
    </div>
  )
}

function resolveHistoryDates(
  range: HistoryRange,
  customFrom: string,
  customTo: string,
): { from: string | null; to: string | null } {
  if (range === 'all') return { from: null, to: null }
  if (range === 'today') {
    const today = todayInputDate()
    return { from: today, to: today }
  }
  if (range === '7d') return { from: dateDaysAgoInput(6), to: todayInputDate() }
  if (range === '30d') return { from: dateDaysAgoInput(29), to: todayInputDate() }
  if (range === '90d') return { from: dateDaysAgoInput(89), to: todayInputDate() }
  return {
    from: customFrom || null,
    to: customTo || null,
  }
}

function labelHistoryRange(
  range: HistoryRange,
  dates: { from: string | null; to: string | null },
): string {
  if (range === 'all') return 'all history'
  if (range === 'today') return 'today'
  if (range === 'custom') {
    if (dates.from && dates.to) return `${dates.from} to ${dates.to}`
    if (dates.from) return `from ${dates.from}`
    if (dates.to) return `until ${dates.to}`
    return 'custom range'
  }
  return HISTORY_RANGES.find((option) => option.value === range)?.label ?? 'history'
}

function todayInputDate(): string {
  return toInputDate(new Date())
}

function dateDaysAgoInput(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return toInputDate(date)
}

function toInputDate(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function LiveTimeLine({ iso }: { iso: string | null }) {
  const live = useLiveTime(iso)
  return (
    <span className={cn(iso ? '' : 'text-muted-foreground')}>
      {iso ? live : 'never scraped'}
    </span>
  )
}

interface DetailStats {
  low: number | null
  lowStore: ProductStoreSummary | null
  inStockStores: number
  bestDrop: number | null
  bestDropStore: ProductStoreSummary | null
}

function computeStats(
  p: Product,
  localCurrency: string,
  exchangeRates: Record<string, number>,
): DetailStats {
  let low: number | null = null
  let lowLocal: number | null = null
  let lowFallback: { value: number; store: ProductStoreSummary } | null = null
  let lowStore: ProductStoreSummary | null = null
  let inStockStores = 0
  let bestDrop: number | null = null
  let bestDropLocal: number | null = null
  let bestDropStore: ProductStoreSummary | null = null
  for (const s of p.stores) {
    const effective =
      s.manual_price ?? s.latest_discounted_price ?? s.latest_price
    if (effective != null) {
      if (lowFallback == null || effective < lowFallback.value) {
        lowFallback = { value: effective, store: s }
      }
      const localEffective = convertToLocalCurrency(effective, {
        sourceCurrency:
          s.manual_price != null && effective === s.manual_price
            ? null
            : s.latest_currency_code,
        localCurrency,
        exchangeRates,
      })
      if (localEffective != null && (lowLocal == null || localEffective < lowLocal)) {
        low = effective
        lowLocal = localEffective
        lowStore = s
      }
    }
    const stock = s.manual_stock_status ?? s.latest_stock_status
    if (stock === 'in_stock' || stock === 'limited') inStockStores += 1
    if (
      s.latest_price_delta != null &&
      s.latest_price_delta < 0 &&
      (bestDrop == null ||
        (convertToLocalCurrency(s.latest_price_delta, {
          sourceCurrency: s.latest_currency_code,
          localCurrency,
          exchangeRates,
        }) ?? s.latest_price_delta) < (bestDropLocal ?? bestDrop))
    ) {
      bestDrop = s.latest_price_delta
      bestDropLocal =
        convertToLocalCurrency(s.latest_price_delta, {
          sourceCurrency: s.latest_currency_code,
          localCurrency,
          exchangeRates,
        }) ?? s.latest_price_delta
      bestDropStore = s
    }
  }
  if (low == null && lowFallback != null) {
    low = lowFallback.value
    lowStore = lowFallback.store
  }
  return { low, lowStore, inStockStores, bestDrop, bestDropStore }
}

function formatStorePrice(
  value: number,
  store: ProductStoreSummary,
  options: {
    symbol: string
    mode: 'regional' | 'source'
    locale: string
    localCurrency: string
    exchangeRates: Record<string, number>
  },
): string {
  const raw =
    store.latest_discounted_price != null && value === store.latest_discounted_price
      ? store.latest_raw_discounted
      : store.latest_raw_price
  const source = formatDisplayMoney(value, {
    symbol: options.symbol,
    mode: options.mode,
    currencyCode: store.latest_currency_code,
    raw,
    locale: options.locale,
  })
  const local = formatLocalEquivalent(value, {
    sourceCurrency: store.latest_currency_code,
    localCurrency: options.localCurrency,
    exchangeRates: options.exchangeRates,
    symbol: options.symbol,
  })
  return local ?? source
}

function mostRecentScrape(p: Product): string | null {
  let newest: string | null = null
  let newestMs = -Infinity
  for (const s of p.stores) {
    if (!s.latest_scraped_at) continue
    const scrapedAt = parseApiDate(s.latest_scraped_at)?.getTime()
    if (scrapedAt == null || Number.isNaN(scrapedAt)) continue
    if (scrapedAt > newestMs) {
      newest = s.latest_scraped_at
      newestMs = scrapedAt
    }
  }
  return newest
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  )
}

function ErrorState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/70 p-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}
