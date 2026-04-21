import { Fragment, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  AlertCircle,
  Eye,
  FileText,
  Info,
  Link2,
  Loader2,
  Package,
  Search,
  Settings2,
  Sparkles,
  Tag,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { BentoGrid, BentoTile, TileHeader } from '@/components/ui/bento'
import { StatTile } from '@/components/ui/stat-tile'
import { toast } from '@/components/ui/toast-store'
import { ScrapeReviewNotice } from '@/components/scraper/ScrapeReviewNotice'
import { scraperApi } from '@/api'
import { useCurrencySymbol } from '@/hooks/useSettings'
import { formatMoney } from '@/lib/utils'
import type { ProbeResponse } from '@/api'

export function ProbePage() {
  const symbol = useCurrencySymbol()
  const [url, setUrl] = useState('')
  const [waitFor, setWaitFor] = useState('')
  const [usePlaywright, setUsePlaywright] = useState(true)

  const probe = useMutation({
    mutationFn: () =>
      scraperApi.probe({
        url: url.trim(),
        use_playwright: usePlaywright,
        wait_for: waitFor.trim() || null,
      }),
    onSuccess: (data) => {
      if (data.extracted.error) {
        toast.info('Probe complete', 'with warnings')
      } else {
        toast.success('Probe complete', data.platform)
      }
    },
    onError: () => toast.error('Probe failed', 'Check URL and backend'),
  })

  const result: ProbeResponse | undefined = probe.data

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Probe"
        description="Paste a URL and inspect what each strategy finds."
      />

      <BentoGrid cols={6}>
        <BentoTile colSpan={4} tone="primary">
          <TileHeader
            eyebrow="Request"
            title="Target URL"
            icon={<Link2 className="h-4 w-4" />}
          />
          <div className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="probe-url">URL</Label>
              <Input
                id="probe-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://shop.example.com/products/widget"
                disabled={probe.isPending}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="wait-for">Wait-for selector (optional)</Label>
                <Input
                  id="wait-for"
                  value={waitFor}
                  onChange={(e) => setWaitFor(e.target.value)}
                  placeholder=".product-price"
                  className="font-mono"
                  disabled={probe.isPending}
                />
              </div>
              <div className="flex items-end">
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={usePlaywright}
                    onChange={(e) => setUsePlaywright(e.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="text-sm">Playwright</span>
                </label>
              </div>
              <div className="flex items-end">
                <Button
                  onClick={() => probe.mutate()}
                  disabled={url.trim().length < 8 || probe.isPending}
                >
                  {probe.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  Probe
                </Button>
              </div>
            </div>
          </div>
        </BentoTile>

        <StatTile
          label="Platform"
          value={result?.platform ?? 'n/a'}
          icon={<Sparkles className="h-4 w-4" />}
          hint={result ? 'detected' : 'run probe first'}
          tone={result ? 'primary' : 'default'}
        />
        <StatTile
          label="Candidates"
          value={result?.candidates.length ?? 0}
          icon={<Eye className="h-4 w-4" />}
          hint={
            result?.json_ld_found
              ? 'JSON-LD available'
              : result
                ? 'inspected DOM'
                : 'standby'
          }
          tone={result && result.candidates.length > 0 ? 'accent' : 'default'}
        />
      </BentoGrid>

      {result ? <ProbeResults result={result} symbol={symbol} /> : null}
    </div>
  )
}

function ProbeResults({
  result,
  symbol,
}: {
  result: ProbeResponse
  symbol: string
}) {
  const e = result.extracted
  const suggestedEntries = Object.entries(result.suggested_selectors ?? {})

  return (
    <div className="space-y-6">
      <BentoGrid cols={6}>
        <BentoTile colSpan={3}>
          <TileHeader
            eyebrow="Extracted"
            title={e.title ?? '(no title)'}
            icon={<Tag className="h-4 w-4" />}
            action={
              <div className="flex items-center gap-1.5">
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {result.platform}
                </Badge>
                {result.json_ld_found ? (
                  <Badge variant="success" className="text-[10px]">
                    JSON-LD
                  </Badge>
                ) : null}
              </div>
            }
          />
          <dl className="mt-3 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Final URL</dt>
            <dd className="truncate font-mono text-xs">
              {result.final_url ?? result.url}
            </dd>
            <dt className="text-muted-foreground">Price</dt>
            <dd className="font-semibold tabular-nums">
              {e.price != null ? formatMoney(e.price, symbol) : '—'}
            </dd>
            {e.discounted_price != null ? (
              <>
                <dt className="text-muted-foreground">Discounted</dt>
                <dd className="font-semibold tabular-nums text-success">
                  {formatMoney(e.discounted_price, symbol)}
                </dd>
              </>
            ) : null}
            {e.dealer_price != null ? (
              <>
                <dt className="text-muted-foreground">Dealer</dt>
                <dd className="font-semibold tabular-nums">
                  {formatMoney(e.dealer_price, symbol)}
                </dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Stock</dt>
            <dd>
              <StockBadge status={e.stock_status} />
            </dd>
            {e.raw_price ? (
              <>
                <dt className="text-muted-foreground">Raw price</dt>
                <dd className="truncate font-mono text-xs">{e.raw_price}</dd>
              </>
            ) : null}
          </dl>
          {e.error ? (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{e.error}</span>
            </div>
          ) : null}
          <ScrapeReviewNotice result={e} className="mt-4" />
        </BentoTile>

        <BentoTile colSpan={3}>
          <TileHeader
            eyebrow="Suggested config"
            title="Apply to scrape_config"
            icon={<Settings2 className="h-4 w-4" />}
          />
          <dl className="mt-3 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">wait_for</dt>
            <dd className="truncate font-mono text-xs">
              {result.suggested_wait_for ?? '—'}
            </dd>
            {suggestedEntries.map(([k, v]) => (
              <Fragment key={k}>
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="truncate font-mono text-xs">{v ?? '—'}</dd>
              </Fragment>
            ))}
          </dl>
        </BentoTile>
      </BentoGrid>

      {result.candidates.length > 0 ? (
        <BentoGrid cols={6}>
          <BentoTile colSpan={6}>
            <TileHeader
              eyebrow="Candidates"
              title={`${result.candidates.length} price-like nodes`}
              icon={<Package className="h-4 w-4" />}
            />
            <div className="mt-3 overflow-hidden rounded-md border border-border">
              <div className="max-h-[360px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/80 text-muted-foreground backdrop-blur">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">
                        Text
                      </th>
                      <th className="px-2 py-1.5 text-right font-medium">
                        Value
                      </th>
                      <th className="px-2 py-1.5 text-right font-medium">
                        Score
                      </th>
                      <th className="px-2 py-1.5 text-center font-medium">
                        Flags
                      </th>
                      <th className="px-2 py-1.5 text-left font-medium">
                        DOM path
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.candidates.slice(0, 50).map((c, i) => (
                      <tr
                        key={i}
                        className="border-t border-border transition-colors hover:bg-accent/30"
                      >
                        <td className="px-2 py-1.5">{c.text}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                          {c.value != null
                            ? formatMoney(c.value, symbol)
                            : '—'}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                          {c.score}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-center">
                          {c.struck ? (
                            <Badge variant="muted" className="mr-1 text-[10px]">
                              struck
                            </Badge>
                          ) : null}
                          {c.dealer ? (
                            <Badge
                              variant="outline"
                              className="mr-1 text-[10px]"
                            >
                              dealer
                            </Badge>
                          ) : null}
                          {c.variant_alt ? (
                            <Badge variant="warning" className="text-[10px]">
                              variant
                            </Badge>
                          ) : null}
                        </td>
                        <td className="truncate px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                          {c.dom_path ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </BentoTile>
        </BentoGrid>
      ) : null}

      {result.notes.length > 0 ? (
        <BentoGrid cols={6}>
          <BentoTile colSpan={6} tone="accent">
            <TileHeader
              eyebrow="Notes"
              title={`${result.notes.length} observation${result.notes.length === 1 ? '' : 's'}`}
              icon={<FileText className="h-4 w-4" />}
            />
            <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              {result.notes.map((n, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          </BentoTile>
        </BentoGrid>
      ) : null}
    </div>
  )
}

function StockBadge({ status }: { status: string }) {
  const variant =
    status === 'in_stock' || status === 'limited'
      ? 'success'
      : status === 'out_of_stock'
        ? 'destructive'
        : 'muted'
  return <Badge variant={variant}>{status}</Badge>
}
