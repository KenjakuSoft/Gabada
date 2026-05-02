import { useQuery } from '@tanstack/react-query'
import { settingsApi } from '@/api'
import type { Settings } from '@/api'
import type { PriceDisplayMode } from '@/lib/utils'

function useSettings() {
  return useQuery<Settings>({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get(),
    staleTime: 5 * 60_000,
  })
}

export function useCurrencySymbol(): string {
  const { data } = useSettings()
  return data?.currency_symbol ?? '$'
}

export function useCurrencyCode(): string {
  const { data } = useSettings()
  return data?.currency_code ?? 'USD'
}

export function useCountryCode(): string {
  const { data } = useSettings()
  return data?.country_code ?? 'US'
}

export function useExchangeRates(): Record<string, number> {
  const { data } = useSettings()
  return data?.exchange_rates ?? {}
}

export function useLocale(): string {
  const { data } = useSettings()
  return data?.locale ?? navigator.language ?? 'en-US'
}

export function usePriceDisplayMode(): PriceDisplayMode {
  const { data } = useSettings()
  return data?.price_display_mode ?? 'regional'
}

export function useTimezone(): string {
  const { data } = useSettings()
  return data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
}
