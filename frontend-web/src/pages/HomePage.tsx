import { PageHeader } from '@/components/layout/PageHeader'

export function HomePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tracked products"
        description="Price and stock across every store in one view."
      />
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Product rows land here in r4.2.
      </div>
    </div>
  )
}
