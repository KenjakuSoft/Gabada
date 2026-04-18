import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { settingsApi } from '@/api'
import type { Settings } from '@/api'

const CURRENCY_PRESETS: Array<{ code: string; symbol: string; label: string }> = [
  { code: 'USD', symbol: '$', label: 'USD — US Dollar' },
  { code: 'EUR', symbol: '€', label: 'EUR — Euro' },
  { code: 'GBP', symbol: '£', label: 'GBP — British Pound' },
  { code: 'JPY', symbol: '¥', label: 'JPY — Japanese Yen' },
  { code: 'CAD', symbol: 'CA$', label: 'CAD — Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', label: 'AUD — Australian Dollar' },
  { code: 'CHF', symbol: 'CHF', label: 'CHF — Swiss Franc' },
  { code: 'SEK', symbol: 'kr', label: 'SEK — Swedish Krona' },
  { code: 'NOK', symbol: 'kr', label: 'NOK — Norwegian Krone' },
  { code: 'DKK', symbol: 'kr', label: 'DKK — Danish Krone' },
  { code: 'PLN', symbol: 'zł', label: 'PLN — Polish Złoty' },
  { code: 'CZK', symbol: 'Kč', label: 'CZK — Czech Koruna' },
  { code: 'RUB', symbol: '₽', label: 'RUB — Russian Ruble' },
  { code: 'TRY', symbol: '₺', label: 'TRY — Turkish Lira' },
  { code: 'ILS', symbol: '₪', label: 'ILS — Israeli Shekel' },
  { code: 'AED', symbol: 'د.إ', label: 'AED — UAE Dirham' },
  { code: 'SAR', symbol: '﷼', label: 'SAR — Saudi Riyal' },
  { code: 'INR', symbol: '₹', label: 'INR — Indian Rupee' },
  { code: 'CNY', symbol: '¥', label: 'CNY — Chinese Yuan' },
  { code: 'HKD', symbol: 'HK$', label: 'HKD — Hong Kong Dollar' },
  { code: 'TWD', symbol: 'NT$', label: 'TWD — Taiwan Dollar' },
  { code: 'KRW', symbol: '₩', label: 'KRW — Korean Won' },
  { code: 'SGD', symbol: 'S$', label: 'SGD — Singapore Dollar' },
  { code: 'THB', symbol: '฿', label: 'THB — Thai Baht' },
  { code: 'IDR', symbol: 'Rp', label: 'IDR — Indonesian Rupiah' },
  { code: 'MYR', symbol: 'RM', label: 'MYR — Malaysian Ringgit' },
  { code: 'PHP', symbol: '₱', label: 'PHP — Philippine Peso' },
  { code: 'VND', symbol: '₫', label: 'VND — Vietnamese Đồng' },
  { code: 'BRL', symbol: 'R$', label: 'BRL — Brazilian Real' },
  { code: 'MXN', symbol: 'MX$', label: 'MXN — Mexican Peso' },
  { code: 'ARS', symbol: '$', label: 'ARS — Argentine Peso' },
  { code: 'ZAR', symbol: 'R', label: 'ZAR — South African Rand' },
  { code: 'NZD', symbol: 'NZ$', label: 'NZD — New Zealand Dollar' },
]

const TIMEZONE_PRESETS = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Warsaw',
  'Europe/Moscow',
  'Europe/Istanbul',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
]

const CRON_PRESETS = [
  { value: '0 * * * *', label: 'Every hour' },
  { value: '0 */6 * * *', label: 'Every 6 hours' },
  { value: '0 */12 * * *', label: 'Every 12 hours' },
  { value: '0 8 * * *', label: 'Daily at 08:00' },
  { value: '0 8,20 * * *', label: 'Twice daily (08:00 and 20:00)' },
  { value: '0 8 * * 1', label: 'Weekly on Monday at 08:00' },
]

export function SettingsPage() {
  const qc = useQueryClient()
  const settings = useQuery<Settings>({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get(),
  })

  const [form, setForm] = useState<Settings | null>(null)
  useEffect(() => {
    if (settings.data && !form) setForm(settings.data)
  }, [settings.data, form])

  const next = useQuery<{ next_run_time: string | null }>({
    queryKey: ['settings', 'next-run'],
    queryFn: () => settingsApi.nextRun(),
    refetchInterval: 10_000,
  })

  const save = useMutation({
    mutationFn: (body: Partial<Settings>) => settingsApi.update(body),
    onSuccess: (updated) => {
      qc.setQueryData(['settings'], updated)
      qc.invalidateQueries({ queryKey: ['settings', 'next-run'] })
      setForm(updated)
    },
  })

  if (!form) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        {settings.isError ? 'Failed to load settings.' : 'Loading…'}
      </div>
    )
  }

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f))
  }

  function pickCurrency(code: string) {
    const preset = CURRENCY_PRESETS.find((c) => c.code === code)
    if (!preset || !form) return
    setForm({
      ...form,
      currency_code: preset.code,
      currency_symbol: preset.symbol,
    })
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Settings"
        description="Currency, timezone, and scrape schedule."
        actions={
          <Button
            size="sm"
            onClick={() =>
              save.mutate({
                currency_code: form.currency_code,
                currency_symbol: form.currency_symbol,
                country_code: form.country_code,
                timezone: form.timezone,
                scrape_cron: form.scrape_cron,
                scrape_enabled: form.scrape_enabled,
                locale: form.locale,
              })
            }
            disabled={save.isPending}
          >
            {save.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Save
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Regional</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="currency">Currency</Label>
            <Select
              id="currency"
              value={form.currency_code}
              onChange={(e) => pickCurrency(e.target.value)}
            >
              {CURRENCY_PRESETS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="symbol">Currency symbol</Label>
            <Input
              id="symbol"
              value={form.currency_symbol}
              onChange={(e) => update('currency_symbol', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="country">Country code (ISO-3166)</Label>
            <Input
              id="country"
              value={form.country_code}
              maxLength={2}
              onChange={(e) =>
                update('country_code', e.target.value.toUpperCase())
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="locale">Locale</Label>
            <Input
              id="locale"
              value={form.locale}
              onChange={(e) => update('locale', e.target.value)}
              placeholder="en-US"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="tz">Timezone</Label>
            <Input
              id="tz"
              value={form.timezone}
              onChange={(e) => update('timezone', e.target.value)}
              list="tz-presets"
              placeholder="UTC"
            />
            <datalist id="tz-presets">
              {TIMEZONE_PRESETS.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scrape schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={form.scrape_enabled}
              onChange={(e) => update('scrape_enabled', e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-sm font-medium">
              Enable automatic scraping
            </span>
          </label>

          <div className="space-y-1.5">
            <Label htmlFor="cron">Cron expression</Label>
            <Input
              id="cron"
              value={form.scrape_cron}
              onChange={(e) => update('scrape_cron', e.target.value)}
              className="font-mono"
              placeholder="0 8 * * *"
            />
            <p className="text-xs text-muted-foreground">
              Standard 5-field cron (minute hour day month weekday). Interpreted
              in the timezone above.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {CRON_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => update('scrape_cron', p.value)}
                className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs hover:bg-accent"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5" />
              Next scheduled run
            </span>
            <span className="font-mono text-xs">
              {next.data?.next_run_time
                ? new Date(next.data.next_run_time).toLocaleString()
                : form.scrape_enabled
                  ? '—'
                  : 'disabled'}
            </span>
          </div>
        </CardContent>
      </Card>

      {save.isError ? (
        <p className="text-right text-sm text-destructive">
          Failed to save: invalid cron, timezone, or backend unreachable.
        </p>
      ) : null}
    </div>
  )
}
