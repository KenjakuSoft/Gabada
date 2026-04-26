import {
  useDeferredValue,
  useMemo,
  useState,
  type ChangeEvent,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  Download,
  FileJson,
  FileUp,
  Link2,
  Loader2,
  Package,
  Search,
  Share2,
  Store as StoreIcon,
  Upload,
} from 'lucide-react'
import { productsApi, storesApi, importApi } from '@/api'
import type { FileImportRow, Product, ProductStoreSummary, Store } from '@/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { BentoGrid, BentoTile, TileHeader } from '@/components/ui/bento'
import { StatTile } from '@/components/ui/stat-tile'
import { toast } from '@/components/ui/toast-store'
import { useCurrencySymbol } from '@/hooks/useSettings'
import { cn, formatMoney } from '@/lib/utils'

interface GabadaShareStore {
  name: string
  base_url: string
  manual_only: boolean
}

interface GabadaShareRow {
  product_name: string
  image_url: string | null
  category_name: string | null
  product_url: string | null
  retail_price: number | null
  discounted_price: number | null
  dealer_price: number | null
  warranty: string | null
  stock_status: string | null
}

interface GabadaShareFile {
  format: 'gabada-share'
  version: 1
  exported_at: string
  source: {
    app: 'Gabada'
    store: GabadaShareStore
    row_count: number
  }
  rows: GabadaShareRow[]
}

interface ExportableStoreRow {
  key: number
  product_id: number
  product_name: string
  image_url: string | null
  category_name: string | null
  store_link: ProductStoreSummary
  retail_price: number | null
  discounted_price: number | null
  dealer_price: number | null
  warranty: string | null
  stock_status: string | null
  product_url: string | null
}

interface ShareImportPreviewRow {
  index: number
  row: GabadaShareRow
  targetProduct: Product | null
  targetScore: number | null
}

interface SharePriceOverrideDraft {
  retail_price: string
  dealer_price: string
}

interface ResolvedShareRowValues {
  retail_price: number | null
  discounted_price: number | null
  dealer_price: number | null
  has_retail_override: boolean
  has_dealer_override: boolean
}

const CREATE_STORE_OPTION = '__create__'
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

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeStoreBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase()
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
  if (/^\d{1,2}$/.test(flat)) return true
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
): { product: Product | null; score: number | null } {
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

function exportableStoreRows(
  products: Product[],
  storeId: number | null,
): ExportableStoreRow[] {
  if (storeId == null) return []
  const rows: ExportableStoreRow[] = []
  for (const product of products) {
    const link = product.stores.find((store) => store.store_id === storeId)
    if (!link) continue
    rows.push({
      key: link.id,
      product_id: product.id,
      product_name: product.canonical_name,
      image_url: product.image_url,
      category_name: product.category_name,
      store_link: link,
      retail_price: link.manual_price ?? link.latest_price ?? link.latest_discounted_price,
      discounted_price: link.manual_price == null ? link.latest_discounted_price : null,
      dealer_price: link.latest_dealer_price,
      warranty: link.manual_warranty ?? link.latest_warranty,
      stock_status: link.manual_stock_status ?? link.latest_stock_status,
      product_url: link.product_url.startsWith('http') ? link.product_url : null,
    })
  }
  return rows.sort((a, b) => a.product_name.localeCompare(b.product_name))
}

function shareFilename(storeName: string): string {
  const slug = storeName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const stamp = new Date().toISOString().slice(0, 10)
  return `${slug || 'gabada-store'}-${stamp}.gabada-share.json`
}

function downloadShareFile(payload: GabadaShareFile, filename: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  })
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(objectUrl)
}

