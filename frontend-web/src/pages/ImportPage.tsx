import { useState } from 'react'
import { FileSpreadsheet, ShoppingBag } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { BentoGrid, BentoTile, TileHeader } from '@/components/ui/bento'
import { cn } from '@/lib/utils'
import { WooImport } from '@/components/import/WooImport'
import { FileImport } from '@/components/import/FileImport'

type Tab = 'woo' | 'file'

export function ImportPage() {
  const [tab, setTab] = useState<Tab>('woo')

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Import"
        description="Bulk-add products from WooCommerce or a spreadsheet."
      />

      <BentoGrid cols={6}>
        <SourceTile
          active={tab === 'woo'}
          onClick={() => setTab('woo')}
          icon={<ShoppingBag className="h-4 w-4" />}
          eyebrow="Source · API"
          title="WooCommerce"
          description="Pull live products via REST credentials."
        />
        <SourceTile
          active={tab === 'file'}
          onClick={() => setTab('file')}
          icon={<FileSpreadsheet className="h-4 w-4" />}
          eyebrow="Source · File"
          title="CSV / Excel / PDF"
          description="Map columns and commit rows in one pass."
        />
      </BentoGrid>

      {tab === 'woo' ? <WooImport /> : <FileImport />}
    </div>
  )
}

interface SourceTileProps {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  eyebrow: string
  title: string
  description: string
}

function SourceTile({
  active,
  onClick,
  icon,
  eyebrow,
  title,
  description,
}: SourceTileProps) {
  return (
    <BentoTile
      colSpan={3}
      interactive
      tone={active ? 'primary' : 'default'}
      className={cn(
        'cursor-pointer select-none',
        active && 'ring-2 ring-primary/40',
      )}
      onClick={onClick}
    >
      <TileHeader eyebrow={eyebrow} title={title} icon={icon} />
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </BentoTile>
  )
}
