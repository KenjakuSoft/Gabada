import { PageHeader } from '@/components/layout/PageHeader'

export function StoresPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Stores"
        description="Shops you track. Manage dealer logins and base URLs here."
      />
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Stores CRUD lands in r4.3.
      </div>
    </div>
  )
}
