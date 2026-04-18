import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ImageOff,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { StoreRow } from '@/components/products/StoreRow'
import { PriceChart } from '@/components/products/PriceChart'
import { LogsTable } from '@/components/products/LogsTable'
import { logsApi, productsApi, scraperApi } from '@/api'
import { useCurrencySymbol } from '@/hooks/useSettings'
import type { PriceLog, Product } from '@/api'

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const productId = Number(id)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const symbol = useCurrencySymbol()

  const product = useQuery<Product>({
    queryKey: ['product', productId],
    queryFn: () => productsApi.get(productId),
    enabled: Number.isFinite(productId) && productId > 0,
  })

  const logs = useQuery<PriceLog[]>({
    queryKey: ['product-logs', productId],
    queryFn: () => logsApi.forProduct(productId),
    enabled: Number.isFinite(productId) && productId > 0,
  })

  const scrapeAll = useMutation({
    mutationFn: async () => {
      const stores = product.data?.stores ?? []
      await Promise.all(stores.map((s) => scraperApi.scrapeOne(s.id)))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product', productId] })
      qc.invalidateQueries({ queryKey: ['product-logs', productId] })
      qc.invalidateQueries({ queryKey: ['products'] })
    },
  })

  const remove = useMutation({
    mutationFn: () => productsApi.remove(productId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
      navigate('/')
    },
  })

  if (!Number.isFinite(productId) || productId <= 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Invalid product id.
      </div>
    )
  }

  if (product.isLoading) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (product.isError || !product.data) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Failed to load product.
      </div>
    )
  }

  const p = product.data

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/')}
          className="-ml-2 mb-3 text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <PageHeader
          title={p.canonical_name}
          description={
            p.category_name
              ? `Category: ${p.category_name}`
              : 'Uncategorized product'
          }
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => scrapeAll.mutate()}
                disabled={scrapeAll.isPending || p.stores.length === 0}
              >
                <RefreshCw
                  className={`h-4 w-4 ${scrapeAll.isPending ? 'animate-spin' : ''}`}
                />
                Scrape all
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (confirm(`Delete "${p.canonical_name}" and all its data?`)) {
                    remove.mutate()
                  }
                }}
                disabled={remove.isPending}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </>
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-6">
            <div className="flex h-48 w-48 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
              {p.image_url ? (
                <img
                  src={p.image_url}
                  alt=""
                  className="h-full w-full object-contain"
                />
              ) : (
                <ImageOff className="h-10 w-10 text-muted-foreground" />
              )}
            </div>
            <div className="w-full space-y-2 text-xs">
              <InfoRow label="ID" value={`#${p.id}`} />
              <InfoRow label="Stores" value={String(p.stores.length)} />
              <InfoRow
                label="Created"
                value={new Date(p.created_at).toLocaleDateString()}
              />
              {p.category_name ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Category</span>
                  <Badge
                    variant="outline"
                    style={
                      p.category_color
                        ? { borderColor: p.category_color, color: p.category_color }
                        : undefined
                    }
                  >
                    {p.category_name}
                  </Badge>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stores</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {p.stores.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No stores linked yet.
              </div>
            ) : (
              p.stores.map((s) => (
                <StoreRow key={s.id} store={s} symbol={symbol} />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Price history</CardTitle>
        </CardHeader>
        <CardContent>
          <PriceChart
            logs={logs.data ?? []}
            stores={p.stores}
            symbol={symbol}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent logs</CardTitle>
        </CardHeader>
        <CardContent>
          <LogsTable
            logs={(logs.data ?? []).slice(0, 100)}
            stores={p.stores}
            symbol={symbol}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