function parseOptionalPriceValue(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const normalized = trimmed
    .replace(/,/g, '')
    .replace(/(?:rs\.?|lkr|රු)/gi, '')
    .replace(/\s+/g, '')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function resolveShareRowValues(
  row: ExportableStoreRow,
  override?: SharePriceOverrideDraft,
): ResolvedShareRowValues {
  const retailOverride = override?.retail_price.trim() ?? ''
  const dealerOverride = override?.dealer_price.trim() ?? ''
  const hasRetailOverride = retailOverride.length > 0
  const hasDealerOverride = dealerOverride.length > 0

  return {
    retail_price: hasRetailOverride ? parseOptionalPriceValue(retailOverride) : row.retail_price,
    discounted_price: hasRetailOverride ? null : row.discounted_price,
    dealer_price: hasDealerOverride ? parseOptionalPriceValue(dealerOverride) : row.dealer_price,
    has_retail_override: hasRetailOverride,
    has_dealer_override: hasDealerOverride,
  }
}

function buildSharePayload(
  store: Store,
  rows: ExportableStoreRow[],
  overrides: Record<number, SharePriceOverrideDraft>,
): GabadaShareFile {
  return {
    format: 'gabada-share',
    version: 1,
    exported_at: new Date().toISOString(),
    source: {
      app: 'Gabada',
      store: {
        name: store.name,
        base_url: store.base_url,
        manual_only: store.manual_only,
      },
      row_count: rows.length,
    },
    rows: rows.map((row) => {
      const resolved = resolveShareRowValues(row, overrides[row.key])
      return {
        product_name: row.product_name,
        image_url: row.image_url,
        category_name: row.category_name,
        product_url: row.product_url,
        retail_price: resolved.retail_price,
        discounted_price: resolved.discounted_price,
        dealer_price: resolved.dealer_price,
        warranty: row.warranty,
        stock_status: row.stock_status,
      }
    }),
  }
}

function parseShareFile(raw: string): GabadaShareFile {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch (error) {
    throw new Error(
      error instanceof Error ? `Could not read JSON: ${error.message}` : 'Could not read JSON',
    )
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Gabada share file is empty or invalid')
  }

  const payload = data as Partial<GabadaShareFile>
  if (payload.format !== 'gabada-share') {
    throw new Error('This is not a Gabada share file')
  }
  if (payload.version !== 1) {
    throw new Error('This Gabada share file version is not supported yet')
  }
  if (!payload.source?.store?.name || !Array.isArray(payload.rows)) {
    throw new Error('Gabada share file is missing required store or row data')
  }

  return {
    format: 'gabada-share',
    version: 1,
    exported_at: payload.exported_at || new Date().toISOString(),
    source: {
      app: 'Gabada',
      row_count: Number(payload.source.row_count ?? payload.rows.length ?? 0),
      store: {
        name: String(payload.source.store.name),
        base_url: String(payload.source.store.base_url ?? ''),
        manual_only: Boolean(payload.source.store.manual_only),
      },
    },
    rows: payload.rows.map((row) => ({
      product_name: String(row.product_name ?? '').trim(),
      image_url: row.image_url ?? null,
      category_name: row.category_name ?? null,
      product_url: row.product_url ?? null,
      retail_price:
        typeof row.retail_price === 'number' ? row.retail_price : null,
      discounted_price:
        typeof row.discounted_price === 'number' ? row.discounted_price : null,
      dealer_price:
        typeof row.dealer_price === 'number' ? row.dealer_price : null,
      warranty: row.warranty ?? null,
      stock_status: row.stock_status ?? null,
    })),
  }
}

function storeTargetOptionLabel(store: Store): string {
  return store.manual_only || !store.base_url
    ? `${store.name} (manual)`
    : `${store.name} (${store.base_url})`
}

function findMatchingStore(stores: Store[], sourceStore: GabadaShareStore): Store | null {
  const baseUrl = normalizeStoreBaseUrl(sourceStore.base_url)
  if (baseUrl) {
    const byUrl = stores.find(
      (store) => normalizeStoreBaseUrl(store.base_url) === baseUrl,
    )
    if (byUrl) return byUrl
  }
  const byName = stores.find(
    (store) => normalizeSearchText(store.name) === normalizeSearchText(sourceStore.name),
  )
  return byName ?? null
}

function matchesShareSearch(row: ExportableStoreRow | ShareImportPreviewRow, query: string): boolean {
  if (!query) return true
  const terms = query.split(/\s+/).filter(Boolean)
  const target =
    'row' in row
      ? [
          row.row.product_name,
          row.row.category_name ?? '',
          row.row.stock_status ?? '',
          row.targetProduct?.canonical_name ?? '',
        ]
      : [
          row.product_name,
          row.category_name ?? '',
          row.stock_status ?? '',
          row.store_link.store_name,
        ]
  const haystack = normalizeSearchText(target.join(' '))
  return terms.every((term) => haystack.includes(term))
}

function statusMeta(
  previewRow: ShareImportPreviewRow,
  targetStoreId: number | null,
): { label: string; variant: 'success' | 'secondary' | 'info' } {
  if (
    targetStoreId != null &&
    previewRow.targetProduct?.stores.some((store) => store.store_id === targetStoreId)
  ) {
    return { label: 'Updates linked row', variant: 'success' }
  }
  if (previewRow.targetProduct) {
    return { label: 'Links to existing product', variant: 'secondary' }
  }
  return { label: 'Creates new product', variant: 'info' }
}

export function GabadaShare() {
  const qc = useQueryClient()
  const symbol = useCurrencySymbol()
  const [exportStoreId, setExportStoreId] = useState('')
  const [exportSearch, setExportSearch] = useState('')
  const [selectedExportRows, setSelectedExportRows] = useState<Set<number>>(new Set())
  const [touchedExportSelection, setTouchedExportSelection] = useState(false)
  const [exportOverrides, setExportOverrides] = useState<
    Record<number, SharePriceOverrideDraft>
  >({})
  const [shareFileName, setShareFileName] = useState('')
  const [importFileName, setImportFileName] = useState('')
  const [importPreview, setImportPreview] = useState<GabadaShareFile | null>(null)
  const [importSearch, setImportSearch] = useState('')
  const [selectedImportRows, setSelectedImportRows] = useState<Set<number>>(new Set())
  const [touchedImportSelection, setTouchedImportSelection] = useState(false)
  const [targetStoreChoice, setTargetStoreChoice] = useState(CREATE_STORE_OPTION)
  const [newStoreName, setNewStoreName] = useState('')
  const [newStoreBaseUrl, setNewStoreBaseUrl] = useState('')
  const [newStoreManualOnly, setNewStoreManualOnly] = useState(false)
  const deferredExportSearch = useDeferredValue(exportSearch.trim().toLowerCase())
  const deferredImportSearch = useDeferredValue(importSearch.trim().toLowerCase())

  const stores = useQuery<Store[]>({
    queryKey: ['stores'],
    queryFn: () => storesApi.list(),
  })
  const products = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: () => productsApi.list(),
  })

  const selectedExportStoreId = exportStoreId ? Number(exportStoreId) : null
  const selectedExportStore =
    (stores.data ?? []).find((store) => store.id === selectedExportStoreId) ?? null

  const exportRows = useMemo(
    () => exportableStoreRows(products.data ?? [], selectedExportStoreId),
    [products.data, selectedExportStoreId],
  )

  const filteredExportRows = useMemo(
    () => exportRows.filter((row) => matchesShareSearch(row, deferredExportSearch)),
    [exportRows, deferredExportSearch],
  )

  const matchedStore = useMemo(
    () =>
      importPreview == null
        ? null
        : findMatchingStore(stores.data ?? [], importPreview.source.store),
    [importPreview, stores.data],
  )

  const targetStoreId =
    targetStoreChoice === CREATE_STORE_OPTION ? null : Number(targetStoreChoice)

  const importRows = useMemo<ShareImportPreviewRow[]>(() => {
    if (!importPreview) return []
    return importPreview.rows.map((row, index) => {
      const suggestion = findSuggestedTarget(
        row.product_name,
        products.data ?? [],
        targetStoreId,
      )
      return {
        index,
        row,
        targetProduct: suggestion.product,
        targetScore: suggestion.score,
      }
    })
  }, [importPreview, products.data, targetStoreId])

  const filteredImportRows = useMemo(
    () => importRows.filter((row) => matchesShareSearch(row, deferredImportSearch)),
    [importRows, deferredImportSearch],
  )

  const parseShareMutation = useMutation({
    mutationFn: async (file: File) => parseShareFile(await file.text()),
    onSuccess: (data, file) => {
      const matched = findMatchingStore(stores.data ?? [], data.source.store)
      setImportFileName(file.name)
      setImportPreview(data)
      setSelectedImportRows(new Set())
      setTouchedImportSelection(false)
      setTargetStoreChoice(matched ? String(matched.id) : CREATE_STORE_OPTION)
      setNewStoreName(data.source.store.name)
      setNewStoreBaseUrl(data.source.store.base_url)
      setNewStoreManualOnly(
        data.source.store.manual_only || !data.source.store.base_url,
      )
      toast.success(
        'Share file loaded',
        `${data.source.row_count} rows from ${data.source.store.name}`,
      )
    },
    onError: (error) => {
      const detail = error instanceof Error ? error.message : 'Could not read share file'
      toast.error('Share file failed', detail)
    },
  })

  const importShareMutation = useMutation({
    mutationFn: async () => {
      if (!importPreview) {
        throw new Error('Load a Gabada share file first')
      }

      let resolvedStoreId = targetStoreId
      if (resolvedStoreId == null) {
        const createBaseUrl = newStoreManualOnly ? '' : newStoreBaseUrl.trim()
        const createdStore = await storesApi.create({
          name: newStoreName.trim(),
          base_url: createBaseUrl,
          manual_only: newStoreManualOnly || !createBaseUrl,
          dealer_login_url: null,
        })
        resolvedStoreId = createdStore.id
      }

      const rows: FileImportRow[] = importRows
        .filter((row) => effectiveSelectedImportRows.has(row.index))
        .map((row) => {
          const linkedRow =
            resolvedStoreId == null
              ? null
              : row.targetProduct?.stores.find((store) => store.store_id === resolvedStoreId) ??
                null
          return {
            name: row.row.product_name,
            product_id: linkedRow ? undefined : row.targetProduct?.id,
            product_store_id: linkedRow?.id,
            url: row.row.product_url,
            image_url: row.row.image_url,
            price: row.row.retail_price,
            discounted_price: row.row.discounted_price,
            dealer_price: row.row.dealer_price,
            warranty: row.row.warranty,
            stock_status: row.row.stock_status,
          }
        })

      return importApi.fileCommit({
        rows,
        store_id: resolvedStoreId,
        create_missing_products: true,
      })
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['stores'] })
      qc.invalidateQueries({ queryKey: ['activity'] })
      toast.success(
        'Share imported',
        `Imported ${result.imported} rows, created ${result.created}, updated ${result.updated}.`,
      )
      setImportPreview(null)
      setImportFileName('')
      setImportSearch('')
      setSelectedImportRows(new Set())
      setTouchedImportSelection(false)
    },
    onError: (error) => {
      const detail =
        error instanceof Error ? error.message : 'Could not import Gabada share file'
      toast.error('Import failed', detail)
    },
  })

  const effectiveSelectedExportRows = touchedExportSelection
    ? selectedExportRows
    : new Set(exportRows.map((row) => row.key))
  const effectiveSelectedImportRows = touchedImportSelection
    ? selectedImportRows
    : new Set(importRows.map((row) => row.index))

  const exportSelectedRows = exportRows.filter((row) =>
    effectiveSelectedExportRows.has(row.key),
  )
  const exportVisibleSelected = filteredExportRows.filter((row) =>
    effectiveSelectedExportRows.has(row.key),
  )
  const importSelectedCount = effectiveSelectedImportRows.size
  const canExport =
    selectedExportStore != null &&
    exportSelectedRows.length > 0 &&
    !stores.isLoading &&
    !products.isLoading
  const canImport =
    importPreview != null &&
    importSelectedCount > 0 &&
    !parseShareMutation.isPending &&
    !importShareMutation.isPending &&
    (targetStoreId != null || newStoreName.trim().length > 0)

  function toggleExportRow(key: number) {
    setTouchedExportSelection(true)
    setSelectedExportRows((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleImportRow(index: number) {
    setTouchedImportSelection(true)
    setSelectedImportRows((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  function selectVisibleExportRows() {
    setTouchedExportSelection(true)
    setSelectedExportRows(
      new Set(filteredExportRows.map((row) => row.key)),
    )
  }

  function clearExportRows() {
    setTouchedExportSelection(true)
    setSelectedExportRows(new Set())
  }

  function selectVisibleImportRows() {
    setTouchedImportSelection(true)
    setSelectedImportRows(
      new Set(filteredImportRows.map((row) => row.index)),
    )
  }

  function clearImportRows() {
    setTouchedImportSelection(true)
    setSelectedImportRows(new Set())
  }

  function handleExportStoreChange(value: string) {
    setExportStoreId(value)
    setTouchedExportSelection(false)
    setSelectedExportRows(new Set())
    setExportOverrides({})
    const store =
      (stores.data ?? []).find((entry) => String(entry.id) === value) ?? null
    setShareFileName(store ? shareFilename(store.name) : '')
  }

  function setExportOverrideValue(
    rowKey: number,
    field: keyof SharePriceOverrideDraft,
    value: string,
  ) {
    setExportOverrides((current) => {
      const next = { ...current }
      const existing = next[rowKey] ?? { retail_price: '', dealer_price: '' }
      const updated = { ...existing, [field]: value }
      if (!updated.retail_price.trim() && !updated.dealer_price.trim()) {
        delete next[rowKey]
        return next
      }
      next[rowKey] = updated
      return next
    })
  }

  function handleShareFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''
    if (!file) return
    parseShareMutation.mutate(file)
  }

  function exportShare() {
    if (!selectedExportStore) return
    const invalidRow = exportSelectedRows.find((row) => {
      const override = exportOverrides[row.key]
      const hasRetailOverride = Boolean(override?.retail_price.trim())
      const hasDealerOverride = Boolean(override?.dealer_price.trim())
      return (
        (hasRetailOverride && parseOptionalPriceValue(override?.retail_price ?? '') == null) ||
        (hasDealerOverride && parseOptionalPriceValue(override?.dealer_price ?? '') == null)
      )
    })
    if (invalidRow) {
      toast.error(
        'Shared prices need numbers',
        `Check the manual retail or dealer price on ${invalidRow.product_name}.`,
      )
      return
    }

    const payload = buildSharePayload(
      selectedExportStore,
      exportSelectedRows,
      exportOverrides,
    )
    downloadShareFile(payload, shareFileName || shareFilename(selectedExportStore.name))
    toast.success(
      'Share file downloaded',
      `${payload.rows.length} rows from ${selectedExportStore.name}`,
    )
  }

  return (
    <div className="space-y-6">
      <BentoGrid cols={6}>
        <BentoTile colSpan={3} tone="primary">
          <TileHeader
            eyebrow="Share out"
            title="Export selected products"
            icon={<Share2 className="h-4 w-4" />}
          />
          <div className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="share-store">Store</Label>
              <Select
                id="share-store"
                value={exportStoreId}
                onChange={(event) => handleExportStoreChange(event.target.value)}
              >
                <option value="">- select store -</option>
                {(stores.data ?? []).map((store) => (
                  <option key={store.id} value={store.id}>
                    {storeTargetOptionLabel(store)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="share-search">Search what to share</Label>
              <Input
                id="share-search"
                value={exportSearch}
                onChange={(event) => setExportSearch(event.target.value)}
                placeholder="Search product or category"
                disabled={!selectedExportStore}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="share-file">File name</Label>
              <Input
                id="share-file"
                value={shareFileName}
                onChange={(event) => setShareFileName(event.target.value)}
                placeholder="gabada-share.json"
                disabled={!selectedExportStore}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={selectVisibleExportRows}
                disabled={!filteredExportRows.length}
              >
                Select visible
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={clearExportRows}
                disabled={!effectiveSelectedExportRows.size}
              >
                Clear all
              </Button>
              <Button
                size="sm"
                onClick={exportShare}
                disabled={!canExport}
              >
                <Download className="h-4 w-4" />
                Download share file
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Share files only include this store and the rows you select here. Other stores linked to the same products are not exported.
            </p>
            <p className="text-xs text-muted-foreground">
              Shared retail and dealer prices are optional. Leave them blank to keep the current values, or type your own values just for this file.
            </p>
          </div>
        </BentoTile>

        <BentoTile colSpan={3} tone="accent">
          <TileHeader
            eyebrow="Share in"
            title="Import a Gabada share file"
            icon={<FileJson className="h-4 w-4" />}
          />
          <div className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="share-import-file">Share file</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="share-import-file"
                  type="file"
                  accept=".json,.gabada-share.json"
                  onChange={handleShareFile}
                  disabled={parseShareMutation.isPending}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Import a share file from another Gabada user. If a product already exists here, Gabada will link and update it. If not, it will create it.
              </p>
            </div>

            {importPreview ? (
              <>
                <div className="rounded-xl border border-border/70 bg-background/40 p-3 text-sm">
                  <div className="font-medium text-foreground">
                    {importPreview.source.store.name}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {importPreview.source.row_count} rows
                    {importFileName ? ` • ${importFileName}` : ''}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="share-target-store">Import into store</Label>
                  <Select
                    id="share-target-store"
                    value={targetStoreChoice}
                    onChange={(event) => setTargetStoreChoice(event.target.value)}
                  >
                    <option value={CREATE_STORE_OPTION}>Create store from file</option>
                    {(stores.data ?? []).map((store) => (
                      <option key={store.id} value={store.id}>
                        {storeTargetOptionLabel(store)}
                      </option>
                    ))}
                  </Select>
                  {matchedStore && targetStoreChoice !== CREATE_STORE_OPTION ? (
                    <p className="text-xs text-muted-foreground">
                      Auto-matched to {matchedStore.name}.
                    </p>
                  ) : null}
                </div>

                {targetStoreChoice === CREATE_STORE_OPTION ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="share-new-store-name">New store name</Label>
                      <Input
                        id="share-new-store-name"
                        value={newStoreName}
                        onChange={(event) => setNewStoreName(event.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="share-new-store-url">Base URL</Label>
                      <Input
                        id="share-new-store-url"
                        value={newStoreBaseUrl}
                        onChange={(event) => setNewStoreBaseUrl(event.target.value)}
                        placeholder="https://supplier.example.com"
                        disabled={newStoreManualOnly}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={newStoreManualOnly}
                        onChange={(event) => setNewStoreManualOnly(event.target.checked)}
                        className="h-4 w-4 accent-primary"
                      />
                      Manual-only store
                    </label>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectVisibleImportRows}
                    disabled={!filteredImportRows.length}
                  >
                    Select visible
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearImportRows}
                    disabled={!effectiveSelectedImportRows.size}
                  >
                    Clear all
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => importShareMutation.mutate()}
                    disabled={!canImport}
                  >
                    {importShareMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    Import selected
                  </Button>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-background/35 p-8 text-center text-sm text-muted-foreground">
                Upload a Gabada share file to preview it here.
              </div>
            )}
          </div>
        </BentoTile>

        <StatTile
          label="Share rows"
          value={exportRows.length}
          icon={<Package className="h-4 w-4" />}
          hint={selectedExportStore ? selectedExportStore.name : 'choose a store'}
          loading={products.isLoading}
          tone="primary"
        />
        <StatTile
          label="Selected to share"
          value={effectiveSelectedExportRows.size}
          icon={<CheckCircle2 className="h-4 w-4" />}
          hint={
            filteredExportRows.length
              ? `${exportVisibleSelected.length} selected in view`
              : 'nothing visible'
          }
          loading={products.isLoading}
          tone="success"
        />
        <StatTile
          label="Share import"
          value={importPreview?.rows.length ?? 0}
          icon={<FileUp className="h-4 w-4" />}
          hint={importPreview ? importPreview.source.store.name : 'no file yet'}
          tone="accent"
        />
        <StatTile
          label="Import selected"
          value={effectiveSelectedImportRows.size}
          icon={<Link2 className="h-4 w-4" />}
          hint="rows ready to merge"
          tone="success"
        />
      </BentoGrid>

      {selectedExportStore ? (
        <BentoGrid cols={6}>
          <BentoTile colSpan={6}>
            <TileHeader
              eyebrow="Export preview"
              title={`${filteredExportRows.length} visible products from ${selectedExportStore.name}`}
              icon={<StoreIcon className="h-4 w-4" />}
              action={
                <div className="relative w-full max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={exportSearch}
                    onChange={(event) => setExportSearch(event.target.value)}
                    placeholder="Search export rows"
                    className="pl-9"
                  />
                </div>
              }
            />
            {filteredExportRows.length === 0 ? (
              <div className="mt-3 rounded-md border border-dashed border-border bg-card/35 p-8 text-center text-sm text-muted-foreground">
                No products matched this export search.
              </div>
            ) : (
              <div className="mt-3 space-y-1.5">
                {filteredExportRows.map((row) => {
                  const resolved = resolveShareRowValues(row, exportOverrides[row.key])
                  const currentOverride = exportOverrides[row.key]
                  return (
                    <div
                      key={row.key}
                      className={cn(
                        'rounded-md border border-border bg-background/35 px-3 py-3 transition-colors hover:bg-accent/20',
                        effectiveSelectedExportRows.has(row.key) &&
                          'border-primary/35 bg-primary/5',
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={effectiveSelectedExportRows.has(row.key)}
                          onChange={() => toggleExportRow(row.key)}
                          className="mt-1 h-4 w-4 accent-primary"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{row.product_name}</div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {row.category_name ? (
                              <Badge variant="outline" className="text-[10px]">
                                {row.category_name}
                              </Badge>
                            ) : null}
                            {row.stock_status ? (
                              <Badge variant="outline" className="text-[10px]">
                                {row.stock_status}
                              </Badge>
                            ) : null}
                            {row.warranty ? (
                              <Badge variant="outline" className="text-[10px]">
                                {row.warranty}
                              </Badge>
                            ) : null}
                            <Badge variant="outline" className="text-[10px]">
                              Sharing only {row.store_link.store_name}
                            </Badge>
                          </div>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label
                                htmlFor={`share-retail-${row.key}`}
                                className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
                              >
                                Shared retail price
                              </Label>
                              <Input
                                id={`share-retail-${row.key}`}
                                value={currentOverride?.retail_price ?? ''}
                                onChange={(event) =>
                                  setExportOverrideValue(
                                    row.key,
                                    'retail_price',
                                    event.target.value,
                                  )
                                }
                                placeholder={
                                  row.retail_price != null
                                    ? formatMoney(row.retail_price, symbol)
                                    : 'optional'
                                }
                                inputMode="decimal"
                                className="h-8 text-xs"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label
                                htmlFor={`share-dealer-${row.key}`}
                                className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
                              >
                                Shared dealer price
                              </Label>
                              <Input
                                id={`share-dealer-${row.key}`}
                                value={currentOverride?.dealer_price ?? ''}
                                onChange={(event) =>
                                  setExportOverrideValue(
                                    row.key,
                                    'dealer_price',
                                    event.target.value,
                                  )
                                }
                                placeholder={
                                  row.dealer_price != null
                                    ? formatMoney(row.dealer_price, symbol)
                                    : 'optional'
                                }
                                inputMode="decimal"
                                className="h-8 text-xs"
                              />
                            </div>
                          </div>
                        </div>
                        <div className="flex max-w-xs flex-wrap items-center justify-end gap-2 text-xs">
                          {resolved.retail_price != null ? (
                            <Badge variant="outline" className="text-[10px]">
                              Retail {formatMoney(resolved.retail_price, symbol)}
                            </Badge>
                          ) : null}
                          {resolved.discounted_price != null ? (
                            <Badge variant="secondary" className="text-[10px]">
                              Sale {formatMoney(resolved.discounted_price, symbol)}
                            </Badge>
                          ) : null}
                          {resolved.dealer_price != null ? (
                            <Badge variant="success" className="text-[10px]">
                              Dealer {formatMoney(resolved.dealer_price, symbol)}
                            </Badge>
                          ) : null}
                          {resolved.has_retail_override || resolved.has_dealer_override ? (
                            <Badge variant="info" className="text-[10px]">
                              Manual share values
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </BentoTile>
        </BentoGrid>
      ) : null}

      {importPreview ? (
        <BentoGrid cols={6}>
          <BentoTile colSpan={6}>
            <TileHeader
              eyebrow="Import preview"
              title={`${filteredImportRows.length} visible rows from ${importPreview.source.store.name}`}
              icon={<FileJson className="h-4 w-4" />}
              action={
                <div className="relative w-full max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={importSearch}
                    onChange={(event) => setImportSearch(event.target.value)}
                    placeholder="Search import rows"
                    className="pl-9"
                  />
                </div>
              }
            />
            {filteredImportRows.length === 0 ? (
              <div className="mt-3 rounded-md border border-dashed border-border bg-card/35 p-8 text-center text-sm text-muted-foreground">
                No rows matched this import search.
              </div>
            ) : (
              <div className="mt-3 space-y-1.5">
                {filteredImportRows.map((previewRow) => {
                  const meta = statusMeta(previewRow, targetStoreId)
                  return (
                    <label
                      key={previewRow.index}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-md border border-border bg-background/35 px-3 py-3 transition-colors hover:bg-accent/20',
                        effectiveSelectedImportRows.has(previewRow.index) &&
                          'border-primary/35 bg-primary/5',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={effectiveSelectedImportRows.has(previewRow.index)}
                        onChange={() => toggleImportRow(previewRow.index)}
                        className="h-4 w-4 accent-primary"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {previewRow.row.product_name}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge variant={meta.variant} className="text-[10px]">
                            {meta.label}
                          </Badge>
                          {previewRow.targetProduct ? (
                            <Badge variant="outline" className="text-[10px]">
                              {previewRow.targetProduct.canonical_name}
                              {previewRow.targetScore != null
                                ? ` • ${Math.round(previewRow.targetScore * 100)}%`
                                : ''}
                            </Badge>
                          ) : null}
                          {previewRow.row.stock_status ? (
                            <Badge variant="outline" className="text-[10px]">
                              {previewRow.row.stock_status}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
                        {previewRow.row.retail_price != null ? (
                          <Badge variant="outline" className="text-[10px]">
                            Retail {formatMoney(previewRow.row.retail_price, symbol)}
                          </Badge>
                        ) : null}
                        {previewRow.row.discounted_price != null ? (
                          <Badge variant="secondary" className="text-[10px]">
                            Sale {formatMoney(previewRow.row.discounted_price, symbol)}
                          </Badge>
                        ) : null}
                        {previewRow.row.dealer_price != null ? (
                          <Badge variant="success" className="text-[10px]">
                            Dealer {formatMoney(previewRow.row.dealer_price, symbol)}
                          </Badge>
                        ) : null}
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
          </BentoTile>
        </BentoGrid>
      ) : null}
    </div>
  )
}
