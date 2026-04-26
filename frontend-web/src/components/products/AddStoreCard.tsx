import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { productsApi, storesApi } from '@/api'
import type { StockStatus, Store } from '@/api'

interface AddStoreCardProps {
  productId: number
}

const MANUAL_STOCK_OPTIONS: Array<{ value: StockStatus; label: string }> = [
  { value: 'in_stock', label: 'In stock' },
  { value: 'out_of_stock', label: 'Out of stock' },
  { value: 'limited', label: 'Limited' },
  { value: 'preorder', label: 'Pre-order' },
  { value: 'backorder', label: 'Backorder' },
  { value: 'call_for_price', label: 'Call for price' },
  { value: 'contact_store', label: 'Contact store' },
  { value: 'discontinued', label: 'Discontinued' },
  { value: 'unknown', label: 'Unknown' },
]

export function AddStoreCard({ productId }: AddStoreCardProps) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [storeId, setStoreId] = useState('')
  const [newStoreName, setNewStoreName] = useState('')
  const [newStoreManualOnly, setNewStoreManualOnly] = useState(false)
  const [manualPrice, setManualPrice] = useState('')
  const [manualStockStatus, setManualStockStatus] = useState<StockStatus | ''>('')
  const [manualWarranty, setManualWarranty] = useState('')

  const stores = useQuery<Store[]>({
    queryKey: ['stores'],
    queryFn: () => storesApi.list(),
    enabled: open,
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

  const effectiveStoreId = storeId || (matchedStore ? String(matchedStore.id) : '')

  const createStore = useMutation({
    mutationFn: async () => {
      return storesApi.create({
        name: newStoreName.trim() || safeHost(url) || 'Manual source',
        base_url: newStoreManualOnly ? '' : new URL(url).origin,
        manual_only: newStoreManualOnly,
      })
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['stores'] })
      setStoreId(String(created.id))
      setNewStoreName('')
      setNewStoreManualOnly(false)
    },
  })

  const selectedStore = useMemo(() => {
    const fromQuery =
      (stores.data ?? []).find((store) => String(store.id) === effectiveStoreId) ?? null
    if (fromQuery) return fromQuery
    if (createStore.data && String(createStore.data.id) === effectiveStoreId) {
      return createStore.data
    }
    return null
  }, [createStore.data, effectiveStoreId, stores.data])
  const manualSourceSelected = selectedStore?.manual_only ?? newStoreManualOnly

  const addStore = useMutation({
    mutationFn: async () => {
      const link = await productsApi.addStore(productId, {
        store_id: Number(effectiveStoreId),
        product_url: url.trim() || null,
        auto_detect: !(selectedStore?.manual_only ?? false),
      })

      const parsedManualPrice = parseManualPrice(manualPrice)
      if (
        selectedStore?.manual_only &&
        (
          parsedManualPrice != null ||
          manualStockStatus !== '' ||
          manualWarranty.trim() !== ''
        )
      ) {
        await productsApi.setOverride(productId, link.id, {
          manual_price: parsedManualPrice,
          manual_stock_status: manualStockStatus || null,
          manual_warranty: manualWarranty.trim() || null,
        })
      }

      return link
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product', productId] })
      qc.invalidateQueries({ queryKey: ['products'] })
      reset()
    },
  })

  function reset() {
    setOpen(false)
    setUrl('')
    setStoreId('')
    setNewStoreName('')
    setNewStoreManualOnly(false)
    setManualPrice('')
    setManualStockStatus('')
    setManualWarranty('')
    createStore.reset()
    addStore.reset()
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="w-full border-dashed"
      >
        <Plus className="h-4 w-4" />
        Add another store
      </Button>
    )
  }

  const canAdd =
    effectiveStoreId !== '' &&
    ((selectedStore?.manual_only ?? false) || url.trim().length > 8)
  const urlHost = safeHost(url)

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Add another store</span>
        <Button variant="ghost" size="sm" onClick={reset} className="h-7 px-2">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="add-store-url">Product URL on the store</Label>
        <Input
          id="add-store-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={
            selectedStore?.manual_only
              ? 'Optional for manual-only stores'
              : 'https://another-shop.example.com/products/widget'
          }
        />
        {selectedStore?.manual_only ? (
          <p className="text-xs text-muted-foreground">
            This store is marked as manual-only, so you can link it without a website URL.
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="add-store-select">Store</Label>
        <Select
          id="add-store-select"
          value={effectiveStoreId}
          onChange={(e) => setStoreId(e.target.value)}
        >
          <option value="">— select —</option>
          {(stores.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        {!effectiveStoreId ? (
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={newStoreManualOnly}
              onChange={(e) => setNewStoreManualOnly(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Create a manual-only supplier instead of a website store
          </label>
        ) : null}
        {(url && !matchedStore) || newStoreManualOnly ? (
          <div className="mt-2 rounded-md border border-dashed border-border p-2">
            <p className="mb-2 text-xs text-muted-foreground">
              {newStoreManualOnly
                ? 'Create a manual-only supplier store?'
                : <>No store matches <span className="font-mono">{urlHost}</span>. Create one?</>}
            </p>
            <div className="flex gap-2">
              <Input
                value={newStoreName}
                onChange={(e) => setNewStoreName(e.target.value)}
                placeholder={urlHost ?? 'Store name'}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => createStore.mutate()}
                disabled={createStore.isPending || (!newStoreManualOnly && !urlHost)}
              >
                {createStore.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Create
              </Button>
            </div>
            {createStore.isError ? (
              <p className="mt-1 text-xs text-destructive">
                Could not create store. Does it already exist with a different base URL?
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {manualSourceSelected ? (
        <div className="space-y-3 rounded-md border border-dashed border-border p-3">
          <div>
            <p className="text-sm font-medium">Manual store snapshot</p>
            <p className="text-xs text-muted-foreground">
              Enter the current price and stock status now, so the manual supplier row is useful immediately.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="manual-store-price">Price (optional)</Label>
              <Input
                id="manual-store-price"
                value={manualPrice}
                onChange={(e) => setManualPrice(e.target.value)}
                placeholder="52500"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-store-stock">Stock status (optional)</Label>
              <Select
                id="manual-store-stock"
                value={manualStockStatus}
                onChange={(e) => setManualStockStatus(e.target.value as StockStatus | '')}
              >
                <option value="">— none —</option>
                {MANUAL_STOCK_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="manual-store-warranty">Warranty (optional)</Label>
              <Input
                id="manual-store-warranty"
                value={manualWarranty}
                onChange={(e) => setManualWarranty(e.target.value)}
                placeholder="1 year warranty"
              />
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={reset}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => addStore.mutate()}
          disabled={!canAdd || addStore.isPending}
        >
          {addStore.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Add store
        </Button>
      </div>

      {addStore.isError ? (
        <p className="text-right text-xs text-destructive">
          Failed to add store. The store may already be linked to this product.
        </p>
      ) : null}
    </div>
  )
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

function parseManualPrice(value: string): number | null {
  const cleaned = value.replace(/[^\d.,]/g, '').trim()
  if (!cleaned) return null
  const normalized = cleaned.includes('.') ? cleaned.replace(/,/g, '') : cleaned.replace(/,/g, '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
