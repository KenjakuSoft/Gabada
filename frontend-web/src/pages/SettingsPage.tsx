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

// Full ISO 4217 set of actively-circulating national currencies plus a few
// widely-used dependent-territory currencies. Sorted alphabetically by code
// so users can scan or type-to-jump in the Select.
const CURRENCY_PRESETS: Array<{ code: string; symbol: string; label: string }> = [
  { code: 'AED', symbol: 'د.إ', label: 'AED — UAE Dirham' },
  { code: 'AFN', symbol: '؋', label: 'AFN — Afghan Afghani' },
  { code: 'ALL', symbol: 'L', label: 'ALL — Albanian Lek' },
  { code: 'AMD', symbol: '֏', label: 'AMD — Armenian Dram' },
  { code: 'ANG', symbol: 'ƒ', label: 'ANG — Netherlands Antillean Guilder' },
  { code: 'AOA', symbol: 'Kz', label: 'AOA — Angolan Kwanza' },
  { code: 'ARS', symbol: '$', label: 'ARS — Argentine Peso' },
  { code: 'AUD', symbol: 'A$', label: 'AUD — Australian Dollar' },
  { code: 'AWG', symbol: 'ƒ', label: 'AWG — Aruban Florin' },
  { code: 'AZN', symbol: '₼', label: 'AZN — Azerbaijani Manat' },
  { code: 'BAM', symbol: 'KM', label: 'BAM — Bosnia-Herzegovina Convertible Mark' },
  { code: 'BBD', symbol: 'Bds$', label: 'BBD — Barbadian Dollar' },
  { code: 'BDT', symbol: '৳', label: 'BDT — Bangladeshi Taka' },
  { code: 'BGN', symbol: 'лв', label: 'BGN — Bulgarian Lev' },
  { code: 'BHD', symbol: '.د.ب', label: 'BHD — Bahraini Dinar' },
  { code: 'BIF', symbol: 'FBu', label: 'BIF — Burundian Franc' },
  { code: 'BMD', symbol: 'BD$', label: 'BMD — Bermudian Dollar' },
  { code: 'BND', symbol: 'B$', label: 'BND — Brunei Dollar' },
  { code: 'BOB', symbol: 'Bs.', label: 'BOB — Bolivian Boliviano' },
  { code: 'BRL', symbol: 'R$', label: 'BRL — Brazilian Real' },
  { code: 'BSD', symbol: 'B$', label: 'BSD — Bahamian Dollar' },
  { code: 'BTN', symbol: 'Nu.', label: 'BTN — Bhutanese Ngultrum' },
  { code: 'BWP', symbol: 'P', label: 'BWP — Botswanan Pula' },
  { code: 'BYN', symbol: 'Br', label: 'BYN — Belarusian Ruble' },
  { code: 'BZD', symbol: 'BZ$', label: 'BZD — Belize Dollar' },
  { code: 'CAD', symbol: 'CA$', label: 'CAD — Canadian Dollar' },
  { code: 'CDF', symbol: 'FC', label: 'CDF — Congolese Franc' },
  { code: 'CHF', symbol: 'CHF', label: 'CHF — Swiss Franc' },
  { code: 'CLP', symbol: 'CLP$', label: 'CLP — Chilean Peso' },
  { code: 'CNY', symbol: '¥', label: 'CNY — Chinese Yuan' },
  { code: 'COP', symbol: 'COL$', label: 'COP — Colombian Peso' },
  { code: 'CRC', symbol: '₡', label: 'CRC — Costa Rican Colón' },
  { code: 'CUP', symbol: '₱', label: 'CUP — Cuban Peso' },
  { code: 'CVE', symbol: '$', label: 'CVE — Cape Verdean Escudo' },
  { code: 'CZK', symbol: 'Kč', label: 'CZK — Czech Koruna' },
  { code: 'DJF', symbol: 'Fdj', label: 'DJF — Djiboutian Franc' },
  { code: 'DKK', symbol: 'kr', label: 'DKK — Danish Krone' },
  { code: 'DOP', symbol: 'RD$', label: 'DOP — Dominican Peso' },
  { code: 'DZD', symbol: 'دج', label: 'DZD — Algerian Dinar' },
  { code: 'EGP', symbol: 'E£', label: 'EGP — Egyptian Pound' },
  { code: 'ERN', symbol: 'Nfk', label: 'ERN — Eritrean Nakfa' },
  { code: 'ETB', symbol: 'Br', label: 'ETB — Ethiopian Birr' },
  { code: 'EUR', symbol: '€', label: 'EUR — Euro' },
  { code: 'FJD', symbol: 'FJ$', label: 'FJD — Fijian Dollar' },
  { code: 'FKP', symbol: 'FK£', label: 'FKP — Falkland Islands Pound' },
  { code: 'FOK', symbol: 'kr', label: 'FOK — Faroese Króna' },
  { code: 'GBP', symbol: '£', label: 'GBP — British Pound' },
  { code: 'GEL', symbol: '₾', label: 'GEL — Georgian Lari' },
  { code: 'GGP', symbol: '£', label: 'GGP — Guernsey Pound' },
  { code: 'GHS', symbol: 'GH₵', label: 'GHS — Ghanaian Cedi' },
  { code: 'GIP', symbol: '£', label: 'GIP — Gibraltar Pound' },
  { code: 'GMD', symbol: 'D', label: 'GMD — Gambian Dalasi' },
  { code: 'GNF', symbol: 'FG', label: 'GNF — Guinean Franc' },
  { code: 'GTQ', symbol: 'Q', label: 'GTQ — Guatemalan Quetzal' },
  { code: 'GYD', symbol: 'GY$', label: 'GYD — Guyanese Dollar' },
  { code: 'HKD', symbol: 'HK$', label: 'HKD — Hong Kong Dollar' },
  { code: 'HNL', symbol: 'L', label: 'HNL — Honduran Lempira' },
  { code: 'HRK', symbol: 'kn', label: 'HRK — Croatian Kuna' },
  { code: 'HTG', symbol: 'G', label: 'HTG — Haitian Gourde' },
  { code: 'HUF', symbol: 'Ft', label: 'HUF — Hungarian Forint' },
  { code: 'IDR', symbol: 'Rp', label: 'IDR — Indonesian Rupiah' },
  { code: 'ILS', symbol: '₪', label: 'ILS — Israeli New Shekel' },
  { code: 'IMP', symbol: '£', label: 'IMP — Isle of Man Pound' },
  { code: 'INR', symbol: '₹', label: 'INR — Indian Rupee' },
  { code: 'IQD', symbol: 'ع.د', label: 'IQD — Iraqi Dinar' },
  { code: 'IRR', symbol: '﷼', label: 'IRR — Iranian Rial' },
  { code: 'ISK', symbol: 'kr', label: 'ISK — Icelandic Króna' },
  { code: 'JEP', symbol: '£', label: 'JEP — Jersey Pound' },
  { code: 'JMD', symbol: 'J$', label: 'JMD — Jamaican Dollar' },
  { code: 'JOD', symbol: 'JD', label: 'JOD — Jordanian Dinar' },
  { code: 'JPY', symbol: '¥', label: 'JPY — Japanese Yen' },
  { code: 'KES', symbol: 'KSh', label: 'KES — Kenyan Shilling' },
  { code: 'KGS', symbol: 'с', label: 'KGS — Kyrgyzstani Som' },
  { code: 'KHR', symbol: '៛', label: 'KHR — Cambodian Riel' },
  { code: 'KID', symbol: '$', label: 'KID — Kiribati Dollar' },
  { code: 'KMF', symbol: 'CF', label: 'KMF — Comorian Franc' },
  { code: 'KRW', symbol: '₩', label: 'KRW — South Korean Won' },
  { code: 'KWD', symbol: 'KD', label: 'KWD — Kuwaiti Dinar' },
  { code: 'KYD', symbol: 'CI$', label: 'KYD — Cayman Islands Dollar' },
  { code: 'KZT', symbol: '₸', label: 'KZT — Kazakhstani Tenge' },
  { code: 'LAK', symbol: '₭', label: 'LAK — Laotian Kip' },
  { code: 'LBP', symbol: 'L£', label: 'LBP — Lebanese Pound' },
  { code: 'LKR', symbol: 'Rs', label: 'LKR — Sri Lankan Rupee' },
  { code: 'LRD', symbol: 'L$', label: 'LRD — Liberian Dollar' },
  { code: 'LSL', symbol: 'M', label: 'LSL — Lesotho Loti' },
  { code: 'LYD', symbol: 'LD', label: 'LYD — Libyan Dinar' },
  { code: 'MAD', symbol: 'DH', label: 'MAD — Moroccan Dirham' },
  { code: 'MDL', symbol: 'L', label: 'MDL — Moldovan Leu' },
  { code: 'MGA', symbol: 'Ar', label: 'MGA — Malagasy Ariary' },
  { code: 'MKD', symbol: 'ден', label: 'MKD — Macedonian Denar' },
  { code: 'MMK', symbol: 'K', label: 'MMK — Myanmar Kyat' },
  { code: 'MNT', symbol: '₮', label: 'MNT — Mongolian Tögrög' },
  { code: 'MOP', symbol: 'MOP$', label: 'MOP — Macanese Pataca' },
  { code: 'MRU', symbol: 'UM', label: 'MRU — Mauritanian Ouguiya' },
  { code: 'MUR', symbol: '₨', label: 'MUR — Mauritian Rupee' },
  { code: 'MVR', symbol: 'Rf', label: 'MVR — Maldivian Rufiyaa' },
  { code: 'MWK', symbol: 'MK', label: 'MWK — Malawian Kwacha' },
  { code: 'MXN', symbol: 'MX$', label: 'MXN — Mexican Peso' },
  { code: 'MYR', symbol: 'RM', label: 'MYR — Malaysian Ringgit' },
  { code: 'MZN', symbol: 'MT', label: 'MZN — Mozambican Metical' },
  { code: 'NAD', symbol: 'N$', label: 'NAD — Namibian Dollar' },
  { code: 'NGN', symbol: '₦', label: 'NGN — Nigerian Naira' },
  { code: 'NIO', symbol: 'C$', label: 'NIO — Nicaraguan Córdoba' },
  { code: 'NOK', symbol: 'kr', label: 'NOK — Norwegian Krone' },
  { code: 'NPR', symbol: '₨', label: 'NPR — Nepalese Rupee' },
  { code: 'NZD', symbol: 'NZ$', label: 'NZD — New Zealand Dollar' },
  { code: 'OMR', symbol: '﷼', label: 'OMR — Omani Rial' },
  { code: 'PAB', symbol: 'B/.', label: 'PAB — Panamanian Balboa' },
  { code: 'PEN', symbol: 'S/', label: 'PEN — Peruvian Sol' },
  { code: 'PGK', symbol: 'K', label: 'PGK — Papua New Guinean Kina' },
  { code: 'PHP', symbol: '₱', label: 'PHP — Philippine Peso' },
  { code: 'PKR', symbol: '₨', label: 'PKR — Pakistani Rupee' },
  { code: 'PLN', symbol: 'zł', label: 'PLN — Polish Złoty' },
  { code: 'PYG', symbol: '₲', label: 'PYG — Paraguayan Guaraní' },
  { code: 'QAR', symbol: '﷼', label: 'QAR — Qatari Rial' },
  { code: 'RON', symbol: 'lei', label: 'RON — Romanian Leu' },
  { code: 'RSD', symbol: 'дин', label: 'RSD — Serbian Dinar' },
  { code: 'RUB', symbol: '₽', label: 'RUB — Russian Ruble' },
  { code: 'RWF', symbol: 'RF', label: 'RWF — Rwandan Franc' },
  { code: 'SAR', symbol: '﷼', label: 'SAR — Saudi Riyal' },
  { code: 'SBD', symbol: 'SI$', label: 'SBD — Solomon Islands Dollar' },
  { code: 'SCR', symbol: '₨', label: 'SCR — Seychellois Rupee' },
  { code: 'SDG', symbol: 'ج.س.', label: 'SDG — Sudanese Pound' },
  { code: 'SEK', symbol: 'kr', label: 'SEK — Swedish Krona' },
  { code: 'SGD', symbol: 'S$', label: 'SGD — Singapore Dollar' },
  { code: 'SHP', symbol: '£', label: 'SHP — Saint Helena Pound' },
  { code: 'SLE', symbol: 'Le', label: 'SLE — Sierra Leonean Leone' },
  { code: 'SOS', symbol: 'Sh', label: 'SOS — Somali Shilling' },
  { code: 'SRD', symbol: 'Sr$', label: 'SRD — Surinamese Dollar' },
  { code: 'SSP', symbol: '£', label: 'SSP — South Sudanese Pound' },
  { code: 'STN', symbol: 'Db', label: 'STN — São Tomé & Príncipe Dobra' },
  { code: 'SYP', symbol: 'S£', label: 'SYP — Syrian Pound' },
  { code: 'SZL', symbol: 'E', label: 'SZL — Eswatini Lilangeni' },
  { code: 'THB', symbol: '฿', label: 'THB — Thai Baht' },
  { code: 'TJS', symbol: 'SM', label: 'TJS — Tajikistani Somoni' },
  { code: 'TMT', symbol: 'T', label: 'TMT — Turkmenistani Manat' },
  { code: 'TND', symbol: 'د.ت', label: 'TND — Tunisian Dinar' },
  { code: 'TOP', symbol: 'T$', label: 'TOP — Tongan Paʻanga' },
  { code: 'TRY', symbol: '₺', label: 'TRY — Turkish Lira' },
  { code: 'TTD', symbol: 'TT$', label: 'TTD — Trinidad & Tobago Dollar' },
  { code: 'TVD', symbol: '$', label: 'TVD — Tuvaluan Dollar' },
  { code: 'TWD', symbol: 'NT$', label: 'TWD — New Taiwan Dollar' },
  { code: 'TZS', symbol: 'TSh', label: 'TZS — Tanzanian Shilling' },
  { code: 'UAH', symbol: '₴', label: 'UAH — Ukrainian Hryvnia' },
  { code: 'UGX', symbol: 'USh', label: 'UGX — Ugandan Shilling' },
  { code: 'USD', symbol: '$', label: 'USD — US Dollar' },
  { code: 'UYU', symbol: '$U', label: 'UYU — Uruguayan Peso' },
  { code: 'UZS', symbol: "so'm", label: 'UZS — Uzbekistani So\u02bbm' },
  { code: 'VES', symbol: 'Bs.', label: 'VES — Venezuelan Bolívar Soberano' },
  { code: 'VND', symbol: '₫', label: 'VND — Vietnamese Đồng' },
  { code: 'VUV', symbol: 'VT', label: 'VUV — Vanuatu Vatu' },
  { code: 'WST', symbol: 'WS$', label: 'WST — Samoan Tālā' },
  { code: 'XAF', symbol: 'FCFA', label: 'XAF — Central African CFA Franc' },
  { code: 'XCD', symbol: 'EC$', label: 'XCD — East Caribbean Dollar' },
  { code: 'XOF', symbol: 'CFA', label: 'XOF — West African CFA Franc' },
  { code: 'XPF', symbol: 'CFP', label: 'XPF — CFP Franc' },
  { code: 'YER', symbol: '﷼', label: 'YER — Yemeni Rial' },
  { code: 'ZAR', symbol: 'R', label: 'ZAR — South African Rand' },
  { code: 'ZMW', symbol: 'ZK', label: 'ZMW — Zambian Kwacha' },
  { code: 'ZWL', symbol: 'Z$', label: 'ZWL — Zimbabwean Dollar' },
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
