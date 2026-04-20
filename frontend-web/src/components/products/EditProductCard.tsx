import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Save, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { categoriesApi, productsApi } from '@/api'
import type { Category, Product } from '@/api'

interface EditProductCardProps {
  product: Product
  onClose: () => void
}

export function EditProductCard({ product, onClose }: EditProductCardProps) {
  const qc = useQueryClient()
  const [name, setName] = useState(product.canonical_name)
  const [imageUrl, setImageUrl] = useState(product.image_url ?? '')
  const [categoryId, setCategoryId] = useState(
    product.category_id == null ? '' : String(product.category_id),
  )

  const categories = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
  })

  const save = useMutation({
    mutationFn: () =>
      productsApi.update(product.id, {
        canonical_name: name.trim(),
        image_url: imageUrl.trim() || null,
        category_id: categoryId === '' ? null : Number(categoryId),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product', product.id] })
      qc.invalidateQueries({ queryKey: ['products'] })
      onClose()
    },
  })

  const canSave = name.trim().length > 0 && !save.isPending

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Edit product</span>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 px-2">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="edit-name">Name</Label>
          <Input
            id="edit-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Product name"
          />
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="edit-image">Image URL</Label>
          <Input
            id="edit-image"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://…/image.jpg"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="edit-category">Category</Label>
          <Select
            id="edit-category"
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
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => save.mutate()} disabled={!canSave}>
          {save.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save changes
        </Button>
      </div>

      {save.isError ? (
        <p className="text-right text-xs text-destructive">
          Failed to save product. Check the values and try again.
        </p>
      ) : null}
    </div>
  )
}
