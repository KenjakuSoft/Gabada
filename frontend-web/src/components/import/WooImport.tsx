import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2,
  Download,
  KeyRound,
  Loader2,
  Package,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { BentoGrid, BentoTile, TileHeader } from '@/components/ui/bento'
import { StatTile } from '@/components/ui/stat-tile'
import { toast } from '@/components/ui/toast-store'
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
      toast.success(`Found ${data.length} products`)
    },
    onError: () =>
      toast.error('Preview failed', 'Check credentials and site URL'),
  })

  const importMutation = useMutation({
    mutationFn: () =>
      importApi.wooImport({
        credentials,
        store_id: Number(storeId),
        product_ids: Array.from(selected),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['stores'] })
      toast.success(`Imported ${data.imported} products`)
      navigate('/')
    },
    onError: () => toast.error('Import failed'),
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

  function toggleAll() {
    if (selected.size === preview.length) setSelected(new Set())
    else setSelected(new Set(preview.map((p) => p.woo_id)))
  }

  return (
    <div className="space-y-6">
      <BentoGrid cols={6}>
        <BentoTile colSpan={4} tone="primary">
          <TileHeader
            eyebrow="Credentials"
            title="WooCommerce REST API"
            icon={<KeyRound className="h-4 w-4" />}
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="woo-site">Site URL</Label>
              <Input
                id="woo-site"
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                placeholder="https://shop.example.com"
                disabled={previewMutation.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="woo-key">Consumer key</Label>
              <Input
                id="woo-key"
                value={consumerKey}
                onChange={(e) => setConsumerKey(e.target.value)}
                placeholder="ck_…"
                disabled={previewMutation.isPending}
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
                disabled={previewMutation.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="woo-store">Import into store</Label>
              <Select
                id="woo-store"
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                disabled={importMutation.isPending}
              >
                <option value="">— select —</option>
                {(stores.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="sm:col-span-2 flex justify-end">
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
          </div>
        </BentoTile>

        <StatTile
          label="Found"
          value={preview.length}
          icon={<Package className="h-4 w-4" />}
          hint={preview.length > 0 ? 'in current preview' : 'run preview'}
          tone={preview.length > 0 ? 'primary' : 'default'}
        />
        <StatTile
          label="Selected"
          value={selected.size}
          icon={<CheckCircle2 className="h-4 w-4" />}
          hint={
            preview.length > 0
              ? `${Math.round((selected.size / preview.length) * 100)}% of found`
              : 'none yet'
          }
          tone={selected.size > 0 ? 'success' : 'default'}
        />
      </BentoGrid>

      {preview.length > 0 ? (
        <BentoGrid cols={6}>
          <BentoTile colSpan={6}>
            <TileHeader
              eyebrow="Review"
              title={`${preview.length} products · ${selected.size} selected`}
              action={
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={toggleAll}>
                    {selected.size === preview.length
                      ? 'Clear all'
                      : 'Select all'}
                  </Button>
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
                </div>
              }
            />
            <div className="mt-3 max-h-[500px] space-y-1.5 overflow-y-auto pr-1">
              {preview.map((p) => {
                const checked = selected.has(p.woo_id)
                return (
                  <label
                    key={p.woo_id}
                    className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-2 transition-colors hover:bg-accent/30"
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
                        {p.sale_price ? (
                          <span>Sale: {p.sale_price}</span>
                        ) : null}
                        <Badge variant="outline" className="text-xs">
                          {p.stock_status}
                        </Badge>
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>
          </BentoTile>
        </BentoGrid>
      ) : null}
    </div>
  )
}
