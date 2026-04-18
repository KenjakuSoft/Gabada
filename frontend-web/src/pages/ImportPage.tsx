import { useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { cn } from '@/lib/utils'
import { WooImport } from '@/components/import/WooImport'
import { FileImport } from '@/components/import/FileImport'

type Tab = 'woo' | 'file'

export function ImportPage() {
  const [tab, setTab] = useState<Tab>('woo')

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Import"
        description="Bulk-add products from WooCommerce or a file."
      />

      <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
        <TabButton active={tab === 'woo'} onClick={() => setTab('woo')}>
          WooCommerce
        </TabButton>
        <TabButton active={tab === 'file'} onClick={() => setTab('file')}>
          CSV / Excel / PDF
        </TabButton>
      </div>

      {tab === 'woo' ? <WooImport /> : <FileImport />}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-background shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
