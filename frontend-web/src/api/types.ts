export type StockStatus =
  | 'in_stock'
  | 'out_of_stock'
  | 'limited'
  | 'preorder'
  | 'backorder'
  | 'call_for_price'
  | 'contact_store'
  | 'discontinued'
  | 'unknown'

export interface Category {
  id: number
  name: string
  color: string
  created_at: string
}

export interface Store {
  id: number
  name: string
  base_url: string
  manual_only: boolean
  dealer_login_url: string | null
  dealer_storage_state_path: string | null
  dealer_session_updated_at: string | null
  woo_enabled: boolean
  woo_site_url: string | null
  woo_consumer_key: string | null
  woo_consumer_secret: string | null
  woo_auto_import_new: boolean
  woo_last_synced_at: string | null
  created_at: string
}

export interface WooSyncResult {
  store_id: number
  store_name: string
  discovered: number
  created: number
  existing: number
  auto_import_new: boolean
  synced_at: string | null
}

export interface StoreCatalogClearResult {
  store_id: number
  store_name: string
  removed_links: number
  removed_products: number
  removed_logs: number
}

export interface StoreDealerSessionResponse {
  store: Store
  saved_to: string
  final_url: string
}

export interface ProductStoreSummary {
  id: number
  store_id: number
  store_name: string
  store_base_url: string
  store_manual_only: boolean
  product_url: string
  is_active: boolean
  latest_price: number | null
  latest_discounted_price: number | null
  latest_dealer_price: number | null
  latest_warranty: string | null
  latest_stock_status: StockStatus | null
  latest_scraped_at: string | null
  latest_change_type: string | null
  latest_price_delta: number | null
  manual_price: number | null
  manual_stock_status: StockStatus | null
  manual_warranty: string | null
  override_note: string | null
}

export interface Product {
  id: number
  canonical_name: string
  image_url: string | null
  category_id: number | null
  category_name: string | null
  category_color: string | null
  created_at: string
  stores: ProductStoreSummary[]
}

export interface PriceLog {
  id: number
  product_store_id: number
  scraped_at: string
  title: string | null
  price: number | null
  discounted_price: number | null
  dealer_price: number | null
  warranty: string | null
  stock_status: StockStatus | null
  change_type: string | null
  price_delta: number | null
  previous_price: number | null
  previous_stock_status: StockStatus | null
}

export interface ActivityEntry {
  id: number
  product_id: number
  product_name: string
  store_name: string
  change_type: string
  price: number | null
  discounted_price: number | null
  dealer_price: number | null
  price_delta: number | null
  previous_price: number | null
  stock_status: StockStatus | null
  previous_stock_status: StockStatus | null
  scraped_at: string
}

export interface Settings {
  currency_code: string
  currency_symbol: string
  country_code: string
  timezone: string
  scrape_cron: string
  scrape_enabled: boolean
  locale: string
  theme: 'light' | 'dark' | 'system'
  updated_at: string | null
}

export interface DatabaseCounts {
  products: number
  stores: number
  categories: number
  product_stores: number
  price_logs: number
}

export interface DatabaseTransferInfo {
  data_dir: string
  database_path: string
  site_profiles_path: string
  site_profiles_exists: boolean
  install_mode: 'desktop' | 'source'
  recommended_export_name: string
  counts: DatabaseCounts
  database_modified_at: string | null
}

export interface DatabaseImportResponse {
  source_name: string
  backup_path: string
  site_profiles_restored: boolean
  counts: DatabaseCounts
}

export interface ProbeCandidate {
  text: string
  value: number | null
  score: number
  font_size: number | null
  font_weight: number | null
  struck: boolean
  dealer: boolean
  variant_alt: boolean
  dom_path: string | null
}

export type ScrapeSelectorField =
  | 'title'
  | 'price'
  | 'discounted_price'
  | 'dealer_price'
  | 'stock_status'
  | 'image'

export type ScrapeSelectorMap = Partial<Record<ScrapeSelectorField, string | null>>

export interface ScrapeResult {
  title: string | null
  price: number | null
  discounted_price: number | null
  dealer_price: number | null
  stock_status: StockStatus
  raw_price: string | null
  raw_discounted: string | null
  raw_dealer: string | null
  review_status: string
  review_notes: string[]
  error: string | null
}

export interface SelectorLabCandidate {
  selector: string
  dom_path: string | null
  text: string | null
  sample: string | null
  value: number | null
  stock_status: StockStatus | null
  tag: string | null
  source: string
  confidence: number
  kind_hints: ScrapeSelectorField[]
  reason: string | null
}

export interface SelectorLabProfile {
  hostname: string
  matched_hostname: string | null
  platform: string | null
  wait_for: string | null
  selectors: ScrapeSelectorMap
}

export interface SelectorLabResponse {
  url: string
  final_url: string | null
  hostname: string | null
  platform: string
  root_selector: string | null
  extracted: ScrapeResult
  current_profile: SelectorLabProfile | null
  suggested_assignments: Record<string, string | null>
  candidates: SelectorLabCandidate[]
  notes: string[]
}

export interface ProbeResponse {
  url: string
  final_url: string | null
  platform: string
  suggested_wait_for: string | null
  suggested_selectors: Record<string, string | null>
  json_ld_found: boolean
  json_ld_name: string | null
  json_ld_price: number | null
  json_ld_availability: string | null
  extracted: ScrapeResult
  candidates: ProbeCandidate[]
  notes: string[]
}

export interface SelectorLabSaveResponse {
  profile: SelectorLabProfile
  path: string
  hostnames: string[]
}

export interface WooCredentials {
  site_url: string
  consumer_key: string
  consumer_secret: string
}

export interface WooProductPreview {
  woo_id: number
  name: string
  permalink: string
  regular_price: string | null
  sale_price: string | null
  stock_status: string
  image_url: string | null
  categories: string[]
}

export interface FileImportPreviewResponse {
  columns: string[]
  sample_rows: string[][]
  rows: string[][]
  total_rows: number
  file_format: 'csv' | 'excel' | 'pdf'
  source_name?: string | null
}

export interface FileImportRow {
  name: string
  source_index?: number | null
  product_id?: number | null
  product_store_id?: number | null
  url?: string | null
  image_url?: string | null
  price?: number | string | null
  discounted_price?: number | string | null
  dealer_price?: number | string | null
  warranty?: string | null
  stock_status?: string | null
}

export interface FileImportCommitResponse {
  imported: number
  created: number
  updated: number
  skipped: number
  dealer_unavailable_marked: number
}
