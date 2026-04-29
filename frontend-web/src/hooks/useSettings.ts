import { useQuery } from '@tanstack/react-query'
import { settingsApi } from '@/api'
import type { Settings } from '@/api'

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

export function useTimezone(): string {
  const { data } = useSettings()
  return data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
}
