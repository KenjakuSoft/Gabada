import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2, Pin, PinOff, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { scraperApi } from '@/api'
import { toast } from '@/components/ui/toast-store'
import { cn, formatMoney } from '@/lib/utils'
import type {
  BuyAreaItem,
  BuyAreaItemKind,
  BuyAreaPick,
  BuyAreaPicksResponse,
  BuyAreaPickTarget,
} from '@/api'

const TARGET_LABELS: Record<BuyAreaPickTarget, string> = {
  price: 'Price',
  discounted_price: 'Discount',
  dealer_price: 'Dealer',
  stock_status: 'Stock',
  title: 'Title',
}

const TARGET_ORDER: BuyAreaPickTarget[] = [
  'price',
  'discounted_price',
  'dealer_price',
  'stock_status',
  'title',
]

const KIND_VARIANT: Record<
  BuyAreaItemKind,
  'default' | 'success' | 'warning' | 'info' | 'muted' | 'outline' | 'secondary'
> = {
  title: 'info',
  price: 'success',
  qualifier: 'warning',
  badge: 'default',
  label: 'muted',
  stock: 'secondary',
  image: 'outline',
  other: 'outline',
}

interface BuyAreaPanelProps {
  buyArea: BuyAreaItem[]
  buyAreaRoot: string | null
  productStoreId: number | null
  symbol?: string
  // Optional integration with the parent's test mutation. When provided,
  // the panel renders a primary Test button next to the header so the
  // user can confirm "this is what my pinned picks produce" without
  // hunting for the Test button elsewhere on the page.
  onTest?: () => void
  testIsPending?: boolean
}

