import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ExternalLink,
  FileText,
  Flame,
  Pencil,
  ShieldCheck,
  Store as StoreIcon,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast-store'
import { EditProductCard } from './EditProductCard'
import { StockPill } from './StockPill'
import { cn, formatMoney, formatRelativeTime } from '@/lib/utils'
import { productsApi } from '@/api'
import type { Product, ProductStoreSummary, StockStatus } from '@/api'

interface ProductTileProps {
  product: Product
  symbol: string
}

interface PriceSummary {
  value: number
  storeName: string
}

function effectiveRetailPrice(store: ProductStoreSummary): number | null {
  return (
    store.manual_price ??
    store.latest_discounted_price ??
    store.latest_price ??
    null
  )
}

function effectiveStockStatus(store: ProductStoreSummary): StockStatus | null {
  return store.manual_stock_status ?? store.latest_stock_status
}

function effectiveWarranty(store: ProductStoreSummary): string | null {
  return store.manual_warranty ?? store.latest_warranty ?? null
}

function lowestRetailPrice(product: Product): PriceSummary | null {
  let low: PriceSummary | null = null
  for (const store of product.stores) {
    if (!store.is_active) continue
    const value = effectiveRetailPrice(store)
    if (value == null) continue
    if (low == null || value < low.value) {
      low = { value, storeName: store.store_name }
    }
  }
  return low
}

function lowestDealerPrice(product: Product): PriceSummary | null {
  let low: PriceSummary | null = null
  for (const store of product.stores) {
    if (!store.is_active || store.latest_dealer_price == null) continue
    if (low == null || store.latest_dealer_price < low.value) {
      low = { value: store.latest_dealer_price, storeName: store.store_name }
    }
  }
  return low
}

function summaryStockStatus(product: Product): StockStatus {
  const statuses = product.stores.map(effectiveStockStatus).filter(Boolean)
  if (statuses.includes('in_stock')) return 'in_stock'
  if (statuses.includes('limited')) return 'limited'
  if (statuses.includes('preorder')) return 'preorder'
  if (statuses.includes('backorder')) return 'backorder'
  if (statuses.includes('call_for_price')) return 'call_for_price'
  if (statuses.includes('contact_store')) return 'contact_store'
  if (statuses.includes('out_of_stock')) return 'out_of_stock'
  if (statuses.includes('discontinued')) return 'discontinued'
  return 'unknown'
}

function firstWarranty(product: Product): string | null {
  const match = product.stores.find((store) => effectiveWarranty(store))
  return match ? effectiveWarranty(match) : null
}

