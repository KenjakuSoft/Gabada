import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  ExternalLink,
  Pencil,
  RefreshCw,
  Save,
  Target,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { toast } from '@/components/ui/toast-store'
import { productsApi, scraperApi } from '@/api'
import type { ProductStoreSummary, StockStatus } from '@/api'
import { formatDelta, formatRelativeTime } from '@/lib/utils'
import type { PriceDisplayMode } from '@/lib/utils'
import { PriceCell } from './PriceCell'
import { StockPill } from './StockPill'

interface StoreRowProps {
  store: ProductStoreSummary
  symbol: string
  displayMode?: PriceDisplayMode
  locale?: string
  localCurrency?: string
  exchangeRates?: Record<string, number>
  productId: number
}

const STOCK_OPTIONS: Array<{ value: StockStatus; label: string }> = [
  { value: 'in_stock', label: 'In stock' },
  { value: 'out_of_stock', label: 'Out of stock' },
  { value: 'limited', label: 'Limited' },
  { value: 'preorder', label: 'Pre-order' },
  { value: 'backorder', label: 'Backorder' },
  { value: 'call_for_price', label: 'Call for price' },
  { value: 'contact_store', label: 'Contact store' },
  { value: 'discontinued', label: 'Discontinued' },
  { value: 'unknown', label: 'Unknown' },
]

