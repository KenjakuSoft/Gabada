import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Download, Loader2, Search } from 'lucide-react'
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
import { importApi, storesApi } from '@/api'
import type { Store, WooProductPreview } from '@/api'

export function WooImport() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [siteUrl, setSiteUrl] = useState('')
  const [consumerKey, setConsumerKey] = useState('')
  const [consumerSecret, setConsumerSecret] = useState('')
  const [storeId, setStoreId] = useState<string>('')
  const [preview, setPreview] = useState<WooProductPreview[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const stores = useQuery<Store[]>({
    queryKey: ['stores'],
    queryFn: () => storesApi.list(),
  })

  const credentials = {
    site_url: siteUrl.trim(),
    consumer_key: consumerKey.trim(),
    consumer_secret: consumerSecret.trim(),
  }

  const previewMutation = useMutation({
    mutationFn: () =>
      importApi.wooPreview({ credentials, per_page: 100, page: 1 }),
    onSuccess: (data) => {
      setPreview(data)
      setSelected(new Set(data.map((p) => p.woo_id)))
    },
  })

  const importMutation = useMutation({
    mutationFn: () =>
      importApi.wooImport({
        credentials,
        store_id: Number(storeId),
        product_ids: Array.from(selected),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
      navigate('/')
    },
  })

  const canPreview =
    siteUrl.length > 8 && consumerKey.length > 0 && consumerSecret.length > 0
  const canImport = selected.size > 0 && storeId !== ''

  function toggle(id: number) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>WooCommerce credentials</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="woo-site">Site URL</Label>
            <Input
              id="woo-site"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              placeholder="https://shop.example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="woo-key">Consumer key</Label>
            <Input
              id="woo-key"
              value={consumerKey}
              onChange={(e) => setConsumerKey(e.target.value)}
              placeholder="ck_…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="woo-secret">Consumer secret</Label>
            <Input
              id="woo-secret"
              type="password"
              value={consumerSecret}
              onChange={(e) => setConsumerSecret(e.target.value)}
              placeholder="cs_…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="woo-store">Import into store</Label>
            <Select
              id="woo-store"
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
          <div className="flex items-end justify-end sm:col-span-2">
            <Button
              onClick={() => previewMutation.mutate()}
              disabled={!canPreview || previewMutation.isPending}
            >
              {previewMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Preview products
            </Button>
          </div>
          {previewMutation.isError ? (
            <p className="text-sm text-destructive sm:col-span-2">
              Failed to fetch products. Check credentials and site URL.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {preview.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>
                {preview.length} products found • {selected.size} selected
              </span>
              <Button
                size="sm"
                onClick={() => importMutation.mutate()}
                disabled={!canImport || importMutation.isPending}
              >
                {importMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Import {selected.size}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 max-h-[500px] overflow-y-auto">
            {preview.map((p) => {
              const checked = selected.has(p.woo_id)
              return (
                <label
                  key={p.woo_id}
                  className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-2 hover:bg-accent/30"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(p.woo_id)}
                    className="h-4 w-4 accent-primary"
                  />
                  {p.image_url ? (
                    <img
                      src={p.image_url}
                      alt=""
                      className="h-10 w-10 rounded-sm object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-sm bg-muted" />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">
                      {p.name}
                    </span>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {p.regular_price ? (
                        <span>Regular: {p.regular_price}</span>
                      ) : null}
                      {p.sale_price ? <span>Sale: {p.sale_price}</span> : null}
                      <Badge variant="outline" className="text-xs">
                        {p.stock_status}
                      </Badge>
                    </div>
                  </div>
                </label>
              )
            })}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
