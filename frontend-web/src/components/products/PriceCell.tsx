import { formatMoney } from '@/lib/utils'
import type { ProductStoreSummary } from '@/api'

interface PriceCellProps {
  store: ProductStoreSummary
  symbol: string
}

export function PriceCell({ store, symbol }: PriceCellProps) {
  const manualPrice = store.manual_price
  const discounted = store.latest_discounted_price
  const regular = store.latest_price
  const dealer = store.latest_dealer_price

  if (manualPrice != null) {
    return (
      <div className="flex flex-col">
        <span className="font-semibold tabular-nums">
          {formatMoney(manualPrice, symbol)}
        </span>
        <span className="text-xs text-muted-foreground">manual</span>
      </div>
    )
  }

  if (discounted != null && regular != null && discounted < regular) {
    return (
      <div className="flex items-baseline gap-2">
        <span className="font-semibold tabular-nums text-success">
          {formatMoney(discounted, symbol)}
        </span>
        <span className="text-xs text-muted-foreground line-through tabular-nums">
          {formatMoney(regular, symbol)}
        </span>
      </div>
    )
  }

  if (regular != null) {
    return (
      <span className="font-semibold tabular-nums">
        {formatMoney(regular, symbol)}
      </span>
    )
  }

  if (dealer != null) {
    return (
      <div className="flex flex-col">
        <span className="font-semibold tabular-nums">
          {formatMoney(dealer, symbol)}
        </span>
        <span className="text-xs text-muted-foreground">dealer</span>
      </div>
    )
  }

  return <span className="text-sm text-muted-foreground">—</span>
}
