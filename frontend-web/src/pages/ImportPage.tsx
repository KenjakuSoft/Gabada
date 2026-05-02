import { useState } from 'react'
import { FileSpreadsheet, Gamepad2, Share2, ShoppingBag } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { BentoGrid, BentoTile, TileHeader } from '@/components/ui/bento'
import { cn } from '@/lib/utils'
import { ApiCatalogImport } from '@/components/import/ApiCatalogImport'
import { WooImport } from '@/components/import/WooImport'
import { FileImport } from '@/components/import/FileImport'
import { GabadaShare } from '@/components/import/GabadaShare'

type Tab = 'api' | 'woo' | 'file' | 'share'

export function ImportPage() {
  const [tab, setTab] = useState<Tab>('api')

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Import"
        description="Pull products from APIs, WooCommerce, supplier files, or Gabada share files."
      />

      <BentoGrid cols={6}>
        <SourceTile
          active={tab === 'api'}
          onClick={() => setTab('api')}
          icon={<Gamepad2 className="h-4 w-4" />}
          eyebrow="Source / API"
          title="API catalog"
          description="Select a provider and import products directly."
          colSpan={3}
        />
        <SourceTile
          active={tab === 'woo'}
          onClick={() => setTab('woo')}
          icon={<ShoppingBag className="h-4 w-4" />}
          eyebrow="Source / Woo"
          title="WooCommerce"
          description="Pull live products via REST credentials."
          colSpan={3}
        />
        <SourceTile
          active={tab === 'file'}
          onClick={() => setTab('file')}
          icon={<FileSpreadsheet className="h-4 w-4" />}
          eyebrow="Source / File"
          title="CSV / Excel / PDF"
          description="Update existing store prices from dealer sheets or import rows into Gabada."
          colSpan={3}
        />
        <SourceTile
          active={tab === 'share'}
          onClick={() => setTab('share')}
          icon={<Share2 className="h-4 w-4" />}
          eyebrow="Source / Share"
          title="Gabada Share"
          description="Export selected store rows to share, or import a shared Gabada product file."
          colSpan={3}
        />
      </BentoGrid>

      {tab === 'api' ? (
        <ApiCatalogImport />
      ) : tab === 'woo' ? (
        <WooImport />
      ) : tab === 'file' ? (
        <FileImport />
      ) : (
        <GabadaShare />
      )}
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
  colSpan?: 1 | 2 | 3 | 4 | 5 | 6
}

function SourceTile({
  active,
  onClick,
  icon,
  eyebrow,
  title,
  description,
  colSpan = 3,
}: SourceTileProps) {
  return (
    <BentoTile
      colSpan={colSpan}
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
