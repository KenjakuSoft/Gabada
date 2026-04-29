import { ArrowRight } from 'lucide-react'
import type { PriceLog, ProductStoreSummary } from '@/api'
import { useTimezone } from '@/hooks/useSettings'
import { formatApiDateTime, formatDelta, formatMoney } from '@/lib/utils'
import { StockPill } from './StockPill'

interface LogsTableProps {
  logs: PriceLog[]
  stores: ProductStoreSummary[]
  symbol: string
  showStoreColumn?: boolean
}

export function LogsTable({
  logs,
  stores,
  symbol,
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
                    <RetailLogPrice log={log} symbol={symbol} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-success">
                    {log.dealer_price != null
                      ? formatMoney(log.dealer_price, symbol)
                      : '-'}
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

function RetailLogPrice({ log, symbol }: { log: PriceLog; symbol: string }) {
  const current = log.discounted_price ?? log.price

  if (
    log.previous_price != null &&
    current != null &&
    log.previous_price !== current
  ) {
    return (
      <span className="inline-flex items-center justify-end gap-1.5 tabular-nums">
        <span className="text-muted-foreground line-through">
          {formatMoney(log.previous_price, symbol)}
        </span>
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <span className="font-semibold">{formatMoney(current, symbol)}</span>
      </span>
    )
  }

  if (log.discounted_price != null && log.price != null && log.discounted_price < log.price) {
    return (
      <span className="inline-flex items-center justify-end gap-1.5 tabular-nums">
        <span className="font-semibold text-success">
          {formatMoney(log.discounted_price, symbol)}
        </span>
        <span className="text-xs text-muted-foreground line-through">
          {formatMoney(log.price, symbol)}
        </span>
      </span>
    )
  }

  return (
    <span className="font-semibold tabular-nums">
      {current != null ? formatMoney(current, symbol) : '-'}
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

function formatChangeType(changeType: string | null): string {
  if (!changeType) return '-'
  return changeType.replaceAll('_', ' ')
}
