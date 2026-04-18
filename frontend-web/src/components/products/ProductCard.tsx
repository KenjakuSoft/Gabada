import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, ImageOff } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn, formatMoney } from '@/lib/utils'
import type { Product } from '@/api'
import { StoreRow } from './StoreRow'

interface ProductCardProps {
  product: Product
  symbol: string
  defaultOpen?: boolean
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

function anyInStock(product: Product): boolean {
  return product.stores.some((s) => {
    const status = s.manual_stock_status ?? s.latest_stock_status
    return status === 'in_stock' || status === 'limited'
  })
}

export function ProductCard({
  product,
  symbol,
  defaultOpen = true,
}: ProductCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const low = lowestActivePrice(product)
  const inStock = anyInStock(product)
  const count = product.stores.length

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center gap-4 p-4">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex shrink-0 items-center justify-center rounded-md p-1 hover:bg-accent"
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
          {product.image_url ? (
            <img
              src={product.image_url}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
              onError={(e) => {
                ;(e.currentTarget as HTMLImageElement).style.display = 'none'
              }}
            />
          ) : (
            <ImageOff className="h-5 w-5 text-muted-foreground" />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <Link
            to={`/product/${product.id}`}
            className="truncate text-base font-semibold hover:underline"
          >
            {product.canonical_name}
          </Link>
          <div className="mt-1 flex items-center gap-2">
            {product.category_name ? (
              <Badge
                variant="outline"
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
            <span className="text-xs text-muted-foreground">
              {count} {count === 1 ? 'store' : 'stores'}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={cn(
              'text-lg font-semibold tabular-nums',
              low == null && 'text-muted-foreground',
            )}
          >
            {low != null ? formatMoney(low, symbol) : 'No price'}
          </span>
          <Badge variant={inStock ? 'success' : 'muted'}>
            {inStock ? 'Available' : 'Unavailable'}
          </Badge>
        </div>
      </div>

      {open && count > 0 ? (
        <div className="space-y-1.5 border-t border-border bg-muted/30 p-3">
          {product.stores.map((store) => (
            <StoreRow key={store.id} store={store} symbol={symbol} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
