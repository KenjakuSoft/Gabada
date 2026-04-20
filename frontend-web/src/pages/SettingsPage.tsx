import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  Clock,
  FileCode,
  Globe2,
  Loader2,
  Radio,
  RefreshCw,
  Timer,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { BentoGrid, BentoTile, TileHeader } from '@/components/ui/bento'
import { toast } from '@/components/ui/toast-store'
import { useLiveTime } from '@/hooks/useLiveTime'
import { scraperApi, settingsApi } from '@/api'
import type { Settings, SitesConfigResponse } from '@/api'

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

  const [draft, setDraft] = useState<Settings | null>(null)
  const form = draft ?? settings.data ?? null

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
      setDraft(null)
      toast.success('Settings saved')
    },
    onError: () =>
      toast.error('Save failed', 'Invalid cron, timezone, or backend offline'),
  })

  const dirty = useMemo(() => {
    if (!draft || !settings.data) return false
    const keys: Array<keyof Settings> = [
      'currency_code',
      'currency_symbol',
      'country_code',
      'timezone',
      'scrape_cron',
      'scrape_enabled',
      'locale',
    ]
    return keys.some((k) => draft[k] !== settings.data[k])
  }, [draft, settings.data])

  if (!form) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        {settings.isError ? 'Failed to load settings.' : 'Loading…'}
      </div>
    )
  }

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft((current) => {
      const source = current ?? settings.data
      return source ? { ...source, [key]: value } : current
    })
  }

  function pickCurrency(code: string) {
    const preset = CURRENCY_PRESETS.find((c) => c.code === code)
    if (!preset) return
    setDraft((current) => {
      const source = current ?? settings.data
      if (!source) return current
      return {
        ...source,
        currency_code: preset.code,
        currency_symbol: preset.symbol,
      }
    })
  }

  const nextLabel = next.data?.next_run_time
    ? new Date(next.data.next_run_time).toLocaleString()
    : form.scrape_enabled
      ? '—'
      : 'disabled'

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Settings"
        description="Currency, timezone, and scrape schedule."
        actions={
          <>
            {dirty ? (
              <Badge variant="warning" className="text-[10px]">
                unsaved changes
              </Badge>
            ) : null}
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
              disabled={save.isPending || !dirty}
            >
              {save.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Save
            </Button>
          </>
        }
      />

      <BentoGrid cols={6}>
        <BentoTile colSpan={3} tone="primary">
          <TileHeader
            eyebrow="Regional"
            title="Currency & locale"
            icon={<Globe2 className="h-4 w-4" />}
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
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
              <Label htmlFor="symbol">Symbol</Label>
              <Input
                id="symbol"
                value={form.currency_symbol}
                onChange={(e) => update('currency_symbol', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="country">Country (ISO-3166)</Label>
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
            <div className="space-y-1.5">
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
          </div>
        </BentoTile>

        <BentoTile colSpan={3} tone="accent">
          <TileHeader
            eyebrow="Automation"
            title="Scrape schedule"
            icon={<Timer className="h-4 w-4" />}
            action={
              <label className="flex cursor-pointer items-center gap-2 rounded-md bg-background/60 px-2.5 py-1">
                <input
                  type="checkbox"
                  checked={form.scrape_enabled}
                  onChange={(e) => update('scrape_enabled', e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="text-xs font-medium">Enabled</span>
              </label>
            }
          />
          <div className="mt-3 space-y-3">
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
                5-field cron (min hour day mon weekday) in the timezone above.
              </p>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {CRON_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => update('scrape_cron', p.value)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                    form.scrape_cron === p.value
                      ? 'border-primary bg-primary/15 text-foreground'
                      : 'border-border bg-muted/40 hover:bg-accent'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </BentoTile>

        <BentoTile
          colSpan={4}
          tone={form.scrape_enabled ? 'success' : 'default'}
        >
          <TileHeader
            eyebrow="Next scheduled run"
            title={nextLabel}
            icon={<RefreshCw className="h-4 w-4" />}
          />
          <div className="mt-2 text-xs text-muted-foreground">
            {next.data?.next_run_time ? (
              <NextRunLive iso={next.data.next_run_time} />
            ) : form.scrape_enabled ? (
              'awaiting scheduler'
            ) : (
              'automation off'
            )}
          </div>
        </BentoTile>

        <BentoTile
          colSpan={2}
          tone={form.scrape_enabled ? 'primary' : 'default'}
        >
          <TileHeader
            eyebrow="Live status"
            title={form.scrape_enabled ? 'On' : 'Off'}
            icon={<Radio className="h-4 w-4" />}
          />
          <div className="mt-2 text-xs text-muted-foreground">
            {form.scrape_enabled ? 'auto-scraping' : 'manual only'}
          </div>
        </BentoTile>
      </BentoGrid>

      <SiteProfilesCard />
    </div>
  )
}

function NextRunLive({ iso }: { iso: string }) {
  const live = useLiveTime(iso)
  return (
    <span className="inline-flex items-center gap-1">
      <Clock className="h-3 w-3" />
      {live}
    </span>
  )
}

function SiteProfilesCard() {
  const qc = useQueryClient()
  const config = useQuery<SitesConfigResponse>({
    queryKey: ['scraper', 'sites-config'],
    queryFn: () => scraperApi.getSitesConfig(),
  })

  const [draft, setDraft] = useState<string | null>(null)
  const content = draft ?? config.data?.content ?? ''

  const save = useMutation({
    mutationFn: (content: string) => scraperApi.putSitesConfig(content),
    onSuccess: (next) => {
      qc.setQueryData(['scraper', 'sites-config'], next)
      setDraft(null)
      toast.success('Profiles saved', 'Scraper reloads on next run')
    },
    onError: (err: unknown) => {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? 'Failed to save sites.toml'
      toast.error('Save failed', detail)
    },
  })

  const dirty = draft !== null && config.data != null && draft !== config.data.content

  return (
    <BentoGrid cols={6}>
      <BentoTile colSpan={6}>
        <TileHeader
          eyebrow="Scraper · TOML"
          title="Site profiles"
          icon={<FileCode className="h-4 w-4" />}
          action={
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDraft(null)}
                disabled={!dirty || save.isPending}
              >
                Revert
              </Button>
              <Button
                size="sm"
                onClick={() => save.mutate(content)}
                disabled={!dirty || save.isPending}
              >
                {save.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Save profiles
              </Button>
            </div>
          }
        />
        <p className="mt-3 text-sm text-muted-foreground">
          Register shops by hostname and pin a platform or override selectors.
          Plain-text TOML — edit here or directly in{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            {config.data?.path ?? 'backend/scraper/sites.toml'}
          </code>
          . The scraper reloads when the file changes.
        </p>

        {config.data?.hostnames.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {config.data.hostnames.map((h) => (
              <Badge key={h} variant="outline" className="font-mono text-[11px]">
                {h}
              </Badge>
            ))}
          </div>
        ) : null}

        <textarea
          value={content}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="mt-3 min-h-[280px] w-full rounded-md border border-border bg-background/70 px-3 py-2 font-mono text-xs leading-5 text-foreground outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring"
          placeholder={'["mystore.com"]\nplatform = "shopify"\n'}
        />
      </BentoTile>
    </BentoGrid>
  )
}
