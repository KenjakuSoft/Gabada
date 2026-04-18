import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { StockPill } from '@/components/products/StockPill'
import { activityApi } from '@/api'
import { useCurrencySymbol } from '@/hooks/useSettings'
import type { ActivityEntry } from '@/api'
import { formatDelta, formatMoney, formatRelativeTime } from '@/lib/utils'

const CHANGE_LABEL: Record<string, string> = {
  price_drop: 'Price drop',
  price_rise: 'Price rise',
  back_in_stock: 'Back in stock',
  out_of_stock: 'Out of stock',
  initial: 'First scrape',
  stock_change: 'Stock change',
}

export function ActivityPage() {
  const symbol = useCurrencySymbol()
  const activity = useQuery<ActivityEntry[]>({
    queryKey: ['activity'],
    queryFn: () => activityApi.list(100),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity"
        description="Recent scrapes, errors, and price changes."
      />
      {activity.isLoading ? (
        <EmptyState text="Loading…" />
      ) : activity.isError ? (
        <EmptyState text="Failed to load activity." />
      ) : (activity.data ?? []).length === 0 ? (
        <EmptyState text="No activity yet." />
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {(activity.data ?? []).map((e) => (
            <ActivityRow key={e.id} entry={e} symbol={symbol} />
          ))}
        </div>
      )}
    </div>
  )
}

function ActivityRow({
  entry,
  symbol,
}: {
  entry: ActivityEntry
  symbol: string
}) {
  const delta = entry.price_delta
  const deltaColor =
    delta == null || delta === 0
      ? 'text-muted-foreground'
      : delta < 0
        ? 'text-success'
        : 'text-destructive'
  const priceNow = entry.discounted_price ?? entry.price

  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 px-4 py-3 hover:bg-accent/20">
      <div className="flex min-w-0 flex-col">
        <Link
          to={`/product/${entry.product_id}`}
          className="truncate text-sm font-medium hover:underline"
        >
          {entry.product_name}
        </Link>
        <span className="truncate text-xs text-muted-foreground">
          {entry.store_name}
        </span>
      </div>

      <Badge variant="outline" className="text-xs">
        {CHANGE_LABEL[entry.change_type] ?? entry.change_type}
      </Badge>

      <div className="w-24 text-right text-sm tabular-nums">
        {priceNow != null ? formatMoney(priceNow, symbol) : '—'}
      </div>

      <div className={`w-20 text-right text-xs tabular-nums ${deltaColor}`}>
        {formatDelta(delta)}
      </div>

      <div className="flex items-center gap-2">
        <StockPill status={entry.stock_status} />
        <span className="w-20 text-right text-xs text-muted-foreground">
          {formatRelativeTime(entry.scraped_at)}
        </span>
      </div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}
