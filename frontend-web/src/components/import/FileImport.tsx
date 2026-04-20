import { useMemo, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2,
  Columns3,
  Download,
  FileUp,
  Loader2,
  Rows3,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { BentoGrid, BentoTile, TileHeader } from '@/components/ui/bento'
import { StatTile } from '@/components/ui/stat-tile'
import { toast } from '@/components/ui/toaster'
import { categoriesApi, importApi, storesApi } from '@/api'
import type {
  Category,
  FileImportPreviewResponse,
  FileImportRow,
  Store,
} from '@/api'

export function FileImport() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<FileImportPreviewResponse | null>(null)
  const [nameCol, setNameCol] = useState<string>('')
  const [urlCol, setUrlCol] = useState<string>('')
  const [imageCol, setImageCol] = useState<string>('')
  const [storeId, setStoreId] = useState<string>('')
  const [categoryId, setCategoryId] = useState<string>('')

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
      const cols = data.columns
      setNameCol(
        cols.find((c) => /name|title|product/i.test(c)) ?? cols[0] ?? '',
      )
      setUrlCol(cols.find((c) => /url|link|permalink/i.test(c)) ?? '')
      setImageCol(cols.find((c) => /image|img|photo/i.test(c)) ?? '')
      toast.success(`Parsed ${data.total_rows} rows`, data.file_format)
    },
    onError: () => toast.error('Could not read that file'),
  })

  const rows = useMemo<FileImportRow[]>(() => {
    if (!preview || !nameCol || !urlCol) return []
    const cols = preview.columns
    const ni = cols.indexOf(nameCol)
    const ui = cols.indexOf(urlCol)
    const ii = imageCol ? cols.indexOf(imageCol) : -1
    return preview.sample_rows
      .map((r) => ({
        name: r[ni] ?? '',
        url: r[ui] ?? '',
        image_url: ii >= 0 ? r[ii] || null : null,
      }))
      .filter((r) => r.name && r.url)
  }, [preview, nameCol, urlCol, imageCol])

  const commitMutation = useMutation({
    mutationFn: () =>
      importApi.fileCommit({
        rows,
        store_id: Number(storeId),
        category_id: categoryId ? Number(categoryId) : null,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['products'] })
      toast.success(`Imported ${data.imported} products`)
      navigate('/')
    },
    onError: () => toast.error('Import failed'),
  })

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    setPreview(null)
  }

  const canCommit = rows.length > 0 && storeId !== ''

  return (
    <div className="space-y-6">
      <BentoGrid cols={6}>
        <BentoTile colSpan={4} tone="primary">
          <TileHeader
            eyebrow="Step 1"
            title="Upload file"
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
                  : 'Tables extracted from PDFs too.'}
              </div>
            </div>
            <input
              type="file"
              accept=".csv,.xlsx,.xls,.pdf"
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
              Preview
            </Button>
          </div>
        </BentoTile>

        <StatTile
          label="Total rows"
          value={preview?.total_rows ?? 0}
          icon={<Rows3 className="h-4 w-4" />}
          hint={preview?.file_format ?? 'awaiting file'}
          tone={preview ? 'primary' : 'default'}
        />
        <StatTile
          label="Mapped"
          value={rows.length}
          icon={<CheckCircle2 className="h-4 w-4" />}
          hint={nameCol && urlCol ? 'ready to commit' : 'set name + URL'}
          tone={rows.length > 0 ? 'success' : 'default'}
        />
      </BentoGrid>

      {preview ? (
        <BentoGrid cols={6}>
          <BentoTile colSpan={6}>
            <TileHeader
              eyebrow="Step 2"
              title="Map columns"
              icon={<Columns3 className="h-4 w-4" />}
              action={
                <Badge variant="secondary" className="font-mono text-xs">
                  {preview.file_format}
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
                label="URL column"
                value={urlCol}
                onChange={setUrlCol}
                columns={preview.columns}
              />
              <ColSelect
                label="Image column (optional)"
                value={imageCol}
                onChange={setImageCol}
                columns={preview.columns}
                allowEmpty
              />
              <div className="space-y-1.5">
                <Label htmlFor="file-store">Store</Label>
                <Select
                  id="file-store"
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                >
                  <option value="">— select —</option>
                  {(stores.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="file-category">Category (optional)</Label>
                <Select
                  id="file-category"
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
              <div className="flex items-end">
                <Button
                  className="w-full"
                  onClick={() => commitMutation.mutate()}
                  disabled={!canCommit || commitMutation.isPending}
                >
                  {commitMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Import {rows.length}
                </Button>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-md border border-border">
              <div className="max-h-[320px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/80 text-muted-foreground backdrop-blur">
                    <tr>
                      {preview.columns.map((c) => (
                        <th
                          key={c}
                          className="px-2 py-1.5 text-left font-medium"
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample_rows.map((row, i) => (
                      <tr
                        key={i}
                        className="border-t border-border transition-colors hover:bg-accent/20"
                      >
                        {row.map((v, j) => (
                          <td key={j} className="truncate px-2 py-1.5">
                            {v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Showing first {preview.sample_rows.length} rows. Backend commits
              the previewed rows only.
            </p>
          </BentoTile>
        </BentoGrid>
      ) : null}
    </div>
  )
}

interface ColSelectProps {
  label: string
  value: string
  onChange: (v: string) => void
  columns: string[]
  allowEmpty?: boolean
}

function ColSelect({ label, value, onChange, columns, allowEmpty }: ColSelectProps) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {allowEmpty ? <option value="">— none —</option> : null}
        {columns.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
    </div>
  )
}
