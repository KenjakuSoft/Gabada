import { useMemo, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2,
  Columns3,
  Download,
  FileUp,
  Loader2,
  Package,
  Rows3,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { BentoGrid, BentoTile, TileHeader } from '@/components/ui/bento'
import { StatTile } from '@/components/ui/stat-tile'
import { toast } from '@/components/ui/toast-store'
import { categoriesApi, importApi, storesApi } from '@/api'
import type {
  Category,
  FileImportPreviewResponse,
  FileImportRow,
  Store,
} from '@/api'

interface MappedPreviewRow extends FileImportRow {
  original: string[]
  valid: boolean
}

const OPTIONAL_COLUMN = ''

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
  const [stockCol, setStockCol] = useState<string>(OPTIONAL_COLUMN)
  const [storeId, setStoreId] = useState<string>('')
  const [categoryId, setCategoryId] = useState<string>('')
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())

  const stores = useQuery<Store[]>({
    queryKey: ['stores'],
    queryFn: () => storesApi.list(),
  })
  const categories = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list(),
  })

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
      setStockCol(
        pickColumn(columns, [/stock/i, /availability/i, /status/i]),
      )
      setSelectedRows(new Set(data.rows.map((_, index) => index)))
      toast.success(
        `Parsed ${data.total_rows} rows`,
        data.source_name ? `${data.file_format} - ${data.source_name}` : data.file_format,
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
      const mapped: MappedPreviewRow = {
        source_index: index,
        name: (cell(row, nameCol) ?? '').trim(),
        url: (cell(row, urlCol) ?? '').trim() || null,
        image_url: (cell(row, imageCol) ?? '').trim() || null,
        price: cell(row, priceCol),
        discounted_price: cell(row, discountedCol),
        dealer_price: cell(row, dealerCol),
        stock_status: (cell(row, stockCol) ?? '').trim() || null,
        original: row,
        valid: false,
      }
      mapped.valid = mapped.name.length > 0
      return mapped
    })
  }, [
    preview,
    nameCol,
    urlCol,
    imageCol,
    priceCol,
    discountedCol,
    dealerCol,
    stockCol,
  ])

  const validRows = useMemo(
    () => mappedRows.filter((row) => row.valid),
    [mappedRows],
  )

  const selectedMappedRows = useMemo(
    () =>
      validRows.filter(
        (row) => row.source_index != null && selectedRows.has(row.source_index),
      ),
    [selectedRows, validRows],
  )

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

  const commitMutation = useMutation({
    mutationFn: () =>
      importApi.fileCommit({
        rows: selectedMappedRows.map((row) => ({
          source_index: row.source_index ?? null,
          name: row.name,
          url: row.url,
          image_url: row.image_url,
          price: row.price,
          discounted_price: row.discounted_price,
          dealer_price: row.dealer_price,
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
    setSelectedRows(new Set())
  }

  function toggleRow(index: number) {
    const next = new Set(selectedRows)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    setSelectedRows(next)
  }

  function toggleAllValid() {
    const validIndexes = validRows
      .map((row) => row.source_index)
      .filter((index): index is number => index != null)
    const allSelected = validIndexes.every((index) => selectedRows.has(index))
    if (allSelected) {
      setSelectedRows(new Set())
      return
    }
    setSelectedRows(new Set(validIndexes))
  }

  const canCommit = selectedMappedRows.length > 0 && storeId !== ''
  const mappedColumnBadges: Record<string, string> = {
    [nameCol]: 'Name',
    ...(urlCol ? { [urlCol]: 'URL' } : {}),
    ...(imageCol ? { [imageCol]: 'Image' } : {}),
    ...(priceCol ? { [priceCol]: 'Retail' } : {}),
    ...(discountedCol ? { [discountedCol]: 'Sale' } : {}),
    ...(dealerCol ? { [dealerCol]: 'Dealer' } : {}),
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
                  : 'Full tables are parsed for live row selection.'}
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
              Build live preview
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
              ? `${validRows.length} mappable rows`
              : 'set a name column'
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
                title="Map columns and choose destination"
                icon={<Columns3 className="h-4 w-4" />}
                action={
                  <Badge variant="secondary" className="font-mono text-xs">
                    {preview.source_name
                      ? `${preview.file_format} - ${preview.source_name}`
                      : preview.file_format}
                  </Badge>
                }
              />
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <ColSelect
                  label="Name column"
                  value={nameCol}
                  onChange={setNameCol}
                  columns={preview.columns}
                />
                <ColSelect
                  label="URL column (optional)"
                  value={urlCol}
                  onChange={setUrlCol}
                  columns={preview.columns}
                  allowEmpty
                />
                <ColSelect
                  label="Image column (optional)"
                  value={imageCol}
                  onChange={setImageCol}
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
                <ColSelect
                  label="Stock column"
                  value={stockCol}
                  onChange={setStockCol}
                  columns={preview.columns}
                  allowEmpty
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
                <div className="space-y-1.5">
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

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
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
                  label="Ready"
                  value={validRows.length}
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  hint="rows with names"
                  tone={validRows.length > 0 ? 'success' : 'default'}
                />
              </div>

              <p className="mt-3 text-xs text-muted-foreground">
                Rows without a URL can still be imported as price-list entries
                for the selected store. They will be created as inactive
                non-scraping store links until you attach a real product URL
                later.
              </p>
            </BentoTile>
          </BentoGrid>

          <BentoGrid cols={6}>
            <BentoTile colSpan={6}>
              <TileHeader
                eyebrow="Step 3"
                title={`${selectedMappedRows.length} selected - ${validRows.length} ready to import`}
                action={
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={toggleAllValid}>
                      {selectedMappedRows.length === validRows.length &&
                      validRows.length > 0
                        ? 'Clear all'
                        : 'Select all ready'}
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
                      Import {selectedMappedRows.length}
                    </Button>
                  </div>
                }
              />

              <div className="mt-3 overflow-hidden rounded-md border border-border">
                <div className="max-h-[520px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-muted/90 text-muted-foreground backdrop-blur">
                      <tr>
                        <th className="w-10 px-2 py-2 text-left font-medium">
                          Pick
                        </th>
                        <th className="w-12 px-2 py-2 text-left font-medium">
                          #
                        </th>
                        <th className="min-w-[220px] px-2 py-2 text-left font-medium">
                          Name
                        </th>
                        <th className="min-w-[200px] px-2 py-2 text-left font-medium">
                          URL
                        </th>
                        <th className="w-28 px-2 py-2 text-left font-medium">
                          Retail
                        </th>
                        <th className="w-28 px-2 py-2 text-left font-medium">
                          Sale
                        </th>
                        <th className="w-28 px-2 py-2 text-left font-medium">
                          Dealer
                        </th>
                        <th className="w-28 px-2 py-2 text-left font-medium">
                          Stock
                        </th>
                        {preview.columns.map((column) => (
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
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {mappedRows.map((row) => {
                        const rowIndex = row.source_index ?? -1
                        const checked =
                          row.source_index != null && selectedRows.has(row.source_index)
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
                              <div className="min-w-0">
                                <div className="truncate font-medium">
                                  {row.name || 'Missing name'}
                                </div>
                                {!row.valid ? (
                                  <span className="text-[11px] text-destructive">
                                    This row will be skipped unless you map a
                                    name column.
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-2 py-2 align-top text-muted-foreground">
                              <div className="max-w-[200px] truncate">
                                {row.url || 'Will create inactive import entry'}
                              </div>
                            </td>
                            <td className="px-2 py-2 align-top">
                              {formatMappedValue(row.price)}
                            </td>
                            <td className="px-2 py-2 align-top">
                              {formatMappedValue(row.discounted_price)}
                            </td>
                            <td className="px-2 py-2 align-top">
                              {formatMappedValue(row.dealer_price)}
                            </td>
                            <td className="px-2 py-2 align-top">
                              {formatMappedValue(row.stock_status)}
                            </td>
                            {row.original.map((value, cellIndex) => (
                              <td
                                key={`${rowIndex}-${cellIndex}`}
                                className="max-w-[220px] truncate px-2 py-2 align-top"
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
