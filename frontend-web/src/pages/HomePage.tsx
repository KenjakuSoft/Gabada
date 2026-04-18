import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, RefreshCw, Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ProductCard } from '@/components/products/ProductCard'
import { categoriesApi, productsApi, scraperApi } from '@/api'
import { useCurrencySymbol } from '@/hooks/useSettings'
import type { Category, Product } from '@/api'

export function HomePage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const symbol = useCurrencySymbol()
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState<number | null>(null)

  const products = useQuery<Product[]>({
    queryKey: ['products', { categoryId }],
    queryFn: () => productsApi.list(categoryId ?? undefined),
  })

  const categories = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
    staleTime: 5 * 60_000,
  })

  const scrapeAll = useMutation({
    mutationFn: () => scraperApi.scrapeAll(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  })

  const filtered = useMemo(() => {
    const list = products.data ?? []
    if (!search.trim()) return list
    const q = search.trim().toLowerCase()
    return list.filter(
      (p) =>
        p.canonical_name.toLowerCase().includes(q) ||
        p.stores.some((s) => s.store_name.toLowerCase().includes(q)),
    )
  }, [products.data, search])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tracked products"
        description="Price and stock across every store in one view."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => scrapeAll.mutate()}
              disabled={scrapeAll.isPending}
            >
              <RefreshCw
                className={`h-4 w-4 ${scrapeAll.isPending ? 'animate-spin' : ''}`}
              />
              Scrape all
            </Button>
            <Button size="sm" onClick={() => navigate('/add')}>
              <Plus className="h-4 w-4" />
              Add product
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search products or stores…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryPill
            active={categoryId == null}
            label="All"
            onClick={() => setCategoryId(null)}
          />
          {(categories.data ?? []).map((c) => (
            <CategoryPill
              key={c.id}
              active={categoryId === c.id}
              label={c.name}
              color={c.color}
              onClick={() => setCategoryId(c.id)}
            />
          ))}
        </div>
      </div>

      {products.isLoading ? (
        <EmptyState text="Loading products…" />
      ) : products.isError ? (
        <EmptyState text="Failed to load. Is the backend running on :8000?" />
      ) : filtered.length === 0 ? (
        <EmptyState
          text={
            search
              ? 'No products match your search.'
              : 'No products yet. Add your first one.'
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => (
            <ProductCard key={p.id} product={p} symbol={symbol} />
          ))}
        </div>
      )}
    </div>
  )
}

interface CategoryPillProps {
  active: boolean
  label: string
  color?: string
  onClick: () => void
}

function CategoryPill({ active, label, color, onClick }: CategoryPillProps) {
  return (
    <button onClick={onClick} className="focus:outline-none">
      <Badge
        variant={active ? 'default' : 'outline'}
        style={
          !active && color
            ? { borderColor: color, color }
            : undefined
        }
        className="cursor-pointer"
      >
        {label}
      </Badge>
    </button>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}
