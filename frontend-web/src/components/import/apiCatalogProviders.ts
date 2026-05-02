import type { ApiPlatform } from '@/api'

export interface ApiPlatformOption {
  value: ApiPlatform
  label: string
  needsJsonConfig?: boolean
}

export interface CustomJsonApiConfig {
  url_template: string
  detail_url_template: string
  results_path: string
  external_id_path: string
  name_path: string
  url_path: string
  price_path: string
  discounted_price_path: string
  currency_path: string
  raw_price_path: string
  raw_discounted_path: string
  image_path: string
  stock_path: string
  categories_path: string
  headers_json: string
}

export const API_PLATFORM_OPTIONS: ApiPlatformOption[] = [
  { value: 'steam', label: 'Steam' },
  { value: 'apple_app_store', label: 'Apple App Store' },
  { value: 'apple_store', label: 'Apple Store', needsJsonConfig: true },
  { value: 'playstation_store', label: 'PlayStation Store', needsJsonConfig: true },
  { value: 'xbox_store', label: 'Xbox Store', needsJsonConfig: true },
  { value: 'ea_play', label: 'EA Play', needsJsonConfig: true },
  { value: 'epic_games_store', label: 'Epic Games Store', needsJsonConfig: true },
  { value: 'gog', label: 'GOG' },
  { value: 'ubisoft_store', label: 'Ubisoft Store', needsJsonConfig: true },
  { value: 'nintendo_store', label: 'Nintendo Store', needsJsonConfig: true },
  { value: 'google_play', label: 'Google Play', needsJsonConfig: true },
  { value: 'custom_json', label: 'Custom JSON API', needsJsonConfig: true },
]

export const API_PLATFORM_BASE_URLS: Partial<Record<ApiPlatform, string>> = {
  steam: 'https://store.steampowered.com',
  apple_app_store: 'https://itunes.apple.com',
  apple_store: 'https://www.apple.com/store',
  playstation_store: 'https://store.playstation.com',
  xbox_store: 'https://www.xbox.com',
  ea_play: 'https://www.ea.com/ea-play',
  epic_games_store: 'https://store.epicgames.com',
  gog: 'https://www.gog.com',
  ubisoft_store: 'https://store.ubisoft.com',
  nintendo_store: 'https://www.nintendo.com/store',
  google_play: 'https://play.google.com/store',
}

export const DEFAULT_CUSTOM_JSON_CONFIG: CustomJsonApiConfig = {
  url_template: '',
  detail_url_template: '',
  results_path: '',
  external_id_path: 'id',
  name_path: 'name',
  url_path: 'url||permalink',
  price_path: 'price',
  discounted_price_path: 'discounted_price||sale_price',
  currency_path: 'currency',
  raw_price_path: 'raw_price',
  raw_discounted_path: 'raw_discounted',
  image_path: 'image_url||image||thumbnail',
  stock_path: 'stock_status||availability||available',
  categories_path: 'categories||genres',
  headers_json: '',
}

export function apiPlatformLabel(platform: ApiPlatform | null | undefined): string {
  return (
    API_PLATFORM_OPTIONS.find((option) => option.value === platform)?.label ??
    platform ??
    'API provider'
  )
}

export function apiPlatformNeedsJsonConfig(platform: ApiPlatform): boolean {
  return API_PLATFORM_OPTIONS.some(
    (option) => option.value === platform && option.needsJsonConfig,
  )
}

export function apiPlatformBaseUrl(platform: ApiPlatform): string {
  return API_PLATFORM_BASE_URLS[platform] ?? ''
}

export function readCustomJsonConfig(
  value: Record<string, unknown> | null | undefined,
): CustomJsonApiConfig {
  const raw =
    value && typeof value.custom_json === 'object' && value.custom_json
      ? (value.custom_json as Record<string, unknown>)
      : value ?? {}
  return {
    ...DEFAULT_CUSTOM_JSON_CONFIG,
    ...Object.fromEntries(
      Object.entries(raw).map(([key, item]) => [key, String(item ?? '')]),
    ),
  }
}

export function trimCustomJsonConfig(
  config: CustomJsonApiConfig,
): CustomJsonApiConfig {
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => [key, value.trim()]),
  ) as CustomJsonApiConfig
}
