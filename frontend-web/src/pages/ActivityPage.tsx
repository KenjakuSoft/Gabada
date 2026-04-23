import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Activity as ActivityIcon,
  CircleDot,
  Radio,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
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

const REFRESH_MS = 30_000
const EMPTY_ENTRIES: ActivityEntry[] = []

type NormalizedChangeType =
  | 'price_down'
  | 'price_up'
  | 'price_and_stock'
  | 'stock_in'
  | 'stock_out'
  | 'stock_change'
  | 'new'
  | 'unknown'

interface ChangePresentation {
  label: string
  icon: LucideIcon
  variant: 'success' | 'warning' | 'info' | 'destructive' | 'outline'
}

const CHANGE_PRESENTATION: Record<NormalizedChangeType, ChangePresentation> = {
  price_down: {
    label: 'Price down',
    icon: TrendingDown,
    variant: 'success',
  },
  price_up: {
    label: 'Price up',
    icon: TrendingUp,
    variant: 'destructive',
  },
  price_and_stock: {
    label: 'Price + stock',
    icon: ActivityIcon,
    variant: 'info',
  },
  stock_in: {
    label: 'Back in stock',
    icon: CircleDot,
    variant: 'success',
  },
  stock_out: {
    label: 'Out of stock',
    icon: Radio,
    variant: 'warning',
  },
  stock_change: {
    label: 'Stock change',
    icon: Radio,
    variant: 'outline',
  },
  new: {
    label: 'First scrape',
    icon: CircleDot,
    variant: 'info',
  },
  unknown: {
    label: 'Update',
    icon: ActivityIcon,
    variant: 'outline',
  },
}

function normalizeChangeType(changeType: string): NormalizedChangeType {
  switch (changeType) {
    case 'price_drop':
      return 'price_down'
    case 'price_rise':
      return 'price_up'
    case 'back_in_stock':
      return 'stock_in'
    case 'out_of_stock':
      return 'stock_out'
    case 'initial':
      return 'new'
    case 'price_down':
    case 'price_up':
    case 'price_and_stock':
    case 'stock_in':
    case 'stock_out':
    case 'stock_change':
    case 'new':
      return changeType
    default:
      return 'unknown'
  }
}

export function ActivityPage() {
  const symbol = useCurrencySymbol()
  const activity = useQuery<ActivityEntry[]>({
    queryKey: ['activity'],
    queryFn: () => activityApi.list(100),
    refetchInterval: REFRESH_MS,
    staleTime: 10_000,
  })

  const entries = activity.data ?? EMPTY_ENTRIES
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
  const normalizedChange = normalizeChangeType(entry.change_type)
  const changePresentation = CHANGE_PRESENTATION[normalizedChange]
  const ChangeIcon = changePresentation.icon
  const deltaColor =
    delta == null || delta === 0
      ? 'text-muted-foreground'
      : delta < 0
        ? 'text-success'
        : 'text-destructive'
  const priceNow = entry.discounted_price ?? entry.price
  const isDrop = normalizedChange === 'price_down'
  const isRise = normalizedChange === 'price_up'

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
        variant={changePresentation.variant}
        className="flex items-center gap-1.5 whitespace-nowrap text-[10px]"
      >
        <ChangeIcon className="h-3 w-3" />
        {changePresentation.label}
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
    const normalizedChange = normalizeChangeType(e.change_type)
    if (normalizedChange === 'price_down') drops += 1
    if (normalizedChange === 'price_up') rises += 1
    if (
      normalizedChange === 'stock_in' ||
      normalizedChange === 'stock_out' ||
      normalizedChange === 'stock_change' ||
      normalizedChange === 'price_and_stock'
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
