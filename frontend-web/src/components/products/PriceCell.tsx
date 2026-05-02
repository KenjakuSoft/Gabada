import type { ReactNode } from 'react'
import { cn, formatDisplayMoney, formatLocalEquivalent } from '@/lib/utils'
import type { ProductStoreSummary } from '@/api'
import type { PriceDisplayMode } from '@/lib/utils'

interface PriceCellProps {
  store: ProductStoreSummary
  symbol: string
  displayMode?: PriceDisplayMode
  locale?: string
  localCurrency?: string
  exchangeRates?: Record<string, number>
}

export function PriceCell({
  store,
  symbol,
  displayMode = 'regional',
  locale,
  localCurrency = 'USD',
  exchangeRates = {},
}: PriceCellProps) {
  const manualPrice = store.manual_price
  const discounted = store.latest_discounted_price
  const regular = store.latest_price
  const dealer = store.latest_dealer_price

  if (manualPrice != null) {
    return (
      <PriceStack>
        <PriceLine label="Manual" value={manualPrice} symbol={symbol} />
        {dealer != null ? (
          <PriceLine
            label="Dealer"
            value={dealer}
            symbol={symbol}
            tone="dealer"
            raw={store.latest_raw_dealer}
            currencyCode={store.latest_currency_code}
            displayMode={displayMode}
            locale={locale}
            localCurrency={localCurrency}
            exchangeRates={exchangeRates}
          />
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
          raw={store.latest_raw_discounted}
          compareRaw={store.latest_raw_price}
          currencyCode={store.latest_currency_code}
          displayMode={displayMode}
          locale={locale}
          localCurrency={localCurrency}
          exchangeRates={exchangeRates}
        />
        {dealer != null ? (
          <PriceLine
            label="Dealer"
            value={dealer}
            symbol={symbol}
            tone="dealer"
            raw={store.latest_raw_dealer}
            currencyCode={store.latest_currency_code}
            displayMode={displayMode}
            locale={locale}
            localCurrency={localCurrency}
            exchangeRates={exchangeRates}
          />
        ) : null}
      </PriceStack>
    )
  }

  if (regular != null) {
    return (
      <PriceStack>
        <PriceLine
          label="Retail"
          value={regular}
          symbol={symbol}
          raw={store.latest_raw_price}
          currencyCode={store.latest_currency_code}
          displayMode={displayMode}
          locale={locale}
          localCurrency={localCurrency}
          exchangeRates={exchangeRates}
        />
        {dealer != null ? (
          <PriceLine
            label="Dealer"
            value={dealer}
            symbol={symbol}
            tone="dealer"
            raw={store.latest_raw_dealer}
            currencyCode={store.latest_currency_code}
            displayMode={displayMode}
            locale={locale}
            localCurrency={localCurrency}
            exchangeRates={exchangeRates}
          />
        ) : null}
      </PriceStack>
    )
  }

  if (dealer != null) {
    return (
      <PriceStack>
        <PriceLine
          label="Dealer"
          value={dealer}
          symbol={symbol}
          tone="dealer"
          raw={store.latest_raw_dealer}
          currencyCode={store.latest_currency_code}
          displayMode={displayMode}
          locale={locale}
          localCurrency={localCurrency}
          exchangeRates={exchangeRates}
        />
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
  raw,
  currencyCode,
  displayMode = 'regional',
  locale,
  localCurrency,
  exchangeRates,
}: {
  label: string
  value: number
  symbol: string
  tone?: 'default' | 'dealer'
  raw?: string | null
  currencyCode?: string | null
  displayMode?: PriceDisplayMode
  locale?: string
  localCurrency?: string
  exchangeRates?: Record<string, number>
}) {
  const localEquivalent =
    localCurrency && exchangeRates
      ? formatLocalEquivalent(value, {
          sourceCurrency: currencyCode,
          localCurrency,
          exchangeRates,
          symbol,
        })
      : null
  return (
    <div className="text-right">
      <div className="grid grid-cols-[3.75rem_minmax(0,max-content)] items-baseline justify-end gap-x-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            'text-sm font-semibold tabular-nums text-foreground',
            tone === 'dealer' && 'text-success',
          )}
        >
          {formatDisplayMoney(value, {
            symbol,
            mode: displayMode,
            currencyCode,
            raw,
            locale,
          })}
        </span>
      </div>
      {localEquivalent ? (
        <LocalPriceLine value={localEquivalent} tone={tone} />
      ) : null}
    </div>
  )
}

function SalePriceLine({
  label,
  value,
  compareAt,
  symbol,
  raw,
  compareRaw,
  currencyCode,
  displayMode = 'regional',
  locale,
  localCurrency,
  exchangeRates,
}: {
  label: string
  value: number
  compareAt: number
  symbol: string
  raw?: string | null
  compareRaw?: string | null
  currencyCode?: string | null
  displayMode?: PriceDisplayMode
  locale?: string
  localCurrency?: string
  exchangeRates?: Record<string, number>
}) {
  const localEquivalent =
    localCurrency && exchangeRates
      ? formatLocalEquivalent(value, {
          sourceCurrency: currencyCode,
          localCurrency,
          exchangeRates,
          symbol,
        })
      : null
  return (
    <div className="text-right">
      <div className="grid grid-cols-[3.75rem_minmax(0,max-content)] items-baseline justify-end gap-x-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-sm font-semibold tabular-nums text-success">
            {formatDisplayMoney(value, {
              symbol,
              mode: displayMode,
              currencyCode,
              raw,
              locale,
            })}
          </span>
          <span className="text-[11px] text-muted-foreground line-through tabular-nums">
            {formatDisplayMoney(compareAt, {
              symbol,
              mode: displayMode,
              currencyCode,
              raw: compareRaw,
              locale,
            })}
          </span>
        </span>
      </div>
      {localEquivalent ? (
        <LocalPriceLine value={localEquivalent} tone="sale" />
      ) : null}
    </div>
  )
}

function LocalPriceLine({
  value,
  tone = 'default',
}: {
  value: string
  tone?: 'default' | 'dealer' | 'sale'
}) {
  return (
    <div className="grid grid-cols-[3.75rem_minmax(0,max-content)] items-baseline justify-end gap-x-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Local
      </span>
      <span
        className={cn(
          'text-sm font-semibold tabular-nums text-foreground',
          tone === 'dealer' && 'text-success',
          tone === 'sale' && 'text-success',
        )}
      >
        {value}
      </span>
    </div>
  )
}
