import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { productsApi, storesApi } from '@/api'
import type { Store } from '@/api'

interface AddStoreCardProps {
  productId: number
}

export function AddStoreCard({ productId }: AddStoreCardProps) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [storeId, setStoreId] = useState('')
  const [newStoreName, setNewStoreName] = useState('')

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
      const origin = new URL(url).origin
      return storesApi.create({
        name: newStoreName.trim() || new URL(url).hostname,
        base_url: origin,
      })
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['stores'] })
      setStoreId(String(created.id))
      setNewStoreName('')
    },
  })

  const addStore = useMutation({
    mutationFn: () =>
      productsApi.addStore(productId, {
        store_id: Number(effectiveStoreId),
        product_url: url.trim(),
        auto_detect: true,
      }),
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

  const canAdd = url.trim().length > 8 && effectiveStoreId !== ''
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
          placeholder="https://another-shop.example.com/products/widget"
        />
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
        {url && !matchedStore ? (
          <div className="mt-2 rounded-md border border-dashed border-border p-2">
            <p className="mb-2 text-xs text-muted-foreground">
              No store matches <span className="font-mono">{urlHost}</span>. Create one?
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
                disabled={createStore.isPending || !urlHost}
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
          Failed to add store. The URL may already be linked to this product.
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
