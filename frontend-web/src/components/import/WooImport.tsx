import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2,
  Download,
  KeyRound,
  Loader2,
  Package,
  RefreshCw,
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
  const [enableWooSync, setEnableWooSync] = useState(false)
  const [autoAddNew, setAutoAddNew] = useState(true)
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

  async function persistWooSyncSettings() {
    if (!storeId) {
      throw new Error('Select a store first')
    }
    return storesApi.update(Number(storeId), {
      woo_enabled: enableWooSync,
      woo_site_url: credentials.site_url || null,
      woo_consumer_key: credentials.consumer_key || null,
      woo_consumer_secret: credentials.consumer_secret || null,
      woo_auto_import_new: enableWooSync ? autoAddNew : false,
    })
  }

  const previewMutation = useMutation({
    onMutate: () => {
      setPreview([])
      setSelected(new Set())
      toast.info(
        'Checking WooCommerce catalog',
        'This can take a bit on large stores',
      )
    },
    mutationFn: () =>
      importApi.wooPreview({
        credentials,
        per_page: 100,
        page: 1,
        fetch_all: true,
      }),
    onSuccess: (data) => {
      setPreview(data)
      setSelected(new Set(data.map((product) => product.woo_id)))
      toast.success(`Found ${data.length} products across the full catalog`)
    },
    onError: (error) => {
      const detail =
        typeof error === 'object' &&
        error &&
        'response' in error &&
        typeof error.response === 'object' &&
        error.response &&
        'data' in error.response &&
        typeof error.response.data === 'object' &&
        error.response.data &&
        'detail' in error.response.data &&
        typeof error.response.data.detail === 'string'
          ? error.response.data.detail
          : error instanceof Error && error.message
            ? error.message
            : 'Check credentials and site URL'
      toast.error('Preview failed', detail)
    },
  })

  const importMutation = useMutation({
    mutationFn: async () => {
      const data = await importApi.wooImport({
        credentials,
        store_id: Number(storeId),
        product_ids: Array.from(selected),
      })
      let syncError: string | null = null
      try {
        await persistWooSyncSettings()
      } catch (error) {
        syncError =
          error instanceof Error
            ? error.message
            : 'Could not save Woo sync settings'
      }
      return { ...data, syncError }
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['stores'] })
      if (data.syncError) {
        toast.info(
          `Imported ${data.imported} products`,
          `Woo sync settings were not saved: ${data.syncError}`,
        )
      } else if (enableWooSync) {
        toast.success(
          `Imported ${data.imported} products`,
          autoAddNew
            ? 'Scheduled Woo sync is on and new catalog products will be auto-added later.'
            : 'Scheduled Woo sync is on without auto-adding new products yet.',
        )
      } else {
        toast.success(`Imported ${data.imported} products`)
      }
      navigate('/')
    },
    onError: () => toast.error('Import failed'),
  })

  const saveSyncMutation = useMutation({
    mutationFn: persistWooSyncSettings,
    onSuccess: (store) => {
      qc.invalidateQueries({ queryKey: ['stores'] })
      if (store.woo_enabled) {
        toast.success(
          'Woo sync saved',
          store.woo_auto_import_new
            ? 'New Woo products will be auto-added during scheduled syncs.'
            : 'Woo catalog sync is enabled without auto-adding new products yet.',
        )
      } else {
        toast.info('Woo sync disabled for this store')
      }
    },
    onError: (error) => {
      const detail =
        error instanceof Error
          ? error.message
          : 'Could not save Woo sync settings'
      toast.error('Save failed', detail)
    },
  })

  const canPreview =
    siteUrl.length > 8 && consumerKey.length > 0 && consumerSecret.length > 0
  const canImport = selected.size > 0 && storeId !== ''
  const canSaveSync = canPreview && storeId !== ''

  function toggle(id: number) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function toggleAll() {
    if (selected.size === preview.length) setSelected(new Set())
    else setSelected(new Set(preview.map((product) => product.woo_id)))
  }

  function handleStoreChange(nextStoreId: string) {
    setStoreId(nextStoreId)
    const store =
      (stores.data ?? []).find((item) => String(item.id) === nextStoreId) ?? null
    if (!store) return
    setEnableWooSync(store.woo_enabled)
    setAutoAddNew(store.woo_enabled ? store.woo_auto_import_new : true)
    if (store.woo_site_url) setSiteUrl(store.woo_site_url)
    if (store.woo_consumer_key) setConsumerKey(store.woo_consumer_key)
    if (store.woo_consumer_secret) {
      setConsumerSecret(store.woo_consumer_secret)
    }
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
                onChange={(event) => setSiteUrl(event.target.value)}
                placeholder="https://shop.example.com"
                disabled={previewMutation.isPending}
              />
              <p className="text-xs text-muted-foreground">
                Use the main store URL. Gabada will try both standard Woo REST
                endpoints and fallback auth modes automatically.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="woo-key">Consumer key</Label>
              <Input
                id="woo-key"
                value={consumerKey}
                onChange={(event) => setConsumerKey(event.target.value)}
                placeholder="ck_..."
                disabled={previewMutation.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="woo-secret">Consumer secret</Label>
              <Input
                id="woo-secret"
                type="password"
                value={consumerSecret}
                onChange={(event) => setConsumerSecret(event.target.value)}
                placeholder="cs_..."
                disabled={previewMutation.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="woo-store">Import into store</Label>
              <Select
                id="woo-store"
                value={storeId}
                onChange={(event) => handleStoreChange(event.target.value)}
                disabled={importMutation.isPending || saveSyncMutation.isPending}
              >
                <option value="">- select -</option>
                {(stores.data ?? []).map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2 rounded-xl border border-border/70 bg-background/60 p-3 sm:col-span-2">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={enableWooSync}
                  onChange={(event) => setEnableWooSync(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                  disabled={saveSyncMutation.isPending || importMutation.isPending}
                />
                <span className="text-sm text-foreground">
                  Enable scheduled Woo sync for this store
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={autoAddNew}
                  onChange={(event) => setAutoAddNew(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                  disabled={
                    !enableWooSync ||
                    saveSyncMutation.isPending ||
                    importMutation.isPending
                  }
                />
                <span className="text-sm text-muted-foreground">
                  Automatically add newly discovered Woo products to Gabada
                </span>
              </label>
              <p className="text-xs text-muted-foreground">
                Scheduled Woo sync checks the catalog during future scrape runs.
                Turn on auto-add if you want new Woo products to appear in
                Gabada automatically later.
              </p>
            </div>
            <div className="sm:col-span-2 flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => saveSyncMutation.mutate()}
                disabled={!canSaveSync || saveSyncMutation.isPending}
              >
                {saveSyncMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Save sync settings
              </Button>
              <Button
                onClick={() => previewMutation.mutate()}
                disabled={!canPreview || previewMutation.isPending}
              >
                {previewMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Preview full catalog
              </Button>
            </div>
          </div>
        </BentoTile>

        <StatTile
          label="Found"
          value={preview.length}
          icon={<Package className="h-4 w-4" />}
          hint={
            previewMutation.isPending
              ? 'loading full catalog'
              : preview.length > 0
                ? 'in full catalog preview'
                : 'run preview'
          }
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
        <StatTile
          label="Woo sync"
          value={enableWooSync ? 'On' : 'Off'}
          icon={<RefreshCw className="h-4 w-4" />}
          hint={
            enableWooSync
              ? autoAddNew
                ? 'auto-add new products'
                : 'catalog sync only'
              : 'manual import only'
          }
          tone={enableWooSync ? 'accent' : 'default'}
        />
      </BentoGrid>

      {preview.length > 0 ? (
        <BentoGrid cols={6}>
          <BentoTile colSpan={6}>
            <TileHeader
              eyebrow="Review"
              title={`${preview.length} products - ${selected.size} selected`}
              action={
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={toggleAll}>
                    {selected.size === preview.length ? 'Clear all' : 'Select all'}
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
              {preview.map((product) => {
                const checked = selected.has(product.woo_id)
                return (
                  <label
                    key={product.woo_id}
                    className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-2 transition-colors hover:bg-accent/30"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(product.woo_id)}
                      className="h-4 w-4 accent-primary"
                    />
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt=""
                        className="h-10 w-10 rounded-sm object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded-sm bg-muted" />
                    )}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">
                        {product.name}
                      </span>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {product.regular_price ? (
                          <span>Regular: {product.regular_price}</span>
                        ) : null}
                        {product.sale_price ? (
                          <span>Sale: {product.sale_price}</span>
                        ) : null}
                        <Badge variant="outline" className="text-xs">
                          {product.stock_status}
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
