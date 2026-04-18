import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { productsApi, scraperApi } from '@/api'
import type { ProductStoreSummary } from '@/api'
import { formatDelta, formatRelativeTime } from '@/lib/utils'
import { PriceCell } from './PriceCell'
import { StockPill } from './StockPill'

interface StoreRowProps {
  store: ProductStoreSummary
  symbol: string
  productId: number
}

export function StoreRow({ store, symbol, productId }: StoreRowProps) {
  const qc = useQueryClient()

  const scrape = useMutation({
    mutationFn: () => scraperApi.scrapeOne(store.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['product', productId] })
    },
  })

  const remove = useMutation({
    mutationFn: () => productsApi.removeStore(productId, store.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product', productId] })
      qc.invalidateQueries({ queryKey: ['products'] })
    },
  })

  const delta = store.latest_price_delta
  const deltaColor =
    delta == null || delta === 0
      ? 'text-muted-foreground'
      : delta < 0
        ? 'text-success'
        : 'text-destructive'

  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 rounded-md border border-border bg-background/50 px-3 py-2 hover:bg-accent/30 transition-colors">
      <div className="flex min-w-0 flex-col">
        <a
          href={store.product_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 truncate text-sm font-medium hover:underline"
        >
          {store.store_name}
          <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
        </a>
        <span className="truncate text-xs text-muted-foreground">
          {safeHost(store.product_url)}
        </span>
      </div>

      <PriceCell store={store} symbol={symbol} />

      <div className={`w-16 text-right text-xs tabular-nums ${deltaColor}`}>
        {formatDelta(delta)}
      </div>

      <StockPill status={store.manual_stock_status ?? store.latest_stock_status} />

      <div className="flex items-center gap-1">
        <span className="w-20 text-right text-xs text-muted-foreground">
          {formatRelativeTime(store.latest_scraped_at)}
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => scrape.mutate()}
          disabled={scrape.isPending}
          title="Scrape now"
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
  )
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
