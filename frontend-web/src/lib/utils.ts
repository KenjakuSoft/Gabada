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
