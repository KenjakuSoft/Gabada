import { Badge } from '@/components/ui/badge'
import type { StockStatus } from '@/api'

const LABEL: Record<StockStatus, string> = {
  in_stock: 'In stock',
  out_of_stock: 'Out of stock',
  limited: 'Limited',
  preorder: 'Pre-order',
  backorder: 'Backorder',
  unknown: 'Unknown',
}

type BadgeVariant = 'success' | 'destructive' | 'warning' | 'info' | 'muted'

const VARIANT: Record<StockStatus, BadgeVariant> = {
  in_stock: 'success',
  out_of_stock: 'destructive',
  limited: 'warning',
  preorder: 'info',
  backorder: 'warning',
  unknown: 'muted',
}

interface StockPillProps {
  status: StockStatus | null | undefined
}

export function StockPill({ status }: StockPillProps) {
  const s: StockStatus = status ?? 'unknown'
  return <Badge variant={VARIANT[s]}>{LABEL[s]}</Badge>
}