export function BuyAreaPanel({
  buyArea,
  buyAreaRoot,
  productStoreId,
  symbol = '',
  onTest,
  testIsPending = false,
}: BuyAreaPanelProps) {
  const queryClient = useQueryClient()

  const picksQuery = useQuery<BuyAreaPicksResponse>({
    queryKey: ['buyAreaPicks', productStoreId],
    queryFn: () => scraperApi.listBuyAreaPicks(productStoreId as number),
    enabled: productStoreId != null,
  })

  const upsertMutation = useMutation({
    mutationFn: (variables: { item: BuyAreaItem; target: BuyAreaPickTarget }) => {
      if (productStoreId == null) {
        throw new Error('productStoreId required to pin a buy-area pick')
      }
      const pick: BuyAreaPick = {
        target_field: variables.target,
        selector: variables.item.selector,
        dom_path: variables.item.dom_path,
        kind: variables.item.kind,
        text: variables.item.text,
        value: variables.item.value,
        qualifier: variables.item.qualifier,
        label_before: variables.item.label_before,
        label_after: variables.item.label_after,
        picked_at: new Date().toISOString(),
      }
      return scraperApi.upsertBuyAreaPick({
        product_store_id: productStoreId,
        pick,
      })
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(['buyAreaPicks', productStoreId], data)
      toast.success(
        `Pinned as ${TARGET_LABELS[variables.target]}`,
        variables.item.text.slice(0, 60),
      )
    },
    onError: () =>
      toast.error('Pin failed', 'Could not save the buy-area pick'),
  })

  const deleteMutation = useMutation({
    mutationFn: (target: BuyAreaPickTarget) => {
      if (productStoreId == null) {
        throw new Error('productStoreId required to clear a buy-area pick')
      }
      return scraperApi.deleteBuyAreaPick(productStoreId, target)
    },
    onSuccess: (data, target) => {
      queryClient.setQueryData(['buyAreaPicks', productStoreId], data)
      toast.success(`Unpinned ${TARGET_LABELS[target]}`)
    },
    onError: () =>
      toast.error('Unpin failed', 'Could not clear the buy-area pick'),
  })

  // Group existing picks by their target_field for quick lookup. Reading
  // ``picksQuery.data`` directly inside the memo (rather than via a derived
  // ``picks`` const) keeps the dependency stable when react-query returns
  // referentially-equal data.
  const picksByTarget = useMemo(() => {
    const map = new Map<BuyAreaPickTarget, BuyAreaPick>()
    for (const pick of picksQuery.data?.picks ?? []) {
      if (TARGET_ORDER.includes(pick.target_field)) {
        map.set(pick.target_field, pick)
      }
    }
    return map
  }, [picksQuery.data])
  const picks = picksQuery.data?.picks ?? []

  if (buyArea.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
        No buy-area items captured. The scraper could not see a product
        buy-box on this page - likely a partial bot block, a login wall, or
        a layout the heuristic detector does not recognise. The price (if
        any) came from server-rendered metadata only.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline gap-3">
        <h3 className="text-base font-semibold">Buy Area</h3>
        {buyAreaRoot ? (
          <span className="text-xs text-muted-foreground">
            scope: <code className="rounded bg-muted px-1">{buyAreaRoot}</code>
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {buyArea.length} item{buyArea.length === 1 ? '' : 's'}
        </span>
        {productStoreId == null ? (
          <Badge variant="muted" className="ml-auto">
            Open from a product to pin items
          </Badge>
        ) : null}
        {onTest ? (
          <Button
            size="sm"
            onClick={onTest}
            disabled={testIsPending}
            className="ml-auto"
          >
            {testIsPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Test pinned picks
          </Button>
        ) : null}
      </header>

      {productStoreId != null && picks.length > 0 ? (
        <PinnedPicksRow
          picks={picks}
          symbol={symbol}
          onUnpin={(target) => deleteMutation.mutate(target)}
          unpinPending={deleteMutation.isPending}
        />
      ) : null}

      <ol className="divide-y rounded-md border">
        {buyArea.map((item) => (
          <BuyAreaRow
            key={`${item.order}-${item.selector ?? item.text}`}
            item={item}
            symbol={symbol}
            productStoreId={productStoreId}
            currentTargets={
              productStoreId == null
                ? []
                : matchingTargets(item, picksByTarget)
            }
            onPin={(target) =>
              upsertMutation.mutate({ item, target })
            }
            pinPending={upsertMutation.isPending}
          />
        ))}
      </ol>
    </div>
  )
}

interface PinnedPicksRowProps {
  picks: BuyAreaPick[]
  symbol: string
  onUnpin: (target: BuyAreaPickTarget) => void
  unpinPending: boolean
}

function PinnedPicksRow({
  picks,
  symbol,
  onUnpin,
  unpinPending,
}: PinnedPicksRowProps) {
  return (
    <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
        <Pin className="h-3.5 w-3.5" />
        Pinned picks
      </div>
      <ul className="flex flex-wrap gap-2">
        {picks.map((pick) => (
          <li
            key={pick.target_field}
            className="flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs shadow-sm"
          >
            <span className="font-semibold">
              {TARGET_LABELS[pick.target_field] ?? pick.target_field}
            </span>
            <span className="text-muted-foreground">-&gt;</span>
            <span className="font-mono">
              {pick.qualifier ??
                (pick.value != null
                  ? formatMoney(pick.value, symbol)
                  : pick.text)}
            </span>
            <button
              type="button"
              onClick={() => onUnpin(pick.target_field)}
              disabled={unpinPending}
              className="rounded-full p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
              aria-label={`Unpin ${TARGET_LABELS[pick.target_field]}`}
              title="Unpin"
            >
              <PinOff className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface BuyAreaRowProps {
  item: BuyAreaItem
  symbol: string
  productStoreId: number | null
  currentTargets: BuyAreaPickTarget[]
  onPin: (target: BuyAreaPickTarget) => void
  pinPending: boolean
}

function BuyAreaRow({
  item,
  symbol,
  productStoreId,
  currentTargets,
  onPin,
  pinPending,
}: BuyAreaRowProps) {
  const isPinned = currentTargets.length > 0
  return (
    <li
      className={cn(
        'flex flex-wrap items-start gap-3 px-3 py-2 text-sm',
        isPinned && 'bg-emerald-500/5',
      )}
    >
      <span className="w-8 shrink-0 text-right font-mono text-xs text-muted-foreground">
        #{item.order}
      </span>
      <Badge variant={KIND_VARIANT[item.kind] ?? 'outline'}>
        {item.kind}
      </Badge>
      <div className="min-w-0 flex-1 space-y-1">
        <div
          className={cn(
            'break-words font-medium',
            item.struck && 'text-muted-foreground line-through',
          )}
        >
          {item.text}
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          {item.value != null ? (
            <span className="font-mono text-foreground">
              {formatMoney(item.value, symbol)}
            </span>
          ) : null}
          {item.qualifier ? (
            <Badge variant="warning" className="font-normal">
              {item.qualifier}
            </Badge>
          ) : null}
          {item.struck ? (
            <Badge variant="muted" className="font-normal">
              struck
            </Badge>
          ) : null}
          {item.is_button ? (
            <Badge variant="muted" className="font-normal">
              {item.is_disabled ? 'button (disabled)' : 'button'}
            </Badge>
          ) : null}
          {item.label_before ? (
            <span>before: <em>{item.label_before}</em></span>
          ) : null}
          {item.label_after ? (
            <span>after: <em>{item.label_after}</em></span>
          ) : null}
          {item.near_badges.length > 0 ? (
            <span>badges: {item.near_badges.join(', ')}</span>
          ) : null}
          {item.selector ? (
            <code className="truncate rounded bg-muted px-1 py-0.5 text-[10px]">
              {item.selector}
            </code>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {currentTargets.map((target) => (
          <Badge key={target} variant="success" className="gap-1">
            <Sparkles className="h-3 w-3" />
            {TARGET_LABELS[target]}
          </Badge>
        ))}
        {productStoreId != null ? (
          <PinSelect
            disabled={pinPending}
            onPick={(target) => onPin(target)}
          />
        ) : null}
      </div>
    </li>
  )
}

interface PinSelectProps {
  disabled: boolean
  onPick: (target: BuyAreaPickTarget) => void
}

function PinSelect({ disabled, onPick }: PinSelectProps) {
  return (
    <div className="flex items-center gap-1">
      <Select
        defaultValue=""
        disabled={disabled}
        onChange={(event) => {
          const value = event.target.value as BuyAreaPickTarget | ''
          if (!value) return
          onPick(value)
          event.target.value = ''
        }}
        aria-label="Track as"
        className="h-8 text-xs"
      >
        <option value="">Track as...</option>
        {TARGET_ORDER.map((target) => (
          <option key={target} value={target}>
            {TARGET_LABELS[target]}
          </option>
        ))}
      </Select>
    </div>
  )
}

function matchingTargets(
  item: BuyAreaItem,
  picksByTarget: Map<BuyAreaPickTarget, BuyAreaPick>,
): BuyAreaPickTarget[] {
  // Show a "pinned" badge on the row when the saved pick still matches the
  // live item. Selector + text is strict; the DOM path fallback keeps the
  // badge stable when a selector is reformatted for the same element.
  const matches: BuyAreaPickTarget[] = []
  for (const target of TARGET_ORDER) {
    const pick = picksByTarget.get(target)
    if (!pick) continue
    const sameSelector =
      Boolean(pick.selector && item.selector && pick.selector === item.selector)
    const sameDomPath =
      Boolean(pick.dom_path && item.dom_path && pick.dom_path === item.dom_path)
    if ((sameSelector || sameDomPath) && pick.text === item.text) {
      matches.push(target)
    }
  }
  return matches
}
