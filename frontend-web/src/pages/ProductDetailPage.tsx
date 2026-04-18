import { useParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Product #${id ?? '?'}`}
        description="Per-store price history and logs land here in r4.2."
      />
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Detail view placeholder.
      </div>
    </div>
  )
}
