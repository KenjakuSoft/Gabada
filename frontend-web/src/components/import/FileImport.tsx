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
type ImportGoal = 'update_existing' | 'catalog_import'
type FileScope = 'partial_update' | 'full_dealer_catalog'
type ReviewView = 'guided' | 'document'

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
const GENERIC_MATCH_TOKENS = new Set([
  'adapter',
  'adaptor',
  'atx',
  'board',
  'cable',
  'card',
  'capture',
  'case',
  'charger',
  'cooler',
  'controller',
  'cpu',
  'desktop',
  'dock',
  'fan',
  'gpu',
  'graphics',
  'headphone',
  'headphones',
  'headset',
  'hdd',
  'hub',
  'keyboard',
  'laptop',
  'memory',
  'mic',
  'microphone',
  'monitor',
  'motherboard',
  'mouse',
  'pad',
  'power',
  'printer',
  'processor',
  'psu',
  'ram',
  'router',
  'scanner',
  'speaker',
  'ssd',
  'stand',
  'supply',
  'switch',
  'type',
  'usb',
  'vga',
  'webcam',
  'wireless',
  'wired',
])
const MODEL_UNIT_TOKENS = new Set([
  'GB',
  'TB',
  'MB',
  'MHZ',
  'GHZ',
  'HZ',
  'W',
  'KW',
  'V',
  'MM',
  'CM',
  'M',
  'KG',
  'G',
  'ML',
  'L',
  'IN',
  'INCH',
  'INCHES',
  'FPS',
  'MP',
  'RGB',
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

function getColumnValue(
  columns: string[],
  row: string[],
  column: string,
): string | null {
  if (!column) return null
  const index = columns.indexOf(column)
  if (index < 0) return null
  return row[index] ?? null
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

function tokenizeModelSource(value: string): string[] {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((token) => token.replace(/^-+|-+$/g, ''))
    .filter(Boolean)
}

function isSpecLikeToken(token: string, nextToken?: string): boolean {
  const flat = token.replace(/-/g, '')
  if (!flat) return true
  if (MODEL_UNIT_TOKENS.has(flat)) return true
  if (/^\d+(\.\d+)?(GB|TB|MB|MHZ|GHZ|HZ|W|KW|V|MM|CM|KG|G|ML|L|MP)$/.test(flat)) {
    return true
  }
  if (/^\d+(\.\d+)?$/.test(flat) && nextToken && MODEL_UNIT_TOKENS.has(nextToken)) {
    return true
  }
  if (/^\d{1,2}$/.test(flat)) {
    return true
  }
  return false
}

function isModelLikeToken(tokens: string[], index: number): boolean {
  const token = tokens[index]
  const next = tokens[index + 1]
  const flat = token.replace(/-/g, '')
  if (flat.length < 2 || isSpecLikeToken(token, next)) return false

  const hasDigit = /\d/.test(flat)
  const hasLetter = /[A-Z]/.test(flat)
  if (!hasDigit) return false
  if (hasLetter) return true
  return flat.length >= 4
}

function extractModelSignatures(value: string): string[] {
  const tokens = tokenizeModelSource(value)
  const signatures = new Set<string>()

  for (let index = 0; index < tokens.length; index += 1) {
    if (!isModelLikeToken(tokens, index)) continue

    const token = tokens[index]
    const compact = token.replace(/-/g, '')
    signatures.add(token)
    if (compact !== token) signatures.add(compact)

    const prev = tokens[index - 1]
    const prevPrev = tokens[index - 2]
    if (prev && !isSpecLikeToken(prev)) {
      signatures.add(`${prev} ${token}`)
      if (prevPrev && !isSpecLikeToken(prevPrev)) {
        signatures.add(`${prevPrev} ${prev} ${token}`)
      }
    }

    const next = tokens[index + 1]
    if (next && /^[A-Z]{2,5}$/.test(next) && !isSpecLikeToken(next)) {
      signatures.add(`${token} ${next}`)
    }
  }

  return [...signatures]
}

function compactSignature(signature: string): string {
  return signature.replace(/[^A-Z0-9]+/g, '')
}

function meaningfulProductTokens(tokens: string[]): string[] {
  return tokens.filter((token) => !GENERIC_MATCH_TOKENS.has(token))
}

function scoreProductMatch(sourceName: string, product: Product): number {
  const source = normalizeSearchText(sourceName)
  const target = normalizeSearchText(product.canonical_name)
  if (!source || !target) return 0

  const sourceTokens = tokenizeProductName(sourceName)
  const targetTokens = tokenizeProductName(product.canonical_name)
  const sourceModels = extractModelSignatures(sourceName)
  const targetModels = extractModelSignatures(product.canonical_name)
  const sourceMeaningful = meaningfulProductTokens(sourceTokens)
  const targetMeaningful = meaningfulProductTokens(targetTokens)
  const sourceModelSet = new Set(sourceModels.map(compactSignature))
  const targetModelSet = new Set(targetModels.map(compactSignature))
  const sharedModels = [...sourceModelSet].filter((model) => targetModelSet.has(model))
  const targetMeaningfulSet = new Set(targetMeaningful)
  const sharedMeaningful = sourceMeaningful.filter((token) =>
    targetMeaningfulSet.has(token),
  )

  const hasSpecificSourceSignal =
    sourceModels.length > 0 ||
    sourceMeaningful.length >= 2 ||
    (sourceMeaningful.length === 1 &&
      sourceTokens.length >= 3 &&
      source.length >= 18)

  if (!hasSpecificSourceSignal) return 0
  if (
    source === target &&
    (sourceModels.length > 0 ||
      sourceMeaningful.length >= 2 ||
      (sourceMeaningful.length === 1 &&
        sourceTokens.length >= 3 &&
        source.length >= 18))
  ) {
    return 1
  }

  if (sourceModels.length > 0 && targetModels.length > 0) {
    if (sharedModels.length > 0) {
      return Math.min(0.95 + sharedModels.length * 0.02, 1)
    }
    return 0
  }

  if (
    (source.includes(target) || target.includes(source)) &&
    sourceMeaningful.length >= 2 &&
    sharedMeaningful.length >= 2
  ) {
    return Math.min(0.82 + sharedMeaningful.length * 0.04, 0.94)
  }

  if (sourceMeaningful.length === 0 || targetMeaningful.length === 0) return 0
  if (sharedMeaningful.length >= 2) {
    return Math.min(
      sharedMeaningful.length /
        Math.max(sourceMeaningful.length, targetMeaningful.length) +
        0.2,
      0.9,
    )
  }
  if (
    sharedMeaningful.length === 1 &&
    sourceMeaningful.length === 1 &&
    sourceTokens.length >= 3 &&
    source.length >= 18
  ) {
    return 0.56
  }
  return 0
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
    return { label: 'Suggested target', variant: 'secondary' }
  }
  if (state === 'new') {
    return { label: 'New product', variant: 'info' }
  }
  return { label: 'Needs name', variant: 'warning' }
}

function canImportRow(row: MappedPreviewRow, goal: ImportGoal): boolean {
  if (!row.valid) return false
  if (goal === 'catalog_import') return true
  return row.product_id != null || row.targetProductStoreId != null
}

function describeStoreAction(row: MappedPreviewRow, goal: ImportGoal): string {
  if (goal === 'update_existing') {
    if (row.targetProductStoreId != null) {
      return 'Update this store row with imported dealer and retail values'
    }
    if (row.product_id != null) {
      return 'Review this suggested Gabada product before importing these values'
    }
    return 'Choose a Gabada product first. This mode will not create a new product.'
  }
  if (row.targetProductStoreId != null) {
    return 'Update this store link directly'
  }
  if (row.product_id != null) {
    return 'Use this suggested product or choose a different Gabada target'
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
  const [importGoal, setImportGoal] = useState<ImportGoal>('update_existing')
  const [fileScope, setFileScope] = useState<FileScope>('partial_update')
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
  const [reviewView, setReviewView] = useState<ReviewView>('guided')
  const [showSelectedOnly, setShowSelectedOnly] = useState(false)
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [targetOverrides, setTargetOverrides] = useState<Record<number, string>>({})
  const [activeRowIndex, setActiveRowIndex] = useState<number | null>(null)

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

  const selectedStore = useMemo(
    () =>
      selectedStoreId == null
        ? null
        : (stores.data ?? []).find((store) => store.id === selectedStoreId) ?? null,
    [selectedStoreId, stores.data],
  )

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
        pickColumn(columns, [/dealer/i, /wholesale/i, /trade/i, /reseller/i, /\bdp\b/i]),
      )
      setWarrantyCol(
        pickColumn(columns, [/warranty/i, /guarantee/i, /service/i]),
      )
      setStockCol(
        pickColumn(columns, [/stock/i, /availability/i, /status/i]),
      )
      setRowSearch('')
      setReviewFilter('all')
      setReviewView('guided')
      setShowSelectedOnly(false)
      setTargetOverrides({})
      setSelectedRows(new Set(data.rows.map((_, index) => index)))
      setActiveRowIndex(data.rows.length > 0 ? 0 : null)
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

    return preview.rows.map((row, index) => {
      const mappedName = (getColumnValue(preview.columns, row, nameCol) ?? '').trim()
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
        url: (getColumnValue(preview.columns, row, urlCol) ?? '').trim() || null,
        image_url:
          (getColumnValue(preview.columns, row, imageCol) ?? '').trim() || null,
        price: getColumnValue(preview.columns, row, priceCol),
        discounted_price: getColumnValue(preview.columns, row, discountedCol),
        dealer_price: getColumnValue(preview.columns, row, dealerCol),
        warranty:
          (getColumnValue(preview.columns, row, warrantyCol) ?? '').trim() || null,
        stock_status:
          (getColumnValue(preview.columns, row, stockCol) ?? '').trim() || null,
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
  const readyRows = useMemo(
    () => mappedRows.filter((row) => canImportRow(row, importGoal)).length,
    [importGoal, mappedRows],
  )

  const selectedMappedRows = useMemo(
    () =>
      mappedRows.filter(
        (row) =>
          canImportRow(row, importGoal) &&
          row.source_index != null &&
          selectedRows.has(row.source_index),
      ),
    [importGoal, mappedRows, selectedRows],
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

  const seenLinkedProductStoreIds = useMemo(
    () =>
      [
        ...new Set(
          mappedRows
            .map((row) => row.targetProductStoreId)
            .filter((id): id is number => id != null),
        ),
      ],
    [mappedRows],
  )

  const existingStoreLinkIds = useMemo(
    () =>
      selectedStoreId == null
        ? []
        : [
            ...new Set(
              productOptions.flatMap((product) =>
                product.stores
                  .filter((store) => store.store_id === selectedStoreId)
                  .map((store) => store.id),
              ),
            ),
          ],
    [productOptions, selectedStoreId],
  )

  const fullCatalogMissingLinkedCount = useMemo(() => {
    if (selectedStoreId == null) return 0
    const seen = new Set(seenLinkedProductStoreIds)
    return existingStoreLinkIds.filter((id) => !seen.has(id)).length
  }, [existingStoreLinkIds, seenLinkedProductStoreIds, selectedStoreId])

  const fullCatalogNeedsDealerColumn =
    fileScope === 'full_dealer_catalog' && dealerCol === OPTIONAL_COLUMN

  const visibleIndexes = useMemo(
    () =>
      visibleRows
        .map((row) => row.source_index)
        .filter(
          (index, position, array): index is number =>
            index != null && array.indexOf(index) === position,
        ),
    [visibleRows],
  )

  const visibleReadyIndexes = useMemo(
    () =>
      visibleRows
        .filter((row) => canImportRow(row, importGoal))
        .map((row) => row.source_index)
        .filter((index): index is number => index != null),
    [importGoal, visibleRows],
  )

  const activeRow = useMemo(
    () => {
      if (activeRowIndex != null) {
        const visibleMatch =
          visibleRows.find((row) => row.source_index === activeRowIndex) ?? null
        if (visibleMatch) return visibleMatch
      }
      return visibleRows[0] ?? mappedRows[0] ?? null
    },
    [activeRowIndex, mappedRows, visibleRows],
  )
  const focusedRowIndex = activeRow?.source_index ?? null

  const activeRowSelected =
    activeRow?.source_index != null && selectedRows.has(activeRow.source_index)

  const previewSourceRow = activeRow?.original ?? preview?.sample_rows?.[0] ?? null

  const liveMappingFields = useMemo(() => {
    if (!preview || !previewSourceRow) return []
    return [
      {
        label: 'Name',
        column: nameCol,
        value:
          activeRow?.displayName ||
          (getColumnValue(preview.columns, previewSourceRow, nameCol) ?? ''),
      },
      {
        label: 'URL',
        column: urlCol,
        value: getColumnValue(preview.columns, previewSourceRow, urlCol) ?? '',
      },
      {
        label: 'Retail',
        column: priceCol,
        value: getColumnValue(preview.columns, previewSourceRow, priceCol) ?? '',
      },
      {
        label: 'Sale',
        column: discountedCol,
        value:
          getColumnValue(preview.columns, previewSourceRow, discountedCol) ?? '',
      },
      {
        label: 'Dealer',
        column: dealerCol,
        value: getColumnValue(preview.columns, previewSourceRow, dealerCol) ?? '',
      },
      {
        label: 'Warranty',
        column: warrantyCol,
        value:
          getColumnValue(preview.columns, previewSourceRow, warrantyCol) ?? '',
      },
      {
        label: 'Stock',
        column: stockCol,
        value: getColumnValue(preview.columns, previewSourceRow, stockCol) ?? '',
      },
    ]
  }, [
    activeRow?.displayName,
    dealerCol,
    discountedCol,
    nameCol,
    preview,
    previewSourceRow,
    priceCol,
    stockCol,
    urlCol,
    warrantyCol,
  ])

  const activeSourceFields = useMemo(() => {
    if (!preview || !activeRow) return []
    return preview.columns.map((column, index) => ({
      column,
      value: activeRow.original[index] ?? '',
      badge: mappedColumnBadgesForColumn(
        column,
        nameCol,
        urlCol,
        imageCol,
        priceCol,
        discountedCol,
        dealerCol,
        warrantyCol,
        stockCol,
      ),
    }))
  }, [
    activeRow,
    dealerCol,
    discountedCol,
    imageCol,
    nameCol,
    preview,
    priceCol,
    stockCol,
    urlCol,
    warrantyCol,
  ])

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
        create_missing_products: importGoal === 'catalog_import',
        missing_rows_policy:
          fileScope === 'full_dealer_catalog'
            ? 'mark_dealer_unavailable'
            : 'ignore',
        full_catalog_seen_product_store_ids:
          fileScope === 'full_dealer_catalog' ? seenLinkedProductStoreIds : [],
        dealer_column_mapped: dealerCol !== OPTIONAL_COLUMN,
        warranty_column_mapped: warrantyCol !== OPTIONAL_COLUMN,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['stores'] })
      qc.invalidateQueries({ queryKey: ['activity'] })
      const summaryBits = [
        `${data.updated} updated`,
        `${data.created} new`,
        `${data.skipped} skipped`,
      ]
      if (data.dealer_unavailable_marked > 0) {
        summaryBits.push(
          `${data.dealer_unavailable_marked} dealer unavailable`,
        )
      }
      toast.success(
        `Processed ${data.imported} rows`,
        summaryBits.join(' - '),
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
    setReviewFilter('all')
    setReviewView('guided')
    setFileScope('partial_update')
    setShowSelectedOnly(false)
    setTargetOverrides({})
    setSelectedRows(new Set())
    setActiveRowIndex(null)
  }

  function toggleRow(index: number) {
    const next = new Set(selectedRows)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    setSelectedRows(next)
  }

  function toggleAllVisible() {
    const allSelected =
      visibleReadyIndexes.length > 0 &&
      visibleReadyIndexes.every((index) => selectedRows.has(index))

    if (allSelected) {
      const next = new Set(selectedRows)
      for (const index of visibleReadyIndexes) next.delete(index)
      setSelectedRows(next)
      return
    }

    const next = new Set(selectedRows)
    for (const index of visibleReadyIndexes) next.add(index)
    setSelectedRows(next)
  }

  function selectVisibleRows() {
    const next = new Set(selectedRows)
    for (const index of visibleReadyIndexes) next.add(index)
    setSelectedRows(next)
  }

  function unselectVisibleRows() {
    const next = new Set(selectedRows)
    for (const index of visibleIndexes) next.delete(index)
    setSelectedRows(next)
  }

  function selectReadyRows() {
    setSelectedRows(
      new Set(
        mappedRows
          .filter((row) => canImportRow(row, importGoal))
          .map((row) => row.source_index)
          .filter((index): index is number => index != null),
      ),
    )
  }

  function clearAllRows() {
    setSelectedRows(new Set())
  }

  function setRowTarget(rowIndex: number, value: string) {
    setTargetOverrides((current) => {
      const next = { ...current }
      if (value === '') delete next[rowIndex]
      else next[rowIndex] = value
      return next
    })
  }

  const canCommit =
    selectedMappedRows.length > 0 &&
    storeId !== '' &&
    !fullCatalogNeedsDealerColumn
  const mappedColumnBadges: Record<string, string> = Object.fromEntries(
    preview?.columns
      .map((column) => [
        column,
        mappedColumnBadgesForColumn(
          column,
          nameCol,
          urlCol,
          imageCol,
          priceCol,
          discountedCol,
          dealerCol,
          warrantyCol,
          stockCol,
        ),
      ])
      .filter((entry): entry is [string, string] => Boolean(entry[1])) ?? [],
  )

  function renderTargetPicker(row: MappedPreviewRow) {
    const rowIndex = row.source_index ?? -1
    const overrideValue = targetOverrides[rowIndex] ?? ''
    const autoLabel =
      row.targetMode === 'auto' && row.targetProduct
        ? 'Use suggested target'
        : importGoal === 'update_existing'
          ? 'Suggested / choose existing Gabada product'
          : 'Suggested / create by row name'

    return (
      <div className="space-y-1">
        <Select
          value={overrideValue}
          onChange={(event) => setRowTarget(rowIndex, event.target.value)}
        >
          <option value="">{autoLabel}</option>
          {importGoal === 'catalog_import' ? (
            <option value={NEW_TARGET}>Create / update by row name</option>
          ) : null}
          {productOptions.map((product) => (
            <option key={product.id} value={String(product.id)}>
              {product.canonical_name}
            </option>
          ))}
        </Select>
        {row.targetProduct ? (
          <>
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
                  ? `Suggested ${Math.round((row.targetScore ?? 0) * 100)}%`
                  : 'Manual'}
              </Badge>
              {row.targetProductStoreId ? (
                <Badge variant="secondary" className="text-[10px]">
                  store linked
                </Badge>
              ) : null}
            </div>
          </>
        ) : (
          <div className="text-[11px] text-muted-foreground">
            No confident Gabada match yet
          </div>
        )}
      </div>
    )
  }

  function renderTargetSummary(row: MappedPreviewRow) {
    if (row.targetProduct) {
      return (
        <div className="space-y-1">
          <div className="truncate text-sm font-medium text-foreground">
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
                ? `Suggested ${Math.round((row.targetScore ?? 0) * 100)}%`
                : 'Manual'}
            </Badge>
            {row.targetProductStoreId ? (
              <Badge variant="secondary" className="text-[10px]">
                store linked
              </Badge>
            ) : null}
          </div>
        </div>
      )
    }

    if (importGoal === 'catalog_import') {
      return (
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">Create by row name</div>
          <div className="text-[11px] text-muted-foreground">
            No confident Gabada match yet
          </div>
        </div>
      )
    }

    return (
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">Needs manual target</div>
        <div className="text-[11px] text-muted-foreground">
          Open this row in the workbench to choose an existing Gabada product
        </div>
      </div>
    )
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
            readyRows > 0
              ? `${readyRows} rows are ready`
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
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <GoalTile
                  active={importGoal === 'update_existing'}
                  eyebrow="Recommended for dealer sheets"
                  title="Update existing store prices"
                  description="Use supplier PDFs or Excel files to update dealer, retail, warranty, and stock on products already tracked in Gabada."
                  onClick={() => setImportGoal('update_existing')}
                />
                <GoalTile
                  active={importGoal === 'catalog_import'}
                  eyebrow="Use for broad catalog imports"
                  title="Create or expand products"
                  description="Allow unmatched rows to create new Gabada products while still updating existing store links when possible."
                  onClick={() => setImportGoal('catalog_import')}
                />
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <GoalTile
                  active={fileScope === 'partial_update'}
                  eyebrow="Safer default"
                  title="Partial file update"
                  description="Only products present in this file are updated. Missing products keep their current imported dealer data."
                  onClick={() => setFileScope('partial_update')}
                />
                <GoalTile
                  active={fileScope === 'full_dealer_catalog'}
                  eyebrow="Use only when complete"
                  title="Full latest dealer catalog"
                  description="Products missing from this file for the chosen store are marked dealer unavailable after import."
                  onClick={() => setFileScope('full_dealer_catalog')}
                />
              </div>
              <div className="mt-3 rounded-xl border border-border/70 bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                Import destination:{' '}
                <span className="font-medium text-foreground">
                  {selectedStore?.name ?? 'Choose the store this document belongs to'}
                </span>
              </div>
              <div className="mt-3 rounded-xl border border-border/70 bg-background/60 px-3 py-3 text-sm text-muted-foreground">
                {fileScope === 'partial_update' ? (
                  <>
                    Missing products from this file are ignored. Only the rows
                    you import will update dealer data for{' '}
                    <span className="font-medium text-foreground">
                      {selectedStore?.name ?? 'the selected store'}
                    </span>
                    .
                  </>
                ) : fullCatalogNeedsDealerColumn ? (
                  <>
                    Choose a{' '}
                    <span className="font-medium text-foreground">
                      Dealer price column
                    </span>{' '}
                    before importing a full dealer catalog. That keeps Gabada
                    from clearing old dealer prices without a real dealer field
                    to compare against.
                  </>
                ) : selectedStore == null ? (
                  <>Choose the destination store to preview full-catalog impact.</>
                ) : (
                  <>
                    This file currently matches{' '}
                    <span className="font-medium text-foreground">
                      {seenLinkedProductStoreIds.length}
                    </span>{' '}
                    existing linked rows for{' '}
                    <span className="font-medium text-foreground">
                      {selectedStore.name}
                    </span>
                    .{' '}
                    <span className="font-medium text-foreground">
                      {fullCatalogMissingLinkedCount}
                    </span>{' '}
                    linked rows are not represented in this file and will be
                    marked dealer unavailable after import.
                    {reviewCounts.match + reviewCounts.new + reviewCounts.invalid > 0 ? (
                      <span>
                        {' '}
                        Rows still shown as Suggested target, New, or Needs name do
                        not protect existing dealer prices until you target
                        them.
                      </span>
                    ) : null}
                  </>
                )}
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
                        <div className="text-xs text-muted-foreground">
                          {importGoal === 'update_existing'
                            ? 'Usually not needed for supplier price updates.'
                            : 'Used when a brand-new product is created from this file.'}
                        </div>
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

                <div className="space-y-4">
                  <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-foreground">
                        Live mapping preview
                      </div>
                      <Badge variant="secondary" className="text-[10px]">
                        {activeRow?.source_index != null
                          ? `Row ${activeRow.source_index + 1}`
                          : 'Sample row'}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Change any column above and this preview updates instantly.
                    </div>
                    <div className="mt-3 space-y-2">
                      {liveMappingFields.map((field) => (
                        <div
                          key={field.label}
                          className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-foreground">
                              {field.label}
                            </span>
                            <span className="truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                              {field.column || 'No column'}
                            </span>
                          </div>
                          <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {field.value || 'No value in the current row'}
                          </div>
                        </div>
                      ))}
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
                          Suggested target
                        </Badge>
                        Gabada found a possible existing product, but you should
                        review it before trusting the suggestion.
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
                {importGoal === 'update_existing'
                  ? 'This flow is separate from auto-scraping. It is meant for supplier price sheets and dealer files, so unmatched rows will not create new Gabada products unless you switch to catalog mode.'
                  : 'Each row can either update an existing Gabada product for the chosen store or create a new entry by document name. If the selected product already has this store linked, the importer updates that store record directly.'}
              </p>
            </BentoTile>
          </BentoGrid>

          <BentoGrid cols={6}>
            <BentoTile colSpan={6}>
              <TileHeader
                eyebrow="Step 3"
                title="Review rows and import"
                action={
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-md border border-border bg-background/70 p-1">
                      <Button
                        variant={reviewView === 'guided' ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => setReviewView('guided')}
                      >
                        <Eye className="h-4 w-4" />
                        Workbench
                      </Button>
                      <Button
                        variant={reviewView === 'document' ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => setReviewView('document')}
                      >
                        <EyeOff className="h-4 w-4" />
                        Raw document
                      </Button>
                    </div>
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
                  label={`Suggested ${reviewCounts.match}`}
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
                The workbench lets you click into a row, inspect the parsed source
                cells, and choose the exact Gabada target before importing. Switch
                to raw document mode anytime when you want the full parsed file in a
                single grid.{' '}
                {importGoal === 'update_existing'
                  ? 'Rows without a matched Gabada product stay visible for review, but they will not import until you target an existing product.'
                  : ''}
              </p>
              {fullCatalogNeedsDealerColumn ? (
                <p className="mt-2 text-xs text-amber-700">
                  Full latest dealer catalog mode needs a mapped Dealer price
                  column before Gabada will import.
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={selectVisibleRows}>
                  Select visible
                </Button>
                <Button variant="outline" size="sm" onClick={unselectVisibleRows}>
                  Unselect visible
                </Button>
                <Button variant="outline" size="sm" onClick={selectReadyRows}>
                  Select ready rows
                </Button>
                <Button variant="outline" size="sm" onClick={toggleAllVisible}>
                  {visibleReadyIndexes.length > 0 &&
                  visibleReadyIndexes.every((index) => selectedRows.has(index))
                    ? 'Clear visible ready'
                    : 'Toggle visible ready'}
                </Button>
                <Button variant="ghost" size="sm" onClick={clearAllRows}>
                  Unselect all
                </Button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <StatTile
                  label="Selected"
                  value={selectedMappedRows.length}
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  hint={`${visibleRows.length} visible - ${visibleReadyIndexes.length} ready`}
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
                  hint={
                    importGoal === 'update_existing'
                      ? 'needs a Gabada target before import'
                      : 'creates new Gabada products'
                  }
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

              {reviewView === 'guided' ? (
                <div className="mt-4 grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
                  <div className="rounded-xl border border-border/70 bg-background/60 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          Row explorer
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Click any visible row to inspect its parsed values.
                        </div>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">
                        {visibleRows.length} shown
                      </Badge>
                    </div>
                    <div className="mt-3 max-h-[70vh] space-y-2 overflow-auto pr-1">
                      {visibleRows.length > 0 ? (
                        visibleRows.map((row) => {
                          const rowIndex = row.source_index ?? -1
                          const checked =
                            row.source_index != null &&
                            selectedRows.has(row.source_index)
                          const stateMeta = reviewStateMeta(row)

                          return (
                            <button
                              key={`explorer-${rowIndex}`}
                              type="button"
                              onClick={() => setActiveRowIndex(rowIndex)}
                              className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                                focusedRowIndex === rowIndex
                                  ? 'border-primary/45 bg-primary/10'
                                  : 'border-border/70 bg-background/70 hover:bg-accent/30'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="font-mono text-[11px] text-muted-foreground">
                                    Row {rowIndex + 1}
                                  </div>
                                  <div className="truncate text-sm font-medium text-foreground">
                                    {row.displayName || 'Missing name'}
                                  </div>
                                </div>
                                <div className="shrink-0">
                                  <Badge
                                    variant={checked ? 'success' : 'outline'}
                                    className="text-[10px]"
                                  >
                                    {checked ? 'Picked' : 'Not picked'}
                                  </Badge>
                                </div>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                <Badge variant={stateMeta.variant} className="text-[10px]">
                                  {stateMeta.label}
                                </Badge>
                                {row.targetScore != null && row.targetMode === 'auto' ? (
                                  <Badge variant="secondary" className="text-[10px]">
                                    {Math.round(row.targetScore * 100)}% match
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="mt-2 text-xs text-muted-foreground">
                                R: {formatMappedValue(row.price)} | D:{' '}
                                {formatMappedValue(row.dealer_price)}
                              </div>
                            </button>
                          )
                        })
                      ) : (
                        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                          No rows match the current filter yet.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-foreground">
                            Focused row details
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Review one row deeply before importing.
                          </div>
                        </div>
                        {activeRow ? (
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-[10px]">
                              Row {(activeRow.source_index ?? 0) + 1}
                            </Badge>
                            <Button
                              variant={activeRowSelected ? 'secondary' : 'outline'}
                              size="sm"
                              disabled={
                                activeRow.source_index == null ||
                                !canImportRow(activeRow, importGoal)
                              }
                              onClick={() => {
                                if (activeRow.source_index != null) {
                                  toggleRow(activeRow.source_index)
                                }
                              }}
                            >
                              {activeRowSelected ? 'Picked for import' : 'Pick this row'}
                            </Button>
                          </div>
                        ) : null}
                      </div>

                      {activeRow ? (
                        <>
                          <div className="mt-4 rounded-xl border border-border/70 bg-muted/30 p-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                variant={reviewStateMeta(activeRow).variant}
                                className="text-[10px]"
                              >
                                {reviewStateMeta(activeRow).label}
                              </Badge>
                              {activeRow.targetScore != null &&
                              activeRow.targetMode === 'auto' ? (
                                <Badge variant="secondary" className="text-[10px]">
                                  {Math.round(activeRow.targetScore * 100)}% suggested
                                </Badge>
                              ) : null}
                            </div>
                            <div className="mt-3 text-lg font-semibold text-foreground">
                              {activeRow.displayName || 'Missing name'}
                            </div>
                            <div className="mt-1 text-sm text-muted-foreground">
                              {describeStoreAction(activeRow, importGoal)}
                            </div>
                            <div className="mt-4 grid gap-3 sm:grid-cols-3">
                              <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2">
                                <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                                  Retail
                                </div>
                                <div className="mt-1 text-sm font-medium text-foreground">
                                  {formatMappedValue(activeRow.price)}
                                </div>
                              </div>
                              <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2">
                                <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                                  Dealer
                                </div>
                                <div className="mt-1 text-sm font-medium text-foreground">
                                  {formatMappedValue(activeRow.dealer_price)}
                                </div>
                              </div>
                              <div className="rounded-lg border border-border/70 bg-background/70 px-3 py-2">
                                <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                                  Stock
                                </div>
                                <div className="mt-1 text-sm font-medium text-foreground">
                                  {formatMappedValue(activeRow.stock_status)}
                                </div>
                              </div>
                            </div>
                            <div className="mt-4">{renderTargetPicker(activeRow)}</div>
                          </div>

                          <div className="mt-4">
                            <div className="text-sm font-medium text-foreground">
                              Parsed source values
                            </div>
                            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                              {activeSourceFields.map((field) => (
                                <div
                                  key={`${field.column}-${activeRow.source_index}`}
                                  className="rounded-lg border border-border/70 bg-background/70 px-3 py-2"
                                >
                                  <div className="flex items-center gap-2">
                                    <div className="truncate text-xs font-medium text-foreground">
                                      {field.column}
                                    </div>
                                    {field.badge ? (
                                      <Badge variant="secondary" className="text-[10px]">
                                        {field.badge}
                                      </Badge>
                                    ) : null}
                                  </div>
                                  <div className="mt-1 break-words text-sm text-muted-foreground">
                                    {field.value || '-'}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                          Pick a row from the explorer to inspect the parsed values.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              {reviewView === 'document' ? (
                <div className="mt-4 overflow-hidden rounded-md border border-border">
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
                        {reviewView === 'document'
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
                        const stateMeta = reviewStateMeta(row)

                        return (
                          <tr
                            key={rowIndex}
                            className={`border-t border-border transition-colors hover:bg-accent/20 ${
                              focusedRowIndex === rowIndex ? 'bg-primary/5' : ''
                            }`}
                            onClick={() => setActiveRowIndex(rowIndex)}
                          >
                            <td
                              className="px-2 py-2 align-top"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!canImportRow(row, importGoal)}
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
                                <span className="text-[11px] text-muted-foreground">
                                  Click row to inspect it in the workbench.
                                </span>
                              </div>
                            </td>
                            <td className="px-2 py-2 align-top">
                              {renderTargetSummary(row)}
                            </td>
                            <td className="px-2 py-2 align-top text-muted-foreground">
                              <div className="space-y-1 text-[11px]">
                                <div>{describeStoreAction(row, importGoal)}</div>
                                {importGoal === 'update_existing' &&
                                !canImportRow(row, importGoal) ? (
                                  <div>Pick a Gabada product target before importing this row.</div>
                                ) : row.targetProductStoreId == null &&
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
                            {row.original.map((value, cellIndex) => (
                                  <td
                                    key={`${rowIndex}-${cellIndex}`}
                                    className="max-w-[220px] truncate px-2 py-2 align-top"
                                    title={value}
                                  >
                                    {value || '-'}
                                  </td>
                                ))}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                </div>
              ) : null}
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

function mappedColumnBadgesForColumn(
  column: string,
  nameCol: string,
  urlCol: string,
  imageCol: string,
  priceCol: string,
  discountedCol: string,
  dealerCol: string,
  warrantyCol: string,
  stockCol: string,
): string {
  if (column === nameCol) return 'Name'
  if (column === urlCol) return 'URL'
  if (column === imageCol) return 'Image'
  if (column === priceCol) return 'Retail'
  if (column === discountedCol) return 'Sale'
  if (column === dealerCol) return 'Dealer'
  if (column === warrantyCol) return 'Warranty'
  if (column === stockCol) return 'Stock'
  return ''
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

interface GoalTileProps {
  active: boolean
  eyebrow: string
  title: string
  description: string
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

function GoalTile({
  active,
  eyebrow,
  title,
  description,
  onClick,
}: GoalTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition-colors ${
        active
          ? 'border-primary/50 bg-primary/10'
          : 'border-border/70 bg-background/60 hover:bg-accent/25'
      }`}
    >
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {eyebrow}
      </div>
      <div className="mt-1 text-sm font-medium text-foreground">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{description}</div>
    </button>
  )
}
