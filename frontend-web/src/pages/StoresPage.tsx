import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { storesApi } from '@/api'
import type { Store } from '@/api'

export function StoresPage() {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')

  const stores = useQuery<Store[]>({
    queryKey: ['stores'],
    queryFn: () => storesApi.list(),
  })

  const create = useMutation({
    mutationFn: () =>
      storesApi.create({ name: name.trim(), base_url: baseUrl.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stores'] })
      setName('')
      setBaseUrl('')
      setAdding(false)
    },
  })

  const remove = useMutation({
    mutationFn: (id: number) => storesApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stores'] }),
  })

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Stores"
        description="Shops you track. Manage base URLs here."
        actions={
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Add store
          </Button>
        }
      />

      {adding ? (
        <Card>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="store-name">Name</Label>
              <Input
                id="store-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Example Shop"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="store-url">Base URL</Label>
              <Input
                id="store-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://shop.example.com"
              />
            </div>
            <div className="flex items-end gap-2">
              <Button
                size="sm"
                onClick={() => create.mutate()}
                disabled={
                  create.isPending || !name.trim() || !baseUrl.trim()
                }
              >
                Save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAdding(false)
                  setName('')
                  setBaseUrl('')
                }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {stores.isLoading ? (
        <EmptyState text="Loading…" />
      ) : stores.isError ? (
        <EmptyState text="Failed to load stores." />
      ) : (stores.data ?? []).length === 0 ? (
        <EmptyState text="No stores yet." />
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {(stores.data ?? []).map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{s.name}</span>
                <a
                  href={s.base_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 truncate text-xs text-muted-foreground hover:underline"
                >
                  {s.base_url}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (
                    confirm(`Remove "${s.name}"? Linked product rows will fail.`)
                  ) {
                    remove.mutate(s.id)
                  }
                }}
                disabled={remove.isPending}
                title="Delete"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  )
}
