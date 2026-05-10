import { useDeferredValue, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Activity as ActivityIcon,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Radio,
  Store as StoreIcon,
  Tag,
  TrendingDown,
  TrendingUp,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { BentoGrid, BentoTile, TileHeader } from '@/components/ui/bento'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatTile } from '@/components/ui/stat-tile'
import { Skeleton } from '@/components/ui/skeleton'
import { StockPill } from '@/components/products/StockPill'
import { activityApi } from '@/api'
import {
  useCurrencyCode,
  useCurrencySymbol,
  useExchangeRates,
  useLocale,
  usePriceDisplayMode,
  useTimezone,
} from '@/hooks/useSettings'
import { useLiveTime } from '@/hooks/useLiveTime'
import type { ActivityEntry } from '@/api'
import {
  cn,
  formatApiDateTime,
  formatDelta,
  formatDisplayMoney,
  formatLocalEquivalent,
  parseApiDate,
} from '@/lib/utils'
import type { PriceDisplayMode } from '@/lib/utils'

const REFRESH_MS = 30_000
const EMPTY_ENTRIES: ActivityEntry[] = []
const MAX_CHANGE_BADGES = 3

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

interface ActivityStoreGroup {
  storeId: number
  storeName: string
  latestAt: string
  entries: ActivityEntry[]
}

