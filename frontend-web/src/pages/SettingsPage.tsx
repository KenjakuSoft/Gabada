import { PageHeader } from '@/components/layout/PageHeader'

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Currency, timezone, and scrape schedule."
      />
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Settings form lands in r4.4.
      </div>
    </div>
  )
}
