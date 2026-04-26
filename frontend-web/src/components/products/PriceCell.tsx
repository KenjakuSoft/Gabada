import type { ReactNode } from 'react'
import { cn, formatMoney } from '@/lib/utils'
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
      <PriceStack>
        <PriceLine label="Manual" value={manualPrice} symbol={symbol} />
        {dealer != null ? (
          <PriceLine label="Dealer" value={dealer} symbol={symbol} tone="dealer" />
        ) : null}
      </PriceStack>
    )
  }

  if (discounted != null && regular != null && discounted < regular) {
    return (
      <PriceStack>
        <SalePriceLine
          label="Retail"
          value={discounted}
          compareAt={regular}
          symbol={symbol}
        />
        {dealer != null ? (
          <PriceLine label="Dealer" value={dealer} symbol={symbol} tone="dealer" />
        ) : null}
      </PriceStack>
    )
  }

  if (regular != null) {
    return (
      <PriceStack>
        <PriceLine label="Retail" value={regular} symbol={symbol} />
        {dealer != null ? (
          <PriceLine label="Dealer" value={dealer} symbol={symbol} tone="dealer" />
        ) : null}
      </PriceStack>
    )
  }

  if (dealer != null) {
    return (
      <PriceStack>
        <PriceLine label="Dealer" value={dealer} symbol={symbol} tone="dealer" />
      </PriceStack>
    )
  }

  return <span className="text-sm text-muted-foreground">-</span>
}

function PriceStack({ children }: { children: ReactNode }) {
  return <div className="flex min-w-[9.5rem] flex-col items-end gap-1">{children}</div>
}

function PriceLine({
  label,
  value,
  symbol,
  tone = 'default',
}: {
  label: string
  value: number
  symbol: string
  tone?: 'default' | 'dealer'
}) {
  return (
    <div className="flex items-baseline justify-end gap-2 text-right">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          'text-sm font-semibold tabular-nums text-foreground',
          tone === 'dealer' && 'text-success',
        )}
      >
        {formatMoney(value, symbol)}
      </span>
    </div>
  )
}

function SalePriceLine({
  label,
  value,
  compareAt,
  symbol,
}: {
  label: string
  value: number
  compareAt: number
  symbol: string
}) {
  return (
    <div className="flex items-baseline justify-end gap-2 text-right">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-sm font-semibold tabular-nums text-success">
          {formatMoney(value, symbol)}
        </span>
        <span className="text-[11px] text-muted-foreground line-through tabular-nums">
          {formatMoney(compareAt, symbol)}
        </span>
      </span>
    </div>
  )
}
