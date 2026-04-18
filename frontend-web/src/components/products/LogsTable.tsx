import type { PriceLog, ProductStoreSummary } from '@/api'
import { formatDelta, formatMoney } from '@/lib/utils'
import { StockPill } from './StockPill'

interface LogsTableProps {
  logs: PriceLog[]
  stores: ProductStoreSummary[]
  symbol: string
}

export function LogsTable({ logs, stores, symbol }: LogsTableProps) {
  const storeName = new Map(stores.map((s) => [s.id, s.store_name]))

  if (logs.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No logs yet.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">When</th>
            <th className="px-3 py-2 text-left font-medium">Store</th>
            <th className="px-3 py-2 text-right font-medium">Price</th>
            <th className="px-3 py-2 text-right font-medium">Discounted</th>
            <th className="px-3 py-2 text-right font-medium">Dealer</th>
            <th className="px-3 py-2 text-right font-medium">Δ</th>
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
              <tr key={log.id} className="border-t border-border">
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {new Date(log.scraped_at).toLocaleString()}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {storeName.get(log.product_store_id) ?? `#${log.product_store_id}`}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {log.price != null ? formatMoney(log.price, symbol) : '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {log.discounted_price != null
                    ? formatMoney(log.discounted_price, symbol)
                    : '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {log.dealer_price != null
                    ? formatMoney(log.dealer_price, symbol)
                    : '—'}
                </td>
                <td
                  className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${deltaColor}`}
                >
                  {formatDelta(delta)}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <StockPill status={log.stock_status} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                  {log.change_type ?? '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
