import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2,
  Download,
  Gamepad2,
  Loader2,
  Package,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
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
import { useCountryCode } from '@/hooks/useSettings'
import type { ApiPlatform, ApiProductPreview, Store } from '@/api'
import {
  API_PLATFORM_OPTIONS,
  apiPlatformBaseUrl,
  apiPlatformNeedsJsonConfig,
  readCustomJsonConfig,
  trimCustomJsonConfig,
  type CustomJsonApiConfig,
} from './apiCatalogProviders'

function splitExternalIds(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item).trim()).filter(Boolean)
}

function apiErrorDetail(error: unknown, fallback: string): string {
  if (
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
  ) {
    return error.response.data.detail
  }
  return error instanceof Error && error.message ? error.message : fallback
}

export function CustomJsonConfigFields({
  config,
  disabled,
  onChange,
}: {
  config: CustomJsonApiConfig
  disabled: boolean
  onChange: (config: CustomJsonApiConfig) => void
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false)

  function update(key: keyof CustomJsonApiConfig, value: string) {
    onChange({ ...config, [key]: value })
  }

  return (
    <div className="space-y-3 rounded-md border border-border/70 bg-background/60 p-3 sm:col-span-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="api-custom-url">Catalog URL</Label>
          <Input
            id="api-custom-url"
            value={config.url_template}
            onChange={(event) => update('url_template', event.target.value)}
            placeholder="https://api.example.com/search?q={query}"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="api-custom-detail-url">Product URL</Label>
          <Input
            id="api-custom-detail-url"
            value={config.detail_url_template}
            onChange={(event) => update('detail_url_template', event.target.value)}
            placeholder="https://api.example.com/products/{id}"
            disabled={disabled}
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAdvancedOpen((open) => !open)}
          disabled={disabled}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {advancedOpen ? 'Hide mapping' : 'Advanced mapping'}
        </Button>
      </div>
      {advancedOpen ? (
        <div className="grid gap-3 border-t border-border/70 pt-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="api-custom-results">Results path</Label>
          <Input
            id="api-custom-results"
            value={config.results_path}
            onChange={(event) => update('results_path', event.target.value)}
            placeholder="results"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="api-custom-id">ID path</Label>
          <Input
            id="api-custom-id"
            value={config.external_id_path}
            onChange={(event) => update('external_id_path', event.target.value)}
            placeholder="id"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="api-custom-name">Name path</Label>
          <Input
            id="api-custom-name"
            value={config.name_path}
            onChange={(event) => update('name_path', event.target.value)}
            placeholder="name"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="api-custom-link">URL path</Label>
          <Input
            id="api-custom-link"
            value={config.url_path}
            onChange={(event) => update('url_path', event.target.value)}
            placeholder="url"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="api-custom-price">Price path</Label>
          <Input
            id="api-custom-price"
            value={config.price_path}
            onChange={(event) => update('price_path', event.target.value)}
            placeholder="price"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="api-custom-sale">Discount path</Label>
          <Input
            id="api-custom-sale"
            value={config.discounted_price_path}
            onChange={(event) => update('discounted_price_path', event.target.value)}
            placeholder="sale_price"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="api-custom-currency">Currency path</Label>
          <Input
            id="api-custom-currency"
            value={config.currency_path}
            onChange={(event) => update('currency_path', event.target.value)}
            placeholder="currency"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="api-custom-image">Image path</Label>
          <Input
            id="api-custom-image"
            value={config.image_path}
            onChange={(event) => update('image_path', event.target.value)}
            placeholder="image_url"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="api-custom-stock">Stock path</Label>
          <Input
            id="api-custom-stock"
            value={config.stock_path}
            onChange={(event) => update('stock_path', event.target.value)}
            placeholder="stock_status"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="api-custom-categories">Categories path</Label>
          <Input
            id="api-custom-categories"
            value={config.categories_path}
            onChange={(event) => update('categories_path', event.target.value)}
            placeholder="categories"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="api-custom-headers">Headers JSON</Label>
          <textarea
            id="api-custom-headers"
            value={config.headers_json}
            onChange={(event) => update('headers_json', event.target.value)}
            placeholder='{"Accept":"application/json"}'
            disabled={disabled}
            className="min-h-[72px] w-full rounded-md border border-border bg-background/70 px-3 py-2 font-mono text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
      </div>
      ) : null}
    </div>
  )
}

