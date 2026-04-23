import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Boxes,
  CheckCircle2,
  Clock,
  ExternalLink,
  Globe,
  Plus,
  RefreshCw,
  Store as StoreIcon,
  Trash2,
  TrendingDown,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { BentoGrid, BentoTile, TileHeader } from '@/components/ui/bento'
import { StatTile } from '@/components/ui/stat-tile'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast-store'
import { storesApi, productsApi } from '@/api'
import { useLiveTime } from '@/hooks/useLiveTime'
import { useNow } from '@/hooks/useNow'
import type { Product, Store } from '@/api'

interface StoreAggregate {
  store: Store
  productCount: number
  inStockCount: number
  dropsCount: number
  lastScrapedAt: string | null
  hostname: string
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function computeAggregates(
  stores: Store[],
  products: Product[],
): StoreAggregate[] {
  const byId = new Map<number, StoreAggregate>()
  for (const s of stores) {
    byId.set(s.id, {
      store: s,
      productCount: 0,
      inStockCount: 0,
      dropsCount: 0,
      lastScrapedAt: null,
      hostname: hostnameOf(s.base_url),
    })
  }
  for (const p of products) {
    for (const link of p.stores) {
      const agg = byId.get(link.store_id)
      if (!agg) continue
      agg.productCount += 1
      const status = link.manual_stock_status ?? link.latest_stock_status
      if (status === 'in_stock' || status === 'limited') agg.inStockCount += 1
      if (link.latest_price_delta != null && link.latest_price_delta < 0) {
        agg.dropsCount += 1
      }
      if (
        link.latest_scraped_at &&
        (!agg.lastScrapedAt || link.latest_scraped_at > agg.lastScrapedAt)
      ) {
        agg.lastScrapedAt = link.latest_scraped_at
      }
    }
  }
  return Array.from(byId.values()).sort(
    (a, b) => b.productCount - a.productCount,
  )
}

export function StoresPage() {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')

  const stores = useQuery<Store[]>({
    queryKey: ['stores'],
    queryFn: () => storesApi.list(),
  })

  const products = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: () => productsApi.list(),
  })

  const aggregates = useMemo(
    () => computeAggregates(stores.data ?? [], products.data ?? []),
    [stores.data, products.data],
  )
  const now = useNow()

  const totals = useMemo(() => {
    let productLinks = 0
    let inStock = 0
    let recentlyScraped = 0
    const cutoff = now - 24 * 60 * 60_000
    for (const a of aggregates) {
      productLinks += a.productCount
      inStock += a.inStockCount
      if (a.lastScrapedAt && new Date(a.lastScrapedAt).getTime() > cutoff) {
        recentlyScraped += 1
      }
    }
    return { productLinks, inStock, recentlyScraped }
  }, [aggregates, now])

  const create = useMutation({
    mutationFn: () =>
      storesApi.create({ name: name.trim(), base_url: baseUrl.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stores'] })
      setName('')
      setBaseUrl('')
      setAdding(false)
      toast.success('Store added')
    },
    onError: () => toast.error('Could not add store'),
  })

  const remove = useMutation({
    mutationFn: (id: number) => storesApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stores'] })
      qc.invalidateQueries({ queryKey: ['products'] })
      toast.info('Store removed')
    },
    onError: () => toast.error('Delete failed'),
  })

  const syncWoo = useMutation({
    mutationFn: (id: number) => storesApi.syncWoo(id),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['stores'] })
      qc.invalidateQueries({ queryKey: ['products'] })
      toast.success(
        `${result.store_name} synced`,
        result.auto_import_new
          ? `Created ${result.created} new Woo products from ${result.discovered} catalog items.`
          : `Checked ${result.discovered} Woo catalog items. Auto-add is currently off.`,
      )
    },
    onError: (error) => {
      const detail =
        error instanceof Error ? error.message : 'Could not sync Woo catalog'
      toast.error('Woo sync failed', detail)
    },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stores"
        description="Shops you track. Per-store health and coverage at a glance."
        actions={
          <Button size="sm" onClick={() => setAdding((v) => !v)}>
            <Plus className="h-4 w-4" />
            {adding ? 'Close' : 'Add store'}
          </Button>
        }
      />

      <BentoGrid cols={6}>
        <StatTile
          label="Stores"
          value={aggregates.length}
          icon={<StoreIcon className="h-4 w-4" />}
          hint="tracked shops"
          loading={stores.isLoading}
          tone="primary"
        />
        <StatTile
          label="Product links"
          value={totals.productLinks}
          icon={<Boxes className="h-4 w-4" />}
          hint="across all stores"
          loading={products.isLoading}
        />
        <StatTile
          label="In stock"
          value={totals.inStock}
          icon={<CheckCircle2 className="h-4 w-4" />}
          hint="live availability"
          tone="success"
          loading={products.isLoading}
        />
        <StatTile
          label="Scraped today"
          value={totals.recentlyScraped}
          icon={<Clock className="h-4 w-4" />}
          hint="last 24h"
          tone="accent"
          loading={products.isLoading}
        />

        {adding ? (
          <BentoTile colSpan={6} tone="primary">
            <TileHeader
              eyebrow="New source"
              title="Add store"
              icon={<Globe className="h-4 w-4" />}
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="store-name">Name</Label>
                <Input
                  id="store-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Example Shop"
                  disabled={create.isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="store-url">Base URL</Label>
                <Input
                  id="store-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://shop.example.com"
                  disabled={create.isPending}
                />
              </div>
              <div className="flex items-end gap-2">
                <Button
                  size="sm"
                  onClick={() => create.mutate()}
                  disabled={
                    create.isPending || !name.trim() || !baseUrl.trim()
                  }
                >
                  Save
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAdding(false)
                    setName('')
                    setBaseUrl('')
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </BentoTile>
        ) : null}
      </BentoGrid>

      {stores.isLoading ? (
        <LoadingGrid />
      ) : stores.isError ? (
        <EmptyState text="Failed to load stores." />
      ) : aggregates.length === 0 ? (
        <EmptyState
          text="No stores yet."
          cta={
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              Add your first
            </Button>
          }
        />
      ) : (
        <BentoGrid cols={6} className="md:grid-cols-2 lg:grid-cols-3">
          {aggregates.map((agg) => (
            <StoreTile
              key={agg.store.id}
              agg={agg}
              onSyncWoo={
                agg.store.woo_enabled
                  ? () => syncWoo.mutate(agg.store.id)
                  : undefined
              }
              syncingWoo={syncWoo.isPending}
              onDelete={() => {
                if (
                  confirm(
                    `Remove "${agg.store.name}"? Linked product rows will fail.`,
                  )
                ) {
                  remove.mutate(agg.store.id)
                }
              }}
              deleting={remove.isPending}
            />
          ))}
        </BentoGrid>
      )}
    </div>
  )
}

