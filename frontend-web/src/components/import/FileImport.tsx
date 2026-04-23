import { useMemo, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Columns3,
  Download,
  Eye,
  EyeOff,
  FileSearch,
  FileUp,
  Link2,
  Loader2,
  Package,
  Rows3,
  Search,
  Sparkles,
  Target,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { BentoGrid, BentoTile, TileHeader } from '@/components/ui/bento'
import { StatTile } from '@/components/ui/stat-tile'
import { toast } from '@/components/ui/toast-store'
import { categoriesApi, importApi, productsApi, storesApi } from '@/api'
import type {
  Category,
  FileImportPreviewResponse,
  FileImportRow,
  Product,
  Store,
} from '@/api'

interface SuggestedTarget {
  product: Product | null
  score: number | null
}

interface MappedPreviewRow extends FileImportRow {
  original: string[]
  displayName: string
  valid: boolean
  targetProduct: Product | null
  targetProductStoreId: number | null
  targetMode: 'auto' | 'manual' | 'new'
  targetScore: number | null
}

type ReviewFilter = 'all' | 'linked' | 'match' | 'new' | 'invalid'

const OPTIONAL_COLUMN = ''
const NEW_TARGET = '__new__'
const SEARCH_STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'inch',
  'inches',
  'laptop',
  'desktop',
  'gaming',
  'pc',
])

function pickColumn(
  columns: string[],
  patterns: RegExp[],
  excludes: RegExp[] = [],
): string {
  return (
    columns.find((column) => {
      const value = column.toLowerCase()
      return (
        patterns.some((pattern) => pattern.test(value)) &&
        excludes.every((pattern) => !pattern.test(value))
      )
    }) ?? OPTIONAL_COLUMN
  )
}