interface ActivityGroup {
  productId: number
  productName: string
  latestAt: string
  entries: ActivityEntry[]
  stores: ActivityStoreGroup[]
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
  const localCurrency = useCurrencyCode()
  const exchangeRates = useExchangeRates()
  const priceDisplayMode = usePriceDisplayMode()
  const locale = useLocale()
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim())
  const activity = useQuery<ActivityEntry[]>({
    queryKey: ['activity'],
    queryFn: () => activityApi.list(100),
    refetchInterval: REFRESH_MS,
    staleTime: 10_000,
  })

  const entries = activity.data ?? EMPTY_ENTRIES
  const stats = useMemo(() => computeStats(entries), [entries])
  const groups = useMemo(() => groupActivity(entries), [entries])
  const filteredGroups = useMemo(
    () => filterActivityGroups(groups, deferredSearch),
    [groups, deferredSearch],
  )
  const filteredEntriesCount = useMemo(
    () => filteredGroups.reduce((total, group) => total + group.entries.length, 0),
    [filteredGroups],
  )
  const hasSearch = search.trim().length > 0

  // Collapsible state. Track explicit overrides separately from the
  // derived "default open when searching" so a user toggle survives the
  // next keystroke without locking the user out of the search-driven
  // auto-expand behavior the next time they clear the box.
  const [openProducts, setOpenProducts] = useState<Set<number>>(() => new Set())
  const [closedProducts, setClosedProducts] = useState<Set<number>>(
    () => new Set(),
  )
  const [openStores, setOpenStores] = useState<Set<string>>(() => new Set())
  const [closedStores, setClosedStores] = useState<Set<string>>(() => new Set())

  const toggleProduct = (productId: number, defaultOpen: boolean) => {
    const isOpen = openProducts.has(productId)
      ? true
      : closedProducts.has(productId)
        ? false
        : defaultOpen
    if (isOpen) {
      setClosedProducts((s) => new Set(s).add(productId))
      setOpenProducts((s) => {
        if (!s.has(productId)) return s
        const next = new Set(s)
        next.delete(productId)
        return next
      })
    } else {
      setOpenProducts((s) => new Set(s).add(productId))
      setClosedProducts((s) => {
        if (!s.has(productId)) return s
        const next = new Set(s)
        next.delete(productId)
        return next
      })
    }
  }

  const toggleStore = (key: string, defaultOpen: boolean) => {
    const isOpen = openStores.has(key)
      ? true
      : closedStores.has(key)
        ? false
        : defaultOpen
    if (isOpen) {
      setClosedStores((s) => new Set(s).add(key))
      setOpenStores((s) => {
        if (!s.has(key)) return s
        const next = new Set(s)
        next.delete(key)
        return next
      })
    } else {
      setOpenStores((s) => new Set(s).add(key))
      setClosedStores((s) => {
        if (!s.has(key)) return s
        const next = new Set(s)
        next.delete(key)
        return next
      })
    }
  }

  const expandAll = () => {
    setOpenProducts(new Set(filteredGroups.map((g) => g.productId)))
    setClosedProducts(new Set())
    setOpenStores(
      new Set(
        filteredGroups.flatMap((g) =>
          g.stores.map((s) => storeKey(g.productId, s.storeId)),
        ),
      ),
    )
    setClosedStores(new Set())
  }

  const collapseAll = () => {
    setOpenProducts(new Set())
    setClosedProducts(new Set(filteredGroups.map((g) => g.productId)))
    setOpenStores(new Set())
    setClosedStores(
      new Set(
        filteredGroups.flatMap((g) =>
          g.stores.map((s) => storeKey(g.productId, s.storeId)),
        ),
      ),
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity"
        description="Live feed of scrapes, stock shifts, and price changes."
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
          label="Changes"
          value={stats.total}
          icon={<ActivityIcon className="h-4 w-4" />}
          hint="last 100"
          tone="primary"
          loading={activity.isLoading}
        />
        <StatTile
          label="Products"
          value={groups.length}
          icon={<StoreIcon className="h-4 w-4" />}
          hint="grouped rows"
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
              title={
                hasSearch
                  ? `${filteredGroups.length} matches, ${filteredEntriesCount} changes`
                  : `${groups.length} products, ${entries.length} changes`
              }
              icon={<ActivityIcon className="h-4 w-4" />}
              action={
                <div className="flex w-full flex-wrap items-center gap-2 sm:flex-nowrap sm:justify-end">
                  <div className="relative w-full sm:max-w-md">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search product, store, change, or stock"
                      className="pl-9 pr-10"
                      aria-label="Search activity"
                    />
                    {hasSearch ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 hover:translate-y-[-50%]"
                        onClick={() => setSearch('')}
                        aria-label="Clear activity search"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={expandAll}
                      disabled={filteredGroups.length === 0}
                    >
                      Expand all
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={collapseAll}
                      disabled={filteredGroups.length === 0}
                    >
                      Collapse all
                    </Button>
                  </div>
                </div>
              }
            />
            {filteredGroups.length === 0 ? (
              <div className="mt-3 rounded-md border border-dashed border-border bg-card/35 p-8 text-center text-sm text-muted-foreground">
                No activity matched <span className="font-medium text-foreground">{search.trim()}</span>.
              </div>
            ) : (
              <ul className="gbd-stagger mt-3 space-y-1.5">
                {filteredGroups.map((group) => {
                  const productOpen = openProducts.has(group.productId)
                    ? true
                    : closedProducts.has(group.productId)
                      ? false
                      : hasSearch
                  return (
                    <ActivityProductRow
                      key={group.productId}
                      group={group}
                      open={productOpen}
                      onToggle={() => toggleProduct(group.productId, hasSearch)}
                      isStoreOpen={(storeId) => {
                        const key = storeKey(group.productId, storeId)
                        return openStores.has(key)
                          ? true
                          : closedStores.has(key)
                            ? false
                            : hasSearch
                      }}
                      onToggleStore={(storeId) =>
                        toggleStore(storeKey(group.productId, storeId), hasSearch)
                      }
                      symbol={symbol}
                      displayMode={priceDisplayMode}
                      locale={locale}
                      localCurrency={localCurrency}
                      exchangeRates={exchangeRates}
                    />
                  )
                })}
              </ul>
            )}
          </BentoTile>
        </BentoGrid>
      )}
    </div>
  )
}

interface ActivityProductRowProps {
  group: ActivityGroup
  open: boolean
  onToggle: () => void
  isStoreOpen: (storeId: number) => boolean
  onToggleStore: (storeId: number) => void
  symbol: string
  displayMode: PriceDisplayMode
  locale: string
  localCurrency: string
  exchangeRates: Record<string, number>
}