export function ApiCatalogImport() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const regionalCountryCode = useCountryCode()

  const [platform, setPlatform] = useState<ApiPlatform>('steam')
  const [query, setQuery] = useState('')
  const [externalIds, setExternalIds] = useState('')
  const [countryCode, setCountryCode] = useState('')
  const [countryTouched, setCountryTouched] = useState(false)
  const [language, setLanguage] = useState('english')
  const [storeId, setStoreId] = useState<string>('')
  const [enableApiSync, setEnableApiSync] = useState(false)
  const [autoAddNew, setAutoAddNew] = useState(true)
  const [customConfig, setCustomConfig] = useState<CustomJsonApiConfig>(() =>
    readCustomJsonConfig({}),
  )
  const [preview, setPreview] = useState<ApiProductPreview[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const stores = useQuery<Store[]>({
    queryKey: ['stores'],
    queryFn: () => storesApi.list(),
  })

  const selectedStore =
    (stores.data ?? []).find((store) => String(store.id) === storeId) ?? null
  const effectiveCountryCode = countryTouched ? countryCode : regionalCountryCode
  const needsCustomConfig = apiPlatformNeedsJsonConfig(platform)
  const trimmedCustomConfig = trimCustomJsonConfig(customConfig)
  const externalIdsLabel =
    platform === 'steam' || platform === 'apple_app_store'
      ? 'App IDs or URLs'
      : 'Product IDs or URLs'
  const externalIdsPlaceholder =
    platform === 'steam'
      ? '1091500, https://store.steampowered.com/app/730/'
      : platform === 'apple_app_store'
        ? '123456789, https://apps.apple.com/app/example/id123456789'
        : platform === 'gog'
          ? 'https://www.gog.com/en/game/cyberpunk_2077'
          : 'product-id, https://store.example.com/product'

  function buildApiConfig(nextExternalIds: string[] = []) {
    const currentConfig = selectedStore?.api_config ?? {}
    const configuredIds = stringList(currentConfig.external_ids)
    const mergedIds = Array.from(new Set([...configuredIds, ...nextExternalIds]))
    return {
      ...currentConfig,
      country_code: effectiveCountryCode.trim().toUpperCase() || 'US',
      language: language.trim().toLowerCase() || 'english',
      external_ids: mergedIds,
      ...(needsCustomConfig ? { custom_json: trimmedCustomConfig } : {}),
    }
  }

  async function persistApiSyncSettings(nextExternalIds: string[] = []) {
    if (!storeId) {
      throw new Error('Select a store first')
    }
    return storesApi.update(Number(storeId), {
      api_enabled: enableApiSync,
      api_platform: platform,
      api_base_url: apiPlatformBaseUrl(platform) || null,
      api_key: null,
      api_config: buildApiConfig(nextExternalIds),
      api_auto_import_new: enableApiSync ? autoAddNew : false,
    })
  }

  const previewMutation = useMutation({
    onMutate: () => {
      setPreview([])
      setSelected(new Set())
      toast.info('Checking API catalog')
    },
    mutationFn: () =>
      importApi.apiPreview({
        platform,
        query: query.trim() || null,
        external_ids: splitExternalIds(externalIds),
        country_code: effectiveCountryCode.trim() || 'US',
        language: language.trim() || 'english',
        limit: 50,
        base_url: apiPlatformBaseUrl(platform) || null,
        config: buildApiConfig(),
      }),
    onSuccess: (data) => {
      setPreview(data)
      setSelected(new Set(data.map((product) => product.external_id)))
      toast.success(`Found ${data.length} products`)
    },
    onError: (error) => {
      toast.error('Preview failed', apiErrorDetail(error, 'Check platform settings'))
    },
  })

  const importMutation = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selected)
      const data = await importApi.apiImport({
        platform,
        store_id: Number(storeId),
        external_ids: ids,
        country_code: effectiveCountryCode.trim() || 'US',
        language: language.trim() || 'english',
        base_url: apiPlatformBaseUrl(platform) || null,
        config: buildApiConfig(ids),
      })
      let syncError: string | null = null
      try {
        await persistApiSyncSettings(ids)
      } catch (error) {
        syncError =
          error instanceof Error ? error.message : 'Could not save API sync settings'
      }
      return { ...data, syncError }
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['stores'] })
      if (data.syncError) {
        toast.info(
          `Imported ${data.imported} products`,
          `API sync settings were not saved: ${data.syncError}`,
        )
      } else if (enableApiSync) {
        toast.success(
          `Imported ${data.imported} products`,
          autoAddNew
            ? 'API sync is on and selected catalog IDs are saved.'
            : 'API sync is on for imported products.',
        )
      } else {
        toast.success(`Imported ${data.imported} products`)
      }
      navigate('/')
    },
    onError: (error) => {
      toast.error('Import failed', apiErrorDetail(error, 'Could not import API products'))
    },
  })

  const saveSyncMutation = useMutation({
    mutationFn: () => persistApiSyncSettings(splitExternalIds(externalIds)),
    onSuccess: (store) => {
      qc.invalidateQueries({ queryKey: ['stores'] })
      if (store.api_enabled) {
        toast.success(
          'API sync saved',
          store.api_auto_import_new
            ? 'Saved catalog IDs can be auto-added during sync.'
            : 'Existing API products will be refreshed during sync.',
        )
      } else {
        toast.info('API sync disabled for this store')
      }
    },
    onError: (error) => {
      toast.error('Save failed', apiErrorDetail(error, 'Could not save API sync'))
    },
  })

  const clearCatalogMutation = useMutation({
    mutationFn: (id: number) => storesApi.clearCatalog(id),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['stores'] })
      qc.invalidateQueries({ queryKey: ['activity'] })
      setPreview([])
      setSelected(new Set())
      toast.info(
        `${result.store_name} cleared`,
        `Removed ${result.removed_links} linked rows, ${result.removed_products} products, and ${result.removed_logs} logs.`,
      )
    },
    onError: (error) => {
      toast.error('Clear failed', apiErrorDetail(error, 'Could not clear catalog'))
    },
  })

  const canPreview =
    !previewMutation.isPending &&
    (!needsCustomConfig ||
      Boolean(trimmedCustomConfig.url_template || trimmedCustomConfig.detail_url_template)) &&
    (query.trim().length > 0 || externalIds.trim().length > 0)
  const canImport = selected.size > 0 && storeId !== ''
  const canSaveSync = storeId !== ''
  const canClearCatalog =
    storeId !== '' &&
    !previewMutation.isPending &&
    !importMutation.isPending &&
    !saveSyncMutation.isPending &&
    !clearCatalogMutation.isPending

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function toggleAll() {
    if (selected.size === preview.length) setSelected(new Set())
    else setSelected(new Set(preview.map((product) => product.external_id)))
  }

  function handleStoreChange(nextStoreId: string) {
    setStoreId(nextStoreId)
    const store =
      (stores.data ?? []).find((item) => String(item.id) === nextStoreId) ?? null
    if (!store) return
    if (store.api_platform) setPlatform(store.api_platform)
    setEnableApiSync(store.api_enabled)
    setAutoAddNew(store.api_enabled ? store.api_auto_import_new : true)
    const config = store.api_config ?? {}
    if (typeof config.country_code === 'string') {
      setCountryTouched(true)
      setCountryCode(config.country_code)
    }
    if (typeof config.language === 'string') setLanguage(config.language)
    setCustomConfig(readCustomJsonConfig(config))
    const configuredIds = stringList(config.external_ids)
    if (configuredIds.length > 0) setExternalIds(configuredIds.join('\n'))
  }

  return (
    <div className="space-y-6">
      <BentoGrid cols={6}>
        <BentoTile colSpan={4} tone="primary">
          <TileHeader
            eyebrow="Provider"
            title="API catalog"
            icon={<Gamepad2 className="h-4 w-4" />}
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="api-platform">Platform</Label>
              <Select
                id="api-platform"
                value={platform}
                onChange={(event) => setPlatform(event.target.value as ApiPlatform)}
                disabled={previewMutation.isPending}
              >
                {API_PLATFORM_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="api-store">Import into store</Label>
              <Select
                id="api-store"
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
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="api-query">Search</Label>
              <Input
                id="api-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Cyberpunk 2077"
                disabled={previewMutation.isPending}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="api-external-ids">{externalIdsLabel}</Label>
              <Input
                id="api-external-ids"
                value={externalIds}
                onChange={(event) => setExternalIds(event.target.value)}
                placeholder={externalIdsPlaceholder}
                disabled={previewMutation.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="api-country">Country</Label>
              <Input
                id="api-country"
                value={effectiveCountryCode}
                onChange={(event) => {
                  setCountryTouched(true)
                  setCountryCode(event.target.value.toUpperCase())
                }}
                maxLength={2}
                placeholder="US"
                disabled={previewMutation.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="api-language">Language</Label>
              <Input
                id="api-language"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                placeholder="english"
                disabled={previewMutation.isPending}
              />
            </div>
            {needsCustomConfig ? (
              <CustomJsonConfigFields
                config={customConfig}
                disabled={previewMutation.isPending || saveSyncMutation.isPending}
                onChange={setCustomConfig}
              />
            ) : null}
            <div className="space-y-2 rounded-xl border border-border/70 bg-background/60 p-3 sm:col-span-2">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={enableApiSync}
                  onChange={(event) => setEnableApiSync(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                  disabled={saveSyncMutation.isPending || importMutation.isPending}
                />
                <span className="text-sm text-foreground">
                  Enable scheduled API sync for this store
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={autoAddNew}
                  onChange={(event) => setAutoAddNew(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                  disabled={
                    !enableApiSync ||
                    saveSyncMutation.isPending ||
                    importMutation.isPending
                  }
                />
                <span className="text-sm text-muted-foreground">
                  Auto-add saved catalog IDs during sync
                </span>
              </label>
            </div>
            <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
              <Button
                variant="destructive"
                onClick={() => {
                  if (!selectedStore) return
                  const confirmed = confirm(
                    `Clear all local ${selectedStore.name} rows from Gabada?`,
                  )
                  if (confirmed) clearCatalogMutation.mutate(selectedStore.id)
                }}
                disabled={!canClearCatalog}
              >
                {clearCatalogMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Clear local catalog
              </Button>
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
                disabled={!canPreview}
              >
                {previewMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Preview catalog
              </Button>
            </div>
          </div>
        </BentoTile>

        <StatTile
          label="Found"
          value={preview.length}
          icon={<Package className="h-4 w-4" />}
          hint={previewMutation.isPending ? 'loading catalog' : 'API results'}
          tone={preview.length > 0 ? 'primary' : 'default'}
        />
        <StatTile
          label="Selected"
          value={selected.size}
          icon={<CheckCircle2 className="h-4 w-4" />}
          hint={preview.length > 0 ? `${Math.round((selected.size / preview.length) * 100)}%` : 'none yet'}
          tone={selected.size > 0 ? 'success' : 'default'}
        />
        <StatTile
          label="API sync"
          value={enableApiSync ? 'On' : 'Off'}
          icon={<RefreshCw className="h-4 w-4" />}
          hint={enableApiSync ? 'scheduled refresh' : 'manual import'}
          tone={enableApiSync ? 'accent' : 'default'}
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
                const checked = selected.has(product.external_id)
                return (
                  <label
                    key={product.external_id}
                    className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-2 transition-colors hover:bg-accent/30"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(product.external_id)}
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
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {product.raw_price ? <span>{product.raw_price}</span> : null}
                        {product.raw_discounted ? (
                          <span>Sale: {product.raw_discounted}</span>
                        ) : null}
                        <Badge variant="outline" className="text-xs">
                          {product.stock_status}
                        </Badge>
                        <Badge variant="muted" className="text-xs">
                          {product.platform}:{product.external_id}
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
