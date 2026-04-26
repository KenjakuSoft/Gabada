import { useMemo, useState } from 'react'
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
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { BentoGrid, BentoTile, TileHeader } from '@/components/ui/bento'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { StatTile } from '@/components/ui/stat-tile'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast-store'
import { StoreRow } from '@/components/products/StoreRow'
import { AddStoreCard } from '@/components/products/AddStoreCard'
import { EditProductCard } from '@/components/products/EditProductCard'
import { PriceChart } from '@/components/products/PriceChart'
import { LogsTable } from '@/components/products/LogsTable'
import { logsApi, productsApi, scraperApi } from '@/api'
import { useCurrencySymbol } from '@/hooks/useSettings'
import { useLiveTime } from '@/hooks/useLiveTime'
import type { PriceLog, Product } from '@/api'
import { cn } from '@/lib/utils'

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

  const scrapeAll = useMutation({
    mutationFn: async () => {
      const stores = product.data?.stores ?? []
      await Promise.all(stores.map((s) => scraperApi.scrapeOne(s.id)))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product', productId] })
      qc.invalidateQueries({ queryKey: ['product-logs', productId] })
      qc.invalidateQueries({ queryKey: ['products'] })
      toast.success('Scrape complete', 'All stores refreshed')
    },
    onError: () => toast.error('Scrape failed'),
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
  const stats = computeStats(p)
  const recent = mostRecentScrape(p)
  const selectedHistoryStore =
    historyStoreId === 'all'
      ? null
      : p.stores.find((store) => String(store.id) === historyStoreId)
  const historyScope = selectedHistoryStore?.store_name ?? 'All stores'
  const historyRangeLabel = labelHistoryRange(historyRange, historyDates)

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/')}
          className="-ml-2 mb-3 text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <PageHeader
          title={p.canonical_name}
          description={
            p.category_name ? `Category: ${p.category_name}` : 'Uncategorized'
          }
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing((v) => !v)}
              >
                <Pencil className="h-4 w-4" />
                {editing ? 'Close edit' : 'Edit'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => scrapeAll.mutate()}
                disabled={scrapeAll.isPending || p.stores.length === 0}
              >
                <RefreshCw
                  className={`h-4 w-4 ${scrapeAll.isPending ? 'animate-spin' : ''}`}
                />
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
            </>
          }
        />
      </div>

      {editing ? (
        <EditProductCard product={p} onClose={() => setEditing(false)} />
      ) : null}

      <BentoGrid cols={6}>
        <BentoTile colSpan={2} rowSpan={2} padded={false} className="overflow-hidden">
          <div className="flex h-full flex-col">
            <div className="relative flex-1 min-h-[260px] bg-gradient-to-br from-muted/80 to-muted/30">
              {p.image_url ? (
                <img
                  src={p.image_url}
                  alt=""
                  className="absolute inset-0 h-full w-full object-contain p-6"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <ImageOff className="h-12 w-12 text-muted-foreground/50" />
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 space-y-1 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-4">
                <div className="line-clamp-2 text-sm font-semibold text-white">
                  {p.canonical_name}
                </div>
                {p.category_name ? (
                  <Badge
                    variant="outline"
                    className="border-white/40 bg-black/30 text-white"
                    style={
                      p.category_color
                        ? { borderColor: p.category_color, color: p.category_color }
                        : undefined
                    }
                  >
                    {p.category_name}
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>
        </BentoTile>

        <StatTile
          label="Lowest price"
          value={stats.low}
          decimals={2}
          prefix={stats.low != null ? symbol : undefined}
          icon={<Tag className="h-4 w-4" />}
          hint={stats.lowStore ? `at ${stats.lowStore}` : undefined}
          tone="primary"
        />
        <StatTile
          label="Stores"
          value={p.stores.length}
          icon={<Boxes className="h-4 w-4" />}
          hint={`${stats.inStockStores} in stock`}
        />
        <StatTile
          label="Logs"
          value={logs.data?.length ?? 0}
          icon={<LineChartIcon className="h-4 w-4" />}
          loading={logs.isLoading}
          hint="price snapshots"
        />
        <StatTile
          label="Latest drop"
          value={stats.bestDrop}
          decimals={2}
          prefix={stats.bestDrop != null ? symbol : undefined}
          icon={<TrendingDown className="h-4 w-4" />}
          tone="success"
          hint={stats.bestDrop != null ? 'vs previous' : 'no drops'}
        />

        <BentoTile colSpan={4}>
          <TileHeader
            eyebrow="Last activity"
            icon={<Clock className="h-4 w-4" />}
            title={<LiveTimeLine iso={recent} />}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Created {new Date(p.created_at).toLocaleDateString()} · #{p.id}
          </p>
        </BentoTile>
      </BentoGrid>

      <BentoGrid cols={6}>
        <BentoTile colSpan={6}>
          <TileHeader
            eyebrow="Stores"
            title={`${p.stores.length} linked`}
          />
          <div className="mt-3 space-y-1.5">
            {p.stores.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No stores linked yet.
              </div>
            ) : (
              p.stores.map((s) => (
                <StoreRow
                  key={s.id}
                  store={s}
                  symbol={symbol}
                  productId={p.id}
                />
              ))
            )}
            <div className="pt-2">
              <AddStoreCard productId={p.id} />
            </div>
          </div>
        </BentoTile>

        <BentoTile colSpan={6}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <TileHeader
                eyebrow="History controls"
                title={`${historyScope} - ${historyRangeLabel}`}
                icon={<CalendarDays className="h-4 w-4" />}
              />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="muted">{historyLogs.length} logs</Badge>
                {logs.isFetching ? <Badge variant="info">Refreshing</Badge> : null}
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(180px,260px)_1fr]">
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
                  Date selection
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
          </div>
        </BentoTile>

        <BentoTile colSpan={6}>
          <TileHeader
            eyebrow="Price graph"
            title={historyScope}
            icon={<LineChartIcon className="h-4 w-4" />}
          />
          <div className="mt-3">
            {logs.isLoading ? (
              <Skeleton className="h-80 w-full" />
            ) : (
              <PriceChart
                logs={historyLogs}
                stores={historyStores}
                symbol={symbol}
              />
            )}
          </div>
        </BentoTile>

        <BentoTile colSpan={6}>
          <TileHeader
            eyebrow="Previous logs"
            title={`${historyLogs.length} entries`}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Logs below follow the selected store and date range above.
          </p>
          <div className="mt-3">
            {logs.isLoading ? (
              <Skeleton className="h-52 w-full" />
            ) : (
              <LogsTable
                logs={historyLogs}
                stores={p.stores}
                symbol={symbol}
              />
            )}
          </div>
        </BentoTile>
      </BentoGrid>
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
  lowStore: string | null
  inStockStores: number
  bestDrop: number | null
}

function computeStats(p: Product): DetailStats {
  let low: number | null = null
  let lowStore: string | null = null
  let inStockStores = 0
  let bestDrop: number | null = null
  for (const s of p.stores) {
    const effective =
      s.manual_price ?? s.latest_discounted_price ?? s.latest_price
    if (effective != null && (low == null || effective < low)) {
      low = effective
      lowStore = s.store_name
    }
    const stock = s.manual_stock_status ?? s.latest_stock_status
    if (stock === 'in_stock' || stock === 'limited') inStockStores += 1
    if (
      s.latest_price_delta != null &&
      s.latest_price_delta < 0 &&
      (bestDrop == null || s.latest_price_delta < bestDrop)
    ) {
      bestDrop = s.latest_price_delta
    }
  }
  return { low, lowStore, inStockStores, bestDrop }
}

function mostRecentScrape(p: Product): string | null {
  let newest: string | null = null
  for (const s of p.stores) {
    if (!s.latest_scraped_at) continue
    if (!newest || s.latest_scraped_at > newest) newest = s.latest_scraped_at
  }
  return newest
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <BentoGrid cols={6}>
        <BentoTile colSpan={2} rowSpan={2} padded={false}>
          <Skeleton className="h-full w-full min-h-[220px] rounded-none" />
        </BentoTile>
        {Array.from({ length: 4 }).map((_, i) => (
          <BentoTile key={i}>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-4 h-8 w-32" />
          </BentoTile>
        ))}
      </BentoGrid>
    </div>
  )
}

function ErrorState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}