function ActivityProductRow({
  group,
  open,
  onToggle,
  isStoreOpen,
  onToggleStore,
  symbol,
  displayMode,
  locale,
  localCurrency,
  exchangeRates,
}: ActivityProductRowProps) {
  const live = useLiveTime(group.latestAt)
  const primaryChange = normalizeChangeType(group.entries[0]?.change_type ?? 'unknown')
  const changePresentation = CHANGE_PRESENTATION[primaryChange]
  const ChangeIcon = changePresentation.icon
  const changes = uniqueChanges(group.entries)
  const hasDrop = changes.includes('price_down')
  const hasRise = changes.includes('price_up')
  const storeCount = group.stores.length

  return (
    <li
      className={cn(
        'rounded-md border border-border bg-background/40 transition-colors hover:bg-accent/25',
        hasDrop && 'border-emerald-500/20',
        hasRise && 'border-destructive/20',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-3 py-3">
        <div className="flex min-w-0 items-start gap-2">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? 'Collapse product' : 'Expand product'}
            className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
          >
            {open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
          <div className="min-w-0">
            <Link
              to={`/product/${group.productId}`}
              className="line-clamp-1 text-sm font-medium hover:underline"
            >
              {group.productName}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <StoreIcon className="h-3 w-3" />
                {storeCount} {storeCount === 1 ? 'store' : 'stores'}
              </span>
              <span>·</span>
              <span>
                {group.entries.length}{' '}
                {group.entries.length === 1 ? 'change' : 'changes'}
              </span>
              <span>{live}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-1.5">
          <Badge
            variant={changePresentation.variant}
            className="flex items-center gap-1.5 whitespace-nowrap text-[10px]"
          >
            <ChangeIcon className="h-3 w-3" />
            {changePresentation.label}
          </Badge>
          {changes.slice(1, MAX_CHANGE_BADGES).map((change) => {
            const presentation = CHANGE_PRESENTATION[change]
            const Icon = presentation.icon
            return (
              <Badge
                key={change}
                variant={presentation.variant}
                className="flex items-center gap-1.5 whitespace-nowrap text-[10px]"
              >
                <Icon className="h-3 w-3" />
                {presentation.label}
              </Badge>
            )
          })}
          {changes.length > MAX_CHANGE_BADGES ? (
            <Badge variant="muted" className="text-[10px]">
              +{changes.length - MAX_CHANGE_BADGES}
            </Badge>
          ) : null}
        </div>
      </div>

      {open ? (
        <div className="gbd-expand space-y-1.5 border-t border-dashed border-border/70 px-3 pb-3 pt-2 sm:px-4">
          {group.stores.map((store) => (
            <ActivityStoreRow
              key={store.storeId}
              store={store}
              open={isStoreOpen(store.storeId)}
              onToggle={() => onToggleStore(store.storeId)}
              symbol={symbol}
              displayMode={displayMode}
              locale={locale}
              localCurrency={localCurrency}
              exchangeRates={exchangeRates}
            />
          ))}
        </div>
      ) : null}
    </li>
  )
}

interface ActivityStoreRowProps {
  store: ActivityStoreGroup
  open: boolean
  onToggle: () => void
  symbol: string
  displayMode: PriceDisplayMode
  locale: string
  localCurrency: string
  exchangeRates: Record<string, number>
}

function ActivityStoreRow({
  store,
  open,
  onToggle,
  symbol,
  displayMode,
  locale,
  localCurrency,
  exchangeRates,
}: ActivityStoreRowProps) {
  const timezone = useTimezone()
  const live = useLiveTime(store.latestAt)
  const primaryChange = normalizeChangeType(
    store.entries[0]?.change_type ?? 'unknown',
  )
  const presentation = CHANGE_PRESENTATION[primaryChange]
  const ChangeIcon = presentation.icon
  const changes = uniqueChanges(store.entries)

  return (
    <div className="rounded-md border border-border/70 bg-card/40">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-accent/30"
      >
        <div className="flex min-w-0 items-center gap-2">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <StoreIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{store.storeName}</span>
          <span className="text-[11px] text-muted-foreground">
            · {store.entries.length}{' '}
            {store.entries.length === 1 ? 'change' : 'changes'}
          </span>
          <span className="text-[11px] text-muted-foreground">{live}</span>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Badge
            variant={presentation.variant}
            className="flex items-center gap-1.5 whitespace-nowrap text-[10px]"
          >
            <ChangeIcon className="h-3 w-3" />
            {presentation.label}
          </Badge>
          {changes.slice(1, MAX_CHANGE_BADGES).map((change) => {
            const p = CHANGE_PRESENTATION[change]
            const Icon = p.icon
            return (
              <Badge
                key={change}
                variant={p.variant}
                className="flex items-center gap-1.5 whitespace-nowrap text-[10px]"
              >
                <Icon className="h-3 w-3" />
                {p.label}
              </Badge>
            )
          })}
        </div>
      </button>

      {open ? (
        <div className="gbd-expand divide-y divide-border/70 border-t border-dashed border-border/70">
          {store.entries.map((entry) => (
            <ActivityChangeLine
              key={entry.id}
              entry={entry}
              symbol={symbol}
              timezone={timezone}
              displayMode={displayMode}
              locale={locale}
              localCurrency={localCurrency}
              exchangeRates={exchangeRates}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function storeKey(productId: number, storeId: number): string {
  return `${productId}:${storeId}`
}

interface ActivityChangeLineProps {
  entry: ActivityEntry
  symbol: string
  timezone: string
  displayMode: PriceDisplayMode
  locale: string
  localCurrency: string
  exchangeRates: Record<string, number>
}

function ActivityChangeLine({
  entry,
  symbol,
  timezone,
  displayMode,
  locale,
  localCurrency,
  exchangeRates,
}: ActivityChangeLineProps) {
  const normalizedChange = normalizeChangeType(entry.change_type)
  const changePresentation = CHANGE_PRESENTATION[normalizedChange]
  const ChangeIcon = changePresentation.icon
  const priceNow = entry.discounted_price ?? entry.price
  const priceRaw = entry.discounted_price != null ? entry.raw_discounted : entry.raw_price
  const hasPriceMovement =
    normalizedChange === 'price_down' ||
    normalizedChange === 'price_up' ||
    normalizedChange === 'price_and_stock' ||
    (entry.previous_price != null &&
      priceNow != null &&
      Math.abs(entry.previous_price - priceNow) > 0.001)
  const delta = entry.price_delta
  const deltaColor =
    delta == null || delta === 0
      ? 'text-muted-foreground'
      : delta < 0
        ? 'text-success'
        : 'text-destructive'
  const localPrice =
    priceNow != null
      ? formatLocalEquivalent(priceNow, {
          sourceCurrency: entry.currency_code,
          localCurrency,
          exchangeRates,
          symbol,
        })
      : null
  const dealerLocal =
    entry.dealer_price != null
      ? formatLocalEquivalent(entry.dealer_price, {
          sourceCurrency: entry.currency_code,
          localCurrency,
          exchangeRates,
          symbol,
        })
      : null

  return (
    <div className="grid gap-3 px-3 py-2 md:grid-cols-[minmax(150px,1fr)_auto_minmax(210px,auto)_minmax(160px,auto)] md:items-center">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{entry.store_name}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {formatApiDateTime(entry.scraped_at, timezone)}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 md:max-w-[12rem]">
        <Badge
          variant={changePresentation.variant}
          className="w-fit items-center gap-1.5 whitespace-nowrap text-[10px]"
        >
          <ChangeIcon className="h-3 w-3" />
          {changePresentation.label}
        </Badge>
        {delta != null && delta !== 0 ? (
          <Badge
            variant={delta < 0 ? 'success' : 'destructive'}
            className="whitespace-nowrap text-[10px]"
          >
            Price {formatDelta(delta)}
          </Badge>
        ) : null}
        {entry.previous_stock_status &&
        entry.stock_status &&
        entry.previous_stock_status !== entry.stock_status ? (
          <Badge variant="warning" className="whitespace-nowrap text-[10px]">
            Stock changed
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-col items-start gap-1 md:items-end">
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          {hasPriceMovement && entry.previous_price != null && priceNow != null ? (
            <>
              <span className="text-xs tabular-nums text-muted-foreground line-through">
                {formatDisplayMoney(entry.previous_price, {
                  symbol,
                  mode: displayMode,
                  currencyCode: entry.currency_code,
                  locale,
                })}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm font-semibold tabular-nums">
                {formatDisplayMoney(priceNow, {
                  symbol,
                  mode: displayMode,
                  currencyCode: entry.currency_code,
                  raw: priceRaw,
                  locale,
                })}
              </span>
            </>
          ) : priceNow != null ? (
            <span className="text-sm font-semibold tabular-nums">
              {formatDisplayMoney(priceNow, {
                symbol,
                mode: displayMode,
                currencyCode: entry.currency_code,
                raw: priceRaw,
                locale,
              })}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">-</span>
          )}
          {delta != null ? (
            <span className={`text-xs tabular-nums ${deltaColor}`}>
              {formatDelta(delta)}
            </span>
          ) : null}
          {entry.dealer_price != null ? (
            <Badge variant="outline" className="gap-1.5 whitespace-nowrap text-[10px]">
              <Tag className="h-3 w-3" />
              Dealer{' '}
              {formatDisplayMoney(entry.dealer_price, {
                symbol,
                mode: displayMode,
                currencyCode: entry.currency_code,
                raw: entry.raw_dealer,
                locale,
              })}
            </Badge>
          ) : null}
        </div>
        {localPrice || dealerLocal ? (
          <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground md:justify-end">
            {localPrice ? <span>Local {localPrice}</span> : null}
            {dealerLocal ? <span>Dealer local {dealerLocal}</span> : null}
          </div>
        ) : null}
      </div>

      <StockTransition entry={entry} />
    </div>
  )
}

function StockTransition({ entry }: { entry: ActivityEntry }) {
  const previous = entry.previous_stock_status
  const current = entry.stock_status
  if (previous && current && previous !== current) {
    return (
      <div className="flex items-center gap-2 md:justify-end">
        <StockPill status={previous} />
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        <StockPill status={current} />
      </div>
    )
  }
  return (
    <div className="flex md:justify-end">
      <StockPill status={current} />
    </div>
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

function groupActivity(entries: ActivityEntry[]): ActivityGroup[] {
  const byProduct = new Map<number, ActivityGroup>()
  for (const entry of entries) {
    const current = byProduct.get(entry.product_id)
    if (!current) {
      byProduct.set(entry.product_id, {
        productId: entry.product_id,
        productName: entry.product_name,
        latestAt: entry.scraped_at,
        entries: [entry],
        stores: [],
      })
      continue
    }

    current.entries.push(entry)
    const entryTime = parseApiDate(entry.scraped_at)?.getTime() ?? 0
    const currentTime = parseApiDate(current.latestAt)?.getTime() ?? 0
    if (entryTime > currentTime) {
      current.latestAt = entry.scraped_at
    }
  }

  return Array.from(byProduct.values())
    .map((group) => {
      const sortedEntries = [...group.entries].sort(
        (a, b) =>
          (parseApiDate(b.scraped_at)?.getTime() ?? 0) -
          (parseApiDate(a.scraped_at)?.getTime() ?? 0),
      )
      return {
        ...group,
        entries: sortedEntries,
        stores: groupByStore(sortedEntries),
      }
    })
    .sort(
      (a, b) =>
        (parseApiDate(b.latestAt)?.getTime() ?? 0) -
        (parseApiDate(a.latestAt)?.getTime() ?? 0),
    )
}

function groupByStore(entries: ActivityEntry[]): ActivityStoreGroup[] {
  const byStore = new Map<number, ActivityStoreGroup>()
  for (const entry of entries) {
    const current = byStore.get(entry.store_id)
    if (!current) {
      byStore.set(entry.store_id, {
        storeId: entry.store_id,
        storeName: entry.store_name,
        latestAt: entry.scraped_at,
        entries: [entry],
      })
      continue
    }
    current.entries.push(entry)
    const entryTime = parseApiDate(entry.scraped_at)?.getTime() ?? 0
    const currentTime = parseApiDate(current.latestAt)?.getTime() ?? 0
    if (entryTime > currentTime) {
      current.latestAt = entry.scraped_at
    }
  }

  return Array.from(byStore.values())
    .map((store) => ({
      ...store,
      entries: [...store.entries].sort(
        (a, b) =>
          (parseApiDate(b.scraped_at)?.getTime() ?? 0) -
          (parseApiDate(a.scraped_at)?.getTime() ?? 0),
      ),
    }))
    .sort(
      (a, b) =>
        (parseApiDate(b.latestAt)?.getTime() ?? 0) -
        (parseApiDate(a.latestAt)?.getTime() ?? 0),
    )
}

function uniqueChanges(entries: ActivityEntry[]): NormalizedChangeType[] {
  const seen = new Set<NormalizedChangeType>()
  for (const entry of entries) {
    seen.add(normalizeChangeType(entry.change_type))
  }
  return Array.from(seen)
}

function filterActivityGroups(
  groups: ActivityGroup[],
  query: string,
): ActivityGroup[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return groups

  const terms = normalizedQuery.split(/\s+/).filter(Boolean)
  return groups.filter((group) => matchesActivityGroup(group, terms))
}

function matchesActivityGroup(group: ActivityGroup, terms: string[]): boolean {
  const haystack = [
    group.productName,
    ...group.entries.flatMap((entry) => [
      entry.store_name,
      entry.change_type,
      CHANGE_PRESENTATION[normalizeChangeType(entry.change_type)].label,
      entry.stock_status ?? '',
      entry.previous_stock_status ?? '',
      entry.dealer_price != null ? 'dealer' : '',
    ]),
  ]
    .join(' ')
    .toLowerCase()
    .replace(/_/g, ' ')

  return terms.every((term) => haystack.includes(term))
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
    <div className="rounded-md border border-dashed border-border bg-card/50 p-12 text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}
