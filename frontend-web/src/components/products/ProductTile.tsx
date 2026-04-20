import { Link } from 'react-router-dom'
import { ImageOff, TrendingDown, TrendingUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { BentoTile } from '@/components/ui/bento'
import { StockPill } from './StockPill'
import { cn, formatMoney } from '@/lib/utils'
import { useLiveTime } from '@/hooks/useLiveTime'
import { useCountUp } from '@/hooks/useCountUp'
import type { Product, ProductStoreSummary } from '@/api'

interface ProductTileProps {
  product: Product
  symbol: string
}

function lowestActivePrice(product: Product): number | null {
  const prices = product.stores
    .filter((s) => s.is_active)
    .map((s) => {
      if (s.manual_price != null) return s.manual_price
      if (s.latest_discounted_price != null) return s.latest_discounted_price
      return s.latest_price
    })
    .filter((v): v is number => v != null)
  if (prices.length === 0) return null
  return Math.min(...prices)
}

function effectiveStockStatus(s: ProductStoreSummary) {
  return s.manual_stock_status ?? s.latest_stock_status
}

function anyInStock(product: Product): boolean {
  return product.stores.some((s) => {
    const status = effectiveStockStatus(s)
    return status === 'in_stock' || status === 'limited'
  })
}

function mostRecentScrape(product: Product): string | null {
  let newest: string | null = null
  for (const s of product.stores) {
    if (!s.latest_scraped_at) continue
    if (!newest || s.latest_scraped_at > newest) newest = s.latest_scraped_at
  }
  return newest
}

function latestDelta(product: Product): number | null {
  let delta: number | null = null
  let newest = ''
  for (const s of product.stores) {
    if (s.latest_price_delta == null || !s.latest_scraped_at) continue
    if (!newest || s.latest_scraped_at > newest) {
      newest = s.latest_scraped_at
      delta = s.latest_price_delta
    }
  }
  return delta
}

export function ProductTile({ product, symbol }: ProductTileProps) {
  const low = lowestActivePrice(product)
  const inStock = anyInStock(product)
  const delta = latestDelta(product)
  const scrapedAt = mostRecentScrape(product)
  const liveTime = useLiveTime(scrapedAt)
  const count = product.stores.length
  const animatedLow = useCountUp(low, { decimals: 2 })

  const deltaColor =
    delta == null || delta === 0
      ? 'text-muted-foreground'
      : delta < 0
        ? 'text-success'
        : 'text-destructive'
  const DeltaIcon = delta != null && delta < 0 ? TrendingDown : TrendingUp

  return (
    <BentoTile
      interactive
      padded={false}
      className={cn('group flex flex-col')}
    >
      <Link
        to={`/product/${product.id}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="relative aspect-[4/3] w-full overflow-hidden border-b border-border bg-gradient-to-br from-muted/80 to-muted/30">
          {product.image_url ? (
            <img
              src={product.image_url}
              alt=""
              className="absolute inset-0 h-full w-full object-contain p-3 transition-transform duration-500 group-hover:scale-[1.04]"
              loading="lazy"
              onError={(e) => {
                ;(e.currentTarget as HTMLImageElement).style.display = 'none'
              }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <ImageOff className="h-8 w-8 text-muted-foreground/50" />
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 via-black/20 to-transparent p-2">
            <StockPill status={inStock ? 'in_stock' : 'out_of_stock'} />
            {product.category_name ? (
              <Badge
                variant="outline"
                className="border-white/30 bg-black/30 text-[10px] text-white backdrop-blur-sm"
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
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="line-clamp-2 text-sm font-semibold leading-tight">
            {product.canonical_name}
          </div>
          <div className="mt-auto flex items-end justify-between gap-3">
            <div>
              <div
                className={cn(
                  'text-xl font-semibold tabular-nums tracking-tight',
                  low == null && 'text-muted-foreground',
                )}
              >
                {animatedLow != null ? formatMoney(animatedLow, symbol) : '—'}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {count} {count === 1 ? 'store' : 'stores'}
              </div>
            </div>
            <div className="flex flex-col items-end gap-0.5 text-xs">
              {delta != null && delta !== 0 ? (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 tabular-nums',
                    deltaColor,
                  )}
                >
                  <DeltaIcon className="h-3 w-3" />
                  {delta > 0 ? '+' : ''}
                  {delta.toFixed(2)}
                </span>
              ) : null}
              <span className="text-muted-foreground">{liveTime}</span>
            </div>
          </div>
        </div>
      </Link>
    </BentoTile>
  )
}
