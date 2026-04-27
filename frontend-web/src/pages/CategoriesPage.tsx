import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Layers,
  Palette,
  Pencil,
  Plus,
  Tag,
  Trash2,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { BentoGrid, BentoTile, TileHeader } from '@/components/ui/bento'
import { StatTile } from '@/components/ui/stat-tile'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast-store'
import { cn } from '@/lib/utils'
import { categoriesApi, productsApi } from '@/api'
import type { Category, Product } from '@/api'

const DEFAULT_COLOR = '#6C63FF'

interface CategorySummary {
  category: Category
  productCount: number
}

export function CategoriesPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingColor, setEditingColor] = useState(DEFAULT_COLOR)

  const categories = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
  })

  const products = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: () => productsApi.list(),
  })

  const summaries = useMemo(
    () => buildCategorySummaries(categories.data ?? [], products.data ?? []),
    [categories.data, products.data],
  )
  const stats = useMemo(() => computeCategoryStats(summaries, products.data ?? []), [summaries, products.data])

  const create = useMutation({
    mutationFn: () =>
      categoriesApi.create({
        name: name.trim(),
        color: color || DEFAULT_COLOR,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      setName('')
      setColor(DEFAULT_COLOR)
      setAdding(false)
      toast.success('Category added')
    },
    onError: () => toast.error('Could not add category'),
  })

  const update = useMutation({
    mutationFn: ({ id, nextName, nextColor }: { id: number; nextName: string; nextColor: string }) =>
      categoriesApi.update(id, {
        name: nextName.trim(),
        color: nextColor || DEFAULT_COLOR,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['products'] })
      setEditingId(null)
      setEditingName('')
      setEditingColor(DEFAULT_COLOR)
      toast.success('Category updated')
    },
    onError: () => toast.error('Update failed'),
  })

  const remove = useMutation({
    mutationFn: (id: number) => categoriesApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['products'] })
      toast.info('Category removed', 'Linked products are now uncategorized')
    },
    onError: () => toast.error('Delete failed'),
  })

  const canCreate = name.trim().length > 0 && !create.isPending
  const loading = categories.isLoading || products.isLoading
  const error = categories.isError || products.isError

  function startEditing(category: Category) {
    setEditingId(category.id)
    setEditingName(category.name)
    setEditingColor(category.color)
  }

  function stopEditing() {
    setEditingId(null)
    setEditingName('')
    setEditingColor(DEFAULT_COLOR)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Categories"
        description="Organize products into reusable buckets for filtering and import."
        actions={
          <Button size="sm" onClick={() => setAdding((value) => !value)}>
            <Plus className="h-4 w-4" />
            {adding ? 'Close' : 'Add category'}
          </Button>
        }
      />

      <BentoGrid cols={6}>
        <StatTile
          label="Categories"
          value={summaries.length}
          icon={<Tag className="h-4 w-4" />}
          hint="available labels"
          loading={loading}
          tone="primary"
        />
        <StatTile
          label="Categorized"
          value={stats.categorizedProducts}
          icon={<Layers className="h-4 w-4" />}
          hint={`${stats.totalProducts} total products`}
          loading={loading}
        />
        <StatTile
          label="Uncategorized"
          value={stats.uncategorizedProducts}
          icon={<Tag className="h-4 w-4" />}
          hint="needs assignment"
          loading={loading}
          tone={stats.uncategorizedProducts > 0 ? 'warning' : 'success'}
        />
        <StatTile
          label="Largest"
          value={stats.largestCategoryLabel}
          icon={<Palette className="h-4 w-4" />}
          hint={stats.largestCategoryCount > 0 ? `${stats.largestCategoryCount} products` : 'no assignments yet'}
          loading={loading}
          tone="accent"
        />

        {adding ? (
          <BentoTile colSpan={6} tone="primary">
            <TileHeader
              eyebrow="New category"
              title="Create category"
              icon={<Plus className="h-4 w-4" />}
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="category-name">Name</Label>
                <Input
                  id="category-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. GPUs, Consoles, Monitors"
                  disabled={create.isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="category-color">Color</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="category-color"
                    type="color"
                    value={color}
                    onChange={(event) => setColor(event.target.value)}
                    className="h-9 w-14 p-1"
                    disabled={create.isPending}
                  />
                  <Input
                    value={color}
                    onChange={(event) => setColor(event.target.value)}
                    className="w-28 font-mono"
                    disabled={create.isPending}
                  />
                </div>
              </div>
              <div className="flex items-end gap-2">
                <Button size="sm" onClick={() => create.mutate()} disabled={!canCreate}>
                  Save
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAdding(false)
                    setName('')
                    setColor(DEFAULT_COLOR)
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </BentoTile>
        ) : null}
      </BentoGrid>

      {loading ? (
        <LoadingGrid />
      ) : error ? (
        <EmptyState text="Failed to load categories." />
      ) : summaries.length === 0 ? (
        <EmptyState
          text="No categories yet."
          cta={
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              Add your first
            </Button>
          }
        />
      ) : (
        <BentoGrid cols={6} className="md:grid-cols-2 lg:grid-cols-3">
          {summaries.map((summary) => {
            const category = summary.category
            const isEditing = editingId === category.id

            const canOpen = !isEditing && summary.productCount > 0
            const open = () =>
              navigate(`/?category=${category.id}`)

            return (
              <BentoTile key={category.id}>
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={canOpen ? open : undefined}
                    disabled={!canOpen}
                    className={cn(
                      'flex min-w-0 flex-1 items-start gap-3 rounded-md text-left transition-colors',
                      canOpen
                        ? 'cursor-pointer hover:text-primary'
                        : 'cursor-default',
                    )}
                    title={
                      canOpen
                        ? `Open ${summary.productCount} product${summary.productCount === 1 ? '' : 's'} in ${category.name}`
                        : summary.productCount === 0
                          ? 'No products in this category yet'
                          : undefined
                    }
                  >
                    <span
                      className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-border"
                      style={{ backgroundColor: category.color }}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {category.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {summary.productCount} product{summary.productCount === 1 ? '' : 's'}
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        isEditing ? stopEditing() : startEditing(category)
                      }
                      title={isEditing ? 'Cancel edit' : 'Edit'}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (
                          confirm(
                            `Delete "${category.name}"? Products in this category will become uncategorized.`,
                          )
                        ) {
                          remove.mutate(category.id)
                        }
                      }}
                      disabled={remove.isPending}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="font-mono text-[11px]">
                    {category.color}
                  </Badge>
                  {summary.productCount > 0 ? (
                    <Badge variant="secondary" className="text-[11px]">
                      assigned
                    </Badge>
                  ) : (
                    <Badge variant="muted" className="text-[11px]">
                      unused
                    </Badge>
                  )}
                  {canOpen ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-7 px-2 text-xs"
                      onClick={open}
                    >
                      View products
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>

                {isEditing ? (
                  <div className="mt-4 space-y-3 border-t border-border pt-4">
                    <div className="space-y-1.5">
                      <Label htmlFor={`edit-category-name-${category.id}`}>Name</Label>
                      <Input
                        id={`edit-category-name-${category.id}`}
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`edit-category-color-${category.id}`}>Color</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id={`edit-category-color-${category.id}`}
                          type="color"
                          value={editingColor}
                          onChange={(event) => setEditingColor(event.target.value)}
                          className="h-9 w-14 p-1"
                        />
                        <Input
                          value={editingColor}
                          onChange={(event) => setEditingColor(event.target.value)}
                          className="w-28 font-mono"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={stopEditing}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() =>
                          update.mutate({
                            id: category.id,
                            nextName: editingName,
                            nextColor: editingColor,
                          })
                        }
                        disabled={editingName.trim().length === 0 || update.isPending}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                ) : null}
              </BentoTile>
            )
          })}
        </BentoGrid>
      )}
    </div>
  )
}

