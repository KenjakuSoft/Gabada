import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Loader2, Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
  })

  const result: ProbeResponse | undefined = probe.data

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Probe"
        description="Paste a URL and inspect what each strategy finds."
      />

      <Card>
        <CardHeader>
          <CardTitle>Request</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="probe-url">URL</Label>
            <Input
              id="probe-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://shop.example.com/products/widget"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="wait-for">Wait-for selector (optional)</Label>
              <Input
                id="wait-for"
                value={waitFor}
                onChange={(e) => setWaitFor(e.target.value)}
                placeholder=".product-price"
                className="font-mono"
              />
            </div>
            <div className="flex items-end">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={usePlaywright}
                  onChange={(e) => setUsePlaywright(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="text-sm">Use Playwright</span>
              </label>
            </div>
          </div>
          <div className="flex justify-end">
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
          {probe.isError ? (
            <p className="text-sm text-destructive">
              Probe failed. Check the URL and backend.
            </p>
          ) : null}
        </CardContent>
      </Card>

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
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Extracted
            <Badge variant="secondary" className="font-mono text-xs">
              {result.platform}
            </Badge>
            {result.json_ld_found ? <Badge variant="success">JSON-LD</Badge> : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Final URL</dt>
            <dd className="truncate font-mono text-xs">
              {result.final_url ?? result.url}
            </dd>
            <dt className="text-muted-foreground">Title</dt>
            <dd className="font-medium">{e.title ?? '—'}</dd>
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
            <dd>{e.stock_status}</dd>
            {e.raw_price ? (
              <>
                <dt className="text-muted-foreground">Raw price</dt>
                <dd className="font-mono text-xs">{e.raw_price}</dd>
              </>
            ) : null}
          </dl>
          {e.error ? (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {e.error}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Suggested config</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">wait_for</dt>
            <dd className="font-mono text-xs">
              {result.suggested_wait_for ?? '—'}
            </dd>
            {Object.entries(result.suggested_selectors ?? {}).map(([k, v]) => (
              <>
                <dt key={`${k}-k`} className="text-muted-foreground">
                  {k}
                </dt>
                <dd key={`${k}-v`} className="font-mono text-xs">
                  {v ?? '—'}
                </dd>
              </>
            ))}
          </dl>
        </CardContent>
      </Card>

      {result.candidates.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              Candidates ({result.candidates.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Text</th>
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
                    <tr key={i} className="border-t border-border">
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
                          <Badge variant="muted" className="text-xs">
                            struck
                          </Badge>
                        ) : null}{' '}
                        {c.dealer ? (
                          <Badge variant="outline" className="text-xs">
                            dealer
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
          </CardContent>
        </Card>
      ) : null}

      {result.notes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">
              {result.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  )
}
