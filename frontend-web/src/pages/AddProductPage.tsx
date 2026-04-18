import { PageHeader } from '@/components/layout/PageHeader'

export function AddProductPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Add product"
        description="Paste a store URL. We auto-detect the platform and preview what we'll scrape."
      />
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Add flow lands in r4.3.
      </div>
    </div>
  )
}
