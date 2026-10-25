import { ArrowRight } from 'lucide-react'
import type { PriceLog, ProductStoreSummary } from '@/api'
import { useTimezone } from '@/hooks/useSettings'
import {
  cn,
  formatApiDateTime,
  formatDelta,
  formatDisplayMoney,
  formatLocalEquivalent,
} from '@/lib/utils'
import type { PriceDisplayMode } from '@/lib/utils'
import { StockPill } from './StockPill'

interface LogsTableProps {
  logs: PriceLog[]
  stores: ProductStoreSummary[]
  symbol: string
  displayMode?: PriceDisplayMode
  locale?: string
  localCurrency?: string
  exchangeRates?: Record<string, number>
  showStoreColumn?: boolean
}

export function LogsTable({
  logs,
  stores,
  symbol,
  displayMode = 'regional',
  locale,
  localCurrency = 'USD',
  exchangeRates = {},
  showStoreColumn = true,
}: LogsTableProps) {
  const timezone = useTimezone()
  const storeName = new Map(stores.map((s) => [s.id, s.store_name]))

  if (logs.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No logs for this store/date selection.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted/90 text-xs uppercase text-muted-foreground backdrop-blur">
            <tr>
              <th className="px-3 py-2 text-left font-medium">When</th>
              {showStoreColumn ? (
                <th className="px-3 py-2 text-left font-medium">Store</th>
              ) : null}
              <th className="px-3 py-2 text-right font-medium">Retail</th>
              <th className="px-3 py-2 text-right font-medium">Dealer</th>
              <th className="px-3 py-2 text-right font-medium">Delta</th>
              <th className="px-3 py-2 text-left font-medium">Stock</th>
              <th className="px-3 py-2 text-left font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const delta = log.price_delta
              const deltaColor =
                delta == null || delta === 0
                  ? 'text-muted-foreground'
                  : delta < 0
                    ? 'text-success'
                    : 'text-destructive'
              return (
                <tr
                  key={log.id}
                  className="border-t border-border transition-colors hover:bg-accent/25"
                >
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {formatApiDateTime(log.scraped_at, timezone)}
                  </td>
                  {showStoreColumn ? (
                    <td className="whitespace-nowrap px-3 py-2">
                      {storeName.get(log.product_store_id) ?? `#${log.product_store_id}`}
                    </td>
                  ) : null}
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <RetailLogPrice
                      log={log}
                      symbol={symbol}
                      displayMode={displayMode}
                      locale={locale}
                      localCurrency={localCurrency}
                      exchangeRates={exchangeRates}
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <LogPriceStack
                      value={log.dealer_price}
                      raw={log.raw_dealer}
                      currencyCode={log.currency_code}
                      symbol={symbol}
                      displayMode={displayMode}
                      locale={locale}
                      localCurrency={localCurrency}
                      exchangeRates={exchangeRates}
                      tone="dealer"
                    />
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${deltaColor}`}
                  >
                    {formatDelta(delta) || '-'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <StockTransition log={log} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {formatChangeType(log.change_type)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RetailLogPrice({
  log,
  symbol,
  displayMode,
  locale,
  localCurrency,
  exchangeRates,
}: {
  log: PriceLog
  symbol: string
  displayMode: PriceDisplayMode
  locale?: string
  localCurrency: string
  exchangeRates: Record<string, number>
}) {
  const current = log.discounted_price ?? log.price
  const currentRaw = log.discounted_price != null ? log.raw_discounted : log.raw_price
  const localEquivalent =
    current != null
      ? formatLocalEquivalent(current, {
          sourceCurrency: log.currency_code,
          localCurrency,
          exchangeRates,
          symbol,
        })
      : null

  if (
    log.previous_price != null &&
    current != null &&
    log.previous_price !== current
  ) {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="inline-flex items-center justify-end gap-1.5 tabular-nums">
          <span className="text-muted-foreground line-through">
            {formatDisplayMoney(log.previous_price, {
              symbol,
              mode: displayMode,
              currencyCode: log.currency_code,
              locale,
            })}
          </span>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <span className="font-semibold">
            {formatDisplayMoney(current, {
              symbol,
              mode: displayMode,
              currencyCode: log.currency_code,
              raw: currentRaw,
              locale,
            })}
          </span>
        </span>
        {localEquivalent ? <LocalLogPrice value={localEquivalent} /> : null}
      </div>
    )
  }

  if (log.discounted_price != null && log.price != null && log.discounted_price < log.price) {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="inline-flex items-center justify-end gap-1.5 tabular-nums">
          <span className="font-semibold text-success">
            {formatDisplayMoney(log.discounted_price, {
              symbol,
              mode: displayMode,
              currencyCode: log.currency_code,
              raw: log.raw_discounted,
              locale,
            })}
          </span>
          <span className="text-xs text-muted-foreground line-through">
            {formatDisplayMoney(log.price, {
              symbol,
              mode: displayMode,
              currencyCode: log.currency_code,
              raw: log.raw_price,
              locale,
            })}
          </span>
        </span>
        {localEquivalent ? <LocalLogPrice value={localEquivalent} tone="sale" /> : null}
      </div>
    )
  }

  return (
    <LogPriceStack
      value={current}
      raw={currentRaw}
      currencyCode={log.currency_code}
      symbol={symbol}
      displayMode={displayMode}
      locale={locale}
      localCurrency={localCurrency}
      exchangeRates={exchangeRates}
    />
  )
}

function LogPriceStack({
  value,
  raw,
  currencyCode,
  symbol,
  displayMode,
  locale,
  localCurrency,
  exchangeRates,
  tone = 'default',
}: {
  value: number | null | undefined
  raw?: string | null
  currencyCode?: string | null
  symbol: string
  displayMode: PriceDisplayMode
  locale?: string
  localCurrency: string
  exchangeRates: Record<string, number>
  tone?: 'default' | 'dealer' | 'sale'
}) {
  if (value == null) {
    return <span className="text-muted-foreground">-</span>
  }
  const localEquivalent = formatLocalEquivalent(value, {
    sourceCurrency: currencyCode,
    localCurrency,
    exchangeRates,
    symbol,
  })

  return (
    <div className="flex flex-col items-end gap-1">
      <span
        className={cn(
          'font-semibold tabular-nums',
          tone === 'dealer' && 'text-success',
          tone === 'sale' && 'text-success',
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
      {localEquivalent ? (
        <LocalLogPrice value={localEquivalent} tone={tone} />
      ) : null}
    </div>
  )
}

function LocalLogPrice({
  value,
  tone = 'default',
}: {
  value: string
  tone?: 'default' | 'dealer' | 'sale'
}) {
  return (
    <span className="grid grid-cols-[3.25rem_minmax(0,max-content)] items-baseline justify-end gap-x-1.5">
      <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Local
      </span>
      <span
        className={cn(
          'text-xs font-semibold tabular-nums text-foreground',
          tone === 'dealer' && 'text-success',
          tone === 'sale' && 'text-success',
        )}
      >
        {value}
      </span>
    </span>
  )
}

function StockTransition({ log }: { log: PriceLog }) {
  if (
    log.previous_stock_status &&
    log.stock_status &&
    log.previous_stock_status !== log.stock_status
  ) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <StockPill status={log.previous_stock_status} />
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <StockPill status={log.stock_status} />
      </span>
    )
  }

  return <StockPill status={log.stock_status} />
}

const CHANGE_TYPE_LABELS: Record<string, string> = {
  new: 'First scrape',
  price_up: 'Price up',
  price_down: 'Price down',
  price_and_stock: 'Price + stock',
  stock_in: 'Back in stock',
  stock_out: 'Out of stock',
  stock_change: 'Stock change',
  no_change: 'No change',
}

function formatChangeType(changeType: string | null): string {
  if (!changeType) return '-'
  return CHANGE_TYPE_LABELS[changeType] ?? changeType.replaceAll('_', ' ')
}