function buildCategorySummaries(
  categories: Category[],
  products: Product[],
): CategorySummary[] {
  const counts = new Map<number, number>()
  for (const product of products) {
    if (product.category_id == null) continue
    counts.set(product.category_id, (counts.get(product.category_id) ?? 0) + 1)
  }

  return categories
    .map((category) => ({
      category,
      productCount: counts.get(category.id) ?? 0,
    }))
    .sort((left, right) => right.productCount - left.productCount || left.category.name.localeCompare(right.category.name))
}

function computeCategoryStats(
  summaries: CategorySummary[],
  products: Product[],
) {
  const categorizedProducts = products.filter(
    (product) => product.category_id != null,
  ).length
  const uncategorizedProducts = products.length - categorizedProducts
  const largest = summaries[0]

  return {
    totalProducts: products.length,
    categorizedProducts,
    uncategorizedProducts,
    largestCategoryLabel: largest ? largest.category.name : 'n/a',
    largestCategoryCount: largest?.productCount ?? 0,
  }
}

function LoadingGrid() {
  return (
    <BentoGrid cols={6} className="md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <BentoTile key={index}>
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="mt-4 h-4 w-24" />
          <Skeleton className="mt-4 h-8 w-20" />
        </BentoTile>
      ))}
    </BentoGrid>
  )
}

function EmptyState({ text, cta }: { text: string; cta?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
      {cta}
    </div>
  )
}
