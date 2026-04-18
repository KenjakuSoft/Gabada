import { Badge } from '@/components/ui/badge'
import type { StockStatus } from '@/api'

const LABEL: Record<StockStatus, string> = {
  in_stock: 'In stock',
  out_of_stock: 'Out of stock',
  limited: 'Limited',
  unknown: 'Unknown',
}

const VARIANT: Record<StockStatus, 'success' | 'destructive' | 'warning' | 'muted'> = {
  in_stock: 'success',
  out_of_stock: 'destructive',
  limited: 'warning',
  unknown: 'muted',
}

interface StockPillProps {
  status: StockStatus | null | undefined
}

export function StockPill({ status }: StockPillProps) {
  const s: StockStatus = status ?? 'unknown'
  return <Badge variant={VARIANT[s]}>{LABEL[s]}</Badge>
}
