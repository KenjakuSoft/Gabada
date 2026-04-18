import { useMemo, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Download, Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  categoriesApi,
  importApi,
  storesApi,
} from '@/api'
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
    },
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
      navigate('/')
    },
  })

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    setPreview(null)
  }

  const canCommit = rows.length > 0 && storeId !== ''

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload file</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-border p-6 hover:bg-accent/30">
            <Upload className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <div className="text-sm font-medium">
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
          <div className="flex justify-end">
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
          {previewMutation.isError ? (
            <p className="text-sm text-destructive">
              Could not read that file.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Map columns
              <Badge variant="secondary" className="font-mono text-xs">
                {preview.file_format}
              </Badge>
              <span className="text-xs font-normal text-muted-foreground">
                {preview.total_rows} rows
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
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
            </div>

            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
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
                    <tr key={i} className="border-t border-border">
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
            <p className="text-xs text-muted-foreground">
              Showing first {preview.sample_rows.length} rows. Backend currently
              commits the previewed rows only.
            </p>

            <div className="flex justify-end">
              <Button
                onClick={() => commitMutation.mutate()}
                disabled={!canCommit || commitMutation.isPending}
              >
                {commitMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Import {rows.length} products
              </Button>
            </div>
            {commitMutation.isError ? (
              <p className="text-right text-sm text-destructive">
                Import failed.
              </p>
            ) : null}
          </CardContent>
        </Card>
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
