import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  CircleCheck,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Store as StoreIcon,
  TrendingDown,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { BentoGrid, BentoTile, TileHeader } from '@/components/ui/bento'
import { StatTile } from '@/components/ui/stat-tile'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast-store'
import { ProductTile } from '@/components/products/ProductTile'
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['activity'] })
      toast.success('Scrape started', 'All stores queued in the background')
    },
    onError: () => toast.error('Scrape failed', 'Check the backend is reachable'),
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

  const stats = useMemo(() => computeStats(products.data ?? []), [products.data])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tracked products"
        description="Price and stock across every store — live."
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

      <BentoGrid cols={6}>
        <StatTile
          label="Tracked"
          value={stats.products}
          icon={<Layers className="h-4 w-4" />}
          hint="products in catalog"
          loading={products.isLoading}
          tone="primary"
        />
        <StatTile
          label="Stores linked"
          value={stats.storeLinks}
          icon={<StoreIcon className="h-4 w-4" />}
          hint={`across ${stats.uniqueStores} shops`}
          loading={products.isLoading}
        />
        <StatTile
          label="In stock"
          value={stats.inStock}
          icon={<CircleCheck className="h-4 w-4" />}
          suffix={`/ ${stats.products}`}
          hint="available now"
          loading={products.isLoading}
          tone="success"
        />
        <StatTile
          label="Recent drops"
          value={stats.drops}
          icon={<TrendingDown className="h-4 w-4" />}
          hint="last scrape"
          loading={products.isLoading}
          tone="accent"
        />

        <BentoTile colSpan={2} tone="accent">
          <TileHeader
            eyebrow="Search & filter"
            title={
              <span className="text-muted-foreground">
                {filtered.length}{' '}
                <span className="text-foreground">
                  {filtered.length === 1 ? 'match' : 'matches'}
                </span>
              </span>
            }
          />
          <div className="mt-3 space-y-3">
            <div className="relative">
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
        </BentoTile>
      </BentoGrid>

      {products.isLoading ? (
        <LoadingGrid />
      ) : products.isError ? (
        <EmptyState text="Failed to load. Is the backend running on :8000?" />
      ) : filtered.length === 0 ? (
        <EmptyState
          text={
            search
              ? 'No products match your search.'
              : 'No products yet. Paste URLs on Add product.'
          }
          cta={
            !search ? (
              <Button size="sm" onClick={() => navigate('/add')}>
                <Plus className="h-4 w-4" />
                Add your first
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <ProductTile key={p.id} product={p} symbol={symbol} />
          ))}
        </div>
      )}
    </div>
  )
}

interface Stats {
  products: number
  storeLinks: number
  uniqueStores: number
  inStock: number
  drops: number
}

function computeStats(list: Product[]): Stats {
  const uniq = new Set<number>()
  let storeLinks = 0
  let inStock = 0
  let drops = 0
  for (const p of list) {
    storeLinks += p.stores.length
    for (const s of p.stores) {
      uniq.add(s.store_id)
      if (s.latest_price_delta != null && s.latest_price_delta < 0) drops += 1
    }
    if (
      p.stores.some((s) => {
        const v = s.manual_stock_status ?? s.latest_stock_status
        return v === 'in_stock' || v === 'limited'
      })
    ) {
      inStock += 1
    }
  }
  return {
    products: list.length,
    storeLinks,
    uniqueStores: uniq.size,
    inStock,
    drops,
  }
}

function LoadingGrid() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <div className="flex flex-wrap gap-1.5">
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-6 w-24 rounded-full" />
                <Skeleton className="h-6 w-28 rounded-full" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            </div>
            <div className="flex gap-1.5">
              <Skeleton className="h-8 w-16 rounded-md" />
              <Skeleton className="h-8 w-14 rounded-md" />
              <Skeleton className="h-8 w-14 rounded-md" />
            </div>
          </div>
        </div>
      ))}
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
        style={!active && color ? { borderColor: color, color } : undefined}
        className="cursor-pointer transition-transform hover:scale-[1.03]"
      >
        {label}
      </Badge>
    </button>
  )
}

function EmptyState({
  text,
  cta,
}: {
  text: string
  cta?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
      {cta}
    </div>
  )
}
