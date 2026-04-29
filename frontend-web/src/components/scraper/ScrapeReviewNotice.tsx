import type { HTMLAttributes } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn, formatMoney } from '@/lib/utils'
import type { ScrapeResult } from '@/api'

export type PriceReviewChoice = 'kept' | 'alternative'

interface ScrapeReviewNoticeProps extends HTMLAttributes<HTMLDivElement> {
  result: Pick<
    ScrapeResult,
    | 'review_status'
    | 'review_notes'
    | 'review_alternative_price'
    | 'review_alternative_raw'
    | 'review_alternative_label'
    | 'price'
    | 'discounted_price'
    | 'raw_price'
    | 'raw_discounted'
  >
  symbol?: string
  choice?: PriceReviewChoice
  onChoiceChange?: (choice: PriceReviewChoice) => void
}

export function ScrapeReviewNotice({
  result,
  symbol = '',
  choice = 'kept',
  onChoiceChange,
  className,
  ...props
}: ScrapeReviewNoticeProps) {
  const hasAlternative = result.review_alternative_price != null
  if (
    result.review_status === 'ok'
    && result.review_notes.length === 0
    && !hasAlternative
  ) {
    return null
  }

  const corrected = result.review_status === 'corrected'
  const keptPrice = result.discounted_price ?? result.price ?? null
  const keptRaw =
    result.discounted_price != null
      ? result.raw_discounted ?? result.raw_price
      : result.raw_price
  const altPrice = result.review_alternative_price
  const altLabel = result.review_alternative_label ?? 'alternative price'

  return (
    <div
      className={cn(
        'rounded-md border p-3 text-sm',
        corrected
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100'
          : 'border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-100',
        className,
      )}
      {...props}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {corrected
                ? 'Review corrected a suspicious scrape result.'
                : 'Review flagged this scrape result.'}
            </span>
            <Badge variant={corrected ? 'warning' : 'info'}>
              {result.review_status}
            </Badge>
          </div>
          {result.review_notes.length > 0 ? (
            <ul className="space-y-1 text-xs">
              {result.review_notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
          {hasAlternative && altPrice != null && onChoiceChange ? (
            <div className="space-y-1.5 pt-1">
              <div className="text-xs font-medium opacity-80">
                Choose which price to use:
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                <ChoiceButton
                  selected={choice === 'kept'}
                  onClick={() => onChoiceChange('kept')}
                  label={corrected ? 'Auto-corrected (in use)' : 'Kept (in use)'}
                  price={keptPrice}
                  raw={keptRaw}
                  symbol={symbol}
                />
                <ChoiceButton
                  selected={choice === 'alternative'}
                  onClick={() => onChoiceChange('alternative')}
                  label={altLabel}
                  price={altPrice}
                  raw={result.review_alternative_raw}
                  symbol={symbol}
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ChoiceButton({
  selected,
  onClick,
  label,
  price,
  raw,
  symbol,
}: {
  selected: boolean
  onClick: () => void
  label: string
  price: number | null
  raw: string | null | undefined
  symbol: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-start gap-0.5 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
        selected
          ? 'border-current bg-background/60 ring-1 ring-current'
          : 'border-current/20 bg-transparent hover:bg-background/30',
      )}
      aria-pressed={selected}
    >
      <span className="font-medium uppercase tracking-wide opacity-70">
        {label}
      </span>
      <span className="font-semibold tabular-nums text-base">
        {price != null ? formatMoney(price, symbol) : '—'}
      </span>
      {raw ? (
        <span className="truncate font-mono text-[10px] opacity-60">
          raw: {raw}
        </span>
      ) : null}
    </button>
  )
}
