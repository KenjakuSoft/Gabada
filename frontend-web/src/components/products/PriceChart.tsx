import { useId, useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { PriceLog, ProductStoreSummary } from '@/api'
import { useTimezone } from '@/hooks/useSettings'
import {
  formatCurrencyCodeMoney,
  formatDisplayMoney,
  formatMoney,
  parseApiDate,
} from '@/lib/utils'
import type { PriceDisplayMode } from '@/lib/utils'

interface PriceChartProps {
  logs: PriceLog[]
  stores: ProductStoreSummary[]
  symbol: string
  displayMode?: PriceDisplayMode
  locale?: string
}

// Multi-store series palette (brand blue leads).
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
  full: string
  [seriesId: string]: number | string
}

export function PriceChart({
  logs,
  stores,
  symbol,
  displayMode = 'regional',
  locale,
}: PriceChartProps) {
  const timezone = useTimezone()
  const gradId = useId()
  const singleStoreCurrency =
    displayMode === 'source' && stores.length === 1
      ? stores[0]?.latest_currency_code
      : null

  const data = useMemo<Point[]>(() => {
    const byTime = new Map<number, Point>()
    for (const log of logs) {
      const parsed = parseApiDate(log.scraped_at)
      const t = parsed?.getTime() ?? Number.NaN
      if (Number.isNaN(t)) continue
      const key = Math.round(t / 60_000)
      const bucket =
        byTime.get(key) ??
        ({
          t: key * 60_000,
          label: new Date(t).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            timeZone: timezone,
          }),
          full: new Date(t).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: timezone,
          }),
        } as Point)
      const price = log.discounted_price ?? log.price ?? log.dealer_price
      if (price != null) bucket[`store_${log.product_store_id}`] = price
      byTime.set(key, bucket)
    }
    return Array.from(byTime.values()).sort((a, b) => a.t - b.t)
  }, [logs, timezone])

  const fmt = (v: number) =>
    singleStoreCurrency
      ? formatDisplayMoney(v, {
          symbol,
          mode: displayMode,
          currencyCode: singleStoreCurrency,
          locale,
        })
      : formatMoney(v, symbol)

  if (data.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-border/70 bg-card/30 text-sm text-muted-foreground">
        No price history yet. Run a scrape.
      </div>
    )
  }

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 16, left: 4, bottom: 4 }}>
          <defs>
            {stores.map((store, idx) => {
              const color = COLORS[idx % COLORS.length]
              return (
                <linearGradient
                  key={store.id}
                  id={`${gradId}-${store.id}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              )
            })}
          </defs>
          <CartesianGrid
            strokeDasharray="2 5"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            stroke="var(--muted-foreground)"
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            minTickGap={28}
          />
          <YAxis
            stroke="var(--muted-foreground)"
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={(v) =>
              typeof v === 'number' && singleStoreCurrency
                ? formatCurrencyCodeMoney(v, singleStoreCurrency, locale) ??
                  String(v)
                : `${symbol}${Number(v).toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}`
            }
          />
          <Tooltip
            cursor={{ stroke: 'var(--brand)', strokeWidth: 1, strokeDasharray: '4 4' }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const full = (payload[0]?.payload as Point | undefined)?.full ?? label
              return (
                <div className="gbd-glass min-w-44 rounded-xl border border-border/80 p-3 text-xs shadow-[var(--shadow-elevated)]">
                  <div className="mb-1.5 font-semibold text-muted-foreground">
                    {String(full)}
                  </div>
                  <div className="space-y-1">
                    {payload.map((entry) => {
                      const store = stores.find(
                        (s) => `store_${s.id}` === entry.dataKey,
                      )
                      return (
                        <div
                          key={String(entry.dataKey)}
                          className="flex items-center justify-between gap-4"
                        >
                          <span className="flex items-center gap-1.5">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ background: entry.color }}
                            />
                            <span className="text-foreground/80">
                              {store?.store_name ?? 'Price'}
                            </span>
                          </span>
                          <span className="gbd-numeral font-semibold">
                            {typeof entry.value === 'number'
                              ? fmt(entry.value)
                              : String(entry.value)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            }}
          />
          {stores.map((store, idx) => {
            const color = COLORS[idx % COLORS.length]
            return (
              <Area
                key={store.id}
                type="monotone"
                dataKey={`store_${store.id}`}
                name={store.store_name}
                stroke={color}
                strokeWidth={2}
                fill={`url(#${gradId}-${store.id})`}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0, fill: color }}
                connectNulls
                isAnimationActive
              />
            )
          })}
        </AreaChart>
      </ResponsiveContainer>
      {stores.length > 1 ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {stores.map((store, idx) => (
            <span
              key={store.id}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: COLORS[idx % COLORS.length] }}
              />
              {store.store_name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