export function ProductTile({ product, symbol }: ProductTileProps) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [editing, setEditing] = useState(false)

  const retail = lowestRetailPrice(product)
  const dealer = lowestDealerPrice(product)
  const warranty = firstWarranty(product)
  const stock = summaryStockStatus(product)
  const supplierCount = product.stores.length

  const remove = useMutation({
    mutationFn: () => productsApi.remove(product.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['activity'] })
      toast.info('Product deleted')
    },
    onError: () => toast.error('Delete failed'),
  })

  return (
    <article className="gbd-glass group/product overflow-hidden rounded-xl border border-border/80 shadow-sm transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[var(--shadow-elevated)]">
      <div className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-4">
        <div className="min-w-0 flex-1">
          <Link
            to={`/product/${product.id}`}
            className="line-clamp-2 text-sm font-black uppercase tracking-tight text-foreground transition-colors hover:text-primary hover:underline sm:text-base"
          >
            {product.canonical_name}
          </Link>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StockPill status={stock} />

            {product.category_name ? (
              <Badge
                variant={product.category_color ? 'outline' : 'info'}
                className="bg-sky-500/15 text-sky-700 dark:text-sky-300"
                style={
                  product.category_color
                    ? {
                        borderColor: product.category_color,
                        color: product.category_color,
                      }
                    : undefined
                }
              >
                {product.category_name}
              </Badge>
            ) : null}

            {warranty ? (
              <Badge
                variant="info"
                className="max-w-full gap-1 bg-blue-500/15 text-blue-700 dark:text-blue-300"
                title={warranty}
              >
                <ShieldCheck className="h-3 w-3" />
                <span className="truncate">{warranty}</span>
              </Badge>
            ) : null}

            {retail ? (
              <Badge
                variant="secondary"
                className="bg-violet-500/15 font-semibold text-violet-800 dark:text-violet-200"
                title={`Lowest retail at ${retail.storeName}`}
              >
                Retail: {formatMoney(retail.value, symbol)}
              </Badge>
            ) : null}

            {dealer ? (
              <Badge
                variant="success"
                className="gap-1 font-semibold"
                title={`Lowest dealer at ${dealer.storeName}`}
              >
                Dealer: {formatMoney(dealer.value, symbol)}
                <Flame className="h-3 w-3 text-amber-500" />
              </Badge>
            ) : null}

            <Badge variant="muted" className="gap-1 font-semibold">
              <StoreIcon className="h-3 w-3" />
              {supplierCount} {supplierCount === 1 ? 'Supplier' : 'Suppliers'}
            </Badge>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDetailsOpen((open) => !open)
              if (editing) setEditing(false)
            }}
          >
            {detailsOpen ? 'Hide' : 'Details'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-primary"
            onClick={() => {
              setEditing((open) => !open)
              if (detailsOpen) setDetailsOpen(false)
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-primary"
            onClick={() => navigate(`/product/${product.id}`)}
          >
            <FileText className="h-3.5 w-3.5" />
            Log
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (confirm(`Delete "${product.canonical_name}" and all its data?`)) {
                remove.mutate()
              }
            }}
            disabled={remove.isPending}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Trash
          </Button>
        </div>
      </div>

      {detailsOpen ? (
        <div className="gbd-expand border-t border-dashed border-border/80 bg-card/25 px-3 py-3 sm:px-4">
          {product.stores.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              No suppliers linked yet.
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {product.stores.map((store) => (
                <SupplierCard
                  key={store.id}
                  store={store}
                  symbol={symbol}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}

      {editing ? (
        <div className="gbd-expand border-t border-dashed border-border/80 bg-muted/20 px-3 py-3 sm:px-4">
          <EditProductCard product={product} onClose={() => setEditing(false)} />
        </div>
      ) : null}
    </article>
  )
}

function SupplierCard({
  store,
  symbol,
}: {
  store: ProductStoreSummary
  symbol: string
}) {
  const retail = effectiveRetailPrice(store)
  const dealer = store.latest_dealer_price
  const stock = effectiveStockStatus(store)
  const canOpenUrl = /^https?:\/\//i.test(store.product_url)

  return (
    <div className="rounded-lg border border-border/80 bg-card/55 p-2.5 text-xs shadow-sm transition-[transform,border-color,background-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:bg-accent/35 hover:shadow-[var(--shadow-soft)]">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          {canOpenUrl ? (
            <a
              href={store.product_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-full items-center gap-1 truncate font-semibold text-primary hover:underline"
            >
              <span className="truncate">{store.store_name}</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          ) : (
            <span className="block truncate font-semibold text-primary">
              {store.store_name}
            </span>
          )}
      <div className="mt-1 text-[11px] text-muted-foreground">
            {store.store_manual_only
              ? 'Manual source'
              : isInternalProductUrl(store.product_url)
                ? 'No website URL yet'
                : safeHost(store.product_url)}
          </div>
        </div>
        <StockPill status={stock} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
        <span>
          R:{' '}
          <strong className={cn(retail == null && 'text-muted-foreground')}>
            {retail != null ? formatMoney(retail, symbol) : '-'}
          </strong>
        </span>
        <span className="text-muted-foreground">|</span>
        <span>
          D:{' '}
          <strong className={cn(dealer == null && 'text-muted-foreground')}>
            {dealer != null ? formatMoney(dealer, symbol) : '-'}
          </strong>
        </span>
      </div>

      {effectiveWarranty(store) ? (
        <div className="mt-1 truncate text-[11px] text-muted-foreground">
          Warranty: {effectiveWarranty(store)}
        </div>
      ) : null}

      <div className="mt-2 text-[11px] text-muted-foreground">
        Updated {formatRelativeTime(store.latest_scraped_at)}
      </div>
    </div>
  )
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url || 'manual'
  }
}

function isInternalProductUrl(url: string): boolean {
  return /^(?:import|manual):\/\//i.test(url)
}
