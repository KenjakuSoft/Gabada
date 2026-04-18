import { PageHeader } from '@/components/layout/PageHeader'

export function ActivityPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity"
        description="Recent scrapes, errors, and price changes."
      />
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Activity feed lands in r4.2.
      </div>
    </div>
  )
}
