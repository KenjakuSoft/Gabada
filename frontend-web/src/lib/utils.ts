import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatDelta(delta: number | null | undefined): string {
  if (delta == null) return ''
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toFixed(2)}`
}

export function formatMoney(
  value: number | null | undefined,
  symbol: string = '$',
): string {
  if (value == null) return '—'
  return `${symbol}${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export type PriceDisplayMode = 'regional' | 'source'

const RAW_CURRENCY_RE = /[^\d\s.,+-]/

export function formatCurrencyCodeMoney(
  value: number | null | undefined,
  currencyCode: string | null | undefined,
  locale?: string | null,
): string | null {
  if (value == null || !currencyCode) return null
  const code = currencyCode.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(code)) return null
  try {
    return new Intl.NumberFormat(locale || undefined, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${code} ${value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }
}

export function formatDisplayMoney(
  value: number | null | undefined,
  options: {
    symbol: string
    mode?: PriceDisplayMode
    currencyCode?: string | null
    raw?: string | null
    locale?: string | null
  },
): string {
  if (value == null) return 'â€”'
  if (options.mode === 'source') {
    const sourceCurrency = formatCurrencyCodeMoney(
      value,
      options.currencyCode,
      options.locale,
    )
    if (sourceCurrency) return sourceCurrency
    const raw = options.raw?.trim()
    if (raw && RAW_CURRENCY_RE.test(raw)) return raw
  }
  return formatMoney(value, options.symbol)
}

export function sourceCurrencyCode(
  currencyCode: string | null | undefined,
): string | null {
  const code = currencyCode?.trim().toUpperCase()
  return code && /^[A-Z]{3}$/.test(code) ? code : null
}

export function convertToLocalCurrency(
  value: number | null | undefined,
  options: {
    sourceCurrency?: string | null
    localCurrency: string
    exchangeRates: Record<string, number>
  },
): number | null {
  if (value == null) return null
  const source = sourceCurrencyCode(options.sourceCurrency)
  const local = sourceCurrencyCode(options.localCurrency)
  if (!source || !local || source === local) return value
  const rate = options.exchangeRates[source]
  if (!Number.isFinite(rate) || rate <= 0) return null
  return value * rate
}

export function formatLocalEquivalent(
  value: number | null | undefined,
  options: {
    sourceCurrency?: string | null
    localCurrency: string
    exchangeRates: Record<string, number>
    symbol: string
  },
): string | null {
  const converted = convertToLocalCurrency(value, options)
  if (converted == null) return null
  const source = sourceCurrencyCode(options.sourceCurrency)
  const local = sourceCurrencyCode(options.localCurrency)
  if (!source || !local || source === local) return null
  return formatMoney(converted, options.symbol)
}

const TZ_SUFFIX_RE = /(?:z|[+-]\d{2}:?\d{2})$/i

export function normalizeApiTimestamp(iso: string): string {
  const value = iso.trim()
  if (!value || TZ_SUFFIX_RE.test(value)) return value
  return `${value.replace(' ', 'T')}Z`
}

export function parseApiDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const date = new Date(normalizeApiTimestamp(iso))
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatApiDateTime(
  iso: string | null | undefined,
  timeZone?: string | null,
): string {
  const date = parseApiDate(iso)
  if (!date) return iso ?? 'n/a'
  try {
    return date.toLocaleString(undefined, timeZone ? { timeZone } : undefined)
  } catch {
    return date.toLocaleString()
  }
}

export function formatApiDate(
  iso: string | null | undefined,
  timeZone?: string | null,
): string {
  const date = parseApiDate(iso)
  if (!date) return iso ?? 'n/a'
  try {
    return date.toLocaleDateString(undefined, timeZone ? { timeZone } : undefined)
  } catch {
    return date.toLocaleDateString()
  }
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const date = parseApiDate(iso)
  if (!date) return iso
  const then = date.getTime()
  if (Number.isNaN(then)) return iso
  const diffMs = Math.max(0, Date.now() - then)
  const mins = Math.round(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}
