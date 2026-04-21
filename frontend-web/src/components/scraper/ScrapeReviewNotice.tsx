import type { HTMLAttributes } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ScrapeResult } from '@/api'

interface ScrapeReviewNoticeProps extends HTMLAttributes<HTMLDivElement> {
  result: Pick<ScrapeResult, 'review_status' | 'review_notes'>
}

export function ScrapeReviewNotice({
  result,
  className,
  ...props
}: ScrapeReviewNoticeProps) {
  if (result.review_status === 'ok' && result.review_notes.length === 0) {
    return null
  }

  const corrected = result.review_status === 'corrected'
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
        </div>
      </div>
    </div>
  )
}