interface StoreTileProps {
  agg: StoreAggregate
  onSyncWoo?: () => void
  syncingWoo: boolean
  onDelete: () => void
  deleting: boolean
}

function StoreTile({ agg, onSyncWoo, syncingWoo, onDelete, deleting }: StoreTileProps) {
  const live = useLiveTime(agg.lastScrapedAt)
  const wooLive = useLiveTime(agg.store.woo_last_synced_at)
  const { store, productCount, inStockCount, dropsCount } = agg
  const coverage =
    productCount > 0 ? Math.round((inStockCount / productCount) * 100) : 0

  return (
    <BentoTile interactive>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent/60 text-accent-foreground">
              <StoreIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{store.name}</div>
              <a
                href={store.base_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 truncate text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {agg.hostname}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onDelete}
          disabled={deleting}
          title="Delete"
          className="shrink-0"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>

      {store.woo_enabled ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            Woo sync on
          </Badge>
          <Badge variant="muted" className="text-[10px]">
            {store.woo_auto_import_new ? 'auto-add new items' : 'catalog check only'}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={onSyncWoo}
            disabled={syncingWoo || !onSyncWoo}
            className="h-7 px-2 text-[11px]"
          >
            {syncingWoo ? (
              <LoaderIcon />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Sync now
          </Button>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        <StoreStat
          value={productCount}
          label="products"
          icon={<Boxes className="h-3.5 w-3.5" />}
        />
        <StoreStat
          value={inStockCount}
          label="in stock"
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          accent={inStockCount > 0 ? 'success' : undefined}
        />
        <StoreStat
          value={dropsCount}
          label="drops"
          icon={<TrendingDown className="h-3.5 w-3.5" />}
          accent={dropsCount > 0 ? 'accent' : undefined}
        />
      </div>

      {productCount > 0 ? (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-[width] duration-500"
              style={{ width: `${coverage}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {coverage}% availability
          </p>
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-[11px] text-muted-foreground">
        <div className="space-y-1">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {agg.lastScrapedAt ? live : 'never scraped'}
          </span>
          {store.woo_enabled ? (
            <div className="inline-flex items-center gap-1">
              <RefreshCw className="h-3 w-3" />
              {store.woo_last_synced_at ? wooLive : 'never synced'}
            </div>
          ) : null}
        </div>
        {productCount === 0 ? (
          <Badge variant="muted" className="text-[10px]">
            unused
          </Badge>
        ) : null}
      </div>
    </BentoTile>
  )
}

function LoaderIcon() {
  return <RefreshCw className="h-3.5 w-3.5 animate-spin" />
}

interface StoreStatProps {
  value: number
  label: string
  icon: React.ReactNode
  accent?: 'success' | 'accent'
}

function StoreStat({ value, label, icon, accent }: StoreStatProps) {
  const tone =
    accent === 'success'
      ? 'text-emerald-500'
      : accent === 'accent'
        ? 'text-primary'
        : 'text-foreground'
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`inline-flex items-center gap-1 text-lg font-semibold tabular-nums ${tone}`}>
        {icon}
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  )
}

function LoadingGrid() {
  return (
    <BentoGrid cols={6} className="md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <BentoTile key={i}>
          <Skeleton className="h-8 w-1/2" />
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
          <Skeleton className="mt-4 h-1.5" />
        </BentoTile>
      ))}
    </BentoGrid>
  )
}

interface EmptyStateProps {
  text: string
  cta?: React.ReactNode
}

function EmptyState({ text, cta }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
      {cta}
    </div>
  )
}
