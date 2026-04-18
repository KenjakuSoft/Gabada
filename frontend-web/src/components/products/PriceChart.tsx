import { useMemo } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { PriceLog, ProductStoreSummary } from '@/api'
import { formatMoney } from '@/lib/utils'

interface PriceChartProps {
  logs: PriceLog[]
  stores: ProductStoreSummary[]
  symbol: string
}

const COLORS = [
  '#6366f1',
  '#ec4899',
  '#14b8a6',
  '#f59e0b',
  '#8b5cf6',
  '#ef4444',
  '#22c55e',
  '#0ea5e9',
]

interface Point {
  t: number
  label: string
  [seriesId: string]: number | string
}

export function PriceChart({ logs, stores, symbol }: PriceChartProps) {
  const data = useMemo<Point[]>(() => {
    const byTime = new Map<number, Point>()
    for (const log of logs) {
      const t = new Date(log.scraped_at).getTime()
      if (Number.isNaN(t)) continue
      const key = Math.round(t / 60_000)
      const bucket = byTime.get(key) ?? {
        t: key * 60_000,
        label: new Date(t).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        }),
      }
      const price = log.discounted_price ?? log.price ?? log.dealer_price
      if (price != null) {
        bucket[`store_${log.product_store_id}`] = price
      }
      byTime.set(key, bucket)
    }
    return Array.from(byTime.values()).sort((a, b) => a.t - b.t)
  }, [logs])

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
        No price history yet. Run a scrape.
      </div>
    )
  }

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="label"
            stroke="var(--muted-foreground)"
            tick={{ fontSize: 12 }}
          />
          <YAxis
            stroke="var(--muted-foreground)"
            tick={{ fontSize: 12 }}
            tickFormatter={(v) => `${symbol}${v}`}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value) =>
              typeof value === 'number' ? formatMoney(value, symbol) : String(value)
            }
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {stores.map((store, idx) => (
            <Line
              key={store.id}
              type="monotone"
              dataKey={`store_${store.id}`}
              name={store.store_name}
              stroke={COLORS[idx % COLORS.length]}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
