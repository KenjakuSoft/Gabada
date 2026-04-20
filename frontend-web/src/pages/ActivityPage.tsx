import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Activity as ActivityIcon,
  CircleDot,
  Radio,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { BentoGrid, BentoTile, TileHeader } from '@/components/ui/bento'
import { StatTile } from '@/components/ui/stat-tile'
import { Skeleton } from '@/components/ui/skeleton'
import { StockPill } from '@/components/products/StockPill'
import { activityApi } from '@/api'
import { useCurrencySymbol } from '@/hooks/useSettings'
import { useLiveTime } from '@/hooks/useLiveTime'
import type { ActivityEntry } from '@/api'
import { cn, formatDelta, formatMoney } from '@/lib/utils'

const CHANGE_LABEL: Record<string, string> = {
  price_drop: 'Price drop',
  price_rise: 'Price rise',
  back_in_stock: 'Back in stock',
  out_of_stock: 'Out of stock',
  initial: 'First scrape',
  stock_change: 'Stock change',
}

const REFRESH_MS = 30_000

export function ActivityPage() {
  const symbol = useCurrencySymbol()
  const activity = useQuery<ActivityEntry[]>({
    queryKey: ['activity'],
    queryFn: () => activityApi.list(100),
    refetchInterval: REFRESH_MS,
    staleTime: 10_000,
  })

  const entries = activity.data ?? []
  const stats = useMemo(() => computeStats(entries), [entries])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity"
        description="Live feed of scrapes, errors, and price changes."
        actions={
          <Badge
            variant="outline"
            className="flex items-center gap-1.5 font-normal"
          >
            <CircleDot className="h-3 w-3 text-emerald-500" />
            Auto-refresh 30s
          </Badge>
        }
      />

      <BentoGrid cols={6}>
        <StatTile
          label="Events"
          value={stats.total}
          icon={<ActivityIcon className="h-4 w-4" />}
          hint="last 100"
          tone="primary"
          loading={activity.isLoading}
        />
        <StatTile
          label="Drops"
          value={stats.drops}
          icon={<TrendingDown className="h-4 w-4" />}
          tone="success"
          hint={stats.drops > 0 ? 'price drops' : 'none'}
          loading={activity.isLoading}
        />
        <StatTile
          label="Rises"
          value={stats.rises}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="warning"
          hint={stats.rises > 0 ? 'price rises' : 'none'}
          loading={activity.isLoading}
        />
        <StatTile
          label="Stock shifts"
          value={stats.stockShifts}
          icon={<Radio className="h-4 w-4" />}
          tone="accent"
          hint="in/out changes"
          loading={activity.isLoading}
        />
      </BentoGrid>

      {activity.isLoading ? (
        <LoadingList />
      ) : activity.isError ? (
        <EmptyState text="Failed to load activity." />
      ) : entries.length === 0 ? (
        <EmptyState text="No activity yet. Run a scrape to populate." />
      ) : (
        <BentoGrid cols={6}>
          <BentoTile colSpan={6}>
            <TileHeader
              eyebrow="Feed"
              title={`${entries.length} recent events`}
              icon={<ActivityIcon className="h-4 w-4" />}
            />
            <ul className="gbd-stagger mt-3 space-y-1.5">
              {entries.map((e) => (
                <ActivityRow key={e.id} entry={e} symbol={symbol} />
              ))}
            </ul>
          </BentoTile>
        </BentoGrid>
      )}
    </div>
  )
}

interface ActivityRowProps {
  entry: ActivityEntry
  symbol: string
}

function ActivityRow({ entry, symbol }: ActivityRowProps) {
  const live = useLiveTime(entry.scraped_at)
  const delta = entry.price_delta
  const deltaColor =
    delta == null || delta === 0
      ? 'text-muted-foreground'
      : delta < 0
        ? 'text-success'
        : 'text-destructive'
  const priceNow = entry.discounted_price ?? entry.price
  const isDrop = entry.change_type === 'price_drop'
  const isRise = entry.change_type === 'price_rise'

  return (
    <li
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] items-center gap-3 rounded-md border border-border bg-background/40 px-3 py-2 transition-colors hover:bg-accent/25',
        isDrop && 'border-emerald-500/20',
        isRise && 'border-destructive/20',
      )}
    >
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

      <Badge
        variant={isDrop ? 'success' : isRise ? 'destructive' : 'outline'}
        className="whitespace-nowrap text-[10px]"
      >
        {CHANGE_LABEL[entry.change_type] ?? entry.change_type}
      </Badge>

      <div className="w-20 text-right text-sm font-semibold tabular-nums sm:w-24">
        {priceNow != null ? formatMoney(priceNow, symbol) : '—'}
      </div>

      <div className={`w-16 text-right text-xs tabular-nums sm:w-20 ${deltaColor}`}>
        {formatDelta(delta)}
      </div>

      <div className="flex items-center gap-2">
        <StockPill status={entry.stock_status} />
        <span className="hidden w-20 text-right text-[11px] text-muted-foreground sm:block">
          {live}
        </span>
      </div>
    </li>
  )
}

interface StatsResult {
  total: number
  drops: number
  rises: number
  stockShifts: number
}

function computeStats(entries: ActivityEntry[]): StatsResult {
  let drops = 0
  let rises = 0
  let stockShifts = 0
  for (const e of entries) {
    if (e.change_type === 'price_drop') drops += 1
    if (e.change_type === 'price_rise') rises += 1
    if (
      e.change_type === 'back_in_stock' ||
      e.change_type === 'out_of_stock' ||
      e.change_type === 'stock_change'
    ) {
      stockShifts += 1
    }
  }
  return { total: entries.length, drops, rises, stockShifts }
}

function LoadingList() {
  return (
    <BentoGrid cols={6}>
      <BentoTile colSpan={6}>
        <Skeleton className="h-5 w-40" />
        <div className="mt-3 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </BentoTile>
    </BentoGrid>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}
