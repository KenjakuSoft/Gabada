import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Check, ImageOff, Loader2, Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  categoriesApi,
  productsApi,
  scraperApi,
  storesApi,
} from '@/api'
import { useCurrencySymbol } from '@/hooks/useSettings'
import { formatMoney } from '@/lib/utils'
import type { Category, ProbeResponse, Store } from '@/api'

export function AddProductPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const symbol = useCurrencySymbol()

  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [storeId, setStoreId] = useState<string>('')
  const [categoryId, setCategoryId] = useState<string>('')
  const [probe, setProbe] = useState<ProbeResponse | null>(null)
  const [newStoreName, setNewStoreName] = useState('')

  const stores = useQuery<Store[]>({
    queryKey: ['stores'],
    queryFn: () => storesApi.list(),
  })

  const categories = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
  })

  const matchedStore = useMemo(() => {
    if (!url || !stores.data) return null
    try {
      const host = new URL(url).hostname
      return (
        stores.data.find((s) => {
          try {
            return new URL(s.base_url).hostname === host
          } catch {
            return false
          }
        }) ?? null
      )
    } catch {
      return null
    }
  }, [url, stores.data])

  const probeMutation = useMutation({
    mutationFn: () => scraperApi.probe({ url }),
    onSuccess: (data) => {
      setProbe(data)
      if (data.extracted.title && !name) setName(data.extracted.title)
      if (data.json_ld_name && !name) setName(data.json_ld_name)
      if (matchedStore) setStoreId(String(matchedStore.id))
    },
  })

  const createStore = useMutation({
    mutationFn: async () => {
      const host = new URL(url).origin
      return storesApi.create({
        name: newStoreName || new URL(url).hostname,
        base_url: host,
      })
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['stores'] })
      setStoreId(String(created.id))
      setNewStoreName('')
    },
  })

  const createProduct = useMutation({
    mutationFn: async () => {
      const product = await productsApi.create({
        canonical_name: name.trim(),
        image_url: imageUrl.trim() || null,
        category_id: categoryId ? Number(categoryId) : null,
      })
      await productsApi.addStore(product.id, {
        store_id: Number(storeId),
        product_url: url.trim(),
        auto_detect: true,
      })
      return product
    },
    onSuccess: (product) => {
      qc.invalidateQueries({ queryKey: ['products'] })
      navigate(`/product/${product.id}`)
    },
  })

  const canProbe = url.trim().length > 8
  const canCreate =
    name.trim().length > 0 && storeId !== '' && url.trim().length > 8

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Add product"
        description="Paste a store URL. We auto-detect the platform and preview what we'll scrape."
      />

      <Card>
        <CardHeader>
          <CardTitle>1. Store URL</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="https://shop.example.com/products/widget"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Button
              onClick={() => probeMutation.mutate()}
              disabled={!canProbe || probeMutation.isPending}
            >
              {probeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Probe
            </Button>
          </div>
          {probeMutation.isError ? (
            <p className="text-sm text-destructive">
              Probe failed. Check the URL and that the backend is running.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {probe ? (
        <ProbePreview probe={probe} symbol={symbol} />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>2. Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="name">Product name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sony WH-1000XM5"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="image">Image URL (optional)</Label>
            <Input
              id="image"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="store">Store</Label>
            <div className="flex gap-2">
              <Select
                id="store"
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
              >
                <option value="">— select —</option>
                {(stores.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            {url && !matchedStore ? (
              <div className="mt-2 rounded-md border border-dashed border-border p-2">
                <p className="mb-2 text-xs text-muted-foreground">
                  No store matches this URL. Create one?
                </p>
                <div className="flex gap-2">
                  <Input
                    value={newStoreName}
                    onChange={(e) => setNewStoreName(e.target.value)}
                    placeholder={
                      (() => {
                        try {
                          return new URL(url).hostname
                        } catch {
                          return 'Store name'
                        }
                      })()
                    }
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => createStore.mutate()}
                    disabled={createStore.isPending}
                  >
                    Create
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category">Category (optional)</Label>
            <Select
              id="category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">— none —</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={() => navigate('/')}>
          Cancel
        </Button>
        <Button
          onClick={() => createProduct.mutate()}
          disabled={!canCreate || createProduct.isPending}
        >
          {createProduct.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Create product
        </Button>
      </div>
      {createProduct.isError ? (
        <p className="text-right text-sm text-destructive">
          Failed to create product.
        </p>
      ) : null}
    </div>
  )
}

function ProbePreview({
  probe,
  symbol,
}: {
  probe: ProbeResponse
  symbol: string
}) {
  const e = probe.extracted
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Probe result
          <Badge variant="secondary" className="font-mono text-xs">
            {probe.platform}
          </Badge>
          {probe.json_ld_found ? (
            <Badge variant="success">JSON-LD</Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-sm">
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
            {probe.suggested_selectors?.image ||
            probe.json_ld_name ? null : (
              <ImageOff className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <span className="text-muted-foreground">Title</span>
            <span className="font-medium">{e.title ?? '—'}</span>
            <span className="text-muted-foreground">Price</span>
            <span className="font-semibold tabular-nums">
              {e.price != null ? formatMoney(e.price, symbol) : '—'}
            </span>
            {e.discounted_price != null ? (
              <>
                <span className="text-muted-foreground">Discounted</span>
                <span className="font-semibold tabular-nums text-success">
                  {formatMoney(e.discounted_price, symbol)}
                </span>
              </>
            ) : null}
            {e.dealer_price != null ? (
              <>
                <span className="text-muted-foreground">Dealer</span>
                <span className="font-semibold tabular-nums">
                  {formatMoney(e.dealer_price, symbol)}
                </span>
              </>
            ) : null}
            <span className="text-muted-foreground">Stock</span>
            <span>{e.stock_status}</span>
          </div>
        </div>

        {probe.notes.length > 0 ? (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
            <div className="mb-1 font-medium text-muted-foreground">Notes</div>
            <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
              {probe.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {e.error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {e.error}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
