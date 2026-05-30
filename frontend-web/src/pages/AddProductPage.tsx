import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Hash,
  Loader2,
  Sparkles,
  Zap,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { BentoGrid, BentoTile, TileHeader } from '@/components/ui/bento'
import { MetricCard } from '@/components/ui/metric-card'
import { toast } from '@/components/ui/toast-store'
import { categoriesApi, productsApi, storesApi } from '@/api'
import type { Category, QuickAddResult, Store } from '@/api'
import { useCurrencySymbol } from '@/hooks/useSettings'
import { cn, formatMoney } from '@/lib/utils'

const URL_RE = /^https?:\/\/\S+$/i

function parseUrls(raw: string): string[] {
  return raw
    .split(/\r?\n|,/g)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function AddProductPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const symbol = useCurrencySymbol()

  const [text, setText] = useState('')
  const [categoryId, setCategoryId] = useState<string>('')
  const [storeId, setStoreId] = useState<string>('')
  const [results, setResults] = useState<QuickAddResult[] | null>(null)

  const categories = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
  })

  const stores = useQuery<Store[]>({
    queryKey: ['stores'],
    queryFn: () => storesApi.list(),
  })

  const urls = useMemo(() => parseUrls(text), [text])
  const websiteStores = useMemo(
    () => (stores.data ?? []).filter((store) => !store.manual_only),
    [stores.data],
  )
  const validCount = urls.filter((u) => URL_RE.test(u)).length
  const invalidCount = urls.length - validCount

  const quickAdd = useMutation({
    mutationFn: () =>
      productsApi.quickAdd({
        urls,
        category_id: categoryId ? Number(categoryId) : null,
        store_id: storeId ? Number(storeId) : null,
      }),
    onSuccess: (data) => {
      setResults(data.results)
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['stores'] })
      const ok = data.results.filter((r) => r.status === 'ok').length
      const err = data.results.filter((r) => r.status === 'error').length
      if (err === 0) toast.success(`Added ${ok} product${ok === 1 ? '' : 's'}`)
      else toast.info(`Added ${ok}`, `${err} failed`)
    },
    onError: () =>
      toast.error(
        'Request failed',
        'Make sure the backend is running and try again',
      ),
  })

  const okCount = results?.filter((r) => r.status === 'ok').length ?? 0
  const errCount = results?.filter((r) => r.status === 'error').length ?? 0

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Add products"
        description="Paste URLs. Platform, title, price, and stock are auto-detected."
      />

      <BentoGrid cols={6}>
        <BentoTile colSpan={4} tone="primary">
          <TileHeader
            eyebrow="Paste-and-go"
            title="URLs"
            icon={<Sparkles className="h-4 w-4" />}
            action={
              <div className="flex items-center gap-2 text-xs">
                <Badge variant={validCount > 0 ? 'success' : 'muted'}>
                  {validCount} valid
                </Badge>
                {invalidCount > 0 ? (
                  <Badge variant="destructive">{invalidCount} invalid</Badge>
                ) : null}
              </div>
            }
          />
          <textarea
            className="mt-3 w-full min-h-[180px] rounded-md border border-border bg-background/70 px-3 py-2 font-mono text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring"
            placeholder={
              'https://shop-a.com/product/foo\nhttps://shop-b.com/items/bar'
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={quickAdd.isPending}
          />
          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_auto] md:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="category">Category (optional)</Label>
              <Select
                id="category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={quickAdd.isPending}
              >
                <option value="">— none —</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="store">Store (optional)</Label>
              <Select
                id="store"
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                disabled={quickAdd.isPending || stores.isLoading}
              >
                <option value="">Auto-detect from URL</option>
                {websiteStores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              className="md:ml-auto"
              onClick={() => quickAdd.mutate()}
              disabled={validCount === 0 || quickAdd.isPending}
            >
              {quickAdd.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Detecting…
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4" />
                  Add & track {validCount > 0 ? `· ${validCount}` : ''}
                </>
              )}
            </Button>
          </div>
        </BentoTile>

        <MetricCard
          label="URLs ready"
          value={validCount}
          icon={<Hash className="h-4 w-4" />}
          hint={invalidCount > 0 ? `${invalidCount} skipped` : 'all valid'}
          tone={validCount > 0 ? 'success' : 'default'}
        />
        <MetricCard
          label={results ? 'Added' : 'Ready'}
          value={results ? okCount : 0}
          icon={<CheckCircle2 className="h-4 w-4" />}
          hint={results && errCount > 0 ? `${errCount} failed` : undefined}
          tone={results && okCount > 0 ? 'success' : 'default'}
        />
      </BentoGrid>

      {results ? (
        <BentoGrid cols={6}>
          <BentoTile colSpan={6}>
            <TileHeader
              eyebrow="Results"
              title={`${results.length} processed`}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setText('')
                    setResults(null)
                  }}
                >
                  Add more
                </Button>
              }
            />
            <div
              className="gbd-stagger mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
              key={results.length}
            >
              {results.map((r, i) => (
                <ResultCard
                  key={i}
                  r={r}
                  symbol={symbol}
                  onOpen={() => navigate(`/product/${r.product_id}`)}
                />
              ))}
            </div>
          </BentoTile>
        </BentoGrid>
      ) : null}
    </div>
  )
}

interface ResultCardProps {
  r: QuickAddResult
  symbol: string
  onOpen: () => void
}

function ResultCard({ r, symbol, onOpen }: ResultCardProps) {
  const ok = r.status === 'ok'
  const effective = r.discounted_price ?? r.price ?? null
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-3 transition-colors',
        ok
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-destructive/30 bg-destructive/5',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {r.name ?? '(no title)'}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {r.store_name ?? new URL(r.url).hostname}
          </div>
        </div>
        {ok ? (
          <Badge variant="success" className="shrink-0">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            ok
          </Badge>
        ) : (
          <Badge variant="destructive" className="shrink-0">
            <AlertCircle className="mr-1 h-3 w-3" />
            error
          </Badge>
        )}
      </div>

      {ok ? (
        <div className="flex items-end justify-between">
          <div>
            <div className="text-lg font-semibold tabular-nums">
              {effective != null ? formatMoney(effective, symbol) : '—'}
            </div>
            {r.platform ? (
              <Badge variant="secondary" className="mt-1 font-mono text-[10px]">
                {r.platform}
              </Badge>
            ) : null}
          </div>
          <Button variant="ghost" size="sm" onClick={onOpen}>
            Open
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <div className="text-xs text-destructive">{r.error ?? 'Failed'}</div>
      )}
    </div>
  )
}