export function StoreRow({
  store,
  symbol,
  displayMode = 'regional',
  locale,
  localCurrency,
  exchangeRates,
  productId,
}: StoreRowProps) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const canOpenUrl = isWebUrl(store.product_url)
  const canScrape = store.is_active && canOpenUrl && !store.store_manual_only
  const [editing, setEditing] = useState(false)
  const [productUrl, setProductUrl] = useState(store.product_url)
  const [manualPrice, setManualPrice] = useState(
    store.manual_price != null ? String(store.manual_price) : '',
  )
  const [manualStockStatus, setManualStockStatus] = useState<StockStatus | ''>(
    store.manual_stock_status ?? '',
  )
  const [manualWarranty, setManualWarranty] = useState(store.manual_warranty ?? '')
  const [overrideNote, setOverrideNote] = useState(store.override_note ?? '')
  const [clearLogsOnUrlChange, setClearLogsOnUrlChange] = useState(false)
  const resolvedProductUrl = resolveEditedProductUrl(productUrl, store.product_url)
  const productUrlChanged =
    resolvedProductUrl !== undefined &&
    (resolvedProductUrl ?? '') !== store.product_url

  const scrape = useMutation({
    mutationFn: () => scraperApi.scrapeOne(store.id),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['products'] }),
        qc.invalidateQueries({ queryKey: ['product', productId] }),
        qc.invalidateQueries({ queryKey: ['product-logs', productId] }),
      ])
      toast.success(`${store.store_name} refreshed`)
    },
    onError: (err: unknown) => {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? 'The scrape did not complete'
      toast.error(`Could not refresh ${store.store_name}`, detail)
    },
  })

  const save = useMutation({
    mutationFn: () =>
      productsApi.updateStore(productId, store.id, {
        product_url: resolvedProductUrl,
        clear_logs_on_url_change: productUrlChanged && clearLogsOnUrlChange,
        manual_price: parseManualPrice(manualPrice),
        manual_stock_status: manualStockStatus || null,
        manual_warranty: manualWarranty.trim() || null,
        override_note: overrideNote.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product', productId] })
      qc.invalidateQueries({ queryKey: ['product-logs', productId] })
      qc.invalidateQueries({ queryKey: ['products'] })
      setEditing(false)
      toast.success(`${store.store_name} updated`)
    },
    onError: () => toast.error(`Could not update ${store.store_name}`),
  })

  const remove = useMutation({
    mutationFn: () => productsApi.removeStore(productId, store.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product', productId] })
      qc.invalidateQueries({ queryKey: ['product-logs', productId] })
      qc.invalidateQueries({ queryKey: ['products'] })
      toast.info(`${store.store_name} unlinked`)
    },
    onError: () => toast.error(`Could not unlink ${store.store_name}`),
  })

  const delta = store.latest_price_delta
  const deltaColor =
    delta == null || delta === 0
      ? 'text-muted-foreground'
      : delta < 0
        ? 'text-success'
        : 'text-destructive'

  const disableSave = save.isPending

  function loadDraftFromStore() {
    setProductUrl(normalizeEditableProductUrl(store.product_url))
    setManualPrice(store.manual_price != null ? String(store.manual_price) : '')
    setManualStockStatus(store.manual_stock_status ?? '')
    setManualWarranty(store.manual_warranty ?? '')
    setOverrideNote(store.override_note ?? '')
    setClearLogsOnUrlChange(false)
    save.reset()
  }

  function resetEditor() {
    setEditing(false)
    loadDraftFromStore()
  }

  function openEditor() {
    loadDraftFromStore()
    setEditing(true)
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-4 rounded-lg border border-border/80 bg-card/50 px-3 py-2 shadow-sm transition-[transform,border-color,background-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:bg-accent/35 hover:shadow-[var(--shadow-soft)]">
        <div className="flex min-w-0 flex-col">
          {canOpenUrl ? (
            <a
              href={store.product_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 truncate text-sm font-medium hover:underline"
            >
              {store.store_name}
              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
            </a>
          ) : (
            <span className="truncate text-sm font-medium">{store.store_name}</span>
          )}
          <span className="truncate text-xs text-muted-foreground">
            {store.store_manual_only
              ? 'Manual source'
              : websiteSourceLabel(store.product_url)}
          </span>
          {effectiveWarranty(store) ? (
            <span className="truncate text-xs text-muted-foreground">
              Warranty: {effectiveWarranty(store)}
            </span>
          ) : null}
          {store.override_note ? (
            <span className="truncate text-xs text-muted-foreground">
              Note: {store.override_note}
            </span>
          ) : null}
        </div>

        <PriceCell
          store={store}
          symbol={symbol}
          displayMode={displayMode}
          locale={locale}
          localCurrency={localCurrency}
          exchangeRates={exchangeRates}
        />

        <div className={`w-16 text-right text-xs tabular-nums ${deltaColor}`}>
          {formatDelta(delta)}
        </div>

        <StockPill status={store.manual_stock_status ?? store.latest_stock_status} />

        <span className="w-20 text-right text-xs text-muted-foreground">
          {formatRelativeTime(store.latest_scraped_at)}
        </span>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (editing) resetEditor()
              else openEditor()
            }}
            title={editing ? 'Close editor' : 'Edit linked store'}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              navigate(
                `/selector-lab?productStoreId=${store.id}&url=${encodeURIComponent(store.product_url)}`,
              )
            }
            disabled={!canOpenUrl}
            title={
              canOpenUrl
                ? 'Configure tracking - open Selector Lab to pin which buy-area item this row should follow'
                : 'Add a real product URL first'
            }
          >
            <Target className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => scrape.mutate()}
            disabled={scrape.isPending || !canScrape}
            title={
              canScrape
                ? 'Scrape now'
                : isInternalProductUrl(store.product_url)
                  ? 'Add a real product URL first'
                  : 'No website source to scrape'
            }
          >
            <RefreshCw
              className={`h-4 w-4 ${scrape.isPending ? 'animate-spin' : ''}`}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (confirm(`Unlink ${store.store_name} from this product?`)) {
                remove.mutate()
              }
            }}
            disabled={remove.isPending}
            title="Remove store link"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {editing ? (
        <div className="rounded-xl border border-border/80 bg-background/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-foreground">
                Edit linked store
              </div>
              <div className="text-xs text-muted-foreground">
                Update the linked URL and optional manual override values for this
                product-store row.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={resetEditor}>
                <X className="h-4 w-4" />
                Cancel
              </Button>
              <Button size="sm" onClick={() => save.mutate()} disabled={disableSave}>
                <Save className="h-4 w-4" />
                Save changes
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="space-y-1.5 lg:col-span-2">
              <Label htmlFor={`store-url-${store.id}`}>Product URL</Label>
              <Input
                id={`store-url-${store.id}`}
                value={productUrl}
                onChange={(event) => setProductUrl(event.target.value)}
                placeholder={
                  store.store_manual_only
                    ? 'Optional for manual stores'
                    : 'https://shop.example.com/product/item'
                }
              />
              <p className="text-xs text-muted-foreground">
                {store.store_manual_only
                  ? 'Manual stores can leave this blank. Gabada will keep a local placeholder.'
                  : isInternalProductUrl(store.product_url)
                    ? 'This row came from file import without a website URL yet. Add the real product page here whenever you want scraping.'
                    : 'Website-backed stores need the exact product page URL.'}
              </p>
              {productUrlChanged ? (
                <label className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={clearLogsOnUrlChange}
                    onChange={(event) =>
                      setClearLogsOnUrlChange(event.target.checked)
                    }
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  />
                  <span>
                    Clear existing price logs for this store link when saving this
                    URL change.
                  </span>
                </label>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`manual-price-${store.id}`}>Manual price</Label>
              <Input
                id={`manual-price-${store.id}`}
                value={manualPrice}
                onChange={(event) => setManualPrice(event.target.value)}
                placeholder="Leave blank to clear"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`manual-stock-${store.id}`}>Manual stock</Label>
              <Select
                id={`manual-stock-${store.id}`}
                value={manualStockStatus}
                onChange={(event) =>
                  setManualStockStatus(event.target.value as StockStatus | '')
                }
              >
                <option value="">No manual stock</option>
                {STOCK_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`manual-warranty-${store.id}`}>Warranty</Label>
              <Input
                id={`manual-warranty-${store.id}`}
                value={manualWarranty}
                onChange={(event) => setManualWarranty(event.target.value)}
                placeholder="Leave blank to use imported or scraped warranty"
              />
            </div>

            <div className="space-y-1.5 lg:col-span-2">
              <Label htmlFor={`override-note-${store.id}`}>Note</Label>
              <textarea
                id={`override-note-${store.id}`}
                value={overrideNote}
                onChange={(event) => setOverrideNote(event.target.value)}
                placeholder="Optional note for this linked store row"
                className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              />
              <p className="text-xs text-muted-foreground">
                Leave manual fields empty and save to clear the override.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function isInternalProductUrl(url: string): boolean {
  return /^(?:import|manual):\/\//i.test(url)
}

function normalizeEditableProductUrl(url: string): string {
  return isInternalProductUrl(url) ? '' : url
}

function resolveEditedProductUrl(
  editedUrl: string,
  currentUrl: string,
): string | null | undefined {
  const trimmed = editedUrl.trim()
  if (trimmed) return trimmed
  if (isInternalProductUrl(currentUrl)) return undefined
  return null
}

function websiteSourceLabel(url: string): string {
  if (isInternalProductUrl(url)) return 'No website URL yet'
  return safeHost(url)
}

function effectiveWarranty(store: ProductStoreSummary): string | null {
  return store.manual_warranty ?? store.latest_warranty ?? null
}

function parseManualPrice(value: string): number | null {
  const cleaned = value.replace(/[^\d.,]/g, '').trim()
  if (!cleaned) return null
  const normalized = cleaned.replace(/,/g, '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
