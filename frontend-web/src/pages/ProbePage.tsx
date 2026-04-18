import { PageHeader } from '@/components/layout/PageHeader'

export function ProbePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Probe"
        description="Paste a URL and inspect what each strategy finds. Pick the winner."
      />
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Probe debugger lands in r4.4.
      </div>
    </div>
  )
}
