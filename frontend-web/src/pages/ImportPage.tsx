import { PageHeader } from '@/components/layout/PageHeader'

export function ImportPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Import"
        description="Bulk import products from WooCommerce or a file."
      />
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Import flows land in r4.3.
      </div>
    </div>
  )
}
