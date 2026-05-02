import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Activity as ActivityIcon,
  CircleDot,
  ExternalLink,
  FileText,
  Flame,
  Pencil,
  Radio,
  ShieldCheck,
  Store as StoreIcon,
  TrendingDown,
  TrendingUp,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast-store'
import { EditProductCard } from './EditProductCard'
import { StockPill } from './StockPill'
import {
  cn,
  convertToLocalCurrency,
  formatDisplayMoney,
  formatLocalEquivalent,
  formatRelativeTime,
} from '@/lib/utils'
import type { PriceDisplayMode } from '@/lib/utils'
import { productsApi } from '@/api'
import type { Product, ProductStoreSummary, StockStatus } from '@/api'

interface ProductTileProps {
  product: Product
  symbol: string
  displayMode?: PriceDisplayMode
  locale?: string
  localCurrency: string
  exchangeRates: Record<string, number>
}

interface PriceSummary {
  value: number
  localValue: number | null
  store: ProductStoreSummary
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

function sourceCurrencyForRetail(store: ProductStoreSummary, value: number): string | null {
  if (store.manual_price != null && value === store.manual_price) return null
  return store.latest_currency_code
}

function localComparablePrice(
  value: number,
  sourceCurrency: string | null,
  localCurrency: string,
  exchangeRates: Record<string, number>,
): number | null {
  return convertToLocalCurrency(value, {
    sourceCurrency,
    localCurrency,
    exchangeRates,
  })
}

function lowestRetailPrice(
  product: Product,
  localCurrency: string,
  exchangeRates: Record<string, number>,
): PriceSummary | null {
  let low: PriceSummary | null = null
  let fallback: PriceSummary | null = null
  for (const store of product.stores) {
    if (!store.is_active) continue
    const value = effectiveRetailPrice(store)
    if (value == null) continue
    const sourceCurrency = sourceCurrencyForRetail(store, value)
    const localValue = localComparablePrice(
      value,
      sourceCurrency,
      localCurrency,
      exchangeRates,
    )
    if (fallback == null || value < fallback.value) {
      fallback = { value, localValue, store }
    }
    if (localValue == null) continue
    if (low == null || localValue < (low.localValue ?? low.value)) {
      low = { value, localValue, store }
    }
  }
  return low ?? fallback
}

function lowestDealerPrice(
  product: Product,
  localCurrency: string,
  exchangeRates: Record<string, number>,
): PriceSummary | null {
  let low: PriceSummary | null = null
  let fallback: PriceSummary | null = null
  for (const store of product.stores) {
    if (!store.is_active || store.latest_dealer_price == null) continue
    const localValue = localComparablePrice(
      store.latest_dealer_price,
      store.latest_currency_code,
      localCurrency,
      exchangeRates,
    )
    if (fallback == null || store.latest_dealer_price < fallback.value) {
      fallback = { value: store.latest_dealer_price, localValue, store }
    }
    if (localValue == null) continue
    if (low == null || localValue < (low.localValue ?? low.value)) {
      low = { value: store.latest_dealer_price, localValue, store }
    }
  }
  return low ?? fallback
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

export function ProductTile({
  product,
  symbol,
  displayMode = 'regional',
  locale,
  localCurrency,
  exchangeRates,
}: ProductTileProps) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [editing, setEditing] = useState(false)

  const retail = lowestRetailPrice(product, localCurrency, exchangeRates)
  const dealer = lowestDealerPrice(product, localCurrency, exchangeRates)
  const retailLocal =
    retail != null
      ? formatRetailLocalEquivalent(retail.value, retail.store, {
          symbol,
          localCurrency,
          exchangeRates,
        })
      : null
  const dealerLocal =
    dealer != null
      ? formatDealerLocalEquivalent(dealer.value, dealer.store, {
          symbol,
          localCurrency,
          exchangeRates,
        })
      : null
  const warranty = firstWarranty(product)
  const stock = summaryStockStatus(product)
  const supplierCount = product.stores.length
  const changes = productChangeSummary(product)

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

            <Badge variant="muted" className="gap-1 font-semibold">
              <StoreIcon className="h-3 w-3" />
              {supplierCount} {supplierCount === 1 ? 'Supplier' : 'Suppliers'}
            </Badge>
          </div>

          {retail || dealer ? (
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
              {retail ? (
                <SummaryPriceBlock
                  label="Retail"
                  value={formatRetailPrice(retail.value, retail.store, {
                    symbol,
                    displayMode,
                    locale,
                    localCurrency,
                    exchangeRates,
                  })}
                  localValue={retailLocal}
                  title={`Lowest retail at ${retail.store.store_name}`}
                />
              ) : null}
              {dealer ? (
                <SummaryPriceBlock
                  label="Dealer"
                  value={formatDealerPrice(dealer.value, dealer.store, {
                    symbol,
                    displayMode,
                    locale,
                    localCurrency,
                    exchangeRates,
                  })}
                  localValue={dealerLocal}
                  tone="dealer"
                  icon={<Flame className="h-3 w-3 text-amber-500" />}
                  title={`Lowest dealer at ${dealer.store.store_name}`}
                />
              ) : null}
            </div>
          ) : null}

          {changes.length ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {changes.map((change) => {
                const Icon = change.icon
                return (
                  <Badge
                    key={change.key}
                    variant={change.variant}
                    className="gap-1.5 text-[10px]"
                    title={change.title}
                  >
                    <Icon className="h-3 w-3" />
                    {change.label}
                  </Badge>
                )
              })}
            </div>
          ) : null}
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
                  displayMode={displayMode}
                  locale={locale}
                  localCurrency={localCurrency}
                  exchangeRates={exchangeRates}
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
  displayMode = 'regional',
  locale,
  localCurrency,
  exchangeRates,
}: {
  store: ProductStoreSummary
  symbol: string
  displayMode?: PriceDisplayMode
  locale?: string
  localCurrency: string
  exchangeRates: Record<string, number>
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

      <div className="mt-2 space-y-1 tabular-nums">
        <SupplierPriceBlock
          label="Retail"
          value={
            retail != null
              ? formatRetailPrice(retail, store, {
                  symbol,
                  displayMode,
                  locale,
                  localCurrency,
                  exchangeRates,
                })
              : null
          }
          localValue={
            retail != null
              ? formatRetailLocalEquivalent(retail, store, {
                  symbol,
                  localCurrency,
                  exchangeRates,
                })
              : null
          }
        />
        <SupplierPriceBlock
          label="Dealer"
          value={
            dealer != null
              ? formatDealerPrice(dealer, store, {
                  symbol,
                  displayMode,
                  locale,
                  localCurrency,
                  exchangeRates,
                })
              : null
          }
          localValue={
            dealer != null
              ? formatDealerLocalEquivalent(dealer, store, {
                  symbol,
                  localCurrency,
                  exchangeRates,
                })
              : null
          }
          tone="dealer"
        />
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

interface ProductChangeIndicator {
  key: string
  label: string
  title: string
  icon: LucideIcon
  variant: 'success' | 'warning' | 'info' | 'destructive' | 'outline' | 'muted'
}

function productChangeSummary(product: Product): ProductChangeIndicator[] {
  let drops = 0
  let rises = 0
  let stock = 0
  let firstScrapes = 0
  let other = 0
  let latestAt: string | null = null

  for (const store of product.stores) {
    const change = store.latest_change_type
    if (!change || change === 'no_change') continue
    if (
      !latestAt ||
      (store.latest_scraped_at &&
        new Date(store.latest_scraped_at).getTime() > new Date(latestAt).getTime())
    ) {
      latestAt = store.latest_scraped_at
    }
    if (change === 'price_down' || (change === 'price_and_stock' && (store.latest_price_delta ?? 0) < 0)) {
      drops += 1
    } else if (change === 'price_up' || (change === 'price_and_stock' && (store.latest_price_delta ?? 0) > 0)) {
      rises += 1
    }
    if (
      change === 'stock_in' ||
      change === 'stock_out' ||
      change === 'stock_change' ||
      change === 'price_and_stock'
    ) {
      stock += 1
    } else if (change === 'new') {
      firstScrapes += 1
    } else if (change !== 'price_down' && change !== 'price_up') {
      other += 1
    }
  }

  const suffix = latestAt ? `; latest ${formatRelativeTime(latestAt)}` : ''
  const indicators: ProductChangeIndicator[] = []
  if (drops > 0) {
    indicators.push({
      key: 'drops',
      label: `${drops} price ${drops === 1 ? 'drop' : 'drops'}`,
      title: `Latest scrape found ${drops} price ${drops === 1 ? 'drop' : 'drops'}${suffix}`,
      icon: TrendingDown,
      variant: 'success',
    })
  }
  if (rises > 0) {
    indicators.push({
      key: 'rises',
      label: `${rises} price ${rises === 1 ? 'rise' : 'rises'}`,
      title: `Latest scrape found ${rises} price ${rises === 1 ? 'rise' : 'rises'}${suffix}`,
      icon: TrendingUp,
      variant: 'destructive',
    })
  }
  if (stock > 0) {
    indicators.push({
      key: 'stock',
      label: `${stock} stock ${stock === 1 ? 'change' : 'changes'}`,
      title: `Latest scrape found ${stock} stock ${stock === 1 ? 'change' : 'changes'}${suffix}`,
      icon: Radio,
      variant: 'warning',
    })
  }
  if (firstScrapes > 0) {
    indicators.push({
      key: 'new',
      label: `${firstScrapes} first ${firstScrapes === 1 ? 'scrape' : 'scrapes'}`,
      title: `${firstScrapes} store ${firstScrapes === 1 ? 'has' : 'have'} first scrape data${suffix}`,
      icon: CircleDot,
      variant: 'info',
    })
  }
  if (other > 0) {
    indicators.push({
      key: 'other',
      label: `${other} ${other === 1 ? 'update' : 'updates'}`,
      title: `${other} other ${other === 1 ? 'update' : 'updates'}${suffix}`,
      icon: ActivityIcon,
      variant: 'outline',
    })
  }
  return indicators.slice(0, 4)
}

function formatRetailPrice(
  value: number,
  store: ProductStoreSummary,
  options: {
    symbol: string
    displayMode: PriceDisplayMode
    locale?: string
    localCurrency: string
    exchangeRates: Record<string, number>
  },
): string {
  const raw =
    store.manual_price != null && value === store.manual_price
      ? null
      : store.latest_discounted_price != null && value === store.latest_discounted_price
        ? store.latest_raw_discounted
        : store.latest_raw_price
  return formatDisplayMoney(value, {
    symbol: options.symbol,
    mode: options.displayMode,
    currencyCode: store.latest_currency_code,
    raw,
    locale: options.locale,
  })
}

function formatDealerPrice(
  value: number,
  store: ProductStoreSummary,
  options: {
    symbol: string
    displayMode: PriceDisplayMode
    locale?: string
    localCurrency: string
    exchangeRates: Record<string, number>
  },
): string {
  return formatDisplayMoney(value, {
    symbol: options.symbol,
    mode: options.displayMode,
    currencyCode: store.latest_currency_code,
    raw: store.latest_raw_dealer,
    locale: options.locale,
  })
}

function formatRetailLocalEquivalent(
  value: number,
  store: ProductStoreSummary,
  options: {
    symbol: string
    localCurrency: string
    exchangeRates: Record<string, number>
  },
): string | null {
  return formatLocalEquivalent(value, {
    sourceCurrency: sourceCurrencyForRetail(store, value),
    localCurrency: options.localCurrency,
    exchangeRates: options.exchangeRates,
    symbol: options.symbol,
  })
}

function formatDealerLocalEquivalent(
  value: number,
  store: ProductStoreSummary,
  options: {
    symbol: string
    localCurrency: string
    exchangeRates: Record<string, number>
  },
): string | null {
  return formatLocalEquivalent(value, {
    sourceCurrency: store.latest_currency_code,
    localCurrency: options.localCurrency,
    exchangeRates: options.exchangeRates,
    symbol: options.symbol,
  })
}

function SummaryPriceBlock({
  label,
  value,
  localValue,
  tone = 'retail',
  icon,
  title,
}: {
  label: string
  value: string
  localValue: string | null
  tone?: 'retail' | 'dealer'
  icon?: ReactNode
  title?: string
}) {
  return (
    <div
      className="grid grid-cols-[3.75rem_minmax(0,max-content)] items-baseline gap-x-2 gap-y-0.5 text-xs tabular-nums"
      title={title}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          'inline-flex items-center gap-1 font-bold text-foreground',
          tone === 'dealer' && 'text-success',
        )}
      >
        {value}
        {icon}
      </span>
      {localValue ? (
        <>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Local
          </span>
          <span
            className={cn(
              'font-bold text-foreground',
              tone === 'dealer' && 'text-success',
            )}
          >
            {localValue}
          </span>
        </>
      ) : null}
    </div>
  )
}

function SupplierPriceBlock({
  label,
  value,
  localValue,
  tone = 'retail',
}: {
  label: string
  value: string | null
  localValue: string | null
  tone?: 'retail' | 'dealer'
}) {
  return (
    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          'font-semibold tabular-nums text-foreground',
          tone === 'dealer' && 'text-success',
          value == null && 'text-muted-foreground',
        )}
      >
        {value ?? '-'}
      </span>
      {localValue ? (
        <>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Local
          </span>
          <span
            className={cn(
              'font-semibold tabular-nums text-foreground',
              tone === 'dealer' && 'text-success',
            )}
          >
            {localValue}
          </span>
        </>
      ) : null}
    </div>
  )
}