function formatMappedValue(value: string | number | null | undefined): string {
  if (value == null || value === '') return '-'
  return String(value)
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeProductName(value: string): string[] {
  return normalizeSearchText(value)
    .split(' ')
    .filter((token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token))
}

function scoreProductMatch(sourceName: string, product: Product): number {
  const source = normalizeSearchText(sourceName)
  const target = normalizeSearchText(product.canonical_name)
  if (!source || !target) return 0
  if (source === target) return 1
  if (source.includes(target) || target.includes(source)) return 0.92

  const sourceTokens = tokenizeProductName(sourceName)
  const targetTokens = tokenizeProductName(product.canonical_name)
  if (sourceTokens.length === 0 || targetTokens.length === 0) return 0

  const targetSet = new Set(targetTokens)
  const overlap = sourceTokens.filter((token) => targetSet.has(token)).length
  if (overlap === 0) return 0

  return overlap / Math.max(sourceTokens.length, targetTokens.length)
}

function findSuggestedTarget(
  rowName: string,
  products: Product[],
  selectedStoreId: number | null,
): SuggestedTarget {
  if (!rowName.trim()) return { product: null, score: null }

  let bestProduct: Product | null = null
  let bestScore = 0

  for (const product of products) {
    let score = scoreProductMatch(rowName, product)
    if (score === 0) continue
    if (
      selectedStoreId != null &&
      product.stores.some((store) => store.store_id === selectedStoreId)
    ) {
      score += 0.08
    }
    if (score > bestScore) {
      bestScore = score
      bestProduct = product
    }
  }

  if (bestScore < 0.52 || bestProduct == null) {
    return { product: null, score: null }
  }
  return { product: bestProduct, score: Math.min(bestScore, 1) }
}

function reviewStateOf(row: MappedPreviewRow): ReviewFilter {
  if (!row.valid) return 'invalid'
  if (row.targetProductStoreId != null) return 'linked'
  if (row.targetProduct != null) return 'match'
  return 'new'
}

function reviewStateMeta(row: MappedPreviewRow): {
  label: string
  variant: 'success' | 'info' | 'warning' | 'secondary'
} {
  const state = reviewStateOf(row)
  if (state === 'linked') {
    return { label: 'Linked', variant: 'success' }
  }
  if (state === 'match') {
    return { label: 'Match found', variant: 'secondary' }
  }
  if (state === 'new') {
    return { label: 'New product', variant: 'info' }
  }
  return { label: 'Needs name', variant: 'warning' }
}

function describeStoreAction(row: MappedPreviewRow): string {
  if (row.targetProductStoreId != null) {
    return 'Update this store link directly'
  }
  if (row.product_id != null) {
    return 'Attach the chosen store to that existing product'
  }
  if (row.url) {
    return 'Create a new tracked product with this URL'
  }
  return 'Create a new inactive price-list row'
}

export function FileImport() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<FileImportPreviewResponse | null>(null)
  const [nameCol, setNameCol] = useState<string>('')
  const [urlCol, setUrlCol] = useState<string>(OPTIONAL_COLUMN)
  const [imageCol, setImageCol] = useState<string>(OPTIONAL_COLUMN)
  const [priceCol, setPriceCol] = useState<string>(OPTIONAL_COLUMN)
  const [discountedCol, setDiscountedCol] = useState<string>(OPTIONAL_COLUMN)
  const [dealerCol, setDealerCol] = useState<string>(OPTIONAL_COLUMN)
  const [warrantyCol, setWarrantyCol] = useState<string>(OPTIONAL_COLUMN)
  const [stockCol, setStockCol] = useState<string>(OPTIONAL_COLUMN)
  const [storeId, setStoreId] = useState<string>('')
  const [categoryId, setCategoryId] = useState<string>('')
  const [rowSearch, setRowSearch] = useState('')
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all')
  const [showSourceColumns, setShowSourceColumns] = useState(false)
  const [showSelectedOnly, setShowSelectedOnly] = useState(false)
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [targetOverrides, setTargetOverrides] = useState<Record<number, string>>({})

  const selectedStoreId = storeId === '' ? null : Number(storeId)

  const stores = useQuery<Store[]>({
    queryKey: ['stores'],
    queryFn: () => storesApi.list(),
  })
  const categories = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
  })
  const products = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: () => productsApi.list(),
  })

  const productOptions = useMemo(
    () =>
      [...(products.data ?? [])].sort((a, b) =>
        a.canonical_name.localeCompare(b.canonical_name),
      ),
    [products.data],
  )

  const previewMutation = useMutation({
    mutationFn: () => importApi.filePreview(file!),
    onSuccess: (data) => {
      setPreview(data)
      const columns = data.columns
      setNameCol(
        pickColumn(columns, [/name/i, /title/i, /product/i]) ||
          columns[0] ||
          OPTIONAL_COLUMN,
      )
      setUrlCol(pickColumn(columns, [/url/i, /link/i, /permalink/i]))
      setImageCol(pickColumn(columns, [/image/i, /img/i, /photo/i, /thumb/i]))
      setPriceCol(
        pickColumn(
          columns,
          [/regular/i, /retail/i, /list/i, /selling/i, /\bprice\b/i],
          [/sale/i, /offer/i, /discount/i, /dealer/i, /wholesale/i, /trade/i],
        ),
      )
      setDiscountedCol(
        pickColumn(columns, [/sale/i, /offer/i, /discount/i, /special/i]),
      )
      setDealerCol(
        pickColumn(columns, [/dealer/i, /wholesale/i, /trade/i, /reseller/i]),
      )
      setWarrantyCol(
        pickColumn(columns, [/warranty/i, /guarantee/i, /service/i]),
      )
      setStockCol(
        pickColumn(columns, [/stock/i, /availability/i, /status/i]),
      )
      setRowSearch('')
      setReviewFilter('all')
      setShowSourceColumns(false)
      setTargetOverrides({})
      setSelectedRows(new Set(data.rows.map((_, index) => index)))
      toast.success(
        `Parsed ${data.total_rows} rows`,
        data.source_name
          ? `${data.file_format} - ${data.source_name}`
          : data.file_format,
      )
    },
    onError: () => toast.error('Could not read that file'),
  })

  const mappedRows = useMemo<MappedPreviewRow[]>(() => {
    if (!preview) return []

    const cell = (row: string[], column: string) => {
      if (!column) return null
      const index = preview.columns.indexOf(column)
      if (index < 0) return null
      return row[index] ?? null
    }

    return preview.rows.map((row, index) => {
      const mappedName = (cell(row, nameCol) ?? '').trim()
      const override = targetOverrides[index]
      const suggestion =
        !override || override === NEW_TARGET
          ? findSuggestedTarget(
              mappedName,
              productOptions,
              selectedStoreId,
            )
          : { product: null, score: null }

      let targetProduct: Product | null = null
      let targetMode: 'auto' | 'manual' | 'new' = 'new'
      let targetScore: number | null = null

      if (override && override !== NEW_TARGET) {
        targetProduct =
          productOptions.find((product) => product.id === Number(override)) ?? null
        targetMode = targetProduct ? 'manual' : 'new'
      } else if (suggestion.product) {
        targetProduct = suggestion.product
        targetMode = 'auto'
        targetScore = suggestion.score
      }

      const targetStore =
        selectedStoreId != null && targetProduct
          ? targetProduct.stores.find(
              (store) => store.store_id === selectedStoreId,
            ) ?? null
          : null
      const displayName = mappedName || targetProduct?.canonical_name || ''

      return {
        source_index: index,
        name: displayName,
        product_id: targetProduct?.id ?? null,
        product_store_id: targetStore?.id ?? null,
        url: (cell(row, urlCol) ?? '').trim() || null,
        image_url: (cell(row, imageCol) ?? '').trim() || null,
        price: cell(row, priceCol),
        discounted_price: cell(row, discountedCol),
        dealer_price: cell(row, dealerCol),
        warranty: (cell(row, warrantyCol) ?? '').trim() || null,
        stock_status: (cell(row, stockCol) ?? '').trim() || null,
        original: row,
        displayName,
        valid: displayName.length > 0,
        targetProduct,
        targetProductStoreId: targetStore?.id ?? null,
        targetMode,
        targetScore,
      }
    })
  }, [
    preview,
    nameCol,
    urlCol,
    imageCol,
    priceCol,
    discountedCol,
    dealerCol,
    warrantyCol,
    stockCol,
    productOptions,
    selectedStoreId,
    targetOverrides,
  ])

  const validRows = useMemo(
    () => mappedRows.filter((row) => row.valid),
    [mappedRows],
  )

  const selectedMappedRows = useMemo(
    () =>
      mappedRows.filter(
        (row) =>
          row.valid &&
          row.source_index != null &&
          selectedRows.has(row.source_index),
      ),
    [mappedRows, selectedRows],
  )

  const visibleRows = useMemo(() => {
    const term = normalizeSearchText(rowSearch)
    return mappedRows.filter((row) => {
      if (reviewFilter !== 'all' && reviewStateOf(row) !== reviewFilter) {
        return false
      }
      if (showSelectedOnly) {
        if (row.source_index == null || !selectedRows.has(row.source_index)) {
          return false
        }
      }
      if (!term) return true
      const haystack = normalizeSearchText(
        [
          row.displayName,
          row.targetProduct?.canonical_name ?? '',
          row.original.join(' '),
        ].join(' '),
      )
      return haystack.includes(term)
    })
  }, [mappedRows, reviewFilter, rowSearch, selectedRows, showSelectedOnly])

  const rowsWithUrls = useMemo(
    () => validRows.filter((row) => row.url).length,
    [validRows],
  )
  const rowsWithPrices = useMemo(
    () =>
      validRows.filter(
        (row) =>
          row.price != null ||
          row.discounted_price != null ||
          row.dealer_price != null,
      ).length,
    [validRows],
  )
  const matchedRows = useMemo(
    () => validRows.filter((row) => row.targetProduct != null).length,
    [validRows],
  )
  const linkedStoreRows = useMemo(
    () => validRows.filter((row) => row.targetProductStoreId != null).length,
    [validRows],
  )
  const reviewCounts = useMemo(
    () => ({
      all: mappedRows.length,
      linked: mappedRows.filter((row) => reviewStateOf(row) === 'linked').length,
      match: mappedRows.filter((row) => reviewStateOf(row) === 'match').length,
      new: mappedRows.filter((row) => reviewStateOf(row) === 'new').length,
      invalid: mappedRows.filter((row) => reviewStateOf(row) === 'invalid').length,
    }),
    [mappedRows],
  )

  const commitMutation = useMutation({
    mutationFn: () =>
      importApi.fileCommit({
        rows: selectedMappedRows.map((row) => ({
          source_index: row.source_index ?? null,
          name: row.displayName,
          product_id: row.product_id,
          product_store_id: row.product_store_id,
          url: row.url,
          image_url: row.image_url,
          price: row.price,
          discounted_price: row.discounted_price,
          dealer_price: row.dealer_price,
          warranty: row.warranty,
          stock_status: row.stock_status,
        })),
        store_id: Number(storeId),
        category_id: categoryId ? Number(categoryId) : null,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['stores'] })
      qc.invalidateQueries({ queryKey: ['activity'] })
      toast.success(
        `Processed ${data.imported} rows`,
        `${data.created} new - ${data.updated} updated`,
      )
      navigate('/')
    },
    onError: () => toast.error('Import failed'),
  })

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setFile(nextFile)
    setPreview(null)
    setRowSearch('')
    setTargetOverrides({})
    setSelectedRows(new Set())
  }

  function toggleRow(index: number) {
    const next = new Set(selectedRows)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    setSelectedRows(next)
  }

  function toggleAllVisible() {
    const visibleIndexes = visibleRows
      .map((row) => row.source_index)
      .filter((index): index is number => index != null && mappedRows[index]?.valid)
    const allSelected =
      visibleIndexes.length > 0 &&
      visibleIndexes.every((index) => selectedRows.has(index))

    if (allSelected) {
      const next = new Set(selectedRows)
      for (const index of visibleIndexes) next.delete(index)
      setSelectedRows(next)
      return
    }

    const next = new Set(selectedRows)
    for (const index of visibleIndexes) next.add(index)
    setSelectedRows(next)
  }

  function setRowTarget(rowIndex: number, value: string) {
    setTargetOverrides((current) => {
      const next = { ...current }
      if (value === '') delete next[rowIndex]
      else next[rowIndex] = value
      return next
    })
  }

  const canCommit = selectedMappedRows.length > 0 && storeId !== ''
  const mappedColumnBadges: Record<string, string> = {
    [nameCol]: 'Name',
    ...(urlCol ? { [urlCol]: 'URL' } : {}),
    ...(imageCol ? { [imageCol]: 'Image' } : {}),
    ...(priceCol ? { [priceCol]: 'Retail' } : {}),
    ...(discountedCol ? { [discountedCol]: 'Sale' } : {}),
    ...(dealerCol ? { [dealerCol]: 'Dealer' } : {}),
    ...(warrantyCol ? { [warrantyCol]: 'Warranty' } : {}),
    ...(stockCol ? { [stockCol]: 'Stock' } : {}),
  }

  return (
    <div className="space-y-6">
      <BentoGrid cols={6}>
        <BentoTile colSpan={4} tone="primary">
          <TileHeader
            eyebrow="Step 1"
            title="Upload document"
            icon={<FileUp className="h-4 w-4" />}
          />
          <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-border bg-background/60 p-6 transition-colors hover:border-primary/40 hover:bg-accent/30">
            <Upload className="h-5 w-5 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {file ? file.name : 'Choose CSV, Excel, or PDF'}
              </div>
              <div className="text-xs text-muted-foreground">
                {file
                  ? `${(file.size / 1024).toFixed(1)} KB`
                  : 'Upload the full file, review every row, then choose exactly what to update.'}
              </div>
            </div>
            <input
              type="file"
              accept=".csv,.xlsx,.xls,.xlsm,.pdf"
              className="hidden"
              onChange={onFile}
            />
          </label>
          <div className="mt-3 flex justify-end">
            <Button
              onClick={() => previewMutation.mutate()}
              disabled={!file || previewMutation.isPending}
            >
              {previewMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Build full workbench
            </Button>
          </div>
        </BentoTile>

        <StatTile
          label="Rows"
          value={preview?.total_rows ?? 0}
          icon={<Rows3 className="h-4 w-4" />}
          hint={
            preview
              ? preview.source_name
                ? `${preview.file_format} - ${preview.source_name}`
                : preview.file_format
              : 'awaiting file'
          }
          tone={preview ? 'primary' : 'default'}
        />
        <StatTile
          label="Selected"
          value={selectedMappedRows.length}
          icon={<CheckCircle2 className="h-4 w-4" />}
          hint={
            validRows.length > 0
              ? `${validRows.length} rows are ready`
              : 'set a name or target product'
          }
          tone={selectedMappedRows.length > 0 ? 'success' : 'default'}
        />
      </BentoGrid>

      {preview ? (
        <>
          <BentoGrid cols={6}>
            <BentoTile colSpan={6}>
              <TileHeader
                eyebrow="Step 2"
                title="Map the essentials"
                icon={<Columns3 className="h-4 w-4" />}
                action={
                  <Badge variant="secondary" className="font-mono text-xs">
                    {preview.source_name
                      ? `${preview.file_format} - ${preview.source_name}`
                      : preview.file_format}
                  </Badge>
                }
              />
              <p className="mt-3 text-sm text-muted-foreground">
                Only a document name and destination store are required. Every
                other mapping is optional and can stay blank if the source file
                does not have it.
              </p>
              <div className="mt-3 rounded-xl border border-border/70 bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                Import destination:{' '}
                <span className="font-medium text-foreground">
                  {storeId
                    ? (stores.data ?? []).find((store) => store.id === Number(storeId))
                        ?.name ?? 'Selected store'
                    : 'Choose the store this document belongs to'}
                </span>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,1fr)]">
                <div className="space-y-4">
                  <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Sparkles className="h-4 w-4 text-primary" />
                      Required first
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <ColSelect
                        label="Name column"
                        value={nameCol}
                        onChange={setNameCol}
                        columns={preview.columns}
                      />
                      <div className="space-y-1.5">
                        <Label htmlFor="file-store">Store</Label>
                        <Select
                          id="file-store"
                          value={storeId}
                          onChange={(event) => setStoreId(event.target.value)}
                        >
                          <option value="">Select store</option>
                          {(stores.data ?? []).map((store) => (
                            <option key={store.id} value={store.id}>
                              {store.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="file-category">Category (optional)</Label>
                        <Select
                          id="file-category"
                          value={categoryId}
                          onChange={(event) => setCategoryId(event.target.value)}
                        >
                          <option value="">No category</option>
                          {(categories.data ?? []).map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Target className="h-4 w-4 text-primary" />
                      Common import fields
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <ColSelect
                        label="URL column"
                        value={urlCol}
                        onChange={setUrlCol}
                        columns={preview.columns}
                        allowEmpty
                      />
                      <ColSelect
                        label="Retail price column"
                        value={priceCol}
                        onChange={setPriceCol}
                        columns={preview.columns}
                        allowEmpty
                      />
                      <ColSelect
                        label="Sale price column"
                        value={discountedCol}
                        onChange={setDiscountedCol}
                        columns={preview.columns}
                        allowEmpty
                      />
                      <ColSelect
                        label="Dealer price column"
                        value={dealerCol}
                        onChange={setDealerCol}
                        columns={preview.columns}
                        allowEmpty
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Link2 className="h-4 w-4 text-primary" />
                      Extra details
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <ColSelect
                        label="Image column"
                        value={imageCol}
                        onChange={setImageCol}
                        columns={preview.columns}
                        allowEmpty
                      />
                      <ColSelect
                        label="Warranty column"
                        value={warrantyCol}
                        onChange={setWarrantyCol}
                        columns={preview.columns}
                        allowEmpty
                      />
                      <ColSelect
                        label="Stock / status column"
                        value={stockCol}
                        onChange={setStockCol}
                        columns={preview.columns}
                        allowEmpty
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                  <div className="text-sm font-medium text-foreground">
                    How row matching works
                  </div>
                  <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                    <div>
                      <Badge variant="success" className="mr-2 text-[10px]">
                        Linked
                      </Badge>
                      Existing product already has this store linked. Import will
                      update that exact row.
                    </div>
                    <div>
                      <Badge variant="secondary" className="mr-2 text-[10px]">
                        Match found
                      </Badge>
                      Gabada found a likely existing product, but this store is
                      not linked yet.
                    </div>
                    <div>
                      <Badge variant="info" className="mr-2 text-[10px]">
                        New product
                      </Badge>
                      No confident match was found, so the row can create a new
                      product.
                    </div>
                    <div>
                      <Badge variant="warning" className="mr-2 text-[10px]">
                        Needs name
                      </Badge>
                      The document row still needs either a mapped name or a
                      chosen Gabada target.
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <StatTile
                  label="Matched"
                  value={matchedRows}
                  icon={<FileSearch className="h-4 w-4" />}
                  hint={`${linkedStoreRows} already linked to this store`}
                  tone={matchedRows > 0 ? 'success' : 'default'}
                />
                <StatTile
                  label="With URL"
                  value={rowsWithUrls}
                  icon={<Package className="h-4 w-4" />}
                  hint={`${validRows.length - rowsWithUrls} without URL`}
                  tone={rowsWithUrls > 0 ? 'primary' : 'default'}
                />
                <StatTile
                  label="With prices"
                  value={rowsWithPrices}
                  icon={<Rows3 className="h-4 w-4" />}
                  hint="retail, sale, or dealer"
                  tone={rowsWithPrices > 0 ? 'success' : 'default'}
                />
                <StatTile
                  label="Product targets"
                  value={productOptions.length}
                  icon={<Columns3 className="h-4 w-4" />}
                  hint="existing Gabada products"
                />
              </div>

              <p className="mt-3 text-xs text-muted-foreground">
                Each row can either update an existing Gabada product for the
                chosen store or create a new entry by document name. If the
                selected product already has this store linked, the importer
                updates that store record directly.
              </p>
            </BentoTile>
          </BentoGrid>

          <BentoGrid cols={6}>
            <BentoTile colSpan={6}>
              <TileHeader
                eyebrow="Step 3"
                title="Review rows and import"
                action={
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={toggleAllVisible}>
                      Select visible
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowSourceColumns((current) => !current)}
                    >
                      {showSourceColumns ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                      {showSourceColumns ? 'Hide source columns' : 'Show source columns'}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => commitMutation.mutate()}
                      disabled={!canCommit || commitMutation.isPending}
                    >
                      {commitMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      Update Gabada
                    </Button>
                  </div>
                }
              />

              <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={rowSearch}
                    onChange={(event) => setRowSearch(event.target.value)}
                    placeholder="Search document rows, source values, or matched Gabada products"
                    className="pl-9"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={showSelectedOnly}
                    onChange={(event) => setShowSelectedOnly(event.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  Show selected only
                </label>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <ReviewFilterChip
                  active={reviewFilter === 'all'}
                  label={`All ${reviewCounts.all}`}
                  onClick={() => setReviewFilter('all')}
                />
                <ReviewFilterChip
                  active={reviewFilter === 'linked'}
                  label={`Linked ${reviewCounts.linked}`}
                  onClick={() => setReviewFilter('linked')}
                />
                <ReviewFilterChip
                  active={reviewFilter === 'match'}
                  label={`Match found ${reviewCounts.match}`}
                  onClick={() => setReviewFilter('match')}
                />
                <ReviewFilterChip
                  active={reviewFilter === 'new'}
                  label={`New ${reviewCounts.new}`}
                  onClick={() => setReviewFilter('new')}
                />
                <ReviewFilterChip
                  active={reviewFilter === 'invalid'}
                  label={`Needs name ${reviewCounts.invalid}`}
                  onClick={() => setReviewFilter('invalid')}
                />
              </div>

              <p className="mt-3 text-xs text-muted-foreground">
                The default review table focuses on what Gabada will do. Turn on
                source columns only when you need to inspect the original file
                values in full.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <StatTile
                  label="Selected"
                  value={selectedMappedRows.length}
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  hint={`${visibleRows.length} visible in current filter`}
                  tone={selectedMappedRows.length > 0 ? 'success' : 'default'}
                />
                <StatTile
                  label="Linked"
                  value={reviewCounts.linked}
                  icon={<Link2 className="h-4 w-4" />}
                  hint="updates exact store rows"
                  tone={reviewCounts.linked > 0 ? 'success' : 'default'}
                />
                <StatTile
                  label="New"
                  value={reviewCounts.new}
                  icon={<Sparkles className="h-4 w-4" />}
                  hint="creates new Gabada products"
                  tone={reviewCounts.new > 0 ? 'accent' : 'default'}
                />
                <StatTile
                  label="Needs name"
                  value={reviewCounts.invalid}
                  icon={<AlertTriangle className="h-4 w-4" />}
                  hint="cannot import yet"
                  tone={reviewCounts.invalid > 0 ? 'warning' : 'default'}
                />
              </div>

              <div className="mt-3 overflow-hidden rounded-md border border-border">
                <div className="max-h-[72vh] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-muted/90 text-muted-foreground backdrop-blur">
                      <tr>
                        <th className="w-10 px-2 py-2 text-left font-medium">
                          Pick
                        </th>
                        <th className="w-12 px-2 py-2 text-left font-medium">
                          #
                        </th>
                        <th className="w-32 px-2 py-2 text-left font-medium">
                          Status
                        </th>
                        <th className="min-w-[240px] px-2 py-2 text-left font-medium">
                          Document row
                        </th>
                        <th className="min-w-[260px] px-2 py-2 text-left font-medium">
                          Gabada target
                        </th>
                        <th className="min-w-[180px] px-2 py-2 text-left font-medium">
                          Import action
                        </th>
                        <th className="min-w-[180px] px-2 py-2 text-left font-medium">
                          Prices
                        </th>
                        <th className="min-w-[160px] px-2 py-2 text-left font-medium">
                          Stock and extras
                        </th>
                        {showSourceColumns
                          ? preview.columns.map((column) => (
                              <th
                                key={column}
                                className="min-w-[160px] px-2 py-2 text-left font-medium"
                              >
                                <div className="flex items-center gap-1.5">
                                  <span>{column}</span>
                                  {mappedColumnBadges[column] ? (
                                    <Badge
                                      variant="secondary"
                                      className="text-[10px]"
                                    >
                                      {mappedColumnBadges[column]}
                                    </Badge>
                                  ) : null}
                                </div>
                              </th>
                            ))
                          : null}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row) => {
                        const rowIndex = row.source_index ?? -1
                        const checked =
                          row.source_index != null &&
                          selectedRows.has(row.source_index)
                        const overrideValue = targetOverrides[rowIndex] ?? ''
                        const stateMeta = reviewStateMeta(row)
                        const targetSummary = row.targetProduct ? (
                          <div className="space-y-1">
                            <Select
                              value={overrideValue}
                              onChange={(event) =>
                                setRowTarget(rowIndex, event.target.value)
                              }
                            >
                              <option value="">
                                {row.targetMode === 'auto' && row.targetProduct
                                  ? 'Use auto match'
                                  : 'Auto / create by row name'}
                              </option>
                              <option value={NEW_TARGET}>
                                Create / update by row name
                              </option>
                              {productOptions.map((product) => (
                                <option key={product.id} value={String(product.id)}>
                                  {product.canonical_name}
                                </option>
                              ))}
                            </Select>
                            <div className="truncate text-[11px] text-muted-foreground">
                              {row.targetProduct.canonical_name}
                            </div>
                            <div className="flex flex-wrap items-center gap-1">
                              <Badge
                                variant={
                                  row.targetMode === 'auto'
                                    ? 'success'
                                    : row.targetMode === 'manual'
                                      ? 'info'
                                      : 'outline'
                                }
                                className="text-[10px]"
                              >
                                {row.targetMode === 'auto'
                                  ? `Auto ${Math.round((row.targetScore ?? 0) * 100)}%`
                                  : 'Manual'}
                              </Badge>
                              {row.targetProductStoreId ? (
                                <Badge variant="secondary" className="text-[10px]">
                                  store linked
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <Select
                              value={overrideValue}
                              onChange={(event) =>
                                setRowTarget(rowIndex, event.target.value)
                              }
                            >
                              <option value="">Auto / create by row name</option>
                              <option value={NEW_TARGET}>
                                Create / update by row name
                              </option>
                              {productOptions.map((product) => (
                                <option key={product.id} value={String(product.id)}>
                                  {product.canonical_name}
                                </option>
                              ))}
                            </Select>
                            <div className="text-[11px] text-muted-foreground">
                              No confident Gabada match yet
                            </div>
                          </div>
                        )

                        return (
                          <tr
                            key={rowIndex}
                            className="border-t border-border transition-colors hover:bg-accent/20"
                          >
                            <td className="px-2 py-2 align-top">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!row.valid}
                                onChange={() => toggleRow(rowIndex)}
                                className="h-4 w-4 accent-primary"
                              />
                            </td>
                            <td className="px-2 py-2 align-top font-mono text-muted-foreground">
                              {rowIndex + 1}
                            </td>
                            <td className="px-2 py-2 align-top">
                              <div className="space-y-1">
                                <Badge variant={stateMeta.variant} className="text-[10px]">
                                  {stateMeta.label}
                                </Badge>
                                {row.targetScore != null && row.targetMode === 'auto' ? (
                                  <div className="text-[11px] text-muted-foreground">
                                    {Math.round(row.targetScore * 100)}% match confidence
                                  </div>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-2 py-2 align-top">
                              <div className="min-w-0 space-y-1">
                                <div className="truncate font-medium">
                                  {row.displayName || 'Missing name'}
                                </div>
                                {row.url ? (
                                  <div className="truncate text-[11px] text-muted-foreground">
                                    {row.url}
                                  </div>
                                ) : (
                                  <div className="text-[11px] text-muted-foreground">
                                    No product URL in this row
                                  </div>
                                )}
                                {!row.valid ? (
                                  <span className="text-[11px] text-destructive">
                                    Map a name column or choose a Gabada product.
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-2 py-2 align-top">{targetSummary}</td>
                            <td className="px-2 py-2 align-top text-muted-foreground">
                              <div className="space-y-1 text-[11px]">
                                <div>{describeStoreAction(row)}</div>
                                {row.targetProductStoreId == null &&
                                row.product_id == null &&
                                !row.url ? (
                                  <div>Useful for dealer lists and offline price sheets.</div>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-2 py-2 align-top">
                              <div className="space-y-1">
                                <div>
                                  <span className="text-muted-foreground">Retail:</span>{' '}
                                  {formatMappedValue(row.price)}
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Sale:</span>{' '}
                                  {formatMappedValue(row.discounted_price)}
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Dealer:</span>{' '}
                                  {formatMappedValue(row.dealer_price)}
                                </div>
                              </div>
                            </td>
                            <td className="px-2 py-2 align-top">
                              <div className="space-y-1">
                                <div>
                                  <span className="text-muted-foreground">Stock:</span>{' '}
                                  {formatMappedValue(row.stock_status)}
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Warranty:</span>{' '}
                                  {formatMappedValue(row.warranty)}
                                </div>
                              </div>
                            </td>
                            {showSourceColumns
                              ? row.original.map((value, cellIndex) => (
                                  <td
                                    key={`${rowIndex}-${cellIndex}`}
                                    className="max-w-[220px] truncate px-2 py-2 align-top"
                                    title={value}
                                  >
                                    {value || '-'}
                                  </td>
                                ))
                              : null}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </BentoTile>
          </BentoGrid>
        </>
      ) : null}
    </div>
  )
}

interface ColSelectProps {
  label: string
  value: string
  onChange: (value: string) => void
  columns: string[]
  allowEmpty?: boolean
}

function ColSelect({
  label,
  value,
  onChange,
  columns,
  allowEmpty,
}: ColSelectProps) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onChange={(event) => onChange(event.target.value)}>
        {allowEmpty ? <option value={OPTIONAL_COLUMN}>No column</option> : null}
        {columns.map((column) => (
          <option key={column} value={column}>
            {column}
          </option>
        ))}
      </Select>
    </div>
  )
}

interface ReviewFilterChipProps {
  active: boolean
  label: string
  onClick: () => void
}

function ReviewFilterChip({
  active,
  label,
  onClick,
}: ReviewFilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? 'border-primary bg-primary/15 text-foreground'
          : 'border-border bg-muted/40 text-muted-foreground hover:bg-accent'
      }`}
    >
      {label}
    </button>
  )
}
